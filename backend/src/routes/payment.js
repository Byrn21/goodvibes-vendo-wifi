/**
 * routes/payment.js — Payment routes
 *
 * Endpoints:
  *   POST /api/payment/create  — Create a PayMongo checkout session
 *   POST /api/payment/initiate — Create a PayMongo checkout session with plan & method (paid mode)
 *   POST /api/payment/webhook  — Receive PayMongo webhook events (raw body signature verification)
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const paymentService = require('../services/payment');
const sessionService = require('../services/session');

const router = express.Router();

// Raw body parser for webhook signature verification.
// Must come before the json() parser in server.js so Express.json()
// does not consume the webhook body first.
const rawBodyParser = express.raw({ type: 'application/json', limit: '2mb' });

/**
 * POST /api/payment/create
 *
 * Create a payment checkout session for a new captive portal session.
 * Expects the client to send browser/device info so we can record
 * the session before redirecting to the payment provider.
 */
router.post('/create', async (req, res) => {
  try {
    const { duration, clientMac, clientIp, apMac, ssidName, redirectUrl } = req.body;

    if (!duration || !clientMac) {
      return res.status(400).json({
        ok: false,
        error: 'duration and clientMac are required',
      });
    }

    const sessionId = uuidv4();

    // Record the session with state pending_payment
    const sessionData = {
      sessionId,
      clientMac,
      clientIp: clientIp || req.ip || '',
      apMac:    apMac || '',
      ssidName: ssidName || '',
      duration: parseInt(duration, 10) || 60,
      voucherUsed: null,
    };

    // Insert session record (initial state is 'active' from recordSession)
    await sessionService.recordSession(sessionData);

    // Create the PayMongo checkout session
    const checkout = await paymentService.createPaymentCheckout({
      sessionId,
      duration: parseInt(duration, 10) || 60,
      clientMac,
      clientIp: clientIp || req.ip || '',
      apMac:    apMac || '',
      ssidName: ssidName || '',
      redirectUrl,
    });

    // Transition session to pending_payment with provider session ID
    await sessionService.markPaymentPending(sessionId, checkout.providerSessionId);

    return res.json({
      ok: true,
      sessionId,
      checkoutUrl: checkout.checkoutUrl,
    });
  } catch (err) {
    console.error('[payment/create] Error:', err.message);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Failed to create payment session',
    });
  }
});

/**
 * POST /api/payment/initiate
 *
 * Accepts a 'method' query param (gcash|maya|qrph) to filter available
 * payment methods in the PayMongo checkout session. The 'plan' param
 * specifies the voucher duration in minutes.
 *
 * Accepts parameters from either the query string or the request body,
 * so it works with both GET redirects and POST form submissions.
 */
router.post('/initiate', async (req, res) => {
  // Merge query-string params as fallback (GET-style redirect from frontend tiles)
  const method = req.query.method || req.body.method;
  const plan   = req.query.plan   || req.body.plan;
  const clientMac = req.query.clientMac || req.body.clientMac;
  const clientIp  = req.query.clientIp  || req.body.clientIp;
  const apMac     = req.query.apMac     || req.body.apMac;
  const ssidName  = req.query.ssidName  || req.body.ssidName;
  const redirectUrl = req.query.redirectUrl || req.body.redirectUrl;

  try {
    if (!plan) {
      return res.status(400).json({
        ok: false,
        error: 'plan (duration in minutes) is required',
      });
    }

    const duration = parseInt(plan, 10);
    if (!duration || duration < 1) {
      return res.status(400).json({
        ok: false,
        error: 'invalid plan duration',
      });
    }

    const sessionId = uuidv4();

    const sessionData = {
      sessionId,
      clientMac,
      clientIp: clientIp || req.ip || '',
      apMac:    apMac || '',
      ssidName: ssidName || '',
      duration: duration,
      voucherUsed: null,
    };

    await sessionService.recordSession(sessionData);

    const checkout = await paymentService.createPaymentCheckout({
      sessionId,
      duration,
      method: method || undefined,   // undefined => all methods available
      clientMac: clientMac || '',
      clientIp:  clientIp || req.ip || '',
      apMac:     apMac || '',
      ssidName:  ssidName || '',
      redirectUrl,
    });

    await sessionService.markPaymentPending(sessionId, checkout.providerSessionId);

    return res.json({
      ok: true,
      sessionId,
      checkoutUrl: checkout.checkoutUrl,
    });
  } catch (err) {
    console.error('[payment/initiate] Error:', err.message);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Failed to create payment session',
    });
  }
});

/**
 * POST /api/payment/webhook
 *
 * Receive PayMongo webhook events.
 * Body must be raw (not parsed JSON) for HMAC signature verification.
 * Uses the rawBodyParser middleware attached above.
 */
router.post('/webhook', rawBodyParser, async (req, res) => {
  try {
    // req.body is a Buffer (from express.raw())
    const rawBody = req.body;

    // Verify webhook signature
    const ok = await paymentService.verifyWebhook(rawBody, req.headers);

    if (!ok) {
      console.warn('[payment/webhook] Signature verification failed');
      return res.status(401).json({ ok: false, error: 'Invalid signature' });
    }

    // Parse the event body (now that signature is verified)
    const bodyStr = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
    let event;
    try {
      event = JSON.parse(bodyStr);
    } catch (parseErr) {
      console.error('[payment/webhook] JSON parse error:', parseErr.message);
      return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
    }

    // Handle the event (with idempotency)
    const result = await paymentService.handlePaymentEvent(event);

    // Always return 200 so PayMongo doesn't retry
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('[payment/webhook] Error:', err.message);
    // Return 200 even on errors to prevent retries for already-processed events
    return res.status(200).json({ ok: false, error: err.message });
  }
});

module.exports = router;