/**
 * routes/payment.js
 *
 * POST /api/payment/create   — Create a checkout session (used by backend-auth flow)
 * POST /api/payment/initiate — Initiate payment from frontend tiles (GCash/Maya/QRPh)
 * POST /api/payment/webhook  — Receive and verify payment provider webhook events
 */

const express = require('express');
const router = express.Router();
const { createPaymentCheckout, verifyWebhook, handlePaymentEvent } = require('../services/payment');
const { markPaymentPending } = require('../services/session');
const { v4: uuidv4 } = require('uuid');
const { normalizeMac } = require('../services/session');

// POST /api/payment/create
// Body: { sessionId, duration, clientMac, clientIp, apMac, ssidName, redirectUrl }
router.post('/create', async (req, res, next) => {
  try {
    const { sessionId, duration, clientMac, clientIp, apMac, ssidName, redirectUrl } = req.body;

    if (!sessionId || !duration) {
      return res.status(400).json({ success: false, error: 'sessionId and duration are required.' });
    }

    const result = await createPaymentCheckout({
      sessionId,
      duration: parseInt(duration, 10),
      clientMac,
      clientIp: clientIp || '',
      apMac: apMac || '',
      ssidName: ssidName || '',
      redirectUrl: redirectUrl || '',
    });

    await markPaymentPending(sessionId);

    return res.json({
      success: true,
      checkoutUrl: result.checkoutUrl,
      sessionId,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/payment/initiate
// Query params: method (gcash|maya|qrph|shopeepay), plan (duration minutes), clientMac
// Creates a session and returns the checkout URL to redirect the browser
router.post('/initiate', async (req, res, next) => {
  try {
    const { method, plan, clientMac, clientIp, apMac, ssidName, redirectUrl } = req.body;

    if (!plan) {
      return res.status(400).json({ success: false, error: 'Plan (duration) is required.' });
    }

    const duration = parseInt(plan, 10);
    if (!duration || duration < 1) {
      return res.status(400).json({ success: false, error: 'Invalid plan duration.' });
    }

    // Normalize MAC
    const normalizedMac = normalizeMac(clientMac || '');

    // Build session ID
    const sessionId = 'sess_' + uuidv4().replace(/-/g, '').slice(0, 16);

    // Mark session pending
    await markPaymentPending(sessionId);

    // Create Xendit checkout
    const result = await createPaymentCheckout({
      sessionId,
      duration,
      clientMac: normalizedMac,
      clientIp: clientIp || '',
      apMac: apMac || '',
      ssidName: ssidName || '',
      redirectUrl: redirectUrl || '',
    });

    return res.json({
      success: true,
      checkoutUrl: result.checkoutUrl,
      sessionId,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/payment/webhook — no auth (uses signature verification)
router.post('/webhook', async (req, res, next) => {
  try {
    const provider = process.env.PAYMENT_PROVIDER || 'paymock';
    const rawBody = req.rawBody || JSON.stringify(req.body);

    // Verify webhook signature
    const verified = await verifyWebhook(rawBody, req.headers, provider);
    if (!verified) {
      return res.status(401).json({ error: 'Webhook signature verification failed.' });
    }

    const event = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    const result = await handlePaymentEvent(event, provider);

    // Always return 200 to the provider so it doesn't retry
    return res.json({ received: true, action: result });
  } catch (err) {
    // Log but return 200 to prevent retries on known errors
    console.error('[Webhook processing error]', err.message);
    return res.json({ received: true, action: 'error' });
  }
});

module.exports = router;
module.exports.handleWebhook = router; // alias for direct server.js mount

// ── Express body capture middleware for webhook signature verification ──
// Express does not preserve raw body after json() parsing.
// Use this middleware BEFORE express.json() for the webhook route.
//
// Usage in server.js:
//   app.use('/api/payment/webhook', express.raw({ type: '*/*' }), (req, res, next) => {
//     req.rawBody = req.body.toString();
//     next();
//   }, require('./routes/payment').handleWebhook);
