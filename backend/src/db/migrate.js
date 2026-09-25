/**
 * db/migrate.js — Database migration runner
 *
 * Supports SQLite (development) and PostgreSQL (production).
 * Reads DATABASE_URL from .env.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Database } = require('better-sqlite3');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'sqlite:./data/portal.db';
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

async function migrate() {
  console.log('[migrate] Starting database migration...');
  console.log('[migrate] Database URL:', DATABASE_URL);

  if (DATABASE_URL.startsWith('sqlite:')) {
    await migrateSQLite();
  } else if (DATABASE_URL.startsWith('postgresql:')) {
    await migratePostgres();
  } else {
    throw new Error('Unsupported DATABASE_URL scheme. Use sqlite: or postgresql:.');
  }

  console.log('[migrate] Done.');
}

async function migrateSQLite() {
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
}

async function migratePostgres() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();

  try {
    // PostgreSQL version: replace SQLite AUTOINCREMENT with SERIAL
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8')
      .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY')
      .replace(/AUTOINCREMENT/g, 'AUTOINCREMENT') // no-op for PG
      .replace(/TIMESTAMP DEFAULT CURRENT_TIMESTAMP/g, 'TIMESTAMP DEFAULT NOW()')
      .replace(/datetime('now')/gi, 'NOW()');

    // Split by semicolons and run each statement
    const statements = schema
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const stmt of statements) {
      await client.query(stmt);
    }

    console.log('[migrate] PostgreSQL schema applied.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error('[migrate] Migration failed:', err.message);
  process.exit(1);
});
