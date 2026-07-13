/*
 * /api/auth/[action] — EINE dynamische Vercel-Function für alle Auth-Aktionen.
 * ---------------------------------------------------------------------------
 * Aktion aus req.query.action (Fallback: letztes Pfadsegment aus req.url).
 * Konventionen siehe ../_lib.js. Session-Erzeugung zentral über buildSession().
 *
 * Aktionen:
 *   POST signup                 { email, password }
 *   POST login                  { email, password }
 *   GET  google                 ?next=<pfad>
 *   GET  callback               ?code=&state=          (Google OAuth Redirect)
 *   POST exchange               { code }               (login_code -> Session)
 *   POST refresh                { refreshToken }        (Rotation)
 *   GET  me                     (Bearer)
 *   POST logout                 (Bearer + { refreshToken })
 *   POST request-password-reset { email }               (immer 200, kein Leak)
 *   POST reset-password         { token, newPassword }
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const {
  sql,
  setCors,
  sendJson,
  bodyFromReq,
  requireAuthUser,
  signAccessToken,
  hashPassword,
  verifyPassword,
  createAuthToken,
  consumeAuthToken,
  hashToken,
  getUserRole,
  pgErrorStatus
} = require('../_lib');

const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 Tage
const LOGIN_CODE_TTL_SECONDS = 60;             // 1 Minute
const RESET_TTL_SECONDS = 30 * 60;             // 30 Minuten
const STATE_TTL = '10m';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Nur relative Pfade als OAuth-`next` zulassen (kein Protocol-relative "//").
const NEXT_RE = /^[a-z0-9._/-]*$/;

const PG_MESSAGES = {
  AUTH_REQUIRED: 'Anmeldung erforderlich.',
  FORBIDDEN: 'Keine Berechtigung.',
  BOOKING_NOT_FOUND_OR_FORBIDDEN: 'Nicht gefunden.',
  SLOT_UNAVAILABLE: 'Dieser Termin ist nicht mehr verfügbar.',
  INVALID_DURATION: 'Ungültige Dauer.',
  INVALID_STATUS: 'Ungültiger Status.',
  INVALID_ROLE: 'Ungültige Rolle.'
};

/* ---------------------------------------------------------------------------
 * Kleine Helfer
 * ------------------------------------------------------------------------- */

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidPassword(value) {
  return typeof value === 'string' && value.length >= 8;
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

// Query-Parameter lesen: bevorzugt req.query (Vercel), sonst aus req.url parsen.
function getQuery(req, key) {
  if (req.query && req.query[key] != null) {
    const value = req.query[key];
    return String(Array.isArray(value) ? value[0] : value);
  }
  try {
    const url = new URL(req.url, 'http://localhost');
    return url.searchParams.get(key) || '';
  } catch (_error) {
    return '';
  }
}

// Aktion bestimmen: req.query.action, sonst letztes Pfadsegment aus req.url.
function resolveAction(req) {
  const fromQuery = req.query && req.query.action;
  if (fromQuery) {
    const value = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
    return String(value).toLowerCase();
  }
  try {
    const url = new URL(req.url, 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean);
    return String(segments[segments.length - 1] || '').toLowerCase();
  } catch (_error) {
    return '';
  }
}

// Nur relative Pfade erlauben (Whitelist-Regex, kein "//").
function sanitizeNext(next) {
  const value = String(next || '');
  if (!value) return '';
  if (value.includes('//')) return '';
  if (!NEXT_RE.test(value)) return '';
  return value;
}

function isUniqueViolation(error) {
  if (!error) return false;
  if (String(error.code) === '23505') return true;
  const message = String(error.message || '').toLowerCase();
  return (
    message.includes('duplicate key') ||
    message.includes('auth_users_email_lower_uidx') ||
    message.includes('unique constraint')
  );
}

async function getAuthUserRow(userId) {
  if (!userId) return null;
  const rows = await sql`select * from auth_users where id = ${userId} limit 1`;
  return (Array.isArray(rows) && rows[0]) || null;
}

// Zentrale Session-Erzeugung: erwartet eine auth_users-Zeile.
async function buildSession(userRow) {
  const userId = userRow.id;
  const email = userRow.email;
  const role = await getUserRole(userId);
  const accessToken = signAccessToken({ id: userId, email });
  const refreshToken = await createAuthToken(userId, 'refresh', REFRESH_TTL_SECONDS);
  return {
    accessToken,
    refreshToken,
    expiresIn: 3600,
    user: {
      id: userId,
      email,
      emailVerified: Boolean(userRow.email_verified),
      fullName: userRow.full_name || '',
      role
    }
  };
}

/* ---------------------------------------------------------------------------
 * Aktionen: E-Mail/Passwort
 * ------------------------------------------------------------------------- */

async function handleLogin(req, res) {
  const body = bodyFromReq(req) || {};
  const email = normalizeEmail(body.email);
  const password = body.password;

  const invalid = () =>
    sendJson(res, 401, {
      error: 'INVALID_CREDENTIALS',
      message: 'E-Mail oder Passwort falsch.'
    });

  if (!email || typeof password !== 'string') {
    return invalid();
  }

  const rows = await sql`select * from auth_users where lower(email) = ${email} limit 1`;
  const userRow = (Array.isArray(rows) && rows[0]) || null;
  if (!userRow) {
    return invalid();
  }
  if (!userRow.password_hash) {
    return sendJson(res, 400, {
      error: 'GOOGLE_ONLY',
      message: 'Bitte mit Google einloggen.'
    });
  }

  const ok = await verifyPassword(password, userRow.password_hash);
  if (!ok) {
    return invalid();
  }

  const session = await buildSession(userRow);
  return sendJson(res, 200, session);
}

/* ---------------------------------------------------------------------------
 * Aktionen: refresh
 * ------------------------------------------------------------------------- */

async function handleRefresh(req, res) {
  const body = bodyFromReq(req) || {};
  const refreshToken = body.refreshToken;
  const invalid = () =>
    sendJson(res, 401, {
      error: 'REFRESH_INVALID',
      message: 'Die Sitzung ist abgelaufen. Bitte erneut anmelden.'
    });

  if (!refreshToken) return invalid();

  // consumeAuthToken('refresh') löscht die alte Zeile (Rotation).
  const consumed = await consumeAuthToken(String(refreshToken), 'refresh');
  if (!consumed) return invalid();

  const userRow = await getAuthUserRow(consumed.userId);
  if (!userRow) return invalid();

  const session = await buildSession(userRow); // erzeugt neuen Access + neuen Refresh
  return sendJson(res, 200, session);
}

/* ---------------------------------------------------------------------------
 * Aktionen: me / logout
 * ------------------------------------------------------------------------- */

async function handleMe(req, res) {
  const authUser = requireAuthUser(req, res);
  if (!authUser) return;

  // Rolle frisch aus E-Mail-Regel synchronisieren (upsertet profiles, gibt Rolle).
  const roleRows = await sql`select public.sync_role_from_email(${authUser.id}) as role`;
  const role = (Array.isArray(roleRows) && roleRows[0] && roleRows[0].role) || 'customer';

  const userRow = await getAuthUserRow(authUser.id);
  if (!userRow) {
    return sendJson(res, 404, { error: 'USER_NOT_FOUND', message: 'Benutzer nicht gefunden.' });
  }

  const profRows = await sql`select * from profiles where id = ${authUser.id} limit 1`;
  const profile = (Array.isArray(profRows) && profRows[0]) || {};

  return sendJson(res, 200, {
    id: userRow.id,
    email: userRow.email,
    emailVerified: Boolean(userRow.email_verified),
    fullName: userRow.full_name || profile.full_name || '',
    role,
    profile: {
      fullName: profile.full_name || userRow.full_name || '',
      phone: profile.phone || '',
      address: profile.address || '',
      avatarUrl: profile.avatar_url || userRow.avatar_url || ''
    }
  });
}

async function handleLogout(req, res) {
  const authUser = requireAuthUser(req, res);
  if (!authUser) return;

  const body = bodyFromReq(req) || {};
  const refreshToken = body.refreshToken;
  if (refreshToken) {
    const tokenHash = hashToken(String(refreshToken));
    await sql`
      delete from auth_tokens
      where token_hash = ${tokenHash}
        and purpose = 'refresh'
        and user_id = ${authUser.id}
    `;
  }

  return sendJson(res, 200, { ok: true });
}

/* ---------------------------------------------------------------------------
 * Aktionen: Passwort zurücksetzen
 * ------------------------------------------------------------------------- */

async function sendPasswordResetEmail(to, token) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from || !to) return;

  const link = `${process.env.FRONTEND_URL}/login.html?reset_token=${token}`;
  const text =
    'Hallo,\n\n' +
    'du hast angefragt, dein Passwort zurückzusetzen. Öffne den folgenden Link, ' +
    'um ein neues Passwort zu vergeben:\n\n' +
    `${link}\n\n` +
    'Der Link ist 30 Minuten gültig. Falls du das nicht warst, kannst du diese ' +
    'E-Mail ignorieren.\n\nDein Parrylicious-Team';

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Passwort zurücksetzen – Parrylicious',
      text
    })
  });
  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error(json && json.message ? json.message : 'Resend Fehler');
  }
}

