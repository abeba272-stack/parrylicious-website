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

async function handleGet(req, res, userId) {
  const role = await getUserRole(userId);
  let rows;
  if (isStaffRole(role)) {
    rows = await sql`
      select * from waitlist
      order by created_at desc
      limit 500
    `;
  } else {
    rows = await sql`
      select * from waitlist
      where user_id = ${userId}
      order by created_at desc
      limit 500
    `;
  }
  return sendJson(res, 200, (rows || []).map(mapWaitlistRow));
}

async function handlePost(req, res, userId) {
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

  const rows = await sql`
    insert into waitlist (user_id, service_id, service_name, email, phone, note)
    values (${userId}, ${serviceId}, ${serviceName}, ${email}, ${phone}, ${note})
    returning *
  `;
  return sendJson(res, 201, mapWaitlistRow(rows[0]));
}

async function handleDelete(req, res, userId) {
  const id = getQueryId(req);

  // No id -> clear all of the caller's own waitlist entries.
  if (!id) {
    const deletedRows = await sql`
      delete from waitlist
      where user_id = ${userId}
      returning id
    `;
    return sendJson(res, 200, { ok: true, deleted: (deletedRows || []).length });
  }

  // With id -> allowed for the owner OR any staff/admin (mirrors the old
  // waitlist_delete_own_or_staff policy; admin.js deletes foreign entries).
  const existingRows = await sql`select * from waitlist where id = ${id} limit 1`;
  const entry = Array.isArray(existingRows) ? existingRows[0] : null;
  if (!entry) {
    return sendJson(res, 404, {
      error: 'NOT_FOUND',
      message: 'Warteliste-Eintrag nicht gefunden.'
    });
  }

  const isOwner = entry.user_id === userId;
  if (!isOwner) {
    const role = await getUserRole(userId);
    if (!isStaffRole(role)) {
      // Collapse forbidden into 404 (do not leak existence to non-owners).
      return sendJson(res, 404, {
        error: 'NOT_FOUND',
        message: 'Warteliste-Eintrag nicht gefunden.'
      });
    }
  }

  await sql`delete from waitlist where id = ${id}`;
  return sendJson(res, 200, { ok: true });
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const user = requireAuthUser(req, res);
  if (!user) return;

  try {
    if (req.method === 'GET') {
      return await handleGet(req, res, user.id);
    }
    if (req.method === 'POST') {
      return await handlePost(req, res, user.id);
    }
    if (req.method === 'DELETE') {
      return await handleDelete(req, res, user.id);
    }
    res.setHeader('Allow', 'GET,POST,DELETE,OPTIONS');
    return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Methode nicht erlaubt.' });
  } catch (error) {
    return sendError(res, error);
  }
};
