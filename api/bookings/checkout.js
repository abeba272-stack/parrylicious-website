/*
 * Öffentlicher Buchungs-Checkout (KEIN Auth) — Pay-then-book.
 * Legt einen kurzlebigen Slot-Hold an (create_booking_hold), erzeugt eine
 * Stripe-Checkout-Session über die ANZAHLUNG und gibt die Redirect-URL zurück.
 * Die Buchung wird erst durch den Webhook (confirm_booking_payment) bestätigt.
 * Beträge kommen ausschließlich aus der serverseitigen Service-Liste (_services).
 */
const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const { setCors, sendJson, bodyFromReq, sql, isAllowedReturnUrl, pgErrorStatus, getAuthUser } = require('../_lib');
const { getService } = require('../_services');

function toStripeAmount(amount) {
  return Math.max(0, Math.round(Number(amount || 0) * 100));
}

function cleanStr(v, max = 200) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Nur POST.' });
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    return sendJson(res, 503, { error: 'STRIPE_UNCONFIGURED', message: 'Zahlungen sind aktuell nicht verfügbar.' });
  }

  const body = bodyFromReq(req) || {};

  // Service serverseitig auflösen — Beträge NIE vom Client übernehmen.
  const service = getService(body.serviceId);
  if (!service) {
    return sendJson(res, 400, { error: 'INVALID_SERVICE', message: 'Unbekannte Dienstleistung.' });
  }
  if (!(service.deposit > 0)) {
    return sendJson(res, 400, { error: 'NO_DEPOSIT', message: 'Für diese Dienstleistung ist keine Anzahlung hinterlegt.' });
  }

  const dateISO = cleanStr(body.dateISO, 10);
  const time = cleanStr(body.time, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || !/^\d{1,2}:\d{2}$/.test(time)) {
    return sendJson(res, 400, { error: 'INVALID_SLOT', message: 'Datum oder Uhrzeit ungültig.' });
  }

  const stylistId = cleanStr(body.stylistId, 60) || 'auto';
  const stylistName = cleanStr(body.stylistName, 120) || 'Egal (automatisch)';

  const c = body.customer || {};
  const customer = {
    firstName: cleanStr(c.firstName, 80),
    lastName: cleanStr(c.lastName, 80),
    name: cleanStr(c.name || `${cleanStr(c.firstName, 80)} ${cleanStr(c.lastName, 80)}`.trim(), 160),
    email: cleanStr(c.email, 160),
    phone: cleanStr(c.phone, 60),
    note: cleanStr(c.note, 400)
  };
  if (!customer.name) {
    return sendJson(res, 400, { error: 'NAME_REQUIRED', message: 'Bitte gib deinen Namen an.' });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customer.email)) {
    return sendJson(res, 400, { error: 'EMAIL_INVALID', message: 'Bitte gib eine gültige E-Mail an (für die Bestätigung).' });
  }

  // Optional eingeloggter Kunde -> Buchung mit user_id verknüpfen (sonst Gast = null).
  const authUser = getAuthUser(req);
  const userId = authUser ? authUser.id : null;

  try {
    // 1) Slot-Hold anlegen (reserviert den Slot; wirft SLOT_UNAVAILABLE bei Kollision).
    const holdRows = await sql`
      select * from create_booking_hold(
        ${service.id}, ${service.name}, ${service.durationMin},
        ${service.priceFrom}, ${service.deposit}, ${stylistId}, ${stylistName},
        ${dateISO}, ${time}, ${JSON.stringify(customer)}::jsonb, ${35}, ${userId}
      )
    `;
    const booking = Array.isArray(holdRows) ? holdRows[0] : null;
    if (!booking) {
      return sendJson(res, 500, { error: 'INTERNAL', message: 'Buchung konnte nicht angelegt werden.' });
    }

    // 2) Rückkehr-URLs.
    const origin = (req.headers.origin || '').replace(/\/$/, '');
    const fallbackOrigin = origin || `https://${req.headers.host || ''}`.replace(/\/$/, '');
    const successUrl = `${fallbackOrigin}/booking.html?payment=success&session_id={CHECKOUT_SESSION_ID}&booking_id=${booking.id}`;
    const cancelUrl = `${fallbackOrigin}/booking.html?payment=cancel&booking_id=${booking.id}`;
    if (!isAllowedReturnUrl(successUrl) || !isAllowedReturnUrl(cancelUrl)) {
      // Hold wieder freigeben, da wir nicht weiterkommen.
      await sql`delete from bookings where id = ${booking.id} and status = 'pending_payment'`;
      return sendJson(res, 400, { error: 'BAD_RETURN_URL', message: 'Ungültige Rückkehr-URL (ALLOWED_ORIGIN prüfen).' });
    }

    // 3) Stripe-Checkout-Session (Anzahlung).
    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('success_url', successUrl);
    params.append('cancel_url', cancelUrl);
    params.append('payment_method_types[0]', 'card');
    params.append('client_reference_id', booking.id);
    params.append('expires_at', String(Math.floor(Date.now() / 1000) + 1800)); // 30 min (Stripe-Minimum)
    params.append('line_items[0][price_data][currency]', 'eur');
    params.append('line_items[0][price_data][unit_amount]', String(toStripeAmount(service.deposit)));
    params.append('line_items[0][price_data][product_data][name]', `Anzahlung: ${service.name}`);
    params.append('line_items[0][price_data][product_data][description]', 'Restbetrag wird vor Ort im Salon bezahlt.');
    params.append('line_items[0][quantity]', '1');
    if (customer.email) params.append('customer_email', customer.email);
    params.append('metadata[booking_id]', booking.id);

    const response = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${stripeSecret}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const json = await response.json();
    if (!response.ok) {
      await sql`delete from bookings where id = ${booking.id} and status = 'pending_payment'`;
      return sendJson(res, 502, { error: 'STRIPE_ERROR', message: json?.error?.message || 'Stripe-Fehler.' });
    }

    // Session-ID am Hold vermerken (für Verifikation/Idempotenz).
    await sql`update bookings set stripe_checkout_session_id = ${json.id}, payment_provider = 'stripe' where id = ${booking.id}`;

    return sendJson(res, 200, { url: json.url, sessionId: json.id, bookingId: booking.id });
  } catch (error) {
    const { status, code } = pgErrorStatus(error);
    if (code === 'SLOT_UNAVAILABLE') {
      return sendJson(res, 409, { error: 'SLOT_UNAVAILABLE', message: 'Dieser Termin ist leider nicht mehr verfügbar.' });
    }
    if (status !== 500) {
      return sendJson(res, status, { error: code, message: 'Buchung konnte nicht angelegt werden.' });
    }
    return sendJson(res, 500, { error: 'INTERNAL', message: 'Unerwarteter Fehler beim Checkout.' });
  }
};
