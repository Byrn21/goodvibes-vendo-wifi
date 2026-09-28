/**
 * services/payment.js — Payment provider adapter
 *
 * Supports:
 *   - paymongo  : PayMongo (PH) — https://paymongo.com
 *
 * PayMongo provides GCash, Maya, and QRPh payment methods via checkout sessions.
 * Webhook events are verified via HMAC-SHA256 signature.
 *
 * @see https://developers.paymongo.com/docs
 */

const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');

const PROVIDER = process.env.PAYMENT_PROVIDER || 'paymongo';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// ── PayMongo configuration ─────────────────────────────────────────
const PAYMONGO_SECRET   = process.env.PAYMONGO_SECRET_KEY     || '';
const PAYMONGO_WEBHOOK  = process.env.PAYMONGO_WEBHOOK_SECRET  || '';
const PAYMONGO_BASE     = process.env.PAYMENT_BASE_URL        || 'https://api.paymongo.com';
const PAYMONGO_CHECKOUT = process.env.PAYMENT_CHECKOUT_URL    || 'https://checkout.paymongo.com';

const PRICE_PER_HOUR    = parseInt(process.env.PRICE_PER_HOUR || '5000', 10); // in cents/smallest unit
const PREMIUM_MODIFIER  = parseFloat(process.env.PREMIUM_PRICE_MODIFIER || '1.5');

/**
 * Calculate the charge amount for a given duration.
 * Simple pricing: price per hour, pro-rated with a minimum of 15 minutes.
 */
function calculateAmount(durationMinutes, voucherType) {
  voucherType = voucherType || 'standard';
  const hours = Math.max(0.25, durationMinutes / 60);
  let amount = Math.round(hours * PRICE_PER_HOUR);

  if (voucherType === 'premium') {
    amount = Math.round(amount * PREMIUM_MODIFIER);
  }

  return amount;
}

/**
 * Create a checkout session.
 *
 * @param {Object} opts - { sessionId, duration, method, clientMac, clientIp, apMac, ssidName, redirectUrl }
 *   @param {string} [opts.method] - Single payment method ('gcash'|'maya'|'qrph'). If omitted, all methods are offered.
 * @returns {Promise<{ checkoutUrl: string, providerSessionId: string }>}
 */
async function createPaymentCheckout({ sessionId, duration, method, clientMac, clientIp, apMac, ssidName, redirectUrl, voucherType, planId }) {
  voucherType = voucherType || 'standard';
  const amount = calculateAmount(duration, voucherType);

  const successUrl = `${BASE_URL}/success.html?sessionId=${encodeURIComponent(sessionId)}&redirectUrl=${encodeURIComponent(redirectUrl || '')}`;
  const cancelUrl  = `${BASE_URL}/index.html?cancelled=1`;

  switch (PROVIDER) {
    case 'paymongo':
            return createPaymongoCheckout({ sessionId, duration, amount, successUrl, cancelUrl, clientIp, method, voucherType, planId });
    default:
      throw new Error('Unknown payment provider: ' + PROVIDER);
  }
}

/**
 * Verify the webhook signature.
 *
 * PayMongo: signature in 'Paymongo-Signature' header (format: t=<timestamp>,v1=<signature>)
 * Uses HMAC-SHA256 with the webhook secret.
 *
 * @param {string|Buffer} rawBody - The raw, unparsed request body
 * @param {Object} headers - The request headers
 * @param {string} [provider] - Override provider
 * @returns {Promise<boolean>}
 */
async function verifyWebhook(rawBody, headers, provider) {
  const prov = provider || PROVIDER;

  switch (prov) {
    case 'paymongo':
      return verifyPayMongoSignature(rawBody, headers);
    default:
      return false;
  }
}

/**
 * Handle a verified webhook event.
 *
 * Returns action taken: 'confirmed', 'failed', 'ignored', 'duplicate'
 *
 * @param {Object} event - The parsed webhook event body
 * @param {string} [provider] - Override provider
 * @returns {Promise<string>}
 */
async function handlePaymentEvent(event, provider) {
  const prov = provider || PROVIDER;

  let parsed;
  switch (prov) {
    case 'paymongo':
      parsed = parsePayMongoEvent(event);
      break;
    default:
      return 'ignored';
  }

  if (!parsed || !parsed.sessionId) {
    return 'ignored';
  }

    const { sessionId, eventId, eventType, amount, status, voucherType } = parsed;

  // Import session service lazily to avoid circular dependency
  const { isEventProcessed, markEventProcessed, activatePaidSession, markPaymentFailed } = require('./session');

  // Idempotency check: already processed?
  if (await isEventProcessed(eventId)) {
    return 'duplicate';
  }

  await markEventProcessed(eventId, sessionId);

    if (status === 'paid' || status === 'succeeded' || eventType === 'payment.paid') {
    await activatePaidSession(sessionId, eventId, amount, voucherType);
    return 'confirmed';
  }

  if (status === 'failed' || eventType === 'payment.failed') {
    await markPaymentFailed(sessionId, eventId);
    return 'failed';
  }

    return 'ignored';
}

