// api/bookings.js — Buchungen (Neon Postgres, selbstgebaute Auth).
// Autorisierung passiert im API-Layer (Rolle aus profiles) bzw. in den
// SQL-Funktionen via p_user_id/p_actor_id. Siehe _lib.js + neon-schema.sql.

const {
  sql,
  setCors,
  sendJson,
  bodyFromReq,
  requireAuthUser,
  getUserRole,
  isStaffRole,
  mapBookingRow,
  pgErrorStatus
} = require('./_lib');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

// Query-Parameter robust lesen (Vercel liefert req.query, sonst aus req.url).
function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try {
    const url = new URL(req.url, 'http://localhost');
    return Object.fromEntries(url.searchParams.entries());
  } catch (_error) {
    return {};
  }
}

function toFiniteNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

// Postgres-Exception -> HTTP-Status + deutsche Meldung (kein Stacktrace an Client).
function sendPgError(res, error) {
  const { status, code } = pgErrorStatus(error);
  const messages = {
    AUTH_REQUIRED: 'Anmeldung erforderlich.',
    FORBIDDEN: 'Keine Berechtigung für diese Aktion.',
    BOOKING_NOT_FOUND_OR_FORBIDDEN: 'Buchung nicht gefunden.',
    SLOT_UNAVAILABLE: 'Dieser Termin ist leider nicht mehr verfügbar.',
    INVALID_DURATION: 'Ungültige Dauer für diese Buchung.',
    INVALID_STATUS: 'Ungültiger Status.',
    INVALID_ROLE: 'Ungültige Rolle.',
    INTERNAL: 'Es ist ein unerwarteter Fehler aufgetreten. Bitte versuche es später erneut.'
  };
  return sendJson(res, status, { error: code, message: messages[code] || messages.INTERNAL });
}

// GET: Liste (staff/admin -> alle, sonst eigene) oder Einzelbuchung (?id=).
async function handleGet(req, res) {
  const user = requireAuthUser(req, res);
  if (!user) return;

  const query = getQuery(req);
  const id = query.id ? String(query.id).trim() : '';

  const role = await getUserRole(user.id);
  const staff = isStaffRole(role);

  if (id) {
    // Nicht-existent oder kein UUID -> 404 (kein Existenz-Leak, kein 500).
    if (!isUuid(id)) {
      return sendJson(res, 404, { error: 'BOOKING_NOT_FOUND_OR_FORBIDDEN', message: 'Buchung nicht gefunden.' });
    }
    const rows = await sql`select * from bookings where id = ${id} limit 1`;
    const row = Array.isArray(rows) ? rows[0] : null;
    // Eigene ODER staff/admin. Sonst 404 statt 403 (kein Existenz-Leak).
    if (!row || (row.user_id !== user.id && !staff)) {
      return sendJson(res, 404, { error: 'BOOKING_NOT_FOUND_OR_FORBIDDEN', message: 'Buchung nicht gefunden.' });
    }
    return sendJson(res, 200, mapBookingRow(row));
  }

  const rows = staff
    ? await sql`select * from bookings order by created_at desc limit 500`
    : await sql`select * from bookings where user_id = ${user.id} order by created_at desc limit 500`;

  const list = (Array.isArray(rows) ? rows : []).map(mapBookingRow);
  return sendJson(res, 200, list);
}

// POST: Buchung anlegen via create_booking_secure (Slot-Check in SQL).
async function handlePost(req, res) {
  const user = requireAuthUser(req, res);
  if (!user) return;

  const body = bodyFromReq(req) || {};

  const serviceId = String(body.serviceId ?? '').trim();
  const serviceName = String(body.serviceName ?? '').trim();
  const durationMin = Number(body.durationMin);
  const priceFrom = toFiniteNumber(body.priceFrom, 0);
  const deposit = toFiniteNumber(body.deposit, 0);
  const stylistId = body.stylistId ? String(body.stylistId).trim() : 'auto';
  const stylistName = body.stylistName ? String(body.stylistName).trim() : 'Egal (automatisch)';
  const dateISO = String(body.dateISO ?? '').trim();
  const time = String(body.time ?? '').trim();
  const customer = body.customer && typeof body.customer === 'object' ? body.customer : {};
  const depositPaid = Boolean(body.depositPaid);

  if (!serviceId || !serviceName) {
    return sendJson(res, 400, { error: 'INVALID_INPUT', message: 'Service-Angaben fehlen.' });
  }
  if (!Number.isInteger(durationMin) || durationMin <= 0) {
    return sendJson(res, 400, { error: 'INVALID_DURATION', message: 'Ungültige Dauer für diese Buchung.' });
  }
  if (!DATE_RE.test(dateISO)) {
    return sendJson(res, 400, { error: 'INVALID_INPUT', message: 'Ungültiges Datum (Format YYYY-MM-DD erwartet).' });
  }
  if (!TIME_RE.test(time)) {
    return sendJson(res, 400, { error: 'INVALID_INPUT', message: 'Ungültige Uhrzeit (Format HH:MM erwartet).' });
  }

  // Parameterreihenfolge exakt an create_booking_secure() aus neon-schema.sql.
  const rows = await sql`
    select * from create_booking_secure(
      ${user.id},
      ${serviceId},
      ${serviceName},
      ${durationMin},
      ${priceFrom},
      ${deposit},
      ${stylistId},
      ${stylistName},
      ${dateISO},
      ${time},
      ${JSON.stringify(customer)}::jsonb,
      ${depositPaid}
    )
  `;
  const row = Array.isArray(rows) ? rows[0] : null;
  return sendJson(res, 201, mapBookingRow(row));
}

// PATCH: {id, action:'set_status'|'cancel', status?}.
async function handlePatch(req, res) {
  const user = requireAuthUser(req, res);
  if (!user) return;

  const body = bodyFromReq(req) || {};
  const id = String(body.id ?? '').trim();
  const action = String(body.action ?? '').trim();

  if (!isUuid(id)) {
    return sendJson(res, 400, { error: 'INVALID_INPUT', message: 'Ungültige Buchungs-ID.' });
  }

  if (action === 'set_status') {
    // set_booking_status prüft staff/admin + Status selbst.
    const status = String(body.status ?? '').trim();
    const rows = await sql`select * from set_booking_status(${user.id}, ${id}, ${status})`;
    const row = Array.isArray(rows) ? rows[0] : null;
    return sendJson(res, 200, mapBookingRow(row));
  }

  if (action === 'cancel') {
    // cancel_my_booking: nur eigene Buchung, sonst BOOKING_NOT_FOUND_OR_FORBIDDEN.
    const rows = await sql`select * from cancel_my_booking(${user.id}, ${id})`;
    const row = Array.isArray(rows) ? rows[0] : null;
    return sendJson(res, 200, mapBookingRow(row));
  }

  return sendJson(res, 400, { error: 'INVALID_ACTION', message: 'Unbekannte Aktion.' });
}

// DELETE: alle eigenen Buchungen löschen.
async function handleDelete(req, res) {
  const user = requireAuthUser(req, res);
  if (!user) return;

  const rows = await sql`delete from bookings where user_id = ${user.id} returning id`;
  const deleted = Array.isArray(rows) ? rows.length : 0;
  return sendJson(res, 200, { ok: true, deleted });
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    if (req.method === 'PATCH') return await handlePatch(req, res);
    if (req.method === 'DELETE') return await handleDelete(req, res);

    res.setHeader('Allow', 'GET,POST,PATCH,DELETE,OPTIONS');
    return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Methode nicht erlaubt.' });
  } catch (error) {
    return sendPgError(res, error);
  }
};
