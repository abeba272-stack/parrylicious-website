// api/slots.js — öffentliche Slot-Verfügbarkeit (KEINE Auth).
// GET ?dateISO=&time=&durationMin=&stylistId=&excludeBookingId=
// -> { available: boolean } via slot_is_available() (neon-schema.sql).

const { sql, setCors, sendJson, pgErrorStatus } = require('./_lib');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

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

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET,OPTIONS');
    return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Methode nicht erlaubt.' });
  }

  const query = getQuery(req);
  const dateISO = query.dateISO ? String(query.dateISO).trim() : '';
  const time = query.time ? String(query.time).trim() : '';
  const durationMin = Number(query.durationMin);
  const stylistId = query.stylistId ? String(query.stylistId).trim() : 'auto';
  const excludeBookingId = query.excludeBookingId ? String(query.excludeBookingId).trim() : null;

  // Pflichtparameter validieren (400 bei Fehlen/Format).
  if (!DATE_RE.test(dateISO)) {
    return sendJson(res, 400, { error: 'INVALID_INPUT', message: 'Parameter dateISO fehlt oder hat ein ungültiges Format (YYYY-MM-DD).' });
  }
  if (!TIME_RE.test(time)) {
    return sendJson(res, 400, { error: 'INVALID_INPUT', message: 'Parameter time fehlt oder hat ein ungültiges Format (HH:MM).' });
  }
  if (!Number.isInteger(durationMin) || durationMin <= 0) {
    return sendJson(res, 400, { error: 'INVALID_INPUT', message: 'Parameter durationMin fehlt oder ist ungültig.' });
  }
  if (excludeBookingId && !UUID_RE.test(excludeBookingId)) {
    return sendJson(res, 400, { error: 'INVALID_INPUT', message: 'Parameter excludeBookingId hat ein ungültiges Format.' });
  }

  try {
    const rows = await sql`
      select slot_is_available(
        ${dateISO},
        ${time},
        ${durationMin},
        ${stylistId},
        ${excludeBookingId}
      ) as available
    `;
    const row = Array.isArray(rows) ? rows[0] : null;
    return sendJson(res, 200, { available: Boolean(row?.available) });
  } catch (error) {
    const { status, code } = pgErrorStatus(error);
    if (status === 500) {
      return sendJson(res, 500, { error: 'INTERNAL', message: 'Verfügbarkeit konnte nicht geprüft werden.' });
    }
    return sendJson(res, status, { error: code, message: 'Verfügbarkeit konnte nicht geprüft werden.' });
  }
};
