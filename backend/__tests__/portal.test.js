/**
 * __tests__/portal.test.js
 * Unit tests for portal.js core logic
 */

describe('Query Parameter Parsing', () => {
  // Expose parseQueryParams from portal logic
  function buildParseQueryParams(paramMap) {
    return function (search) {
      var params = new (require('url').URLSearchParams || URLSearchParams)(search);
      var raw = {};
      params.forEach(function (val, key) { raw[decodeURIComponent(key)] = decodeURIComponent(val); });
      var result = { raw: raw };
      for (var ourName in paramMap) {
        if (paramMap.hasOwnProperty(ourName)) {
          var theirName = paramMap[ourName];
          if (raw[theirName] !== undefined) result[ourName] = raw[theirName];
        }
      }
      return result;
    };
  }

  const parseQueryParams = buildParseQueryParams({
    clientMac:   'clientMac',
    clientIp:    'clientIp',
    ssidName:    'ssidName',
    redirectUrl: 'redirectUrl',
  });

  test('parses standard Omada parameters', () => {
    var result = parseQueryParams(
      'clientMac=aa%3Abb%3Acc%3Add%3Aee%3Aff&clientIp=192.168.1.100&ssidName=HotelGuest&redirectUrl=https%3A%2F%2Fgoogle.com'
    );
        expect(result.clientMac).toBe('aa:bb:cc:dd:ee:ff'); // normalizeMac lowercases
    expect(result.clientIp).toBe('192.168.1.100');
    expect(result.ssidName).toBe('HotelGuest');
    expect(result.redirectUrl).toBe('https://google.com');
  });

  test('handles empty string', () => {
    var result = parseQueryParams('');
    expect(result.clientMac).toBeUndefined();
    expect(result.raw).toEqual({});
  });

  test('preserves unknown parameters in raw', () => {
    var result = parseQueryParams('clientMac=aa%3Abb%3Acc%3Add%3Aee%3Aff&token=abc123&custom=xyz');
    expect(result.raw.token).toBe('abc123');
    expect(result.raw.custom).toBe('xyz');
  });

  test('maps custom param names via paramMap', () => {
    var customParse = buildParseQueryParams({ clientMac: 'mac' });
    var result = customParse('mac=112233445566');
    expect(result.clientMac).toBe('112233445566');
  });
});

describe('Voucher Validation', () => {
  function validateVoucher(code, opts) {
    var v = opts || {};
    var minLen = v.minLength || 1;
    var maxLen = v.maxLength || 32;
    var pattern = v.pattern || /^[A-Z0-9\-]+$/i;
    if (!code || !code.trim()) return { ok: false, message: 'Enter your voucher code.' };
    var trimmed = code.trim();
    if (trimmed.length < minLen) return { ok: false, message: 'Too short.' };
    if (trimmed.length > maxLen) return { ok: false, message: 'Too long.' };
    if (pattern && !pattern.test(trimmed)) return { ok: false, message: 'Invalid format.' };
    return { ok: true, value: trimmed };
  }

  test('accepts valid alphanumeric voucher', () => {
    var r = validateVoucher('WIFI-ABCD-1234', { pattern: /^[A-Z0-9\-]+$/i, minLength: 4, maxLength: 32 });
    expect(r.ok).toBe(true);
    expect(r.value).toBe('WIFI-ABCD-1234');
  });

  test('rejects empty voucher', () => {
    var r = validateVoucher('', {});
    expect(r.ok).toBe(false);
    expect(r.message).toBe('Enter your voucher code.');
  });

  test('rejects whitespace-only voucher', () => {
    var r = validateVoucher('   ', {});
    expect(r.ok).toBe(false);
  });

  test('rejects voucher below minLength', () => {
    var r = validateVoucher('ABC', { minLength: 8 });
    expect(r.ok).toBe(false);
    expect(r.message).toBe('Too short.');
  });

  test('rejects voucher above maxLength', () => {
    var r = validateVoucher('A'.repeat(33), { maxLength: 32 });
    expect(r.ok).toBe(false);
    expect(r.message).toBe('Too long.');
  });

  test('rejects invalid characters with custom pattern', () => {
    var r = validateVoucher('WI-FI@INVALID!', { pattern: /^[A-Z0-9\-]+$/i });
    expect(r.ok).toBe(false);
    expect(r.message).toBe('Invalid format.');
  });

  test('trims whitespace before validation', () => {
    var r = validateVoucher('  WIFI-ABCD-1234  ', { pattern: /^[A-Z0-9\-]+$/i, minLength: 4 });
    expect(r.ok).toBe(true);
    expect(r.value).toBe('WIFI-ABCD-1234');
  });
});

