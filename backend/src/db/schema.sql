-- ================================================================
-- schema.sql — Omada captive portal database schema
-- ================================================================
-- Target: SQLite (development) / PostgreSQL (production)
-- Both databases use standard SQL — minor adjustments noted.
--
-- Run with: sqlite3 data/portal.db < src/db/schema.sql
-- Or for PostgreSQL: psql portal < src/db/schema.sql
-- ================================================================

-- Voucher codes table
CREATE TABLE IF NOT EXISTS vouchers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    code          VARCHAR(32) NOT NULL UNIQUE,
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    state         VARCHAR(16) NOT NULL DEFAULT 'active',  -- active, used, expired
    used_by_mac   VARCHAR(32),
    used_at       TIMESTAMP,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at    TIMESTAMP  -- voucher expiration date (if batch-issued)
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id            VARCHAR(32) NOT NULL UNIQUE,
    client_mac            VARCHAR(32) NOT NULL,
    client_ip             VARCHAR(45),
    ap_mac                VARCHAR(32),
    ssid_name             VARCHAR(64),
    duration_minutes      INTEGER NOT NULL DEFAULT 60,
    started_at            TIMESTAMP,
    expires_at            TIMESTAMP,
    paused_at             TIMESTAMP,
    remaining_seconds     INTEGER,  -- remaining seconds when paused (frozen)
    state                 VARCHAR(16) NOT NULL DEFAULT 'pending',
        -- pending, active, paused, expired, failed
    plan                  VARCHAR(16),          -- e.g. "60", "180"
    amount                INTEGER,              -- in smallest currency unit
    currency              VARCHAR(3) DEFAULT 'PHP',
    payment_id            VARCHAR(64),          -- provider payment/charge ID
    webhook_event_id      VARCHAR(64),          -- provider event ID (idempotency)
    voucher_used          VARCHAR(32),
    omada_auth_failed     BOOLEAN DEFAULT FALSE,
    expire_reason         VARCHAR(32),
    expired_at            TIMESTAMP,
    created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sessions_state      ON sessions(state);
CREATE INDEX IF NOT EXISTS idx_sessions_client_mac ON sessions(client_mac);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_code       ON vouchers(code);

-- Webhook event log for idempotency
CREATE TABLE IF NOT EXISTS webhook_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id    VARCHAR(64) NOT NULL UNIQUE,
    session_id  VARCHAR(32),
    event_type  VARCHAR(64),
    provider    VARCHAR(32),
    raw_payload TEXT,          -- For debugging (consider redacting in production)
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id ON webhook_events(event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_session  ON webhook_events(session_id);

-- Admin users (for /admin routes, if you add them)
CREATE TABLE IF NOT EXISTS admin_users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(16) DEFAULT 'admin',
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login    TIMESTAMP
);

-- ================================================================
-- Notes:
--
-- 1. For PostgreSQL, replace INTEGER PRIMARY KEY AUTOINCREMENT
--    with SERIAL PRIMARY KEY, and TIMESTAMP DEFAULT CURRENT_TIMESTAMP
--    with TIMESTAMP DEFAULT NOW().
--
-- 2. MAC addresses are stored with colons (e.g. aa:bb:cc:dd:ee:ff).
--    Normalize on insert.
--
-- 3. All timestamps are in UTC. Display in local time at the frontend.
--
-- 4. Consider adding a "batch" table for bulk voucher generation,
--    or integrate directly with your point-of-sale / PMS system.
-- ================================================================
