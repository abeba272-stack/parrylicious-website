/*
 * /api/admin/roles — Rollenverwaltung (nur Admin)
 * -----------------------------------------------
 * GET  ?limit=120  -> Liste aller User mit Rollen (admin_list_users_with_roles).
 *                     Antwort: Array<{ userId, email, fullName, role }>.
 * POST { email, role } -> Rolle per E-Mail setzen (admin_set_user_role_by_email).
 *                     Antwort: { userId, email, role }. userId ist null, wenn die
 *                     E-Mail noch nicht registriert ist (nur role_email_rules gesetzt).
 *
 * Autorisierung: requireAuthUser liefert die actor-id; der Admin-Check passiert in
 * SQL (raise FORBIDDEN). Postgres-Exceptions werden ueber pgErrorStatus gemappt.
 */

const {
  sql,
  setCors,
  sendJson,
  bodyFromReq,
  requireAuthUser,
  pgErrorStatus
} = require('../_lib.js');

// Deutsche, nutzerfreundliche Meldungen je Fehlercode.
const ERROR_MESSAGES = {
  AUTH_REQUIRED: 'Anmeldung erforderlich.',
  FORBIDDEN: 'Nur Administratoren duerfen Rollen verwalten.',
  INVALID_ROLE: 'Ungueltige Rolle. Erlaubt sind: customer, staff, admin.',
  INTERNAL: 'Ein unerwarteter Fehler ist aufgetreten.'
};

// Maps a caught Postgres error to the conventional { error, message } JSON payload.
function sendPgError(res, error) {
  const { status, code } = pgErrorStatus(error);
  const message = ERROR_MESSAGES[code] || ERROR_MESSAGES.INTERNAL;
  return sendJson(res, status, { error: code, message });
}

function normalizeRole(value) {
  return value === 'admin' || value === 'staff' ? value : 'customer';
}

function parseLimit(raw) {
  const parsed = Number.parseInt(raw, 10);
  // SQL clamps to [1, 500]; hier nur ein sinnvoller Default.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
}

async function handleGet(req, res, actorId) {
  const limit = parseLimit(req.query?.limit);
  const rows = await sql`select * from admin_list_users_with_roles(${actorId}, ${limit})`;
  const users = (Array.isArray(rows) ? rows : []).map((row) => ({
    userId: row.user_id,
    email: row.email || '',
    fullName: row.full_name || '',
    role: normalizeRole(row.role)
  }));
  return sendJson(res, 200, users);
}

async function handlePost(req, res, actorId) {
  const body = bodyFromReq(req) || {};
  const email = String(body.email || '').trim();
  const role = String(body.role || '').trim();

  if (!email) {
    return sendJson(res, 400, {
      error: 'EMAIL_REQUIRED',
      message: 'Bitte eine E-Mail-Adresse angeben.'
    });
  }

  const rows = await sql`select * from admin_set_user_role_by_email(${actorId}, ${email}, ${role})`;
  const row = Array.isArray(rows) ? rows[0] || null : null;

  // userId ist null, wenn die E-Mail (noch) keinem auth_users-Eintrag entspricht.
  return sendJson(res, 200, {
    userId: row?.user_id || null,
    email: row?.email || email.toLowerCase(),
    role: normalizeRole(row?.role || role)
  });
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET,POST');
    return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Methode nicht erlaubt.' });
  }

  const user = requireAuthUser(req, res);
  if (!user) return;

  try {
    if (req.method === 'GET') {
      return await handleGet(req, res, user.id);
    }
    return await handlePost(req, res, user.id);
  } catch (error) {
    return sendPgError(res, error);
  }
};