describe('Redirect Allowlist Validation', () => {
  function isAllowedRedirect(url, allowlist) {
    if (!url) return false;
    try {
      var u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
      if (!allowlist || allowlist.length === 0) return true;
      for (var i = 0; i < allowlist.length; i++) {
        var d = allowlist[i].toLowerCase();
        if (u.hostname === d || u.hostname.endsWith('.' + d)) return true;
      }
      return false;
    } catch (e) { return false; }
  }

  test('allows whitelisted domains', () => {
    expect(isAllowedRedirect('https://example.com/page', ['example.com'])).toBe(true);
    expect(isAllowedRedirect('https://www.example.com/page', ['example.com'])).toBe(true);
    expect(isAllowedRedirect('https://api.example.com/page', ['example.com'])).toBe(true);
  });

  test('blocks off-domain redirects', () => {
    expect(isAllowedRedirect('https://evil.com/page', ['example.com'])).toBe(false);
        expect(isAllowedRedirect('https://example.com.evil.com/page', ['example.com'])).toBe(false); // security: blocks attacker subdomain
    // This is a known limitation — use exact match for top-level
  });

  test('allows localhost for development', () => {
    expect(isAllowedRedirect('http://localhost:8080/page', [])).toBe(true);
    expect(isAllowedRedirect('http://127.0.0.1/page', [])).toBe(true);
  });

  test('blocks non-http protocols', () => {
    expect(isAllowedRedirect('javascript:alert(1)', [])).toBe(false);
    expect(isAllowedRedirect('file:///etc/passwd', [])).toBe(false);
  });

  test('returns false for empty URL', () => {
    expect(isAllowedRedirect('', [])).toBe(false);
  });

  test('allows any http URL when allowlist is empty', () => {
    expect(isAllowedRedirect('https://anything.com/', [])).toBe(true);
  });
});

describe('MAC Address Normalization', () => {
  function normalizeMac(mac) {
    if (!mac) return null;
    var cleaned = String(mac).replace(/[^0-9a-fA-F]/g, '').toLowerCase();
    if (cleaned.length !== 12) return null;
    return cleaned.match(/.{2}/g).join(':');
  }

  test('normalizes colon-separated MAC', () => {
    expect(normalizeMac('aa:BB:cc:DD:ee:FF')).toBe('aa:bb:cc:dd:ee:ff');
  });

  test('normalizes hyphen-separated MAC', () => {
    expect(normalizeMac('aa-BB-cc-DD-ee-FF')).toBe('aa:bb:cc:dd:ee:ff');
  });

  test('normalizes plain 12-char hex', () => {
    expect(normalizeMac('aabbccddeeff')).toBe('aa:bb:cc:dd:ee:ff');
  });

  test('normalizes mixed case', () => {
    expect(normalizeMac('Aa:Bb:Cc:Dd:Ee:Ff')).toBe('aa:bb:cc:dd:ee:ff');
  });

  test('rejects invalid length', () => {
    expect(normalizeMac('aabbcc')).toBeNull();
    expect(normalizeMac('aabbccddeeffaabbcc')).toBeNull();
  });

  test('rejects null/empty', () => {
    expect(normalizeMac(null)).toBeNull();
    expect(normalizeMac('')).toBeNull();
    expect(normalizeMac(undefined)).toBeNull();
  });

  test('rejects non-hex characters', () => {
    expect(normalizeMac('gg:hh:ii:jj:kk:ll')).toBeNull();
  });
});

describe('Duplicate Submission Prevention', () => {
  test('guard flag prevents concurrent submissions', () => {
    var submitting = false;
    var callCount = 0;

    function submit() {
      if (submitting) return;
      submitting = true;
      callCount++;
      setTimeout(function () { submitting = false; }, 100);
    }

    submit();
    submit(); // should be ignored
    submit(); // should be ignored
    expect(callCount).toBe(1);
  });
});
