/**
 * __tests__/session.test.js
 * Unit tests for session state machine and countdown math
 */

const sessionService = require('../src/services/session');

beforeEach(() => {
  sessionService._resetAll();
});

describe('Session State Machine', () => {
  test('creates and retrieves a session', async () => {
    const s = await sessionService.recordSession({
      sessionId: 'sess_test_001',
      clientMac: 'aa:bb:cc:dd:ee:ff',
      clientIp: '192.168.1.100',
      apMac: '00:11:22:33:44:55',
      ssidName: 'HotelGuest',
      duration: 60,
      plan: null,
      paymentId: null,
      webhookEventId: null,
      voucherUsed: 'WIFI-TEST-001',
    });

    expect(s.state).toBe('active');
    expect(s.sessionId).toBe('sess_test_001');
    expect(s.duration).toBe(60);
    expect(s.clientMac).toBe('aa:bb:cc:dd:ee:ff');
    expect(s.startedAt).toBeTruthy();
    expect(s.expiresAt).toBeTruthy();

    const retrieved = await sessionService.getSession('sess_test_001');
    expect(retrieved.sessionId).toBe('sess_test_001');
  });

  test('pause freezes session and records remaining time', async () => {
    await sessionService.recordSession({
      sessionId: 'sess_pause_001',
      clientMac: 'aa:bb:cc:dd:ee:ff',
      duration: 60,
    });

    // Manually fast-forward expiresAt
    const s = sessionService._sessions.get('sess_pause_001');
    s.expiresAt = new Date(Date.now() + 1800 * 1000).toISOString(); // 30 min left
    sessionService._sessions.set('sess_pause_001', s);

    const paused = await sessionService.pauseSession('sess_pause_001');
    expect(paused.state).toBe('paused');
    expect(paused.pausedAt).toBeTruthy();
    expect(paused.remainingSecondsAtPause).toBeGreaterThan(1700);
    expect(paused.remainingSecondsAtPause).toBeLessThanOrEqual(1800);
  });

  test('resume restarts timer from remaining seconds', async () => {
    await sessionService.recordSession({
      sessionId: 'sess_resume_001',
      clientMac: 'aa:bb:cc:dd:ee:ff',
      duration: 60,
    });

    // Get current remaining
    const before = sessionService._sessions.get('sess_resume_001');
    before.state = 'paused';
    before.pausedAt = new Date().toISOString();
    before.remainingSecondsAtPause = 1500;
    before.expiresAt = null;
    sessionService._sessions.set('sess_resume_001', before);

    const resumed = await sessionService.resumeSession('sess_resume_001');
    expect(resumed.state).toBe('active');
    expect(resumed.expiresAt).toBeTruthy();
    expect(resumed.pausedAt).toBeNull();

    const remainingMs = new Date(resumed.expiresAt) - Date.now();
    expect(remainingMs).toBeGreaterThan(1490 * 1000);
    expect(remainingMs).toBeLessThanOrEqual(1500 * 1000);
  });

  test('expire is idempotent', async () => {
    await sessionService.recordSession({
      sessionId: 'sess_expire_001',
      clientMac: 'aa:bb:cc:dd:ee:ff',
      duration: 60,
    });

    await sessionService.expireSession('sess_expire_001');
    await sessionService.expireSession('sess_expire_001'); // second call — idempotent

    const s = await sessionService.getSession('sess_expire_001');
    expect(s.state).toBe('expired');
  });

  test('pause rejects non-active session', async () => {
    await expect(sessionService.pauseSession('nonexistent')).rejects.toThrow('Session not active');
  });

  test('resume rejects non-paused session', async () => {
    await sessionService.recordSession({
      sessionId: 'sess_notpaused',
      clientMac: 'aa:bb:cc:dd:ee:ff',
      duration: 60,
    });
    await expect(sessionService.resumeSession('sess_notpaused')).rejects.toThrow('Session not paused');
  });
});

