/*
 * /api/customer/[action] — EINE dynamische Vercel-Function für Kunden-Endpunkte
 * (spart Funktionen gegen das Hobby-Limit). Auth: jeder eingeloggte Nutzer.
 *
 * Aktionen:
 *   GET   bookings                                  -> eigene Buchungen
 *   PATCH bookings { id, action:'cancel' }          -> stornieren (>=48h) + Stripe-Refund
 *   PATCH bookings { id, action:'reschedule',
 *                    dateISO, time }                -> verschieben (>=48h), Anzahlung bleibt
 *
 * Erweiterbar (spätere Phasen): points (GET), eligibility (GET) — hier andocken.
 */
const {
  setCors,
  sendJson,
  sql,
  bodyFromReq,
  requireAuthUser,
  mapBookingRow,
  pgErrorStatus
} = require('../_lib');

const CANCEL_WINDOW_HOURS = 48;
const STRIPE_API_BASE = 'https://api.stripe.com/v1';

// Deutsche Meldungen für die per pgErrorStatus gemappten Codes.
const MSG = {
  AUTH_REQUIRED: 'Anmeldung erforderlich.',
  BOOKING_NOT_FOUND_OR_FORBIDDEN: 'Buchung nicht gefunden.',
  NOT_CANCELABLE: 'Diese Buchung kann nicht storniert werden.',
  NOT_RESCHEDULABLE: 'Diese Buchung kann nicht verschoben werden.',
  CANCEL_WINDOW_PASSED: 'Änderungen sind nur bis 48 Stunden vor dem Termin möglich.',
  SLOT_UNAVAILABLE: 'Der neue Wunschtermin ist leider nicht mehr frei.'
};

// Grobe Rest-Stunden bis zum Termin (nur Anzeige-Flag; die verbindliche 48-h-Prüfung
// erfolgt zeitzonen-korrekt in den DB-Funktionen cancel_/reschedule_booking_by_user).
function hoursUntilAppointment(dateISO, time) {
  const t = /^\d:/.test(String(time)) ? `0${time}` : String(time);
  const dt = new Date(`${dateISO}T${t}:00`);
  if (Number.isNaN(dt.getTime())) return -1;
  return (dt.getTime() - Date.now()) / 3600000;
}

function resolveAction(req) {
  const fromQuery = req.query && req.query.action;
  if (fromQuery) return String(Array.isArray(fromQuery) ? fromQuery[0] : fromQuery).toLowerCase();
  try {
    const url = new URL(req.url, 'http://localhost');
    const seg = url.pathname.split('/').filter(Boolean);
    return String(seg[seg.length - 1] || '').toLowerCase();
  } catch (_error) {
    return '';
  }
}

async function stripeRefund(paymentIntentId) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !paymentIntentId) return { ok: false, skipped: true };
  const params = new URLSearchParams();
  params.append('payment_intent', paymentIntentId);
  const resp = await fetch(`${STRIPE_API_BASE}/refunds`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  const json = await resp.json().catch(() => ({}));
  return { ok: resp.ok, json };
}

async function listBookings(res, user) {
  const rows = await sql`
    select * from bookings
    where user_id = ${user.id} and status <> 'pending_payment'
    order by date_iso desc, time desc
  `;
  const list = (Array.isArray(rows) ? rows : []).map((row) => {
    const b = mapBookingRow(row);
    const inWindow = b.status === 'confirmed' && hoursUntilAppointment(b.dateISO, b.time) >= CANCEL_WINDOW_HOURS;
    return { ...b, canCancel: inWindow, canReschedule: inWindow };
  });
  return sendJson(res, 200, list);
}

async function cancelBooking(res, user, bookingId) {
  // DB-Funktion prüft Eigentum + Status + 48-h-Fenster atomar und storniert (Slot frei).
  const rows = await sql`select * from cancel_booking_by_user(${bookingId}, ${user.id})`;
  const b = mapBookingRow(Array.isArray(rows) ? rows[0] : null);
  if (!b) return sendJson(res, 500, { error: 'INTERNAL', message: 'Stornierung fehlgeschlagen.' });

  // Anzahlung zurückerstatten, falls bezahlt.
  if (b.stripePaymentIntentId && b.paymentStatus === 'paid') {
    const r = await stripeRefund(b.stripePaymentIntentId);
    if (r.ok) {
      const up = await sql`update bookings set payment_status = 'refunded' where id = ${bookingId} returning *`;
      return sendJson(res, 200, mapBookingRow(Array.isArray(up) ? up[0] : null));
    }
    // Buchung ist storniert, aber der Refund schlug fehl -> markieren, manuell nachholen.
    return sendJson(res, 200, { ...b, refundPending: true });
  }
  return sendJson(res, 200, b);
}

async function rescheduleBooking(res, user, bookingId, dateISO, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || !/^\d{1,2}:\d{2}$/.test(time)) {
    return sendJson(res, 400, { error: 'INVALID_SLOT', message: 'Datum oder Uhrzeit ungültig.' });
  }
  const rows = await sql`select * from reschedule_booking_by_user(${bookingId}, ${user.id}, ${dateISO}, ${time})`;
  return sendJson(res, 200, mapBookingRow(Array.isArray(rows) ? rows[0] : null));
}

async function handleBookings(req, res, user) {
  if (req.method === 'GET') return listBookings(res, user);

  if (req.method === 'PATCH') {
    const body = bodyFromReq(req) || {};
    const id = String(body.id || '').trim();
    const action = String(body.action || '').trim().toLowerCase();
    if (!id) return sendJson(res, 400, { error: 'INVALID_ID', message: 'Buchungs-ID fehlt.' });
    if (action === 'cancel') return cancelBooking(res, user, id);
    if (action === 'reschedule') {
      return rescheduleBooking(res, user, id, String(body.dateISO || ''), String(body.time || ''));
    }
    return sendJson(res, 400, { error: 'INVALID_ACTION', message: 'Aktion muss cancel oder reschedule sein.' });
  }

  res.setHeader('Allow', 'GET,PATCH');
  return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Nur GET oder PATCH.' });
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const user = requireAuthUser(req, res);
  if (!user) return;

  const action = resolveAction(req);
  try {
    if (action === 'bookings') return await handleBookings(req, res, user);
    return sendJson(res, 404, { error: 'UNKNOWN_ACTION', message: 'Unbekannte Aktion.' });
  } catch (error) {
    const { status, code } = pgErrorStatus(error);
    if (status === 500) {
      return sendJson(res, 500, { error: 'INTERNAL', message: 'Unerwarteter Serverfehler.' });
    }
    return sendJson(res, status, { error: code, message: MSG[code] || 'Anfrage fehlgeschlagen.' });
  }
};
