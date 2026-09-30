/**
 * __tests__/admin.test.js
 * Integration tests for admin.js DELETE /api/admin/vouchers/:id route
 *
 * Tests cover:
 *   - 200 success: DELETE existing voucher with valid API key
 *   - 404 not found: DELETE non-existent voucher with valid API key
 *   - 401 missing token: DELETE without Authorization / X-API-Key header
 *   - 401 invalid token: DELETE with invalid API key
 *   - SQL injection safety: DELETE with crafted ID uses parameterized query
 *
 * Patterns follow backend/__tests__/session.test.js:
 *   - Temp SQLite database created before requiring db/client.js
 *   - Schema applied via schema.sql
 *   - Seed data inserted in beforeEach
 *   - supertest with Express app exported from src/server.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Environment setup MUST happen before requiring any backend modules
const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-admin-test-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

process.env.DATABASE_URL = 'sqlite:' + TEST_DB_PATH;
process.env.ADMIN_API_KEY = 'test-admin-key';
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.OMADA_BASE_URL = '';
process.env.RATE_LIMIT_MAX_REQUESTS = '10000';

// Require the Express app AFTER env is set
const request = require('supertest');
const app = require('../src/server');
const { getDb, closeDb } = require('../src/db/client');


const VALID_KEY = 'test-admin-key';
const INVALID_KEY = 'invalid-key';

// --- Helpers ---

async function applySchema() {
  const schema = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'db', 'schema.sql'),
    'utf8'
  );
  await getDb().exec(schema);
}

async function seedVoucher(code, type, durationMinutes, price, state) {
  return getDb().run(
    'INSERT INTO vouchers (code, type, duration_minutes, price, state) VALUES (?, ?, ?, ?, ?)',
    [code, type, durationMinutes, price, state]
  );
}

async function seedVouchers() {
  await seedVoucher('WIFI-TEST-001', 'standard', 60, 3500, 'active');
  await seedVoucher('WIFI-PREMIUM', 'premium', 120, 9000, 'active');
  await seedVoucher('WIFI-USED', 'standard', 60, 3500, 'used');
}

async function getVoucherId(code) {
  const row = await getDb().getOne('SELECT id FROM vouchers WHERE code = ?', [code]);
  return row ? row.id : null;
}

// --- Lifecycle ---

beforeAll(async () => {
  await applySchema();
});

afterAll(async () => {
  await closeDb();
  try {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
  } catch (err) {
    // best-effort cleanup
  }
});

beforeEach(async () => {
  await getDb().exec('DELETE FROM sessions; DELETE FROM vouchers; DELETE FROM webhook_events;');
  await seedVouchers();
});

// --- Tests ---

describe('DELETE /api/admin/vouchers/:id — Voucher Deletion', () => {

  test('returns 200 + success when deleting an existing voucher with valid API key', async () => {
    const voucherId = await getVoucherId('WIFI-TEST-001');
    expect(voucherId).toBeTruthy();

    const res = await request(app)
      .delete('/api/admin/vouchers/' + voucherId)
      .set('X-API-Key', VALID_KEY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify voucher was actually deleted from DB
    const deleted = await getDb().getOne('SELECT id FROM vouchers WHERE id = ?', [voucherId]);
    expect(deleted).toBeUndefined();
  });

  test('returns 404 when deleting a non-existent voucher', async () => {
    const res = await request(app)
      .delete('/api/admin/vouchers/99999')
      .set('X-API-Key', VALID_KEY);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Voucher not found');
  });

  test('returns 401 when no API key or Authorization header is provided', async () => {
    const res = await request(app)
      .delete('/api/admin/vouchers/1');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/Unauthorized/i);
  });

  test('returns 401 when an invalid API key is provided', async () => {
    const res = await request(app)
      .delete('/api/admin/vouchers/1')
      .set('X-API-Key', INVALID_KEY);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/Unauthorized/i);
  });

  test('returns 401 when an invalid Bearer token', async () => {
    const res = await request(app)
      .delete('/api/admin/vouchers/1')
      .set('Authorization', 'Bearer fake-token');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('parametrized query prevents SQL injection via :id route parameter', async () => {
    const injectionId = "1 OR 1=1; DROP TABLE vouchers; --";

    const res = await request(app)
      .delete('/api/admin/vouchers/' + encodeURIComponent(injectionId))
      .set('X-API-Key', VALID_KEY);

    expect(res.status).toBe(404);

    // Verify the vouchers table still exists (injection was prevented)
    const voucherCount = await getDb().getOne('SELECT COUNT(*) as count FROM vouchers');
    expect(voucherCount.count).toBe(3);
  });

  test('parametrized query prevents UNION-based injection', async () => {
    const injectionId = "1; SELECT * FROM admin_users; --";

    const res = await request(app)
      .delete('/api/admin/vouchers/' + encodeURIComponent(injectionId))
      .set('X-API-Key', VALID_KEY);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);

    const voucherCount = await getDb().getOne('SELECT COUNT(*) as count FROM vouchers');
    expect(voucherCount.count).toBe(3);
  });

  test('Bearer token with valid API key authenticates successfully', async () => {
    const voucherId = await getVoucherId('WIFI-PREMIUM');
    expect(voucherId).toBeTruthy();

    const res = await request(app)
      .delete('/api/admin/vouchers/' + voucherId)
      .set('Authorization', 'Bearer ' + VALID_KEY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const deleted = await getDb().getOne('SELECT id FROM vouchers WHERE id = ?', [voucherId]);
    expect(deleted).toBeUndefined();
  });

  test('does not delete vouchers when ID contains SQL comment characters', async () => {
    const voucherId = await getVoucherId('WIFI-TEST-001');
    expect(voucherId).toBeTruthy();

    const res = await request(app)
      .delete('/api/admin/vouchers/' + voucherId + ' --')
      .set('X-API-Key', VALID_KEY);

    // The trailing comment characters make the ID not match
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);

    // Original voucher should still exist
    const voucher = await getDb().getOne('SELECT id FROM vouchers WHERE id = ?', [voucherId]);
    expect(voucher).toBeTruthy();
  });
});