async function handleRequestPasswordReset(req, res) {
  const body = bodyFromReq(req) || {};
  const email = normalizeEmail(body.email);

  // Niemals verraten, ob die E-Mail existiert (kein Enumeration-Leak).
  try {
    if (email && EMAIL_RE.test(email) && process.env.RESEND_API_KEY) {
      const rows = await sql`select * from auth_users where lower(email) = ${email} limit 1`;
      const userRow = (Array.isArray(rows) && rows[0]) || null;
      if (userRow) {
        const token = await createAuthToken(userRow.id, 'password_reset', RESET_TTL_SECONDS);
        await sendPasswordResetEmail(userRow.email, token);
      }
    }
  } catch (_error) {
    // Fehler bewusst schlucken — Antwort bleibt immer 200.
  }

  return sendJson(res, 200, { ok: true });
}

async function handleResetPassword(req, res) {
  const body = bodyFromReq(req) || {};
  const token = body.token;
  const newPassword = body.newPassword;

  if (!isValidPassword(newPassword)) {
    return sendJson(res, 400, {
      error: 'WEAK_PASSWORD',
      message: 'Das Passwort muss mindestens 8 Zeichen lang sein.'
    });
  }

  const invalidToken = () =>
    sendJson(res, 400, {
      error: 'TOKEN_INVALID',
      message: 'Der Link ist ungültig oder abgelaufen.'
    });

  if (!token) return invalidToken();

  const consumed = await consumeAuthToken(String(token), 'password_reset');
  if (!consumed) return invalidToken();

  const passwordHash = await hashPassword(newPassword);
  await sql`
    update auth_users
    set password_hash = ${passwordHash}, updated_at = now()
    where id = ${consumed.userId}
  `;

  // Alle bestehenden Refresh-Tokens des Users invalidieren.
  await sql`delete from auth_tokens where user_id = ${consumed.userId} and purpose = 'refresh'`;

  return sendJson(res, 200, { ok: true });
}

