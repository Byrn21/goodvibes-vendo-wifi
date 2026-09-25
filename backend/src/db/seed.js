/**
 * db/seed.js — Development seed data
 *
 * Creates sample vouchers for local testing.
 * Do NOT run in production.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Database } = require('better-sqlite3');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'sqlite:./data/portal.db';

function generateVoucher(prefix, durationMinutes) {
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${rand}`;
}

async function seed() {
  if (process.env.NODE_ENV === 'production') {
    console.error('[seed] Refusing to run in production. Set NODE_ENV=development.');
    process.exit(1);
  }

  console.log('[seed] Creating development voucher codes...');

  const vouchers = [
    { code: 'WIFI-TEST-0001', duration: 60,  state: 'active' },
    { code: 'WIFI-TEST-0002', duration: 120, state: 'active' },
    { code: 'WIFI-TEST-0003', duration: 180, state: 'active' },
    { code: 'EXPIRED-VOUCHER', duration: 60,  state: 'expired' },
    { code: 'USED-VOUCHER',    duration: 60,  state: 'used' },
  ];

  if (DATABASE_URL.startsWith('sqlite:')) {
    const dbPath = DATABASE_URL.replace('sqlite:', '');
    const absolutePath = path.resolve(dbPath);
    const db = new Database(absolutePath);
    db.pragma('journal_mode = WAL');

    const insert = db.prepare(`
      INSERT OR IGNORE INTO vouchers (code, duration_minutes, state)
      VALUES (?, ?, ?)
    `);

    const insertMany = db.transaction((rows) => {
      for (const v of rows) insert.run(v.code, v.duration, v.state);
    });

    insertMany(vouchers);
    console.log('[seed] Inserted', vouchers.length, 'vouchers into SQLite.');
    db.close();
  } else if (DATABASE_URL.startsWith('postgresql:')) {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();

    try {
      for (const v of vouchers) {
        await client.query(
          `INSERT INTO vouchers (code, duration_minutes, state)
           VALUES ($1, $2, $3)
           ON CONFLICT (code) DO NOTHING`,
          [v.code, v.duration, v.state]
        );
      }
      console.log('[seed] Inserted', vouchers.length, 'vouchers into PostgreSQL.');
    } finally {
      client.release();
      await pool.end();
    }
  }
}

seed().catch(err => {
  console.error('[seed] Seed failed:', err.message);
  process.exit(1);
});
