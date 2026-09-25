/**
 * services/session.js — Session state machine and database operations
 *
 * Server-side session management. The browser countdown is only a
 * display mechanism. THIS service is authoritative.
 *
 * States:
 *   pending   — Created, awaiting payment (paid sessions only)
 *   active    — Session is running, timer counting down
 *   paused    — Session is frozen, timer stopped
 *   expired   — Session has ended (time up, or manually expired)
 *   failed    — Payment failed or session was invalidated
 *
 * Data model (see db/schema.sql for table DDL):
 *   sessions(
 *     session_id, client_mac, client_ip, ap_mac, ssid_name,
 *     duration_minutes, started_at, expires_at,
 *     paused_at, remaining_seconds_at_pause,
 *     state, payment_id, webhook_event_id,
 *     voucher_used, created_at, updated_at
 *   )
 *
 *   webhook_events(event_id, session_id, event_type, created_at)
 */

const { v4: uuidv4 } = require('uuid');
const omadaService = require('./omada');

// In-memory store for development. Replace with DB queries in production.
// ⚠️ This in-memory store is for DEVELOPMENT and TESTING only.
//    In production, use the database schema in db/schema.sql.
const sessions = new Map();     // sessionId -> session object
const webhookEvents = new Map(); // eventId -> sessionId

const DEFAULT_DURATION = parseInt(process.env.DEFAULT_SESSION_DURATION || '60', 10);
const EXPIRE_CHECK_INTERVAL = parseInt(process.env.SESSION_ENFORCE_INTERVAL || '60000', 10); // 1 min
let expirationTimer = null;

/**
 * Normalize a MAC address to lowercase colon-separated format.
 */
function normalizeMac(mac) {
  if (!mac || typeof mac !== 'string') return null;
  const cleaned = mac.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (cleaned.length !== 12) return null;
  return cleaned.match(/.{2}/g).join(':');
}

/**
 * Validate a free voucher.
 * ⚠️ Replace with real voucher database lookup in production.
 * @returns { valid: boolean, code?: string, duration?: number, message?: string }
 */
async function validateVoucher(voucher, clientMac) {
  // ⚠️ EXAMPLE VOUCHER SYSTEM — replace with real voucher validation.
  //
  // In production, look up the voucher in a database table:
  //   SELECT * FROM vouchers WHERE code = ? AND state = 'active' LIMIT 1
  // Mark it as used, record the client MAC, and return the duration.
  //
  // For this template, we implement a simple mock voucher system.

  const v = voucher.toUpperCase();

  // Mock: reject known-bad patterns
  if (v === 'EXPIRED' || v === 'EXPIRED-VOUCHER') {
    return { valid: false, code: 'EXPIRED_VOUCHER', message: 'This voucher has expired.' };
  }
  if (v === 'USED' || v === 'USED-VOUCHER') {
    return { valid: false, code: 'USED_VOUCHER', message: 'This voucher has already been used.' };
  }
  if (v.length < 6) {
    return { valid: false, code: 'INVALID_VOUCHER', message: 'Invalid voucher code.' };
  }

  // Mock: accept anything else, give 60 minutes
  return { valid: true, duration: DEFAULT_DURATION, message: 'Voucher accepted.' };
}

/**
 * Record a new active session in the database.
 */
async function recordSession({
  sessionId, clientMac, clientIp, apMac, ssidName,
  duration, plan, paymentId, webhookEventId, voucherUsed,
}) {
  const now = new Date();
  const startedAt = now;
  const expiresAt = new Date(now.getTime() + duration * 60 * 1000);

  const session = {
    sessionId,
    clientMac: clientMac || '',
    clientIp: clientIp || '',
    apMac: apMac || '',
    ssidName: ssidName || '',
    duration: duration || DEFAULT_DURATION,
    plan: plan || null,
    startedAt: startedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    pausedAt: null,
    remainingSecondsAtPause: null,
    state: 'active',
    paymentId: paymentId || null,
    webhookEventId: webhookEventId || null,
    voucherUsed: voucherUsed || null,
    createdAt: startedAt.toISOString(),
    updatedAt: startedAt.toISOString(),
  };

  sessions.set(sessionId, session);
  return session;
}

