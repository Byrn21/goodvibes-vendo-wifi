/**
 * db/migrate_fix.js — Column-level migration for existing databases
 *
 * Ensures all columns defined in schema.sql exist on existing tables.
 * This is necessary because CREATE TABLE IF NOT EXISTS won't add
 * columns to tables that already exist in production databases.
 *
 * Columns are added using ALTER TABLE ... ADD COLUMN IF NOT EXISTS
 * (SQLite) / ALTER TABLE ... ADD COLUMN (PostgreSQL — IF NOT EXISTS
 * is handled via error suppression for duplicate column names).
 */

const { getDb, closeDb } = require('./client');

// Columns that may be missing from older production databases
// Derived from schema.sql — sessions table
const SESSIONS_COLUMNS = [
  { name: 'client_ip', type: 'VARCHAR(45)', after: 'client_mac' },
  { name: 'ap_mac', type: 'VARCHAR(32)', after: 'client_ip' },
  { name: 'ssid_name', type: 'VARCHAR(64)', after: 'ap_mac' },
  { name: 'voucher_type', type: "VARCHAR(16) DEFAULT 'standard'", after: 'duration_minutes' },
  { name: 'total_duration_seconds', type: 'INTEGER', after: 'voucher_type' },
  { name: 'started_at', type: 'TIMESTAMP', after: 'total_duration_seconds' },
  { name: 'expires_at', type: 'TIMESTAMP', after: 'started_at' },
  { name: 'paused_at', type: 'TIMESTAMP', after: 'expires_at' },
  { name: 'remaining_seconds', type: 'INTEGER', after: 'paused_at' },
  { name: 'state', type: "VARCHAR(16) NOT NULL DEFAULT 'pending'", after: 'remaining_seconds' },
  { name: 'voucher_used', type: 'VARCHAR(32)', after: 'state' },
  { name: 'provider_session_id', type: 'VARCHAR(128)', after: 'voucher_used' },
  { name: 'payment_event_id', type: 'VARCHAR(128)', after: 'provider_session_id' },
  { name: 'payment_amount', type: 'INTEGER', after: 'payment_event_id' },
  { name: 'payment_method', type: 'VARCHAR(32)', after: 'payment_amount' },
  { name: 'omada_auth_failed', type: 'BOOLEAN DEFAULT FALSE', after: 'payment_method' },
  { name: 'expire_reason', type: 'VARCHAR(32)', after: 'omada_auth_failed' },
  { name: 'expired_at', type: 'TIMESTAMP', after: 'expire_reason' },
  { name: 'created_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP', after: 'expired_at' },
  { name: 'updated_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP', after: 'created_at' },
];

// Columns that may be missing from older production databases
// Derived from schema.sql — vouchers table
const VOUCHERS_COLUMNS = [
  { name: 'type', type: "VARCHAR(16) NOT NULL DEFAULT 'standard'", after: 'code' },
  { name: 'duration_minutes', type: 'INTEGER NOT NULL DEFAULT 60', after: 'type' },
  { name: 'price', type: 'INTEGER', after: 'duration_minutes' },
  { name: 'state', type: "VARCHAR(16) NOT NULL DEFAULT 'active'", after: 'price' },
  { name: 'used_by_mac', type: 'VARCHAR(32)', after: 'state' },
  { name: 'used_at', type: 'TIMESTAMP', after: 'used_by_mac' },
  { name: 'created_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP', after: 'used_at' },
  { name: 'expires_at', type: 'TIMESTAMP', after: 'created_at' },
];

/**
 * Check if a column exists in a given table.
 * @param {Object} db - Database connection
 * @param {string} tableName - Table name
 * @param {string} columnName - Column name
 * @returns {Promise<boolean>}
 */
async function columnExists(db, tableName, columnName) {
  try {
    // PostgreSQL
    if (db._driver === 'pg') {
      const result = await db.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
        [tableName, columnName]
      );
      return result.length > 0;
    }
    // SQLite
    const cols = db._sqliteDb.prepare(`PRAGMA table_info(${tableName})`).all();
    return cols.some(col => col.name === columnName);
  } catch (err) {
    // If the table doesn't exist, PRAGMA returns nothing; treat as no columns
    return false;
  }
}

/**
 * Get list of existing columns in a table.
 * @param {Object} db - Database connection
 * @param {string} tableName - Table name
 * @returns {Promise<string[]>}
 */
