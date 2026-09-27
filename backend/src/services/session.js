/**
 * services/session.js — Session state machine and database operations
 *
 * Server-side session management. The browser countdown is only a
 * display mechanism. THIS service is authoritative.
 *
 * States:
 *   active    — Session is running, timer counting down
 *   paused    — Session is frozen, timer stopped
 *   expired   — Session has ended (time up, or manually expired)
 */

const { v4: uuidv4 } = require('uuid');
const omadaService = require('./omada');
const { getDb } = require('../db/client');

const DEFAULT_DURATION = parseInt(process.env.DEFAULT_SESSION_DURATION || '60', 10);
const EXPIRE_CHECK_INTERVAL = parseInt(process.env.SESSION_ENFORCE_INTERVAL || '60000', 10);
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
 * validateVoucher — Validate a voucher code against the database.
 * Returns { valid, code, duration, message }
 */
async function validateVoucher(voucher, clientMac) {
  const db = getDb();

  const row = await db.getOne(`
    SELECT id, code, duration_minutes, state, used_by_mac, expires_at
    FROM vouchers
    WHERE code = ? 
    LIMIT 1
  `, [voucher]);

  if (!row) {
    return { valid: false, code: 'INVALID_VOUCHER', message: 'Invalid voucher code.' };
  }

  if (row.state === 'expired') {
    return { valid: false, code: 'EXPIRED_VOUCHER', message: 'This voucher has expired.' };
  }

  if (row.state === 'used') {
    return { valid: false, code: 'USED_VOUCHER', message: 'This voucher has already been used.' };
  }

  if (row.state !== 'active') {
    return { valid: false, code: 'INVALID_VOUCHER', message: 'Voucher is not available.' };
  }

  // Check voucher expiration date
  if (row.expires_at) {
    const expiresAt = new Date(row.expires_at);
    if (Date.now() > expiresAt.getTime()) {
      await db.run(`UPDATE vouchers SET state = 'expired' WHERE id = ?`, [row.id]);
      return { valid: false, code: 'EXPIRED_VOUCHER', message: 'This voucher has expired.' };
    }
  }

  // Mark voucher as used
  await db.run(`
    UPDATE vouchers
    SET state = 'used', used_by_mac = ?, used_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [clientMac || '', row.id]);

  return { valid: true, duration: row.duration_minutes, message: 'Voucher accepted.' };
}

/**
 * recordSession — Record a new active session in the database.
 */
async function recordSession({
  sessionId, clientMac, clientIp, apMac, ssidName,
  duration, voucherUsed,
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + duration * 60 * 1000).toISOString();

  await db.run(`
    INSERT INTO sessions (
      session_id, client_mac, client_ip, ap_mac, ssid_name,
      duration_minutes, started_at, expires_at, state,
      voucher_used, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `, [
    sessionId,
    clientMac || '',
    clientIp || '',
    apMac || '',
    ssidName || '',
    duration,
    now,
    expiresAt,
    voucherUsed || null,
    now,
    now,
  ]);

  return await getSession(sessionId);
}

/**
 * getSession — Get a session by ID.
 */
async function getSession(sessionId) {
  const db = getDb();

  const row = await db.getOne(`
    SELECT * FROM sessions WHERE session_id = ? LIMIT 1
  `, [sessionId]);

  if (!row) return null;

  // Map database columns to camelCase
  const session = {
    sessionId: row.session_id,
    clientMac: row.client_mac,
    clientIp: row.client_ip,
    apMac: row.ap_mac,
    ssidName: row.ssid_name,
    duration: row.duration_minutes,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    pausedAt: row.paused_at,
    remainingSeconds: row.remaining_seconds,
    state: row.state,
    voucherUsed: row.voucher_used,
    omadaAuthFailed: Boolean(row.omada_auth_failed),
    expireReason: row.expire_reason,
    expiredAt: row.expired_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  // Check server-side expiration for active sessions
  if (session.state === 'active' && session.expiresAt) {
    const now = Date.now();
    const expiresAt = new Date(session.expiresAt).getTime();
    if (now >= expiresAt) {
      await expireSession(sessionId, 'time_expired');
      return { ...session, state: 'expired' };
    }
  }

  return session;
}

/**
 * expireSession — Deactivate via Omada and mark expired in DB.
 */
async function expireSession(sessionId, reason = 'time_expired') {
  const db = getDb();
  const session = await getSession(sessionId);

  if (!session) return false;
  if (session.state === 'expired') return false; // Idempotent

  const prevState = session.state;
  const now = new Date().toISOString();

  await db.run(`
    UPDATE sessions
    SET state = 'expired', expired_at = ?, expire_reason = ?, updated_at = ?
    WHERE session_id = ?
  `, [now, reason || 'unknown', now, sessionId]);

  // Call Omada unauth only if session was active or paused
  if (prevState === 'active' || prevState === 'paused') {
    try {
      await omadaService.unauthenticateClient({
        clientMac: session.clientMac,
        apMac: session.apMac,
        ssidName: session.ssidName,
      });
    } catch (err) {
      console.warn('[expireSession] Omada unauth failed:', err.message);
    }
  }

  return true;
}

/**
 * pauseSession — Freeze an active session's timer.
 * Omada unauthenticates the client; time is stored in remaining_seconds.
 */
async function pauseSession(sessionId) {
  const db = getDb();
  const session = await getSession(sessionId);

  if (!session || session.state !== 'active') {
    throw new Error('Session not active');
  }

  const now = new Date();
  const remainingSeconds = Math.max(
    0,
    Math.floor((new Date(session.expiresAt) - now) / 1000)
  );

  await db.run(`
    UPDATE sessions
    SET state = 'paused', paused_at = ?, remaining_seconds = ?, expires_at = NULL, updated_at = ?
    WHERE session_id = ?
  `, [now.toISOString(), remainingSeconds, now.toISOString(), sessionId]);

  // Tell Omada to de-authorize the client
  try {
    await omadaService.unauthenticateClient({
      clientMac: session.clientMac,
      apMac: session.apMac,
      ssidName: session.ssidName,
    });
  } catch (err) {
    console.warn('[pauseSession] Omada unauth failed:', err.message);
  }

  return await getSession(sessionId);
}

/**
 * resumeSession — Restart a paused session.
 * Restarts the timer from the remaining seconds.
 */
async function resumeSession(sessionId) {
  const db = getDb();
  const session = await getSession(sessionId);

  if (!session || session.state !== 'paused') {
    throw new Error('Session not paused');
  }

  const remaining = session.remainingSeconds || (session.duration || 60) * 60;
  const expiresAt = new Date(Date.now() + remaining * 1000).toISOString();

  // Re-authenticate via Omada
  try {
    await omadaService.authenticateClient({
      clientMac: session.clientMac,
      clientIp: session.clientIp,
      apMac: session.apMac,
      ssidName: session.ssidName,
      username: 'paid_' + sessionId,
      password: sessionId,
      sessionId,
    });
  } catch (err) {
    console.error('[resumeSession] Omada auth failed:', err.message);
    throw new Error('Could not reconnect to network. Please try again.');
  }

  await db.run(`
    UPDATE sessions
    SET state = 'active', paused_at = NULL, expires_at = ?, updated_at = ?
    WHERE session_id = ?
  `, [expiresAt, new Date().toISOString(), sessionId]);

    return await getSession(sessionId);
}

/**
 * Check if a session is currently active (server-side truth).
 */
async function isSessionActive(sessionId) {
  const session = await getSession(sessionId);
  if (!session) return false;
  if (session.state !== 'active') return false;
  if (session.expiresAt) {
    return Date.now() < new Date(session.expiresAt).getTime();
  }
    return true;
}

/**
 * startExpirationWorker — Background timer that expires sessions server-side.
 * Queries for active sessions whose expires_at has passed, then calls
 * Omada unauth and marks them expired. Runs every EXPIRE_CHECK_INTERVAL ms.
 */
function startExpirationWorker() {
  if (expirationTimer) return; // Already running

  expirationTimer = setInterval(async () => {
    const db = getDb();
    const now = new Date().toISOString();

    const expiredSessions = await db.query(`
      SELECT session_id FROM sessions
      WHERE state = 'active' AND expires_at IS NOT NULL AND expires_at <= ?
    `, [now]);

    for (const row of expiredSessions) {
      await expireSession(row.session_id, 'time_expired');
    }

    if (expiredSessions.length > 0) {
      console.log(`[expiration-worker] Expired ${expiredSessions.length} session(s)`);
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
 * markPaymentPending — Set session state to pending_payment with provider session ID.
 */
async function markPaymentPending(sessionId, providerSessionId) {
  const db = getDb();
  const now = new Date().toISOString();

  await db.run(`
    UPDATE sessions
    SET state = 'pending_payment',
        provider_session_id = ?,
        updated_at = ?
    WHERE session_id = ?
  `, [providerSessionId || null, now, sessionId]);

  return await getSession(sessionId);
}

/**
 * activatePaidSession — Activate a session after successful payment.
 * Sets state to 'active', records payment details, and authenticates via Omada.
 */
async function activatePaidSession(sessionId, eventId, amount) {
  const db = getDb();
  const now = new Date().toISOString();

  // Compute expiry from existing duration
  const session = await getSession(sessionId);
  if (!session) {
    throw new Error('Session not found for payment activation');
  }

  const duration = session.duration;
  const expiresAt = new Date(Date.now() + duration * 60 * 1000).toISOString();
  const username = 'paid_' + sessionId;

  // Authenticate via Omada
  await omadaService.authenticateClient({
    clientMac: session.clientMac,
    clientIp:  session.clientIp,
    apMac:     session.apMac,
    ssidName:  session.ssidName,
    username:  username,
    password:  sessionId,
    sessionId: sessionId,
  });

  await db.run(`
    UPDATE sessions
    SET state = 'active',
        payment_event_id = ?,
        payment_amount = ?,
        started_at = ?,
        expires_at = ?,
        updated_at = ?
    WHERE session_id = ?
  `, [eventId || null, amount || null, now, expiresAt, now, sessionId]);

  return await getSession(sessionId);
}

/**
 * markPaymentFailed — Mark a session's payment as failed.
 */
async function markPaymentFailed(sessionId, eventId) {
  const db = getDb();
  const now = new Date().toISOString();

  await db.run(`
    UPDATE sessions
    SET state = 'payment_failed',
        payment_event_id = ?,
        updated_at = ?
    WHERE session_id = ?
  `, [eventId || null, now, sessionId]);

  return await getSession(sessionId);
}

/**
 * isEventProcessed — Check if a webhook event has already been processed.
 */
async function isEventProcessed(eventId) {
  const db = getDb();
  const row = await db.getOne(`
    SELECT 1 FROM webhook_events WHERE event_id = ? LIMIT 1
  `, [eventId]);
  return !!row;
}

/**
 * markEventProcessed — Record a processed webhook event for idempotency.
 */
async function markEventProcessed(eventId, sessionId) {
  const db = getDb();
  const now = new Date().toISOString();

  try {
    await db.run(`
      INSERT INTO webhook_events (event_id, session_id, processed_at)
      VALUES (?, ?, ?)
    `, [eventId, sessionId || null, now]);
  } catch (err) {
    // Unique violation — event already recorded, skip (idempotent)
    if (err.code === '23505' || err.code === 'SQLITE_CONSTRAINT') {
      return;
    }
    throw err;
  }
}

module.exports = {
  validateVoucher,
  recordSession,
  getSession,
  pauseSession,
  resumeSession,
  expireSession,
  isSessionActive,
  startExpirationWorker,
  stopExpirationWorker,
  normalizeMac,
  markPaymentPending,
  activatePaidSession,
  markPaymentFailed,
  isEventProcessed,
  markEventProcessed,
};
