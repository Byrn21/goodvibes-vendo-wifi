/**
 * services/omada.js — Omada controller adapter
 *
 * ⚠️  WARNING: This adapter is a TEMPLATE / SKELETON.
 *    The exact endpoint paths, request/response body formats,
 *    authentication headers, and error codes depend on the
 *    specific Omada Controller firmware version you are running.
 *    Verify every value below against your controller's
 *    external portal documentation and a captured test request.
 *
 *    Do not treat any value in this file as production-ready
 *    until you have tested it against YOUR controller.
 *
 * ================================================================
 * Common endpoint patterns (verify for your firmware):
 *
 *   POST /extPortal/auth        — Authenticate a client
 *   POST /extPortal/unauth      — Unauthenticate a client
 *   POST /api/v2/extPortal/auth — Some controller versions use /api/v2/ prefix
 *
 * Authentication methods (varies):
 *   a) Basic auth with admin credentials
 *   b) Bearer token (API key or session token)
 *   c) App key + secret in request body
 *
 * ================================================================
 *
 * Configuration (from .env):
 *   OMADA_BASE_URL       — e.g. https://192.168.1.252:8043
 *   OMADA_API_TOKEN      — API token or session cookie
 *   OMADA_SITE           — Site name (e.g. "Default")
 *   OMADA_AUTH_TIMEOUT   — ms
 *   OMADA_AUTH_PATH      — Path override for auth endpoint
 *   OMADA_UNAUTH_PATH    — Path override for unauth endpoint
 *   OMADA_TLS_REJECT     — "true" (default) or "false" (dev only!)
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

const BASE_URL  = process.env.OMADA_BASE_URL    || '';
const API_TOKEN = process.env.OMADA_API_TOKEN   || '';
const SITE      = process.env.OMADA_SITE        || 'Default';
const TIMEOUT   = parseInt(process.env.OMADA_AUTH_TIMEOUT || '10000', 10);
const TLS_REJECT = process.env.OMADA_TLS_REJECT !== 'false';

// ⚠️ These paths are examples — verify against your controller
const AUTH_PATH   = process.env.OMADA_AUTH_PATH   || '/extPortal/auth';
const UNAUTH_PATH = process.env.OMADA_UNAUTH_PATH || '/extPortal/unauth';

// In mock/test mode, simulate controller responses
const MOCK_MODE = process.env.OMADA_MOCK === 'true' || !BASE_URL;

/**
 * Authenticate a client via the Omada external portal API.
 *
 * @param {Object} ctx
 * @param {string} ctx.clientMac     Client MAC (normalized)
 * @param {string} [ctx.clientIp]    Client IP
 * @param {string} [ctx.apMac]       AP MAC
 * @param {string} [ctx.ssidName]    SSID name
 * @param {string} [ctx.username]    Voucher / user credential
 * @param {string} [ctx.password]    Voucher / password credential
 * @param {string} [ctx.sessionId]   Internal session ID (for logging)
 * @returns {Promise<Object>}  { success: boolean, ...data }
 * @throws Error if network/controller error
 *
 * ⚠️ The body format below is a best guess. Common variations:
 *   - Form-encoded: username=...&password=...&mac=...
 *   - JSON: { username, password, mac }
 *   - Different field names: token, key, auth_code, etc.
 *   - Some controllers require an Authorization header.
 */
async function authenticateClient(ctx) {
  if (MOCK_MODE) return mockAuthenticate(ctx);

  const endpoint = BASE_URL + AUTH_PATH;

  // ⚠️ Request body schema — VERIFY THIS FOR YOUR FIRMWARE
  const body = JSON.stringify({
    username: ctx.username || '',
    password: ctx.password || '',
    clientMac: ctx.clientMac || '',
    clientIp: ctx.clientIp || '',
    apMac: ctx.apMac || '',
    ssidName: ctx.ssidName || '',
    site: SITE,
    // Add any site-specific or version-specific fields here
  });

  const response = await omadaRequest(endpoint, 'POST', body);

  // ⚠️ Response format varies. Common patterns:
  //   { result: 0, msg: "success", data: {...} }
  //   { success: true }
  //   { errorCode: 0, ... }
  const isSuccess = isOmadaSuccessResponse(response);
  if (!isSuccess) {
    const err = new Error('Omada auth rejected: ' + (response.msg || response.message || JSON.stringify(response).slice(0, 100)));
    err.code = 'OMADA_AUTH_REJECTED';
    err.omadaResponse = response;
    throw err;
  }

  return { success: true, raw: response };
}

