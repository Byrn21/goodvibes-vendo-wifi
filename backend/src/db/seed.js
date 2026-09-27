/**
 * db/seed.js — Development seed data
 *
 * Creates sample vouchers for local testing.
 * Do NOT run in production.
 */

require('dotenv').config();
const { getDb, closeDb } = require('./client');

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

  const db = getDb();

     for (const v of vouchers) {
    // Use ON CONFLICT for PostgreSQL, INSERT OR IGNORE works in SQLite
    // The db client's run() handles placeholder conversion (? -> $N for PG)
    // ON CONFLICT works in PostgreSQL; SQLite 3.24+ supports it too
    try {
      await db.run(
        'INSERT INTO vouchers (code, duration_minutes, state) VALUES (?, ?, ?) ON CONFLICT (code) DO NOTHING',
        [v.code, v.duration, v.state]
      );
    } catch (err) {
      // Unique violation — voucher already exists, skip
      if (err.code === '23505' || err.code === 'SQLITE_CONSTRAINT') {
        // Skip duplicate — expected for re-runs
      } else {
        throw err;
      }
    }
  }

  console.log('[seed] Inserted', vouchers.length, 'vouchers.');
  await closeDb();
}

seed().catch(err => {
  console.error('[seed] Seed failed:', err.message);
  process.exit(1);
});
