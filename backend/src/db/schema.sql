-- ================================================================
-- schema.sql -- Omada captive portal database schema
-- ================================================================
-- Target: SQLite (development) / PostgreSQL (Render.com production)
--
-- Both databases use standard SQL with minor adjustments:
--   - AUTOINCREMENT vs SERIAL
--   - CURRENT_TIMESTAMP vs NOW()
--   - IF NOT EXISTS for table creation
--   - INSERT OR IGNORE vs ON CONFLICT (handled in app code)
--
-- SQLite uses ? placeholders; PostgreSQL uses $1, $2, etc.
-- The db/client.js layer handles this conversion automatically.
--
-- Run with: node src/db/migrate.js
-- ================================================================

-- Voucher codes table
CREATE TABLE IF NOT EXISTS vouchers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    code            VARCHAR(32) NOT NULL UNIQUE,
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    state           VARCHAR(16) NOT NULL DEFAULT 'active',
    used_by_mac     VARCHAR(32),
    used_at         TIMESTAMP,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at      TIMESTAMP
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id          VARCHAR(32) NOT NULL UNIQUE,
    client_mac          VARCHAR(32) NOT NULL,
    client_ip           VARCHAR(45),
    ap_mac              VARCHAR(32),
    ssid_name           VARCHAR(64),
    duration_minutes    INTEGER NOT NULL DEFAULT 60,
    started_at          TIMESTAMP,
    expires_at          TIMESTAMP,
    paused_at           TIMESTAMP,
    remaining_seconds   INTEGER,
    state               VARCHAR(16) NOT NULL DEFAULT 'pending',
    voucher_used        VARCHAR(32),
    provider_session_id VARCHAR(128),
    payment_event_id    VARCHAR(128),
    payment_amount      INTEGER,
    payment_method      VARCHAR(32),
    omada_auth_failed   BOOLEAN DEFAULT FALSE,
    expire_reason       VARCHAR(32),
    expired_at          TIMESTAMP,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Webhook events table
CREATE TABLE IF NOT EXISTS webhook_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id     VARCHAR(128) NOT NULL UNIQUE,
    session_id   VARCHAR(32),
    provider     VARCHAR(16) DEFAULT 'paymongo',
    event_type   VARCHAR(64),
    amount       INTEGER,
    status       VARCHAR(16),
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_state      ON sessions(state);
CREATE INDEX IF NOT EXISTS idx_sessions_client_mac ON sessions(client_mac);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_code       ON vouchers(code);
CREATE INDEX IF NOT EXISTS idx_sessions_provider   ON sessions(provider_session_id);

-- Admin users
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
-- 1. MAC addresses stored with colons (e.g. aa:bb:cc:dd:ee:ff).
--    Normalize on insert via normalizeMac().
--
-- 2. All timestamps are in UTC. Display in local time at frontend.
--
-- 3. Consider adding a batch table for bulk voucher generation,
--    or integrate directly with your point-of-sale / PMS system.
-- ================================================================