/* ---------------------------------------------------------------------------
 * Dispatcher
 * ------------------------------------------------------------------------- */

// Modell: nur Angestellten-Accounts (vom Admin angelegt). Keine öffentliche
// Selbst-Registrierung, kein Google-Login. Daher sind signup/google/callback/
// exchange NICHT geroutet (Staff nutzen login + optionalen Passwort-Reset).
const ROUTES = {
  login: { method: 'POST', handler: handleLogin },
  refresh: { method: 'POST', handler: handleRefresh },
  me: { method: 'GET', handler: handleMe },
  logout: { method: 'POST', handler: handleLogout },
  'request-password-reset': { method: 'POST', handler: handleRequestPasswordReset },
  'reset-password': { method: 'POST', handler: handleResetPassword }
};

function handleError(res, error) {
  const { status, code } = pgErrorStatus(error);
  if (status === 500) {
    return sendJson(res, 500, {
      error: 'INTERNAL',
      message: 'Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es später erneut.'
    });
  }
  return sendJson(res, status, {
    error: code,
    message: PG_MESSAGES[code] || 'Anfrage fehlgeschlagen.'
  });
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const action = resolveAction(req);
  const route = ROUTES[action];

  if (!route) {
    return sendJson(res, 404, { error: 'UNKNOWN_ACTION', message: 'Unbekannte Aktion.' });
  }
  if (req.method !== route.method) {
    res.setHeader('Allow', route.method);
    return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Methode nicht erlaubt.' });
  }

  try {
    return await route.handler(req, res);
  } catch (error) {
    return handleError(res, error);
  }
};
