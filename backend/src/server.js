/**
 * server.js — Express backend entry point
 *
 * Routes:
 *   POST /api/auth              — Voucher authentication
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
const path = require('path');
const authRoutes = require('./routes/auth');
const sessionRoutes = require('./routes/session');
const adminRoutes = require('./routes/admin');
const { startExpirationWorker } = require('./services/session');
const { fixMissingColumns } = require('./db/migrate_fix');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:8080';

// ── Security middleware ──────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://images.unsplash.com", "https:"],
      styleSrc: ["'self'", "https:", "'unsafe-inline'"],
      fontSrc: ["'self'", "https:", "data:"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"],
      objectSrc: ["'none'"],
    },
  },
}));

// CORS: restrict to known portal origin
const corsOptions = {
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile captive portals)
    if (!origin) return cb(null, true);
    // Allow null origin (file:// protocol for admin.html)
    if (origin === 'null') return cb(null, true);
    const allowed = (process.env.CORS_ORIGINS || FRONTEND_ORIGIN)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (allowed.includes(origin)) return cb(null, true);
    // Allow localhost (for admin panel dev access)
    if (/^http\/\/localhost/.test(origin)) return cb(null, true);
    cb(new Error('CORS: origin not allowed'));
  },
    methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
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
  // Disable X-Forwarded-For validation — Render's proxy header format triggers ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
  validate: {
    xForwardedForHeader: false,
  },
});
app.use('/api/', limiter);

// ── Routes ───────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/session',  sessionRoutes);
app.use('/api/admin',    adminRoutes);

// Health check (unauthenticated)
app.get('/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString(), env: NODE_ENV });
});

// ── Static file serving for captive portal pages ──────────────────
// Docker: static files copied to /app/public/ by Dockerfile
// Local dev: HTML files live in the project root (parent of backend/)
const fs = require('fs');

const candidates = [
  path.join(__dirname, '..', 'public'),              // Docker: /app/public/
  path.join(__dirname, '..', '..'),                 // Local dev: project-root/
];

let PORTAL_HTML_DIR = null;
for (const candidate of candidates) {
  if (fs.existsSync(path.join(candidate, 'index.html'))) {
    PORTAL_HTML_DIR = candidate;
    break;
  }
}

if (PORTAL_HTML_DIR) {
  app.use(express.static(PORTAL_HTML_DIR));
  app.get('/', (req, res) => res.sendFile(path.join(PORTAL_HTML_DIR, 'index.html')));
  app.get('/success', (req, res) => res.sendFile(path.join(PORTAL_HTML_DIR, 'success.html')));
      app.get('/status', (req, res) => res.sendFile(path.join(PORTAL_HTML_DIR, 'status.html')));
  app.get('/admin', (req, res) => res.sendFile(path.join(PORTAL_HTML_DIR, 'admin.html')));
  app.get('/error', (req, res) => res.sendFile(path.join(PORTAL_HTML_DIR, 'error.html')));
} else {
  console.warn('[WARN] Portal HTML directory not found — static file serving disabled.');
}

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
    error: err.message,
    code: code,
  });
});

// ── Start ────────────────────────────────────────────────────
const startup = async () => {
  // Ensure all schema columns exist on existing production tables
  try {
    await fixMissingColumns();
  } catch (err) {
    console.error('[startup] Column migration failed:', err.message);
  }

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
};

startup();

module.exports = app;








