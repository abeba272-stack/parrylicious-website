/*
 * api/admin/staff.js — Team-Accounts verwalten (NUR Admin).
 * POST   { email, password, role: 'staff'|'admin' }  -> Account anlegen
 * DELETE { email }                                    -> Account löschen
 * Passwörter werden hier gehasht; die SQL-Funktionen prüfen die Admin-Rolle.
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

async function handlePost(req, res, actor) {
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

  const passwordHash = await hashPassword(password);
  const rows = await sql`select * from admin_create_staff(${actor.id}, ${email}, ${passwordHash}, ${role})`;
  const row = Array.isArray(rows) ? rows[0] : null;
  return sendJson(res, 201, {
    userId: row?.user_id || null,
    email: row?.email || email,
    role: row?.role || role
  });
}

async function handleDelete(req, res, actor) {
  const body = bodyFromReq(req) || {};
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return sendJson(res, 400, { error: 'EMAIL_INVALID', message: 'Bitte eine gültige E-Mail angeben.' });
  }
  await sql`select * from admin_delete_user(${actor.id}, ${email})`;
  return sendJson(res, 200, { ok: true, email });
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'POST,DELETE,OPTIONS');
    return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Nur POST oder DELETE.' });
  }

  const actor = requireAuthUser(req, res);
  if (!actor) return;

  try {
    if (req.method === 'POST') return await handlePost(req, res, actor);
    return await handleDelete(req, res, actor);
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('EMAIL_EXISTS')) {
      return sendJson(res, 409, { error: 'EMAIL_EXISTS', message: 'Diese E-Mail hat bereits einen Account.' });
    }
    if (message.includes('CANNOT_DELETE_SELF')) {
      return sendJson(res, 400, { error: 'CANNOT_DELETE_SELF', message: 'Du kannst deinen eigenen Account nicht löschen.' });
    }
    if (message.includes('USER_NOT_FOUND')) {
      return sendJson(res, 404, { error: 'USER_NOT_FOUND', message: 'Account nicht gefunden.' });
    }
    const { status, code } = pgErrorStatus(error);
    if (status !== 500) {
      const msg = { FORBIDDEN: 'Nur Admins dürfen Accounts verwalten.', AUTH_REQUIRED: 'Anmeldung erforderlich.', INVALID_ROLE: 'Ungültige Rolle.' };
      return sendJson(res, status, { error: code, message: msg[code] || 'Anfrage fehlgeschlagen.' });
    }
    return sendJson(res, 500, { error: 'INTERNAL', message: 'Aktion konnte nicht ausgeführt werden.' });
  }
};