/**
 * Get a session by ID.
 */
async function getSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return null;

  // If active, check if it's past expiresAt (server-side enforcement)
  if (s.state === 'active' && s.expiresAt) {
    const now = Date.now();
    const expiresAt = new Date(s.expiresAt).getTime();
    if (now >= expiresAt) {
      await expireSession(sessionId, 'time_expired');
      return { ...s, state: 'expired' };
    }
  }

  return { ...s };
}

/**
 * Mark session as payment-pending (paid session before checkout completes).
 */
async function markPaymentPending(sessionId) {
  const now = new Date().toISOString();
  if (sessions.has(sessionId)) {
    const s = sessions.get(sessionId);
    s.state = 'pending';
    s.updatedAt = now;
    sessions.set(sessionId, s);
  } else {
    sessions.set(sessionId, {
      sessionId,
      state: 'pending',
      duration: DEFAULT_DURATION,
      startedAt: null,
      expiresAt: null,
      pausedAt: null,
      remainingSecondsAtPause: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  return true;
}

/**
 * Activate a paid session after successful payment.
 * Also calls Omada to authenticate the client.
 */
async function activatePaidSession(sessionId, eventId, amount) {
  const s = sessions.get(sessionId);
  if (!s) return false;

  // Guard: only activate pending sessions
  if (s.state !== 'pending') {
    // If already active, it's a duplicate — return true but don't re-charge
    return s.state === 'active';
  }

  const now = new Date();
  const duration = s.duration || DEFAULT_DURATION;
  const expiresAt = new Date(now.getTime() + duration * 60 * 1000);

  s.state = 'active';
  s.startedAt = now.toISOString();
  s.expiresAt = expiresAt.toISOString();
  s.paymentId = eventId;
  s.webhookEventId = eventId;
  s.amount = amount;
  s.updatedAt = now.toISOString();

  sessions.set(sessionId, s);

  // Call Omada to authenticate the client
  try {
    await omadaService.authenticateClient({
      clientMac: s.clientMac,
      clientIp: s.clientIp,
      apMac: s.apMac,
      ssidName: s.ssidName,
      username: 'paid_' + sessionId,
      password: sessionId,
      sessionId,
    });
  } catch (err) {
    console.error('[activatePaidSession] Omada auth failed:', err.message);
    // Leave session active in DB but flag it. Client will see error on next status poll.
    s.omadaAuthFailed = true;
    s.updatedAt = new Date().toISOString();
    sessions.set(sessionId, s);
  }

  return true;
}

/**
 * Mark a payment as failed.
 */
async function markPaymentFailed(sessionId, eventId) {
  const s = sessions.get(sessionId);
  if (!s) return false;
  s.state = 'failed';
  s.webhookEventId = eventId;
  s.updatedAt = new Date().toISOString();
  sessions.set(sessionId, s);
  return true;
}

/**
 * Pause an active session.
 * Freezes remaining time; timer stops.
 */
async function pauseSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s || s.state !== 'active') throw new Error('Session not active');

  const now = new Date();
  const remainingSeconds = Math.max(
    0,
    Math.floor((new Date(s.expiresAt) - now) / 1000)
  );

  s.state = 'paused';
  s.pausedAt = now.toISOString();
  s.remainingSecondsAtPause = remainingSeconds;
  s.expiresAt = null; // No longer expires on a fixed date until resumed
  s.updatedAt = now.toISOString();

  sessions.set(sessionId, s);

  // Tell Omada to de-authorize the client
  try {
    await omadaService.unauthenticateClient({
      clientMac: s.clientMac,
      apMac: s.apMac,
      ssidName: s.ssidName,
    });
  } catch (err) {
    console.warn('[pauseSession] Omada unauth failed:', err.message);
    // Session is still paused in our DB; client may remain connected for a while.
  }

  return { ...s };
}

/**
 * Resume a paused session.
 * Restarts the timer from the remaining seconds.
 */
async function resumeSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s || s.state !== 'paused') throw new Error('Session not paused');

  const now = new Date();
  const remaining = s.remainingSecondsAtPause || (s.duration || 60) * 60;
  const expiresAt = new Date(now.getTime() + remaining * 1000);

  // Re-authenticate via Omada
  try {
    await omadaService.authenticateClient({
      clientMac: s.clientMac,
      clientIp: s.clientIp,
      apMac: s.apMac,
      ssidName: s.ssidName,
      username: 'paid_' + sessionId,
      password: sessionId,
      sessionId,
    });
  } catch (err) {
    console.error('[resumeSession] Omada auth failed:', err.message);
    throw new Error('Could not reconnect to network. Please try again.');
  }

  s.state = 'active';
  s.pausedAt = null;
  s.expiresAt = expiresAt.toISOString();
  s.updatedAt = now.toISOString();

  sessions.set(sessionId, s);
  return { ...s };
}

