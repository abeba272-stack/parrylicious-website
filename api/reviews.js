/*
 * /api/reviews — Bewertungen.
 *   GET  ?serviceId?=&limit?=   -> freigeschaltete Reviews (öffentlich)
 *   GET  ?summary=1&serviceId?= -> { avg, count } (freigeschaltet)
 *   POST { bookingId, rating, text } (Auth Kunde) -> Review anlegen (status 'pending')
 * Moderation (freischalten/ausblenden/löschen) läuft über /api/admin/reviews.
 */
const {
  sql, setCors, sendJson, bodyFromReq, requireAuthUser, pgErrorStatus
} = require('./_lib');

const MSG = {
  AUTH_REQUIRED: 'Anmeldung erforderlich.',
  BOOKING_NOT_FOUND_OR_FORBIDDEN: 'Buchung nicht gefunden.',
  INVALID_RATING: 'Bitte 1 bis 5 Sterne angeben.',
  NOT_COMPLETED: 'Bewerten ist erst nach dem Termin möglich.',
  REVIEW_EXISTS: 'Für diese Buchung gibt es bereits eine Bewertung.'
};

function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try { return Object.fromEntries(new URL(req.url, 'http://localhost').searchParams.entries()); } catch (_e) { return {}; }
}

async function handleGet(req, res) {
  const q = getQuery(req);
  const serviceId = q.serviceId ? String(q.serviceId).trim() : '';

  if (q.summary) {
    const rows = serviceId
      ? await sql`select coalesce(round(avg(rating), 1), 0) as avg, count(*)::int as count from reviews where status = 'approved' and service_id = ${serviceId}`
      : await sql`select coalesce(round(avg(rating), 1), 0) as avg, count(*)::int as count from reviews where status = 'approved'`;
    const r = (Array.isArray(rows) ? rows[0] : null) || {};
    return sendJson(res, 200, { avg: Number(r.avg) || 0, count: Number(r.count) || 0 });
  }

  const limit = Math.min(Math.max(Number.parseInt(q.limit, 10) || 20, 1), 100);
  const rows = serviceId
    ? await sql`select id, rating, text, first_name, service_name, created_at from reviews where status = 'approved' and service_id = ${serviceId} order by created_at desc limit ${limit}`
    : await sql`select id, rating, text, first_name, service_name, created_at from reviews where status = 'approved' order by created_at desc limit ${limit}`;
  return sendJson(res, 200, (Array.isArray(rows) ? rows : []).map((r) => ({
    id: r.id, rating: Number(r.rating), text: r.text || '',
    firstName: r.first_name || '', serviceName: r.service_name || '', createdAt: r.created_at
  })));
}

async function handlePost(req, res) {
  const user = requireAuthUser(req, res);
  if (!user) return;
  const body = bodyFromReq(req) || {};
  const bookingId = String(body.bookingId || '').trim();
  const rating = Number.parseInt(body.rating, 10);
  const text = String(body.text || '');
  if (!bookingId) return sendJson(res, 400, { error: 'INVALID_ID', message: 'Buchungs-ID fehlt.' });

  const rows = await sql`select * from create_review(${user.id}, ${bookingId}, ${rating}, ${text})`;
  const r = Array.isArray(rows) ? rows[0] : null;
  return sendJson(res, 201, { id: r?.id, status: r?.status || 'pending' });
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    res.setHeader('Allow', 'GET,POST,OPTIONS');
    return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Nur GET oder POST.' });
  } catch (error) {
    const { status, code } = pgErrorStatus(error);
    if (status === 500) return sendJson(res, 500, { error: 'INTERNAL', message: 'Unerwarteter Serverfehler.' });
    return sendJson(res, status, { error: code, message: MSG[code] || 'Anfrage fehlgeschlagen.' });
  }
};
