/*
 * /api/admin/[action] — EIN Dispatcher für Admin-Endpunkte (spart Vercel-Funktionen).
 *   roles:   GET (?limit) Liste  |  POST { email, role }
 *   staff:   POST { email, password, role }  |  DELETE { email }
 *   reviews: PATCH { id, status }  |  DELETE ?id=
 * Auth: requireAuthUser (actor-id) + Admin/Staff-Check in den SQL-Funktionen.
 * URLs bleiben identisch zu den früheren Einzeldateien (admin/roles, admin/staff).
 */
const {
  sql, setCors, sendJson, bodyFromReq, requireAuthUser, hashPassword, pgErrorStatus
} = require('../_lib');

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const MSG = {
  AUTH_REQUIRED: 'Anmeldung erforderlich.',
  FORBIDDEN: 'Keine Berechtigung.',
  INVALID_ROLE: 'Ungültige Rolle. Erlaubt: customer, staff, admin.',
  INVALID_STATUS: 'Ungültiger Status.',
  BOOKING_NOT_FOUND_OR_FORBIDDEN: 'Nicht gefunden.',
  INTERNAL: 'Ein unerwarteter Fehler ist aufgetreten.'
};

function resolveAction(req) {
  const fromQuery = req.query && req.query.action;
  if (fromQuery) return String(Array.isArray(fromQuery) ? fromQuery[0] : fromQuery).toLowerCase();
  try {
    const seg = new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean);
    return String(seg[seg.length - 1] || '').toLowerCase();
  } catch (_e) { return ''; }
}
function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try { return Object.fromEntries(new URL(req.url, 'http://localhost').searchParams.entries()); } catch (_e) { return {}; }
}
function normalizeRole(v) { return v === 'admin' || v === 'staff' ? v : 'customer'; }

/* ---- roles ---- */
async function rolesGet(req, res, actorId) {
  const raw = Number.parseInt(getQuery(req).limit, 10);
  const limit = Number.isFinite(raw) && raw > 0 ? raw : 120;
  const rows = await sql`select * from admin_list_users_with_roles(${actorId}, ${limit})`;
  return sendJson(res, 200, (Array.isArray(rows) ? rows : []).map((r) => ({
    userId: r.user_id, email: r.email || '', fullName: r.full_name || '', role: normalizeRole(r.role)
  })));
}
async function rolesPost(req, res, actorId) {
  const body = bodyFromReq(req) || {};
  const email = String(body.email || '').trim();
  const role = String(body.role || '').trim();
  if (!email) return sendJson(res, 400, { error: 'EMAIL_REQUIRED', message: 'Bitte eine E-Mail-Adresse angeben.' });
  const rows = await sql`select * from admin_set_user_role_by_email(${actorId}, ${email}, ${role})`;
  const r = Array.isArray(rows) ? rows[0] : null;
  return sendJson(res, 200, { userId: r?.user_id || null, email: r?.email || email.toLowerCase(), role: normalizeRole(r?.role || role) });
}

/* ---- staff ---- */
async function staffPost(req, res, actorId) {
  const body = bodyFromReq(req) || {};
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const role = String(body.role || 'staff').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return sendJson(res, 400, { error: 'EMAIL_INVALID', message: 'Bitte eine gültige E-Mail angeben.' });
  if (password.length < 8) return sendJson(res, 400, { error: 'WEAK_PASSWORD', message: 'Passwort muss mindestens 8 Zeichen haben.' });
  if (role !== 'staff' && role !== 'admin') return sendJson(res, 400, { error: 'INVALID_ROLE', message: 'Rolle muss staff oder admin sein.' });
  const passwordHash = await hashPassword(password);
  const rows = await sql`select * from admin_create_staff(${actorId}, ${email}, ${passwordHash}, ${role})`;
  const r = Array.isArray(rows) ? rows[0] : null;
  return sendJson(res, 201, { userId: r?.user_id || null, email: r?.email || email, role: r?.role || role });
}
async function staffDelete(req, res, actorId) {
  const body = bodyFromReq(req) || {};
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return sendJson(res, 400, { error: 'EMAIL_INVALID', message: 'Bitte eine gültige E-Mail angeben.' });
  await sql`select * from admin_delete_user(${actorId}, ${email})`;
  return sendJson(res, 200, { ok: true, email });
}

/* ---- reviews (Moderation) ---- */
async function reviewsPatch(req, res, actorId) {
  const body = bodyFromReq(req) || {};
  const id = String(body.id || '').trim();
  const status = String(body.status || '').trim().toLowerCase();
  if (!id) return sendJson(res, 400, { error: 'INVALID_ID', message: 'Review-ID fehlt.' });
  const rows = await sql`select * from admin_set_review_status(${actorId}, ${id}, ${status})`;
  const r = Array.isArray(rows) ? rows[0] : null;
  return sendJson(res, 200, { id: r?.id, status: r?.status });
}
async function reviewsDelete(req, res, actorId) {
  const id = String(getQuery(req).id || '').trim();
  if (!id) return sendJson(res, 400, { error: 'INVALID_ID', message: 'Review-ID fehlt.' });
  await sql`select public.admin_delete_review(${actorId}, ${id})`;
  return sendJson(res, 200, { ok: true, id });
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const user = requireAuthUser(req, res);
  if (!user) return;

  const action = resolveAction(req);
  try {
    if (action === 'roles') {
      if (req.method === 'GET') return await rolesGet(req, res, user.id);
      if (req.method === 'POST') return await rolesPost(req, res, user.id);
    } else if (action === 'staff') {
      if (req.method === 'POST') return await staffPost(req, res, user.id);
      if (req.method === 'DELETE') return await staffDelete(req, res, user.id);
    } else if (action === 'reviews') {
      if (req.method === 'PATCH') return await reviewsPatch(req, res, user.id);
      if (req.method === 'DELETE') return await reviewsDelete(req, res, user.id);
    } else {
      return sendJson(res, 404, { error: 'UNKNOWN_ACTION', message: 'Unbekannte Aktion.' });
    }
    res.setHeader('Allow', 'GET,POST,PATCH,DELETE,OPTIONS');
    return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Methode nicht erlaubt.' });
  } catch (error) {
    const m = String(error?.message || '');
    if (m.includes('EMAIL_EXISTS')) return sendJson(res, 409, { error: 'EMAIL_EXISTS', message: 'Diese E-Mail hat bereits einen Account.' });
    if (m.includes('CANNOT_DELETE_SELF')) return sendJson(res, 400, { error: 'CANNOT_DELETE_SELF', message: 'Du kannst deinen eigenen Account nicht löschen.' });
    if (m.includes('USER_NOT_FOUND')) return sendJson(res, 404, { error: 'USER_NOT_FOUND', message: 'Account nicht gefunden.' });
    const { status, code } = pgErrorStatus(error);
    if (status === 500) return sendJson(res, 500, { error: 'INTERNAL', message: MSG.INTERNAL });
    return sendJson(res, status, { error: code, message: MSG[code] || 'Anfrage fehlgeschlagen.' });
  }
};
