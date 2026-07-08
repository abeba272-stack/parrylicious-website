/*
 * API CONVENTIONS (bitte hier nachlesen, bevor du eine Route schreibst)
 * ---------------------------------------------------------------------
 * CORS:      Jede Route startet mit setCors(req, res). Bei req.method === 'OPTIONS'
 *            -> res.statusCode = 204; return res.end().
 *
 * Fehler:    sendJson(res, status, { error: 'CODE', message: 'deutsche Meldung' }).
 *            Postgres-Exceptions ueber pgErrorStatus(error) auf HTTP-Status mappen:
 *              AUTH_REQUIRED                    -> 401
 *              FORBIDDEN                        -> 403
 *              BOOKING_NOT_FOUND_OR_FORBIDDEN   -> 404
 *              SLOT_UNAVAILABLE                 -> 409
 *              INVALID_DURATION/INVALID_STATUS/INVALID_ROLE -> 400
 *            Unerwartete Fehler -> 500 mit generischer Meldung, NIE Stacktrace an Client.
 *
 * DB:        const { sql } = require('./_lib'); Queries als Tagged Template:
 *            await sql`select ... where id = ${id}` (parametrisiert, NIE Konkatenation).
 *
 * Session-Vertrag (Kurzform):
 *   - Erfolgs-Payload signup/login/exchange/refresh:
 *       { accessToken, refreshToken, expiresIn: 3600,
 *         user: { id, email, emailVerified, fullName, role } }
 *   - GET /api/auth/me:
 *       { id, email, emailVerified, fullName, role,
 *         profile: { fullName, phone, address, avatarUrl } }
 *   - JWT: HS256, JWT_SECRET, iss='parrylicious', aud='parry-api', Laufzeit 1h,
 *     sub=<auth_users.id>, email. Rolle NICHT im JWT -> immer frisch aus profiles.
 *   - Refresh-Token: opak (32 Byte hex), in DB nur sha256-Hash (auth_tokens,
 *     purpose='refresh', TTL 30 Tage, Rotation bei Nutzung).
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

const JWT_ISSUER = 'parrylicious';
const JWT_AUDIENCE = 'parry-api';

/* ---------------------------------------------------------------------------
 * CORS
 * ------------------------------------------------------------------------- */

function parseAllowedOrigins() {
  const raw = String(process.env.ALLOWED_ORIGIN || '*').trim();
  if (!raw || raw === '*') return ['*'];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeOrigin(origin) {
  if (!origin) return '';
  return String(origin).replace(/\/$/, '');
}

function resolveAllowedOrigin(req, allowedOrigins) {
  if (allowedOrigins.includes('*')) return '*';
  const requestOrigin = normalizeOrigin(req?.headers?.origin);
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) return requestOrigin;
  if (requestOrigin && !allowedOrigins.includes(requestOrigin)) return 'null';
  return allowedOrigins[0] || 'null';
}

function setCors(req, res) {
  const allowedOrigins = parseAllowedOrigins();
  const allowOrigin = resolveAllowedOrigin(req, allowedOrigins);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Stripe-Signature');
}

/* ---------------------------------------------------------------------------
 * HTTP helpers
 * ------------------------------------------------------------------------- */

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function bodyFromReq(req) {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (_error) {
      return null;
    }
  }
  return req.body || null;
}

/* ---------------------------------------------------------------------------
 * Auth: JWT + bearer token
 * ------------------------------------------------------------------------- */

function getBearerToken(req) {
  const auth = String(req.headers?.authorization || '');
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  return auth.slice(7).trim();
}

// Verifies the access token locally (no network). Returns { id, email } or null.
function getAuthUser(req) {
  const token = getBearerToken(req);
  if (!token) return null;

  const secret = process.env.JWT_SECRET;
  if (!secret) return null;

  try {
    const payload = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    });
    if (!payload?.sub) return null;
    return { id: payload.sub, email: payload.email || null };
  } catch (_error) {
    return null;
  }
}

