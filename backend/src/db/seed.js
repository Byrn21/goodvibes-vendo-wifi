/**
 * db/seed.js — Development seed data
 *
 * Creates sample vouchers for local testing.
 * Do NOT run in production.
 */

require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');

const DATABASE_URL = process.env.DATABASE_URL || 'sqlite:./data/portal.db';

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

  if (!DATABASE_URL.startsWith('sqlite:')) {
    throw new Error('Only SQLite is supported. DATABASE_URL must start with sqlite:');
  }

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
}

seed().catch(err => {
  console.error('[seed] Seed failed:', err.message);
  process.exit(1);
});