// ================================================================
// PAYMONGO
// ================================================================

/**
 * Create a PayMongo checkout session.
 *
 * @param {Object} opts - { sessionId, duration, amount, successUrl, cancelUrl, clientIp }
 * @returns {Promise<{ checkoutUrl: string, providerSessionId: string }>}
 */
async function createPaymongoCheckout({ sessionId, duration, amount, successUrl, cancelUrl, clientIp, method, voucherType, planId }) {
  // Filter to the user-selected payment method, or offer all three if none specified
  var paymentMethodTypes = ['gcash', 'maya', 'qrph'];
  if (method && paymentMethodTypes.indexOf(method) !== -1) {
    paymentMethodTypes = [method];
  }

  const body = JSON.stringify({
    data: {
      attributes: {
        send_email_receipt: true,
        show_description: true,
        show_line_items: true,
                line_items: [
          {
            name:        `WiFi Access (${voucherType === 'premium' ? 'Premium' : 'Standard'} — ${duration} min)`,
            description: `Wireless internet access for ${duration} minutes (${voucherType || 'standard'})${planId ? ' — ' + planId : ''}`,
            quantity:    1,
            amount:      amount,
            currency:    'PHP',
          },
        ],
        payment_method_types: paymentMethodTypes,
        success_url:  successUrl,
        cancel_url:   cancelUrl,
                metadata: {
          session_id:       sessionId,
          duration_minutes: duration,
          client_ip:        clientIp || '',
          voucher_type:     voucherType || 'standard',
          plan_id:          planId || '',
        },
      },
    },
  });

  const response = await paymongoRequest('POST', '/v1/checkout_sessions', body);

  if (!response || !response.data || !response.data.id) {
    throw new Error('PayMongo checkout creation failed: ' + JSON.stringify(response).slice(0, 200));
  }

  return {
    checkoutUrl:      `${PAYMONGO_CHECKOUT}/checkout/${response.data.id}`,
    providerSessionId: response.data.id,
  };
}

/**
 * Verify PayMongo webhook signature.
 *
 * PayMongo sends a 'Paymongo-Signature' header with the format:
 *   t=<timestamp>,v1=<signature>
 *
 * The signature is HMAC-SHA256 of `${timestamp}.${rawBody}` using the webhook secret.
 *
 * @param {string|Buffer} rawBody
 * @param {Object} headers
 * @returns {boolean}
 */
function verifyPayMongoSignature(rawBody, headers) {
  const signature = headers['paymongo-signature'] || headers['Paymongo-Signature'];
  if (!signature) return false;
  if (!PAYMONGO_WEBHOOK) return false;

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

  const rawBodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString();
  const signedPayload = `${ts}.${rawBodyStr}`;

  const expected = crypto
    .createHmac('sha256', PAYMONGO_WEBHOOK)
    .update(signedPayload)
    .digest('hex');

  // Constant-time comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(sig)
    );
  } catch {
    return false;
  }
}

/**
 * Parse a PayMongo webhook event.
 *
 * PayMongo event structure:
 *   event.data.id          — event ID
 *   event.data.attributes.type — 'payment.paid' or 'payment.failed'
 *   event.data.attributes.data.attributes.amount
 *   event.data.attributes.data.attributes.metadata.session_id
 *
 * @param {Object} event
 * @returns {Object|null}
 */
function parsePayMongoEvent(event) {
  try {
    const eventData  = event.data || {};
    const attr       = eventData.attributes || {};
    const eventId    = eventData.id || '';
    const eventType  = attr.type || '';

        const metadata = (attr.data && attr.data.attributes && attr.data.attributes.metadata) || {};
    const amount    = (attr.data && attr.data.attributes && attr.data.attributes.amount) || 0;
    const sessionId = metadata.session_id || '';
    const voucherType = metadata.voucher_type || 'standard';

    let status = 'unknown';
    if (eventType === 'payment.paid')   status = 'paid';
    if (eventType === 'payment.failed') status = 'failed';

        return { sessionId, eventId, eventType, amount, status, voucherType };
  } catch {
    return null;
  }
}

/**
 * Make an HTTPS request to the PayMongo API.
 */
function paymongoRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const base = new URL(PAYMONGO_BASE);

    const opts = {
      hostname: base.hostname,
      port:     base.port || 443,
      path:     path,
      method:   method,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body || ''),
        'Accept':         'application/json',
        // PayMongo uses Basic auth with secret key as username, empty password
        'Authorization':  'Basic ' + Buffer.from(PAYMONGO_SECRET + ':').toString('base64'),
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
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('PayMongo request timed out'));
    });
    if (body) req.write(body);
    req.end();
  });
}

module.exports = {
  createPaymentCheckout,
  calculateAmount,
  verifyWebhook,
  handlePaymentEvent,

  // Exposed for testing
  _internal: {
    calculateAmount,
    verifyPayMongoSignature,
    parsePayMongoEvent,
    PROVIDER,
    PRICE_PER_HOUR,
    PREMIUM_MODIFIER,
  },
};
