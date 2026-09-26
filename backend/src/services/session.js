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
 * Validate a free voucher against database.
 * @returns { valid: boolean, code?: string, duration?: number, message?: string }
 */
async function validateVoucher(voucher, clientMac) {
  const db = getDb();

  const row = db.prepare(`
    SELECT id, code, duration_minutes, state, used_by_mac, expires_at
    FROM vouchers
    WHERE code = ? COLLATE NOCASE
    LIMIT 1
  `).get(voucher);

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
      // Mark as expired
      db.prepare(`UPDATE vouchers SET state = 'expired' WHERE id = ?`).run(row.id);
      return { valid: false, code: 'EXPIRED_VOUCHER', message: 'This voucher has expired.' };
    }
  }

  // Mark voucher as used
  db.prepare(`
    UPDATE vouchers
    SET state = 'used', used_by_mac = ?, used_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(clientMac || '', row.id);

  return { valid: true, duration: row.duration_minutes, message: 'Voucher accepted.' };
}

/**
 * Record a new active session in the database.
 */
async function recordSession({
  sessionId, clientMac, clientIp, apMac, ssidName,
  duration, voucherUsed,
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + duration * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO sessions (
      session_id, client_mac, client_ip, ap_mac, ssid_name,
      duration_minutes, started_at, expires_at, state,
      voucher_used, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(
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
    now
  );

  return await getSession(sessionId);
}

/**
 * Get a session by ID.
 */
async function getSession(sessionId) {
  const db = getDb();

  const row = db.prepare(`
    SELECT * FROM sessions WHERE session_id = ? LIMIT 1
  `).get(sessionId);

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
 * Expire session — deactivate via Omada and mark expired in DB.
 */
async function expireSession(sessionId, reason = 'time_expired') {
  const db = getDb();
  const session = await getSession(sessionId);

  if (!session) return false;
  if (session.state === 'expired') return false; // Idempotent

  const prevState = session.state;
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE sessions
    SET state = 'expired', expired_at = ?, expire_reason = ?, updated_at = ?
    WHERE session_id = ?
  `).run(now, reason || 'unknown', now, sessionId);

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
 * Pause an active session.
 * Freezes remaining time; timer stops.
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

  db.prepare(`
    UPDATE sessions
    SET state = 'paused', paused_at = ?, remaining_seconds = ?, expires_at = NULL, updated_at = ?
    WHERE session_id = ?
  `).run(now.toISOString(), remainingSeconds, now.toISOString(), sessionId);

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
 * Resume a paused session.
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

  db.prepare(`
    UPDATE sessions
    SET state = 'active', paused_at = NULL, expires_at = ?, updated_at = ?
    WHERE session_id = ?
  `).run(expiresAt, new Date().toISOString(), sessionId);

  return await getSession(sessionId);
}

/**
 * Expire a session — server-side enforcement.
 * Reason: 'time_expired', 'admin_expired', 'server_expired'
 */
async function expireSession(sessionId, reason) {
  const db = getDb();
  const session = await getSession(sessionId);

  if (!session) return false;
  if (session.state === 'expired') return false; // Idempotent

  const prevState = session.state;
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE sessions
    SET state = 'expired', expired_at = ?, expire_reason = ?, updated_at = ?
    WHERE session_id = ?
  `).run(now, reason || 'unknown', now, sessionId);

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
 * Background expiration worker.
 * Checks all active sessions every EXPIRE_CHECK_INTERVAL.
 * Calls Omada unauth for any that have expired.
 */
function startExpirationWorker() {
  if (expirationTimer) return; // Already running

  expirationTimer = setInterval(async () => {
    const db = getDb();
    const now = new Date().toISOString();

    const expiredSessions = db.prepare(`
      SELECT session_id FROM sessions
      WHERE state = 'active' AND expires_at IS NOT NULL AND expires_at <= ?
    `).all(now);

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
};