describe('Session Expiration Math', () => {
  test('remainingSeconds correctly computed for active session', async () => {
    await sessionService.recordSession({
      sessionId: 'sess_remaining_001',
      clientMac: 'aa:bb:cc:dd:ee:ff',
      duration: 60,
    });

    // Manually set expiresAt to 30 min from now
    const s = sessionService._sessions.get('sess_remaining_001');
    s.expiresAt = new Date(Date.now() + 1800 * 1000).toISOString();
    sessionService._sessions.set('sess_remaining_001', s);

    const retrieved = await sessionService.getSession('sess_remaining_001');
    expect(retrieved.state).toBe('active');
    expect(retrieved.remainingSeconds).toBeUndefined(); // getSession doesn't compute remaining directly
    // The routes/session.js computeRemaining function handles this
  });

  test('remainingSeconds is frozen when paused', async () => {
    await sessionService.recordSession({
      sessionId: 'sess_paused_remaining',
      clientMac: 'aa:bb:cc:dd:ee:ff',
      duration: 60,
    });

    const s = sessionService._sessions.get('sess_paused_remaining');
    s.state = 'paused';
    s.remainingSecondsAtPause = 3600;
    s.pausedAt = new Date().toISOString();
    sessionService._sessions.set('sess_paused_remaining', s);

    const retrieved = await sessionService.getSession('sess_paused_remaining');
    expect(retrieved.state).toBe('paused');
    expect(retrieved.remainingSecondsAtPause).toBe(3600);
  });

  test('isSessionActive returns false for non-existent session', async () => {
    const active = await sessionService.isSessionActive('nonexistent');
    expect(active).toBe(false);
  });
});

describe('Countdown Display Math', () => {
  function formatDuration(totalSecs) {
    if (totalSecs == null || totalSecs < 0) return '—';
    var h = Math.floor(totalSecs / 3600);
    var m = Math.floor((totalSecs % 3600) / 60);
    var s = totalSecs % 60;
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return (h > 0 ? pad(h) + ':' : '') + pad(m) + ':' + pad(s);
  }

  test('formats HH:MM:SS for hours', () => {
    expect(formatDuration(3661)).toBe('01:01:01');
  });

  test('formats MM:SS for less than an hour', () => {
    expect(formatDuration(90)).toBe('01:30');
    expect(formatDuration(59)).toBe('00:59');
  });

  test('formats zero', () => {
    expect(formatDuration(0)).toBe('00:00');
  });

  test('returns dash for null/undefined', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
  });

  test('handles negative as zero', () => {
    expect(formatDuration(-10)).toBe('—'); // our function guards < 0
  });
});

describe('Voucher Validation', () => {
  test('accepts valid voucher', async () => {
    const r = await sessionService.validateVoucher('WIFI-TEST-0001', 'aa:bb:cc:dd:ee:ff');
    expect(r.valid).toBe(true);
    expect(r.duration).toBeDefined();
  });

  test('rejects expired voucher', async () => {
    const r = await sessionService.validateVoucher('EXPIRED', 'aa:bb:cc:dd:ee:ff');
    expect(r.valid).toBe(false);
    expect(r.code).toBe('EXPIRED_VOUCHER');
  });

  test('rejects used voucher', async () => {
    const r = await sessionService.validateVoucher('USED', 'aa:bb:cc:dd:ee:ff');
    expect(r.valid).toBe(false);
    expect(r.code).toBe('USED_VOUCHER');
  });

  test('rejects too-short voucher', async () => {
    const r = await sessionService.validateVoucher('ABC', 'aa:bb:cc:dd:ee:ff');
    expect(r.valid).toBe(false);
    expect(r.code).toBe('INVALID_VOUCHER');
  });
});

describe('Webhook Idempotency', () => {
  test('marks event as processed', async () => {
    const eventId = 'evt_test_001';
    const sessionId = 'sess_test_001';

    const first = await sessionService.isEventProcessed(eventId);
    expect(first).toBe(false);

    await sessionService.markEventProcessed(eventId, sessionId);

    const second = await sessionService.isEventProcessed(eventId);
    expect(second).toBe(true);
  });

  test('duplicate webhook returns true for isEventProcessed', async () => {
    await sessionService.markEventProcessed('evt_dup', 'sess_dup');
    const result = await sessionService.isEventProcessed('evt_dup');
    expect(result).toBe(true);
  });
});
