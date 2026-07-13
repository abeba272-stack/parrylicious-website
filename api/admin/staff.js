/*
 * api/admin/staff.js — Angestellten-/Admin-Accounts anlegen (NUR Admin).
 * POST { email, password, role: 'staff'|'admin' }
 * Passwort wird hier gehasht; die SQL-Funktion admin_create_staff prüft die
 * Admin-Rolle des Aufrufers und legt auth_users + profiles + Rolle an.
 */
const {
  sql,
  setCors,
  sendJson,
  bodyFromReq,
  requireAuthUser,
  hashPassword,
  pgErrorStatus
} = require('../_lib');

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST,OPTIONS');
    return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Nur POST.' });
  }

  const actor = requireAuthUser(req, res);
  if (!actor) return;

  const body = bodyFromReq(req) || {};
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const role = String(body.role || 'staff').trim().toLowerCase();

  if (!EMAIL_RE.test(email)) {
    return sendJson(res, 400, { error: 'EMAIL_INVALID', message: 'Bitte eine gültige E-Mail angeben.' });
  }
  if (password.length < 8) {
    return sendJson(res, 400, { error: 'WEAK_PASSWORD', message: 'Passwort muss mindestens 8 Zeichen haben.' });
  }
  if (role !== 'staff' && role !== 'admin') {
    return sendJson(res, 400, { error: 'INVALID_ROLE', message: 'Rolle muss staff oder admin sein.' });
  }

  try {
    const passwordHash = await hashPassword(password);
    const rows = await sql`select * from admin_create_staff(${actor.id}, ${email}, ${passwordHash}, ${role})`;
    const row = Array.isArray(rows) ? rows[0] : null;
    return sendJson(res, 201, {
      userId: row?.user_id || null,
      email: row?.email || email,
      role: row?.role || role
    });
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('EMAIL_EXISTS')) {
      return sendJson(res, 409, { error: 'EMAIL_EXISTS', message: 'Diese E-Mail hat bereits einen Account.' });
    }
    const { status, code } = pgErrorStatus(error);
    if (status !== 500) {
      const msg = { FORBIDDEN: 'Nur Admins dürfen Accounts anlegen.', AUTH_REQUIRED: 'Anmeldung erforderlich.', INVALID_ROLE: 'Ungültige Rolle.' };
      return sendJson(res, status, { error: code, message: msg[code] || 'Anfrage fehlgeschlagen.' });
    }
    return sendJson(res, 500, { error: 'INTERNAL', message: 'Account konnte nicht angelegt werden.' });
  }
};
