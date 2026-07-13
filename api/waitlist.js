const {
  sql,
  setCors,
  sendJson,
  bodyFromReq,
  requireAuthUser,
  getUserRole,
  isStaffRole,
  mapWaitlistRow,
  pgErrorStatus
} = require('./_lib');

// User-friendly German messages for the mapped Postgres exception codes.
const CODE_MESSAGES = {
  AUTH_REQUIRED: 'Anmeldung erforderlich.',
  FORBIDDEN: 'Keine Berechtigung.',
  INVALID_INPUT: 'Ungültige Eingabe.'
};

function sendError(res, error) {
  const { status, code } = pgErrorStatus(error);
  if (status === 500) {
    return sendJson(res, 500, {
      error: 'INTERNAL',
      message: 'Unerwarteter Serverfehler. Bitte später erneut versuchen.'
    });
  }
  return sendJson(res, status, {
    error: code,
    message: CODE_MESSAGES[code] || 'Anfrage fehlgeschlagen.'
  });
}

// Reads ?id=... from req.query (Vercel) with a URL-parsing fallback.
function getQueryId(req) {
  if (req.query && typeof req.query.id !== 'undefined') {
    const value = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
    return value ? String(value).trim() : '';
  }
  try {
    const url = new URL(String(req.url || ''), 'http://localhost');
    return (url.searchParams.get('id') || '').trim();
  } catch (_error) {
    return '';
  }
}

// GET: nur Staff/Admin -> alle Einträge.
async function handleGet(req, res) {
  const user = requireAuthUser(req, res);
  if (!user) return;
  const role = await getUserRole(user.id);
  if (!isStaffRole(role)) {
    return sendJson(res, 403, { error: 'FORBIDDEN', message: 'Nur für Mitarbeiter.' });
  }
  const rows = await sql`select * from waitlist order by created_at desc limit 500`;
  return sendJson(res, 200, (rows || []).map(mapWaitlistRow));
}

// POST: öffentlich (Gast-Warteliste, ohne Konto -> user_id null).
async function handlePost(req, res) {
  const body = bodyFromReq(req) || {};
  const serviceId = String(body.serviceId || '').trim();
  const serviceName = String(body.serviceName || '').trim();
  const email = String(body.email || '').trim();
  const phone = String(body.phone || '').trim();
  const note = String(body.note || '').trim();

  if (!serviceId || !serviceName || !email || !phone) {
    return sendJson(res, 400, {
      error: 'INVALID_INPUT',
      message: 'Service, E-Mail und Telefon sind erforderlich.'
    });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return sendJson(res, 400, { error: 'EMAIL_INVALID', message: 'Bitte eine gültige E-Mail angeben.' });
  }

  const rows = await sql`
    insert into waitlist (user_id, service_id, service_name, email, phone, note)
    values (${null}, ${serviceId}, ${serviceName}, ${email}, ${phone}, ${note})
    returning *
  `;
  return sendJson(res, 201, mapWaitlistRow(rows[0]));
}

// DELETE: nur Staff/Admin. ?id= -> ein Eintrag; ohne id -> nicht erlaubt.
async function handleDelete(req, res) {
  const user = requireAuthUser(req, res);
  if (!user) return;
  const role = await getUserRole(user.id);
  if (!isStaffRole(role)) {
    return sendJson(res, 403, { error: 'FORBIDDEN', message: 'Nur für Mitarbeiter.' });
  }
  const id = getQueryId(req);
  if (!id) {
    return sendJson(res, 400, { error: 'INVALID_INPUT', message: 'Kein Eintrag angegeben.' });
  }
  const rows = await sql`delete from waitlist where id = ${id} returning id`;
  if (!Array.isArray(rows) || rows.length === 0) {
    return sendJson(res, 404, { error: 'NOT_FOUND', message: 'Warteliste-Eintrag nicht gefunden.' });
  }
  return sendJson(res, 200, { ok: true });
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res); // öffentlich
    if (req.method === 'DELETE') return await handleDelete(req, res);
    res.setHeader('Allow', 'GET,POST,DELETE,OPTIONS');
    return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Methode nicht erlaubt.' });
  } catch (error) {
    return sendError(res, error);
  }
};