async function getExistingColumns(db, tableName) {
  try {
    if (db._driver === 'pg') {
      const rows = await db.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = ?`,
        [tableName]
      );
      return rows.map(r => r.column_name);
    }
    const cols = db._sqliteDb.prepare(`PRAGMA table_info(${tableName})`).all();
    return cols.map(c => c.name);
  } catch (err) {
    return [];
  }
}

/**
 * Main migration: ensure all expected columns exist.
 */
async function fixMissingColumns() {
  const db = getDb();

  // --- Sessions table ---
  let sessionsExists = false;
  try {
    const existing = await getExistingColumns(db, 'sessions');
    sessionsExists = true;

        if (existing.length === 0) {
      // Table doesn't exist yet — CREATE TABLE will handle it
      console.log('[migrate_fix] Sessions table not found — CREATE TABLE will handle it.');
    } else {
      const missing = SESSIONS_COLUMNS.filter(c => !existing.includes(c.name));

      if (missing.length === 0) {
        console.log('[migrate_fix] All sessions columns up to date.');
      } else {
        console.log(`[migrate_fix] Adding ${missing.length} missing column(s) to sessions table...`);

        for (const col of missing) {
          try {
            // PostgreSQL: columnExists check handles IF NOT EXISTS
            const exists = await columnExists(db, 'sessions', col.name);
            if (exists) {
              console.log(`[migrate_fix]   ✓ ${col.name} already exists`);
              continue;
            }

            // SQLite: add column with default
            await db.exec(`ALTER TABLE sessions ADD COLUMN ${col.name} ${col.type}`);
            console.log(`[migrate_fix]   + ${col.name} (${col.type})`);
          } catch (err) {
            // PostgreSQL: duplicate column name — ignore
            if (err.code === '42701' || (err.message && err.message.includes('already exists'))) {
              console.log(`[migrate_fix]   ✓ ${col.name} already exists`);
              continue;
            }
            // Column might already exist — log and skip non-critical errors
            console.warn(`[migrate_fix]   ! ${col.name}: ${err.message}`);
          }
        }
        console.log('[migrate_fix] Sessions table columns updated successfully.');
      }
    }
  } catch (err) {
    if (!sessionsExists) {
      // Table doesn't exist — schema.sql CREATE TABLE will handle it
    } else {
      console.error('[migrate_fix] Sessions migration error:', err.message);
    }
  }

    // --- Vouchers table ---
  try {
    let existingV = await getExistingColumns(db, 'vouchers');
    if (existingV.length === 0) {
      // Vouchers table doesn't exist yet — CREATE TABLE will handle it
      console.log('[migrate_fix] Vouchers table not found — CREATE TABLE will handle it.');
    } else {
      const missingV = VOUCHERS_COLUMNS.filter(c => !existingV.includes(c.name));
      if (missingV.length === 0) {
        console.log('[migrate_fix] All vouchers columns up to date.');
      } else {
        console.log(`[migrate_fix] Adding ${missingV.length} missing column(s) to vouchers table...`);

        for (const col of missingV) {
          try {
            const exists = await columnExists(db, 'vouchers', col.name);
            if (exists) {
              console.log(`[migrate_fix]   ✓ ${col.name} already exists`);
              continue;
            }
            await db.exec(`ALTER TABLE vouchers ADD COLUMN ${col.name} ${col.type}`);
            console.log(`[migrate_fix]   + ${col.name} (${col.type})`);
          } catch (err) {
            if (err.code === '42701' || (err.message && err.message.includes('already exists'))) {
              console.log(`[migrate_fix]   ✓ ${col.name} already exists`);
              continue;
            }
            console.warn(`[migrate_fix]   ! ${col.name}: ${err.message}`);
          }
        }
        console.log('[migrate_fix] Vouchers table columns updated successfully.');
      }
    }
  } catch (err) {
    console.warn('[migrate_fix] Vouchers table migration skipped:', err.message);
  }

  // --- Portal client context table (new — ensure it exists on old DBs) ---
  try {
    const createSql = `
      CREATE TABLE IF NOT EXISTS portal_client_context (
          client_mac  VARCHAR(32) PRIMARY KEY,
          client_ip   VARCHAR(45),
          ap_mac      VARCHAR(32) NOT NULL,
          ssid_name   VARCHAR(64) NOT NULL,
          radio_id    INTEGER NOT NULL DEFAULT 0,
          site        VARCHAR(64) NOT NULL DEFAULT 'Default',
          seen_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`;
    await db.exec(createSql);
    console.log('[migrate_fix] portal_client_context table ready.');
  } catch (err) {
    console.warn('[migrate_fix] portal_client_context creation skipped:', err.message);
  }
}

// Allow running standalone
if (require.main === module) {
  fixMissingColumns()
    .then(() => {
      console.log('[migrate_fix] Migration check complete.');
      return closeDb();
    })
    .catch(err => {
      console.error('[migrate_fix] Migration failed:', err.message);
      process.exit(1);
    });
}

module.exports = { fixMissingColumns, columnExists, getExistingColumns };