/**
 * Unauthenticate a client (de-authorize, disconnect).
 *
 * @param {Object} ctx
 * @param {string} ctx.clientMac
 * @param {string} [ctx.apMac]
 * @param {string} [ctx.ssidName]
 * @returns {Promise<Object>}
 * @throws Error
 */
async function unauthenticateClient(ctx) {
  if (MOCK_MODE) return mockUnauthenticate(ctx);

  const endpoint = BASE_URL + UNAUTH_PATH;

  const body = JSON.stringify({
    clientMac: ctx.clientMac || '',
    apMac: ctx.apMac || '',
    ssidName: ctx.ssidName || '',
    site: SITE,
  });

  const response = await omadaRequest(endpoint, 'POST', body);

  const isSuccess = isOmadaSuccessResponse(response);
  if (!isSuccess) {
    const err = new Error('Omada unauth rejected: ' + (response.msg || response.message || ''));
    err.code = 'OMADA_UNAUTH_REJECTED';
    err.omadaResponse = response;
    throw err;
  }

  return { success: true, raw: response };
}

// ================================================================
// Internal: HTTP request to Omada controller
// ================================================================
function omadaRequest(url, method, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body || ''),
        'Accept': 'application/json',
      },
      rejectUnauthorized: TLS_REJECT,
      timeout: TIMEOUT,
    };

    // ⚠️ Auth header — VERIFY for your controller
    if (API_TOKEN) {
      options.headers['Authorization'] = 'Bearer ' + API_TOKEN;
    }
    // Some controllers use a cookie-based token:
    // options.headers['Cookie'] = 'TPOMADA_TOKEN=' + API_TOKEN;

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try {
          parsed = data ? JSON.parse(data) : {};
        } catch {
          parsed = { raw: data };
        }
        resolve({ statusCode: res.statusCode, body: parsed });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      const err = new Error('Omada request timed out after ' + TIMEOUT + 'ms');
      err.code = 'OMADA_TIMEOUT';
      reject(err);
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNRESET' && !req.destroyed) {
        const e = new Error('Omada connection reset');
        e.code = 'OMADA_CONNECTION_ERROR';
        reject(e);
      } else {
        reject(err);
      }
    });

    if (body) req.write(body);
    req.end();
  });
}

/**
 * Determine if an Omada response indicates success.
 * ⚠️ Varies by firmware. Common patterns:
 *   - result === 0  (0 = success)
 *   - errorCode === 0
 *   - success === true
 *   - status === 0
 */
function isOmadaSuccessResponse(response) {
  if (!response) return false;
  const body = response.body || response;
  return (
    body.result === 0 ||
    body.errorCode === 0 ||
    body.success === true ||
    body.code === 0 ||
    body.status === 'success'
  );
}

// ================================================================
// Mock / test implementation
// ================================================================
function mockAuthenticate(ctx) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const u = (ctx.username || '').toUpperCase();
      if (u === 'EXPIRED' || u === 'FAIL' || u === 'INVALID') {
        resolve({ success: false, result: 1, msg: 'invalid voucher (mock)' });
      } else if (u === 'OMADA_ERROR' || u === 'SERVICE_UNAVAILABLE') {
        const err = new Error('Mock Omada controller error');
        err.code = 'OMADA_TIMEOUT';
        reject(err);
      } else {
        resolve({ success: true, result: 0, msg: 'success (mock)' });
      }
    }, 200);
  });
}

function mockUnauthenticate(ctx) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ success: true, result: 0, msg: 'unauth success (mock)' });
    }, 150);
  });
}

// ================================================================
module.exports = {
  authenticateClient,
  unauthenticateClient,
  // Exposed for testing
  _internal: {
    isOmadaSuccessResponse,
    AUTH_PATH,
    UNAUTH_PATH,
    MOCK_MODE,
    BASE_URL,
    SITE,
    TLS_REJECT,
  },
};
