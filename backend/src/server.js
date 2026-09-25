/**
 * server.js — Express backend entry point
 *
 * Routes:
 *   POST /api/auth              — Voucher authentication
 *   POST /api/payment/create    — Create paid checkout session
 *   POST /api/payment/webhook   — Payment provider webhook receiver
 *   GET  /api/session/status    — Poll session remaining time
 *   POST /api/session/pause     — Pause active session
 *   POST /api/session/resume    — Resume paused session
 *   POST /api/session/expire    — Admin: immediately expire session
 *   GET  /health               — Health check
 */

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');

const { rateLimit } = require('express-rate-limit');
const authRoutes = require('./routes/auth');
const paymentRoutes = require('./routes/payment');
const sessionRoutes = require('./routes/session');
const { startExpirationWorker } = require('./services/session');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:8080';

// ── Security middleware ──────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS: restrict to known portal origin
const corsOptions = {
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile captive portals)
    if (!origin) return cb(null, true);
    const allowed = (process.env.CORS_ORIGINS || FRONTEND_ORIGIN)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (allowed.includes(origin)) return cb(null, true);
    // In dev, allow localhost
    if (NODE_ENV === 'development' && /^http:\/\/localhost/.test(origin)) return cb(null, true);
    cb(new Error('CORS: origin not allowed'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};
app.use(cors(corsOptions));

app.use(compression());
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));

// ── Rate limiting ────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 min
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '20', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please wait.', code: 'RATE_LIMITED' },
});
app.use('/api/', limiter);

// Stricter rate limit for webhook endpoint (prevents brute-force)
const webhookLimiter = rateLimit({
  windowMs: 60000,
  max: 60,
  message: { success: false, error: 'Too many webhook requests.', code: 'RATE_LIMITED' },
});

// ── Routes ───────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/payment',  paymentRoutes);
app.use('/api/session',  sessionRoutes);

// Payment webhook — use its own limiter, skip CORS (provider calls it)
app.post('/api/payment/webhook', webhookLimiter, require('./routes/payment').handleWebhook);

// Health check (unauthenticated)
app.get('/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString(), env: NODE_ENV });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

// Global error handler (never leaks internals)
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const code = err.code || 'SERVER_ERROR';
  // Log full error server-side; return generic message to client
  console.error('[' + req.method + ' ' + req.path + ']', err.message, err.stack);
  res.status(status).json({
    success: false,
    error: NODE_ENV === 'production' ? 'An internal error occurred.' : err.message,
    code: code,
  });
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Omada portal backend running on port ${PORT} [${NODE_ENV}]`);

  // Start session expiration worker (calls Omada unauth when sessions expire)
  if (process.env.OMADA_BASE_URL) {
    startExpirationWorker();
  } else if (NODE_ENV !== 'test') {
    console.warn('[WARN] OMADA_BASE_URL not set — session expiration worker is disabled.');
    console.warn('[WARN] In production, set OMADA_BASE_URL to enable automatic session expiry.');
  }
});

module.exports = app;
