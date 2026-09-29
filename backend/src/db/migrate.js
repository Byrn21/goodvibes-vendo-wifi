/**
 * db/migrate.js — Database migration runner
 *
 * Reads DATABASE_URL from .env and applies schema.sql.
 * Supports both SQLite (development) and PostgreSQL (Render.com production).
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getDb, closeDb } = require('./client');
const { fixMissingColumns } = require('./migrate_fix');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

async function migrate() {
  console.log('[migrate] Starting database migration...');
  console.log('[migrate] Database URL:', process.env.DATABASE_URL || 'sqlite:./data/portal.db');

  const db = getDb();
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

  await db.exec(schema);

  // Add any missing columns to existing tables (idempotent)
  await fixMissingColumns();

  console.log('[migrate] Schema applied successfully.');
  console.log('[migrate] Done.');

  await closeDb();
}

migrate().catch(err => {
  console.error('[migrate] Migration failed:', err.message);
  process.exit(1);
});
