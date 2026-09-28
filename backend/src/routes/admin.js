/**
 * routes/admin.js — Admin management API
 *
 * All endpoints require an API key passed in the `X-API-Key` header,
 * matching process.env.ADMIN_API_KEY.
 *
 * Endpoints:
 *   GET    /api/admin/vouchers    — List all vouchers
 *   POST   /api/admin/vouchers    — Create a new voucher
 *   PUT    /api/admin/vouchers/:id — Update a voucher
 *   DELETE /api/admin/vouchers/:id — Delete a voucher
 *   GET    /api/admin/sessions    — List active sessions
 *   POST   /api/admin/sessions/:id/expire — Force-expire a session
 *   GET    /api/admin/stats       — Dashboard statistics
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { getDb } = require('../db/client');
const { expireSession } = require('../services/session');

const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ADMIN_API_KEY;
const VALID_TOKENS = new Set();

// Middleware: require bearer token or API key
function requireAuth(req, res, next) {
  const provided = req.headers['authorization']?.replace(/^Bearer\s+/i, '') || req.headers['x-api-key'];
  if (!provided) {
    return res.status(401).json({ success: false, error: 'Unauthorized — valid token or API key required.' });
  }
  // Accept either a valid session token or the admin API key
  if (VALID_TOKENS.has(provided) || (ADMIN_API_KEY && provided === ADMIN_API_KEY)) {
    return next();
  }
  return res.status(401).json({ success: false, error: 'Unauthorized — valid token or API key required.' });
}

// Login endpoint (before requireAuth)
router.post('/login', (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      const token = require('crypto').randomBytes(32).toString('hex');
      VALID_TOKENS.add(token);
      return res.json({ success: true, token, expiresIn: 8 * 3600 });
    }
    return res.status(401).json({ success: false, error: 'Invalid credentials.' });
  } catch (err) {
    next(err);
  }
});

router.use(requireAuth);

// List all vouchers
router.get('/vouchers', async (req, res, next) => {
  try {
    const db = getDb();
    const rows = await db.query(`
      SELECT id, code, type, duration_minutes, price, state, used_by_mac, used_at,
             created_at, expires_at
      FROM vouchers
      ORDER BY created_at DESC
    `);
        res.json({ success: true, vouchers: rows });
  } catch (err) {
    next(err);
  }
});

// Create a new voucher
router.post('/vouchers', async (req, res, next) => {
  try {
    const {
      type = 'standard',
      durationMinutes = 60,
      price = null,
      quantity = 1,
      expiresAt = null,
      prefix = 'WIFI',
    } = req.body;

    if (type !== 'standard' && type !== 'premium') {
      return res.status(400).json({ success: false, error: 'type must be "standard" or "premium"' });
    }
    if (!durationMinutes || durationMinutes < 1) {
      return res.status(400).json({ success: false, error: 'durationMinutes is required and must be positive' });
    }

    const db = getDb();
    const created = [];

    for (let i = 0; i < Math.min(quantity, 100); i++) {
      const code = `${prefix}-${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
      await db.run(`
        INSERT INTO vouchers (code, type, duration_minutes, price, state, expires_at)
        VALUES (?, ?, ?, ?, 'active', ?)
      `, [code, type, durationMinutes, price, expiresAt]);
      created.push(code);
    }

    res.status(201).json({ success: true, created });
  } catch (err) {
    next(err);
  }
});

// Update a voucher
router.put('/vouchers/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { state, type, durationMinutes, price, expiresAt } = req.body;

    const db = getDb();
    const fields = [];
    const params = [];

    if (state !== undefined) {
      fields.push('state = ?');
      params.push(state);
    }
    if (type !== undefined) {
      fields.push('type = ?');
      params.push(type);
    }
    if (durationMinutes !== undefined) {
      fields.push('duration_minutes = ?');
      params.push(durationMinutes);
    }
    if (price !== undefined) {
      fields.push('price = ?');
      params.push(price);
    }
    if (expiresAt !== undefined) {
      fields.push('expires_at = ?');
      params.push(expiresAt);
    }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    params.push(id);
    const result = await db.run(`
      UPDATE vouchers SET ${fields.join(', ')} WHERE id = ?
    `, params);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Voucher not found' });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Delete a voucher
router.delete('/vouchers/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const result = await db.run('DELETE FROM vouchers WHERE id = ?', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Voucher not found' });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// List sessions (active/paused)
router.get('/sessions', async (req, res, next) => {
  try {
    const db = getDb();
    const rows = await db.query(`
      SELECT session_id, client_mac, client_ip, voucher_type, duration_minutes,
             total_duration_seconds, state, started_at, expires_at, paused_at,
             remaining_seconds, voucher_used, payment_amount, created_at
      FROM sessions
      WHERE state IN ('active', 'paused', 'pending', 'pending_payment')
      ORDER BY created_at DESC
      LIMIT 100
    `);
    res.json({ success: true, sessions: rows });
  } catch (err) {
    next(err);
  }
});

// Force-expire a session
router.post('/sessions/:id/expire', async (req, res, next) => {
  try {
    const { id } = req.params;
    const session = await expireSession(id, 'admin_expired');
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    res.json({ success: true, state: 'expired' });
  } catch (err) {
    next(err);
  }
});

// Dashboard statistics
router.get('/stats', async (req, res, next) => {
  try {
    const db = getDb();

    const totalVouchers = await db.getOne('SELECT COUNT(*) as count FROM vouchers');
    const activeVouchers = await db.getOne("SELECT COUNT(*) as count FROM vouchers WHERE state = 'active'");
    const usedVouchers = await db.getOne("SELECT COUNT(*) as count FROM vouchers WHERE state = 'used'");
    const totalSessions = await db.getOne('SELECT COUNT(*) as count FROM sessions');
    const activeSessions = await db.getOne("SELECT COUNT(*) as count FROM sessions WHERE state = 'active'");
    const pausedSessions = await db.getOne("SELECT COUNT(*) as count FROM sessions WHERE state = 'paused'")
    const totalRevenueRow = await db.getOne("SELECT SUM(payment_amount) as total FROM sessions WHERE payment_amount IS NOT NULL")
    const premiumSessions = await db.getOne("SELECT COUNT(*) as count FROM sessions WHERE voucher_type = 'premium'")

    res.json({
      success: true,
      stats: {
        totalVouchers: parseInt(totalVouchers?.count || 0, 10),
        activeVouchers: parseInt(activeVouchers?.count || 0, 10),
        usedVouchers: parseInt(usedVouchers?.count || 0, 10),
        totalSessions: parseInt(totalSessions?.count || 0, 10),
        activeSessions: parseInt(activeSessions?.count || 0, 10),
        pausedSessions: parseInt(pausedSessions?.count || 0, 10),
        totalRevenue: parseInt(totalRevenueRow?.total || 0, 10),
        premiumSessions: parseInt(premiumSessions?.count || 0, 10),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