// Like getAuthUser, but on failure it already sends 401 and returns null.
// Caller pattern: const user = requireAuthUser(req, res); if (!user) return;
function requireAuthUser(req, res) {
  const user = getAuthUser(req);
  if (!user) {
    sendJson(res, 401, { error: 'AUTH_REQUIRED', message: 'Anmeldung erforderlich.' });
    return null;
  }
  return user;
}

function signAccessToken(user) {
  const secret = process.env.JWT_SECRET;
  return jwt.sign({ email: user.email }, secret, {
    subject: String(user.id),
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: '1h'
  });
}

/* ---------------------------------------------------------------------------
 * Passwords (bcryptjs, cost 10)
 * ------------------------------------------------------------------------- */

async function hashPassword(plain) {
  return bcrypt.hash(String(plain), 10);
}

async function verifyPassword(plain, hash) {
  if (!hash) return false;
  try {
    return await bcrypt.compare(String(plain), String(hash));
  } catch (_error) {
    return false;
  }
}

/* ---------------------------------------------------------------------------
 * Opaque tokens (refresh / login_code / password_reset)
 * ------------------------------------------------------------------------- */

function generateOpaqueToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Creates a plaintext token, stores only its hash in auth_tokens, returns plaintext.
async function createAuthToken(userId, purpose, ttlSeconds) {
  const token = generateOpaqueToken();
  const tokenHash = hashToken(token);
  await sql`
    insert into auth_tokens (user_id, token_hash, purpose, expires_at)
    values (${userId}, ${tokenHash}, ${purpose}, now() + make_interval(secs => ${ttlSeconds}))
  `;
  return token;
}

// Consumes a token atomically (race-safe). For 'refresh' the row is deleted (rotation),
// otherwise used_at is stamped. Returns { userId } or null when not found/expired/used.
async function consumeAuthToken(token, purpose) {
  const tokenHash = hashToken(token);
  let rows;
  if (purpose === 'refresh') {
    rows = await sql`
      delete from auth_tokens
      where token_hash = ${tokenHash}
        and purpose = ${purpose}
        and used_at is null
        and expires_at > now()
      returning user_id
    `;
  } else {
    rows = await sql`
      update auth_tokens
      set used_at = now()
      where token_hash = ${tokenHash}
        and purpose = ${purpose}
        and used_at is null
        and expires_at > now()
      returning user_id
    `;
  }
  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? { userId: row.user_id } : null;
}

/* ---------------------------------------------------------------------------
 * Roles / lookups
 * ------------------------------------------------------------------------- */

function isStaffRole(role) {
  return role === 'staff' || role === 'admin';
}

async function getUserRole(userId) {
  if (!userId) return 'customer';
  const rows = await sql`select role from profiles where id = ${userId} limit 1`;
  const role = Array.isArray(rows) && rows[0]?.role ? rows[0].role : 'customer';
  return role;
}

async function getBookingById(bookingId) {
  if (!bookingId) return null;
  const rows = await sql`select * from bookings where id = ${bookingId} limit 1`;
  return Array.isArray(rows) ? rows[0] || null : null;
}

/* ---------------------------------------------------------------------------
 * Row mappers (snake_case DB -> camelCase client)
 * ------------------------------------------------------------------------- */

// Full booking mapper (mirrors the shape the frontend expects, siehe supabase-data.js).
function mapBookingRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    createdAt: row.created_at,
    serviceId: row.service_id,
    serviceName: row.service_name,
    durationMin: row.duration_min,
    priceFrom: Number(row.price_from || 0),
    deposit: Number(row.deposit || 0),
    stylistId: row.stylist_id,
    stylistName: row.stylist_name,
    dateISO: row.date_iso,
    time: row.time,
    customer: row.customer || {},
    depositPaid: Boolean(row.deposit_paid),
    paymentStatus: row.payment_status || (row.deposit_paid ? 'paid' : 'unpaid'),
    paymentProvider: row.payment_provider || null,
    paymentReference: row.payment_reference || null,
    stripeCheckoutSessionId: row.stripe_checkout_session_id || null,
    stripePaymentIntentId: row.stripe_payment_intent_id || null,
    paymentReceiptUrl: row.payment_receipt_url || null,
    paidAt: row.paid_at || null
  };
}

