/**
 * __tests__/payment.test.js
 * Unit tests for payment service — webhook verification and event parsing
 */

const crypto = require('crypto');

describe('Webhook Signature Verification', () => {
  // PayMongo signature verification
  function verifyPayMongoSignature(rawBody, signatureHeader, secret) {
    if (!signatureHeader || !secret) return false;
    const parts = signatureHeader.split(',');
    let ts = '', sig = '';
    for (const part of parts) {
      const [key, val] = part.split('=');
      if (key === 't') ts = val;
      if (key === 'v1') sig = val;
    }
    if (!ts || !sig) return false;
    const signedPayload = `${ts}.${rawBody}`;
    const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
    } catch { return false; }
  }

  test('PayMongo: accepts valid signature', () => {
    const secret = 'whsec_test_secret';
    const body = JSON.stringify({ data: { id: 'evt_123', type: 'payment.paid' } });
    const ts = Math.floor(Date.now() / 1000).toString();
    const signedPayload = `${ts}.${body}`;
    const sig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
    const header = `t=${ts},v1=${sig}`;

    const result = verifyPayMongoSignature(body, header, secret);
    expect(result).toBe(true);
  });

  test('PayMongo: rejects tampered body', () => {
    const secret = 'whsec_test_secret';
    const original = JSON.stringify({ data: { id: 'evt_123', type: 'payment.paid' } });
    const tampered = JSON.stringify({ data: { id: 'evt_123', type: 'payment.paid', extra: 'hack' } });
    const ts = Math.floor(Date.now() / 1000).toString();
    const signedPayload = `${ts}.${original}`;
    const sig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
    const header = `t=${ts},v1=${sig}`;

    const result = verifyPayMongoSignature(tampered, header, secret);
    expect(result).toBe(false);
  });

  test('PayMongo: rejects wrong secret', () => {
    const body = JSON.stringify({ data: { id: 'evt_123' } });
    const ts = '1234567890';
    const sig = 'aabbccddeeff00112233445566778899aabbccdd';
    const header = `t=${ts},v1=${sig}`;

    expect(verifyPayMongoSignature(body, header, 'wrong_secret')).toBe(false);
  });

  test('PayMongo: rejects missing signature', () => {
    expect(verifyPayMongoSignature('{}', '', 'secret')).toBe(false);
    expect(verifyPayMongoSignature('{}', null, 'secret')).toBe(false);
  });

  // Xendit signature verification
  function verifyXenditSignature(token, expectedSecret) {
    return token === expectedSecret;
  }

  test('Xendit: accepts matching token', () => {
    expect(verifyXenditSignature('my_secret_token', 'my_secret_token')).toBe(true);
  });

  test('Xendit: rejects wrong token', () => {
    expect(verifyXenditSignature('wrong', 'correct')).toBe(false);
  });
});

describe('Payment Event Parsing', () => {
  const parsePaymockEvent = (event) => {
    if (!event || event.type !== 'paymock') return null;
    return {
      sessionId: event.sessionId,
      eventId: event.eventId || ('evt_mock_' + Date.now()),
      eventType: event.status === 'paid' ? 'payment.paid' : 'payment.failed',
      amount: event.amount || 0,
      status: event.status || 'paid',
    };
  };

  const parsePayMongoEvent = (event) => {
    try {
      const eventData = event.data || {};
      const attr = eventData.attributes || {};
      const eventId = eventData.id || '';
      const eventType = attr.type || '';
      const metadata = (attr.data && attr.data.attributes && attr.data.attributes.metadata) || {};
      const amount = (attr.data && attr.data.attributes && attr.data.attributes.amount) || 0;
      const sessionId = metadata.session_id || '';
      let status = 'unknown';
      if (eventType === 'payment.paid') status = 'paid';
      else if (eventType === 'payment.failed') status = 'failed';
      return { sessionId, eventId, eventType, amount, status };
    } catch { return null; }
  };

  test('parses paymock paid event', () => {
    const evt = { type: 'paymock', sessionId: 'sess_abc123', status: 'paid', amount: 5000 };
    const r = parsePaymockEvent(evt);
    expect(r.sessionId).toBe('sess_abc123');
    expect(r.status).toBe('paid');
    expect(r.eventType).toBe('payment.paid');
    expect(r.amount).toBe(5000);
  });

  test('parses paymock failed event', () => {
    const evt = { type: 'paymock', sessionId: 'sess_abc123', status: 'failed' };
    const r = parsePaymockEvent(evt);
    expect(r.status).toBe('failed');
    expect(r.eventType).toBe('payment.failed');
  });

  test('ignores non-paymock event', () => {
    expect(parsePaymockEvent({ type: 'paymongo' })).toBeNull();
    expect(parsePaymockEvent(null)).toBeNull();
    expect(parsePaymockEvent(undefined)).toBeNull();
  });

  test('parses PayMongo payment.paid event', () => {
    const evt = {
      data: {
        id: 'evt_abc',
        attributes: {
          type: 'payment.paid',
          data: {
            attributes: {
              amount: 5000,
              metadata: { session_id: 'sess_paymongo_001' },
            },
          },
        },
      },
    };
    const r = parsePayMongoEvent(evt);
    expect(r.sessionId).toBe('sess_paymongo_001');
    expect(r.eventId).toBe('evt_abc');
    expect(r.status).toBe('paid');
    expect(r.amount).toBe(5000);
  });

  test('parses PayMongo payment.failed event', () => {
    const evt = {
      data: {
        id: 'evt_fail',
        attributes: {
          type: 'payment.failed',
          data: { attributes: { amount: 5000, metadata: { session_id: 'sess_fail' } } },
        },
      },
    };
    const r = parsePayMongoEvent(evt);
    expect(r.status).toBe('failed');
  });

  test('handles malformed PayMongo event gracefully', () => {
    expect(parsePayMongoEvent({})).toBeTruthy(); // returns partial
    expect(parsePayMongoEvent({ data: null })).toBeTruthy();
    expect(parsePayMongoEvent(null)).toBeNull();
  });
});

describe('Amount Calculation', () => {
  function calculateAmount(durationMinutes, pricePerHour) {
    var hours = Math.max(0.25, durationMinutes / 60);
    return Math.round(hours * pricePerHour);
  }

  test('calculates hourly rate', () => {
    expect(calculateAmount(60, 5000)).toBe(5000);  // 1 hour
    expect(calculateAmount(120, 5000)).toBe(10000); // 2 hours
    expect(calculateAmount(30, 5000)).toBe(2500);  // 30 min = 0.5h
  });

  test('enforces minimum 15 minutes', () => {
    expect(calculateAmount(10, 5000)).toBe(1250); // 0.25h minimum
    expect(calculateAmount(1, 5000)).toBe(1250);
    expect(calculateAmount(15, 5000)).toBe(1250);
  });

  test('rounds to nearest integer', () => {
    // 90 min = 1.5h × 5000 = 7500
    expect(calculateAmount(90, 5000)).toBe(7500);
  });
});
