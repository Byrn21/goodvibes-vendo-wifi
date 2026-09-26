/**
 * db/migrate.js — SQLite database migration runner
 *
 * Reads DATABASE_URL from .env and applies schema.sql.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATABASE_URL = process.env.DATABASE_URL || 'sqlite:./data/portal.db';
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

async function migrate() {
  console.log('[migrate] Starting database migration...');
  console.log('[migrate] Database URL:', DATABASE_URL);

  if (!DATABASE_URL.startsWith('sqlite:')) {
    throw new Error('Only SQLite is supported. DATABASE_URL must start with sqlite:');
  }

  const dbPath = DATABASE_URL.replace('sqlite:', '');
  const dbDir = path.dirname(dbPath);
  const absolutePath = path.resolve(dbPath);

  // Ensure directory exists
  if (!fs.existsSync(dbDir === '' ? '.' : dbDir)) {
    fs.mkdirSync(dbDir === '' ? '.' : dbDir, { recursive: true });
  }

  const db = new Database(absolutePath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);

  console.log('[migrate] SQLite schema applied to:', absolutePath);
  db.close();
  console.log('[migrate] Done.');
}

migrate().catch(err => {
  console.error('[migrate] Migration failed:', err.message);
  process.exit(1);
});
