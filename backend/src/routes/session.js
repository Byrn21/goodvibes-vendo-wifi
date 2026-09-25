/**
 * routes/session.js
 *
 * GET  /api/session/status  — Poll session remaining time
 * POST /api/session/pause  — Pause active session
 * POST /api/session/resume — Resume paused session
 * POST /api/session/expire — Admin: immediately expire session
 */

const express = require('express');
const router = express.Router();
const {
  getSession,
  pauseSession,
  resumeSession,
  expireSession,
  isSessionActive,
} = require('../services/session');
const omadaService = require('../services/omada');

// ── GET /api/session/status ──────────────────────────────────
router.get('/status', async (req, res, next) => {
  try {
    const { sessionId } = req.query;

    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ success: false, error: 'sessionId is required.' });
    }

    const session = await getSession(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found.',
        code: 'SESSION_NOT_FOUND',
      });
    }

    const serverTime = Math.floor(Date.now() / 1000);

    // Determine if session has expired server-side (defensive; backend should already expire)
    if (session.state === 'active' && session.expiresAt) {
      const expiresAt = Math.floor(new Date(session.expiresAt).getTime() / 1000);
      if (serverTime >= expiresAt) {
        // Server-side expired — call unauth and update state
        await expireSession(sessionId, 'server_expired');
        try {
          await omadaService.unauthenticateClient({ clientMac: session.clientMac });
        } catch (_) { /* ignore */ }
        return res.json({
          sessionId,
          state: 'expired',
          remainingSeconds: 0,
          startedAt: session.startedAt,
          expiresAt: session.expiresAt,
          plan: session.plan,
          canPause: false,
          canResume: false,
        });
      }
    }

    const remainingSeconds = computeRemaining(session, serverTime);

    return res.json({
      sessionId: session.sessionId,
      state: session.state,
      remainingSeconds,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      plan: session.plan,
      totalSeconds: (session.duration || 60) * 60,
      canPause:  session.state === 'active' && remainingSeconds > 60,
      canResume: session.state === 'paused',
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/session/pause ───────────────────────────────────
router.post('/pause', async (req, res, next) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'sessionId is required.' });
    }

    if (process.env.PAUSE_ENABLED !== 'true') {
      return res.status(403).json({ success: false, error: 'Pause is not enabled.', code: 'PAUSE_DISABLED' });
    }

    const session = await getSession(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found.' });
    }
    if (session.state !== 'active') {
      return res.status(409).json({ success: false, error: 'Session is not active.', code: 'INVALID_STATE' });
    }

    const paused = await pauseSession(sessionId);
    return res.json({
      success: true,
      state: 'paused',
      remainingSeconds: computeRemaining(paused, Math.floor(Date.now() / 1000)),
      pausedAt: paused.pausedAt,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/session/resume ──────────────────────────────────
router.post('/resume', async (req, res, next) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'sessionId is required.' });
    }

    const session = await getSession(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found.' });
    }
    if (session.state !== 'paused') {
      return res.status(409).json({ success: false, error: 'Session is not paused.', code: 'INVALID_STATE' });
    }

    const resumed = await resumeSession(sessionId);
    return res.json({
      success: true,
      state: 'active',
      remainingSeconds: computeRemaining(resumed, Math.floor(Date.now() / 1000)),
      expiresAt: resumed.expiresAt,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/session/expire ──────────────────────────────────
// This is an admin/internal endpoint. In production, add admin auth.
router.post('/expire', async (req, res, next) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'sessionId is required.' });
    }

    const session = await getSession(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found.' });
    }

    await expireSession(sessionId, 'admin_expired');

    // Call Omada to unauthenticate
    try {
      await omadaService.unauthenticateClient({ clientMac: session.clientMac });
    } catch (_) { /* ignore — client may already be disconnected */ }

    return res.json({ success: true, state: 'expired' });
  } catch (err) {
    next(err);
  }
});

// ── Helpers ──────────────────────────────────────────────────
function computeRemaining(session, serverTime) {
  if (!session) return 0;

  if (session.state === 'expired' || session.state === 'unknown') return 0;

  if (session.state === 'paused') {
    // Use the server-side frozen remaining time
    return Math.max(0, session.remainingSeconds || 0);
  }

  // Active: calculate from expiresAt
  if (session.expiresAt) {
    const expiresAt = Math.floor(new Date(session.expiresAt).getTime() / 1000);
    return Math.max(0, expiresAt - serverTime);
  }

  // Fallback: use startedAt + duration
  const startedAt = Math.floor(new Date(session.startedAt).getTime() / 1000);
  const durationSecs = (session.duration || 60) * 60;
  return Math.max(0, (startedAt + durationSecs) - serverTime);
}

module.exports = router;
