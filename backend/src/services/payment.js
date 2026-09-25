/**
 * services/payment.js — Payment provider adapter
 *
 * Supports:
 *   - paymock   : Mock provider for local testing (no real payments)
 *   - paymongo  : PayMongo (PH) — https://paymongo.com
 *   - xendit    : Xendit (SEA) — https://xendit.co
 *
 * To add a provider:
 *   1. Add a new branch in each of the 3 main functions below.
 *   2. Implement createCheckout, verifyWebhook, handleEvent.
 *   3. Document the webhook endpoint URL the provider should call.
 */

const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');

const PROVIDER = process.env.PAYMENT_PROVIDER || 'paymock';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Provider-specific configs
const PAYMONGO_SECRET    = process.env.PAYMONGO_SECRET_KEY    || '';
const PAYMONGO_WEBHOOK   = process.env.PAYMONGO_WEBHOOK_SECRET || '';
const PAYMONGO_BASE      = process.env.PAYMENT_BASE_URL       || 'https://api.paymongo.com';
const PAYMONGO_CHECKOUT  = process.env.PAYMENT_CHECKOUT_URL    || 'https://checkout.paymongo.com';

const XENDIT_SECRET      = process.env.XENDIT_SECRET_KEY       || '';
const XENDIT_WEBHOOK     = process.env.XENDIT_WEBHOOK_SECRET   || '';
const XENDIT_EWALLET_CHANNELS = (process.env.XENDIT_EWALLET_CHANNELS || 'GCASH,PAYMAYA').split(',').map(s => s.trim());
const XENDIT_QRIS_ENABLED = process.env.XENDIT_QRIS_ENABLED === 'true';

const PRICE_PER_HOUR     = parseInt(process.env.PRICE_PER_HOUR || '5000', 10); // in cents/smallest unit

/**
 * Create a checkout session.
 * Returns { checkoutUrl, providerSessionId }
 */
async function createPaymentCheckout({ sessionId, duration, clientMac, clientIp, apMac, ssidName, redirectUrl }) {
  const amount = calculateAmount(duration);
  const successUrl = `${BASE_URL}/success.html?sessionId=${encodeURIComponent(sessionId)}&redirectUrl=${encodeURIComponent(redirectUrl || '')}`;
  const cancelUrl = `${BASE_URL}/index.html?cancelled=1`;

  switch (PROVIDER) {
    case 'paymock':
      return createPaymockCheckout({ sessionId, duration, amount, successUrl, cancelUrl });
    case 'paymongo':
      return createPaymongoCheckout({ sessionId, duration, amount, successUrl, cancelUrl, clientIp });
    case 'xendit':
      return createXenditCheckout({ sessionId, duration, amount, successUrl, cancelUrl, clientIp });
    default:
      throw new Error('Unknown payment provider: ' + PROVIDER);
  }
}

/**
 * Verify the webhook signature.
 * Returns true if signature is valid.
 *
 * PayMongo: signature in Paymongo-Signature header
 * Xendit:  signature in x-callback-token header
 * paymock: no verification (mock only)
 */
async function verifyWebhook(rawBody, headers, provider) {
  const prov = provider || PROVIDER;

  switch (prov) {
    case 'paymock':
      return true; // Mock: always accept
    case 'paymongo':
      return verifyPayMongoSignature(rawBody, headers);
    case 'xendit':
      return verifyXenditSignature(rawBody, headers);
    default:
      return false;
  }
}

/**
 * Handle a verified webhook event.
 * Returns action taken: 'confirmed', 'failed', 'ignored', 'duplicate'
 */
async function handlePaymentEvent(event, provider) {
  const prov = provider || PROVIDER;

  let parsed;
  switch (prov) {
    case 'paymock':
      parsed = parsePaymockEvent(event);
      break;
    case 'paymongo':
      parsed = parsePayMongoEvent(event);
      break;
    case 'xendit':
      parsed = parseXenditEvent(event);
      break;
    default:
      return 'ignored';
  }

  if (!parsed || !parsed.sessionId) {
    return 'ignored';
  }

  const { sessionId, eventId, eventType, amount, status } = parsed;

  // Import session service lazily to avoid circular dependency
  const { isEventProcessed, markEventProcessed, activatePaidSession, markPaymentFailed } = require('./session');

  // Idempotency check: already processed?
  if (await isEventProcessed(eventId)) {
    return 'duplicate';
  }

  await markEventProcessed(eventId, sessionId);

  if (status === 'paid' || status === 'succeeded' || eventType === 'payment.paid') {
    await activatePaidSession(sessionId, eventId, amount);
    return 'confirmed';
  }

  if (status === 'failed' || eventType === 'payment.failed') {
    await markPaymentFailed(sessionId, eventId);
    return 'failed';
  }

  return 'ignored';
}

// ================================================================
// PAYMOCK — test provider
// ================================================================
async function createPaymockCheckout({ sessionId, duration, amount, successUrl, cancelUrl }) {
  // Mock: generate a fake checkout URL. In test mode, the webhook is auto-fired
  // by the test harness. For manual testing, a mock webhook can be triggered via:
  // POST /api/payment/webhook with body { type: 'paymock', eventId: 'evt_test_...', sessionId, status: 'paid' }
  const mockUrl = `${BASE_URL}/mock-checkout.html?sessionId=${encodeURIComponent(sessionId)}&amount=${amount}&success=${encodeURIComponent(successUrl)}&cancel=${encodeURIComponent(cancelUrl)}`;
  return {
    checkoutUrl: mockUrl,
    providerSessionId: 'mock_' + sessionId,
  };
}

