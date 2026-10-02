/**
 * routes/payment.js — POST /api/payment/context
 *
 * Captures the Omada controller context (AP MAC, SSID, radio ID) when a
 * client lands on the captive portal page. The payment webhook later reads
 * this row (portal_client_context table) to authorize the client via
 * /hotspot/extPortal/auth — the client does not need to be online at
 * payment time.
 *
 * This endpoint is UNAUTHENTICATED by design (the client has not paid or
 * authenticated yet), so it is protected by:
 *   - Strict input validation (MAC format, field lengths, radio_id range)
 *   - A dedicated per-IP rate limiter (stricter than the global apiLimiter)
 *
 * Called by assets/portal.js as a fire-and-forget beacon on portal landing;
 * seen_at is refreshed on every page load, which keeps the context fresh
 * within the PORTAL_CONTEXT_MAX_AGE_MS staleness window.
 */

const express = require('express');
const router = express.Router();
const { rateLimit } = require('express-rate-limit');
const { getDb } = require('../db/client');
const { normalizeMac } = require('../utils/device-id');
const SITE = process.env.OMADA_SITE || 'Default';

// ── Per-IP rate limiter (stricter than the global apiLimiter) ──────────
// This endpoint is unauthenticated and write-capable, so abusive or
// accidental hammering (e.g. a portal page in a refresh loop) must be
// throttled independently. Legitimate traffic is one beacon per page load.
const contextLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,                  // 30 beacons per IP per window is generous for real usage
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Try again later.', code: 'RATE_LIMITED' },
});

// ── Validation helpers ──────────────────────────────────────────────────
const MAC_RE = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;

/**
 * Validate and normalize a MAC address. Accepts common variants
 * (aa-bb-cc-dd-ee-ff, aabbccddeeff, with/without colons) by delegating to
 * normalizeMac(), then verifying the canonical colon format.
 * @param {string} value
 * @returns {string|null} canonical MAC or null when invalid
 */
function parseMac(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = normalizeMac(value);
  return normalized && MAC_RE.test(normalized) ? normalized : null;
}

function isValidSsid(value) {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 64;
}

function parseRadioId(value) {
  const n = typeof value === 'number' ? value : parseInt(value, 10);
  return Number.isInteger(n) && n >= 0 && n <= 255 ? n : null;
}

function isValidIp(value) {
  return typeof value === 'string' && value.trim().length <= 45;
}

// ── Route ───────────────────────────────────────────────────────────────
router.post('/context', contextLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};

    // client_mac — required, must be a well-formed MAC
    const clientMac = parseMac(body.client_mac);
    if (!clientMac) {
      return res.status(400).json({
        success: false,
        error: 'client_mac is required and must be a valid MAC address.',
        code: 'INVALID_CLIENT_MAC',
      });
    }

    // ap_mac — required, must be a well-formed MAC
    const apMac = parseMac(body.ap_mac);
    if (!apMac) {
      return res.status(400).json({
        success: false,
        error: 'ap_mac is required and must be a valid MAC address.',
        code: 'INVALID_AP_MAC',
      });
    }

    // ssid_name — required, 1–64 chars (matches schema column width)
    if (!isValidSsid(body.ssid_name)) {
      return res.status(400).json({
        success: false,
        error: 'ssid_name is required and must be 1-64 characters.',
        code: 'INVALID_SSID_NAME',
      });
    }
    const ssidName = body.ssid_name.trim();

    // radio_id — required, integer 0–255 (controller sends radioId=0)
    const radioId = parseRadioId(body.radio_id);
    if (radioId === null) {
      return res.status(400).json({
        success: false,
        error: 'radio_id is required and must be an integer between 0 and 255.',
        code: 'INVALID_RADIO_ID',
      });
    }

    // client_ip — optional, length-capped
    if (body.client_ip !== undefined && !isValidIp(body.client_ip)) {
      return res.status(400).json({
        success: false,
        error: 'client_ip must be a string of at most 45 characters.',
        code: 'INVALID_CLIENT_IP',
      });
    }
    const clientIp = body.client_ip ? String(body.client_ip).trim() : null;

    // ── Upsert (SQLite + PostgreSQL compatible) ───────────────────────
    // INSERT ... ON CONFLICT(client_mac) DO UPDATE is valid on SQLite
    // 3.24+ and all supported PostgreSQL versions.
    const now = new Date().toISOString();
    await getDb().run(
      `INSERT INTO portal_client_context
         (client_mac, client_ip, ap_mac, ssid_name, radio_id, site, seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(client_mac) DO UPDATE SET
         client_ip = excluded.client_ip,
         ap_mac    = excluded.ap_mac,
         ssid_name = excluded.ssid_name,
         radio_id  = excluded.radio_id,
         site      = excluded.site,
         seen_at   = excluded.seen_at,
         updated_at = excluded.updated_at`,
      [clientMac, clientIp, apMac, ssidName, radioId, SITE, now, now, now]
    );

    console.log('[payment/context] captured context for ' + clientMac + ' (ap ' + apMac + ', ssid "' + ssidName + '")');
    return res.json({ success: true, code: 'CONTEXT_CAPTURED' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