/**
 * Expire a session — server-side enforcement.
 * Reason: 'time_expired', 'admin_expired', 'server_expired'
 */
async function expireSession(sessionId, reason) {
  const s = sessions.get(sessionId);
  if (!s) return false;

  if (s.state === 'expired') return false; // Idempotent

  const prevState = s.state;
  s.state = 'expired';
  s.expiredAt = new Date().toISOString();
  s.expireReason = reason || 'unknown';
  s.updatedAt = new Date().toISOString();
  sessions.set(sessionId, s);

  // Call Omada unauth only if session was active or paused (client was connected)
  if (prevState === 'active' || prevState === 'paused') {
    try {
      await omadaService.unauthenticateClient({
        clientMac: s.clientMac,
        apMac: s.apMac,
        ssidName: s.ssidName,
      });
    } catch (err) {
      console.warn('[expireSession] Omada unauth failed:', err.message);
    }
  }

  return true;
}

/**
 * Check if a session is currently active (server-side truth).
 */
async function isSessionActive(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return false;
  if (s.state !== 'active') return false;
  if (s.expiresAt) {
    return Date.now() < new Date(s.expiresAt).getTime();
  }
  return true;
}

/**
 * Idempotency: check if a webhook event has already been processed.
 */
async function isEventProcessed(eventId) {
  return webhookEvents.has(eventId);
}

/**
 * Mark a webhook event as processed.
 */
async function markEventProcessed(eventId, sessionId) {
  if (!eventId) return false;
  webhookEvents.set(eventId, { sessionId, processedAt: new Date().toISOString() });
  return true;
}

/**
 * Background expiration worker.
 * Checks all active sessions every EXPIRE_CHECK_INTERVAL.
 * Calls Omada unauth for any that have expired.
 */
function startExpirationWorker() {
  if (expirationTimer) return; // Already running

  expirationTimer = setInterval(async () => {
    const now = Date.now();
    let expiredCount = 0;

    for (const [sessionId, session] of sessions.entries()) {
      if (session.state !== 'active') continue;
      if (!session.expiresAt) continue;

      const expiresAt = new Date(session.expiresAt).getTime();
      if (now >= expiresAt) {
        await expireSession(sessionId, 'time_expired');
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      console.log(`[expiration-worker] Expired ${expiredCount} session(s)`);
    }
  }, EXPIRE_CHECK_INTERVAL);

  // Don't let the timer keep the process alive in tests
  if (typeof expirationTimer.unref === 'function') {
    expirationTimer.unref();
  }
}

function stopExpirationWorker() {
  if (expirationTimer) {
    clearInterval(expirationTimer);
    expirationTimer = null;
  }
}

/**
 * Reset all sessions (for testing).
 */
function _resetAll() {
  sessions.clear();
  webhookEvents.clear();
  stopExpirationWorker();
}

module.exports = {
  validateVoucher,
  recordSession,
  getSession,
  pauseSession,
  resumeSession,
  expireSession,
  isSessionActive,
  markPaymentPending,
  activatePaidSession,
  markPaymentFailed,
  isEventProcessed,
  markEventProcessed,
  startExpirationWorker,
  stopExpirationWorker,
  normalizeMac,
  _resetAll,
  _sessions: sessions,
  _webhookEvents: webhookEvents,
};