function parsePaymockEvent(event) {
  if (!event || event.type !== 'paymock') return null;
  return {
    sessionId: event.sessionId,
    eventId: event.eventId || ('evt_mock_' + Date.now()),
    eventType: event.status === 'paid' ? 'payment.paid' : 'payment.failed',
    amount: event.amount || 0,
    status: event.status || 'paid',
  };
}

// ================================================================
// PAYMONGO
// ================================================================
async function createPaymongoCheckout({ sessionId, duration, amount, successUrl, cancelUrl, clientIp }) {
  const body = JSON.stringify({
    data: {
      attributes: {
        send_email_receipt: true,
        show_description: true,
        show_line_items: true,
        line_items: [
          {
            name: `WiFi Access (${duration} min)`,
            description: `Wireless internet access for ${duration} minutes`,
            quantity: 1,
            amount: amount,
            currency: 'PHP',
          },
        ],
        payment_method_types: ['gcash', 'card', 'paymaya'],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          session_id: sessionId,
          duration_minutes: duration,
          client_ip: clientIp || '',
        },
      },
    },
  });

  const response = await paymongoRequest('POST', '/v1/checkout_sessions', body);
  if (!response || !response.data || !response.data.id) {
    throw new Error('PayMongo checkout creation failed: ' + JSON.stringify(response).slice(0, 200));
  }

  return {
    checkoutUrl: `${PAYMONGO_CHECKOUT}/checkout/${response.data.id}`,
    providerSessionId: response.data.id,
  };
}

function verifyPayMongoSignature(rawBody, headers) {
  const signature = headers['paymongo-signature'] || headers['Paymongo-Signature'];
  if (!signature) return false;
  if (!PAYMONGO_WEBHOOK) return false;

  // PayMongo uses HMAC-SHA-256 with webhook secret
  // Format: t=<timestamp>,v1=<signature>
  const parts = signature.split(',');
  let ts = '';
  let sig = '';
  for (const part of parts) {
    const [key, val] = part.split('=');
    if (key === 't') ts = val;
    if (key === 'v1') sig = val;
  }
  if (!ts || !sig) return false;

  const signedPayload = `${ts}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', PAYMONGO_WEBHOOK)
    .update(signedPayload)
    .digest('hex');

  // Constant-time comparison
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

function parsePayMongoEvent(event) {
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

    return {
      sessionId,
      eventId,
      eventType,
      amount,
      status,
    };
  } catch {
    return null;
  }
}

function paymongoRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const base = new URL(PAYMONGO_BASE);
    const opts = {
      hostname: base.hostname,
      port: base.port || 443,
      path: path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body || ''),
        'Accept': 'application/json',
        // PayMongo uses Basic auth with secret key as username, empty password
        'Authorization': 'Basic ' + Buffer.from(PAYMONGO_SECRET + ':').toString('base64'),
      },
      timeout: 15000,
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('PayMongo request timed out')); });
    if (body) req.write(body);
    req.end();
  });
}

// ================================================================
// XENDIT
// ================================================================
async function createXenditCheckout({ sessionId, duration, amount, successUrl, cancelUrl }) {
  // Build payment methods based on config
  const paymentMethods = ['CARD', 'EWALLET'];
  if (XENDIT_QRIS_ENABLED) paymentMethods.push('QR_CODE');

  const body = JSON.stringify({
    external_id: sessionId,
    payer_email: 'guest@example.com',
    description: `WiFi Access (${duration} min)`,
    amount,
    success_redirect_url: successUrl,
    failure_redirect_url: cancelUrl,
    payment_methods: paymentMethods,
    currency: 'PHP',
    metadata: {
      session_id: sessionId,
      duration_minutes: duration,
    },
  });

  const response = await xenditRequest('POST', '/v2/invoices', body);
  if (!response || !response.id) {
    throw new Error('Xendit checkout creation failed: ' + JSON.stringify(response).slice(0, 200));
  }

  return {
    checkoutUrl: response.invoice_url,
    providerSessionId: response.id,
  };
}

function verifyXenditSignature(rawBody, headers) {
  // Xendit uses x-callback-token header to verify webhook source
  const token = headers['x-callback-token'] || headers['X-Callback-Token'];
  return token === XENDIT_WEBHOOK;
}

function parseXenditEvent(event) {
  if (!event || !event.external_id) return null;
  return {
    sessionId: event.external_id,
    eventId: event.id || ('evt_xendit_' + Date.now()),
    eventType: event.status === 'PAID' ? 'payment.paid' : 'payment.failed',
    amount: event.amount || 0,
    status: event.status && event.status.toLowerCase() === 'paid' ? 'paid' : 'failed',
  };
}

function xenditRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.xendit.co',
      port: 443,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body || ''),
        'Accept': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(XENDIT_SECRET + ':').toString('base64'),
      },
      timeout: 15000,
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Xendit request timed out')); });
    if (body) req.write(body);
    req.end();
  });
}

// ================================================================
// Helpers
// ================================================================
function calculateAmount(durationMinutes) {
  // Simple pricing: price per hour, pro-rated to minimum 15 min
  const hours = Math.max(0.25, durationMinutes / 60);
  return Math.round(hours * PRICE_PER_HOUR);
}

module.exports = {
  createPaymentCheckout,
  verifyWebhook,
  handlePaymentEvent,
  // Exposed for testing
  _internal: {
    calculateAmount,
    verifyPayMongoSignature,
    verifyXenditSignature,
    parsePaymockEvent,
    parsePayMongoEvent,
    parseXenditEvent,
    PROVIDER,
  },
};