// Lean booking mapper (kept for backwards-compat with existing callers).
function mapBookingRowToClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    serviceName: row.service_name,
    dateISO: row.date_iso,
    time: row.time,
    deposit: Number(row.deposit || 0),
    depositPaid: Boolean(row.deposit_paid),
    paymentStatus: row.payment_status || (row.deposit_paid ? 'paid' : 'unpaid'),
    customer: row.customer || {}
  };
}

function mapWaitlistRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    serviceId: row.service_id,
    serviceName: row.service_name,
    email: row.email,
    phone: row.phone,
    note: row.note || ''
  };
}

function mapRole(value) {
  if (value === 'staff' || value === 'admin') return value;
  return 'customer';
}

function mapProfileRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    role: mapRole(row.role),
    fullName: row.full_name || '',
    phone: row.phone || '',
    address: row.address || '',
    avatarUrl: row.avatar_url || '',
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function mapAuthUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    emailVerified: Boolean(row.email_verified),
    fullName: row.full_name || '',
    avatarUrl: row.avatar_url || '',
    hasPassword: Boolean(row.password_hash),
    googleLinked: Boolean(row.google_id)
  };
}

/* ---------------------------------------------------------------------------
 * Error mapping
 * ------------------------------------------------------------------------- */

// Maps Postgres exception strings (contained in error.message) to HTTP status.
// Returns { status, code }. Unknown -> { status: 500, code: 'INTERNAL' }.
function pgErrorStatus(error) {
  const message = String(error?.message || '');
  const table = [
    { code: 'AUTH_REQUIRED', status: 401 },
    { code: 'FORBIDDEN', status: 403 },
    { code: 'BOOKING_NOT_FOUND_OR_FORBIDDEN', status: 404 },
    { code: 'BOOKING_NOT_FOUND', status: 404 },
    { code: 'SLOT_UNAVAILABLE', status: 409 },
    { code: 'INVALID_DURATION', status: 400 },
    { code: 'INVALID_STATUS', status: 400 },
    { code: 'INVALID_ROLE', status: 400 }
  ];
  for (const entry of table) {
    if (message.includes(entry.code)) {
      return { status: entry.status, code: entry.code };
    }
  }
  return { status: 500, code: 'INTERNAL' };
}

/* ---------------------------------------------------------------------------
 * Misc
 * ------------------------------------------------------------------------- */

function isAllowedReturnUrl(urlString) {
  if (!urlString) return false;
  let parsed = null;
  try {
    parsed = new URL(String(urlString));
  } catch (_error) {
    return false;
  }

  const protocol = String(parsed.protocol || '').toLowerCase();
  if (protocol !== 'https:' && protocol !== 'http:') return false;

  const allowedOrigins = parseAllowedOrigins();
  if (allowedOrigins.includes('*')) return true;
  return allowedOrigins.includes(normalizeOrigin(parsed.origin));
}

module.exports = {
  sql,
  parseAllowedOrigins,
  normalizeOrigin,
  resolveAllowedOrigin,
  setCors,
  sendJson,
  bodyFromReq,
  getBearerToken,
  getAuthUser,
  requireAuthUser,
  signAccessToken,
  hashPassword,
  verifyPassword,
  generateOpaqueToken,
  hashToken,
  createAuthToken,
  consumeAuthToken,
  isStaffRole,
  getUserRole,
  getBookingById,
  mapBookingRow,
  mapBookingRowToClient,
  mapWaitlistRow,
  mapProfileRow,
  mapAuthUserRow,
  pgErrorStatus,
  isAllowedReturnUrl
};
