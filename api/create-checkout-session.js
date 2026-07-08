const STRIPE_API_BASE = 'https://api.stripe.com/v1';

const {
  setCors,
  sendJson,
  bodyFromReq,
  sql,
  getAuthUser,
  getUserRole,
  isStaffRole,
  getBookingById,
  isAllowedReturnUrl
} = require('./_lib');

function toStripeAmount(amount) {
  return Math.max(0, Math.round(Number(amount || 0) * 100));
}

async function patchBookingPayment(bookingId, patch) {
  if (!bookingId) return null;
  const rows = await sql`
    update bookings
    set payment_status = ${patch.payment_status},
        payment_provider = ${patch.payment_provider},
        deposit_paid = ${patch.deposit_paid},
        payment_reference = ${patch.payment_reference},
        stripe_checkout_session_id = ${patch.stripe_checkout_session_id},
        stripe_payment_intent_id = ${patch.stripe_payment_intent_id},
        payment_receipt_url = ${patch.payment_receipt_url},
        paid_at = ${patch.paid_at}
    where id = ${bookingId}
    returning *
  `;
  return Array.isArray(rows) ? rows[0] || null : null;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {});
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { message: 'Method not allowed' });
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    return sendJson(res, 503, { message: 'Stripe ist nicht konfiguriert (STRIPE_SECRET_KEY fehlt).' });
  }

  const body = bodyFromReq(req);
  const bookingId = String(body?.bookingId || '').trim();
  if (!bookingId) {
    return sendJson(res, 400, { message: 'bookingId fehlt.' });
  }

  try {
    const authUser = getAuthUser(req);
    if (!authUser?.id) {
      return sendJson(res, 401, { message: 'Nicht eingeloggt.' });
    }

    const booking = await getBookingById(bookingId);
    if (!booking) {
      return sendJson(res, 404, { message: 'Buchung nicht gefunden.' });
    }

    const role = await getUserRole(authUser.id);
    const canAccess = booking.user_id === authUser.id || isStaffRole(role);
    if (!canAccess) {
      return sendJson(res, 403, { message: 'Keine Berechtigung für diese Buchung.' });
    }

    if (booking.payment_status === 'paid' || booking.deposit_paid === true) {
      return sendJson(res, 409, { message: 'Anzahlung wurde bereits bezahlt.' });
    }
    if (booking.status === 'canceled') {
      return sendJson(res, 409, { message: 'Stornierte Buchungen können nicht bezahlt werden.' });
    }

    const amountCents = toStripeAmount(booking.deposit);
    if (!amountCents) {
      return sendJson(res, 400, { message: 'Ungültige Anzahlung.' });
    }

    const origin = (req.headers.origin || '').replace(/\/$/, '');
    const fallbackOrigin = origin || `https://${req.headers.host || ''}`.replace(/\/$/, '');
    const successUrl = String(body?.successUrl || `${fallbackOrigin}/booking.html?payment=success&session_id={CHECKOUT_SESSION_ID}&booking_id=${booking.id}`);
    const cancelUrl = String(body?.cancelUrl || `${fallbackOrigin}/booking.html?payment=cancel&booking_id=${booking.id}`);
    if (!isAllowedReturnUrl(successUrl) || !isAllowedReturnUrl(cancelUrl)) {
      return sendJson(res, 400, { message: 'Ungültige Rückkehr-URL. Prüfe ALLOWED_ORIGIN und Frontend-Domain.' });
    }

    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('success_url', successUrl);
    params.append('cancel_url', cancelUrl);
    params.append('payment_method_types[0]', 'card');
    params.append('client_reference_id', booking.id);
    params.append('line_items[0][price_data][currency]', 'eur');
    params.append('line_items[0][price_data][unit_amount]', String(amountCents));
    params.append('line_items[0][price_data][product_data][name]', `Anzahlung: ${booking.service_name || 'Termin'}`);
    params.append('line_items[0][quantity]', '1');

    const customer = booking.customer || {};
    if (customer.email) {
      params.append('customer_email', String(customer.email));
    }

    const metadata = {
      booking_id: booking.id || '',
      user_id: booking.user_id || '',
      service_name: booking.service_name || '',
      date_iso: booking.date_iso || '',
      time: booking.time || '',
      first_name: customer.firstName || '',
      last_name: customer.lastName || '',
      phone: customer.phone || ''
    };
    Object.entries(metadata).forEach(([key, value]) => {
      params.append(`metadata[${key}]`, String(value));
    });

    const response = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });
    const json = await response.json();
    if (!response.ok) {
      return sendJson(res, response.status, { message: json?.error?.message || 'Stripe Fehler' });
    }

    await patchBookingPayment(booking.id, {
      payment_status: 'pending',
      payment_provider: 'stripe',
      deposit_paid: false,
      payment_reference: json.id,
      stripe_checkout_session_id: json.id,
      stripe_payment_intent_id: null,
      payment_receipt_url: null,
      paid_at: null
    });

    return sendJson(res, 200, {
      id: json.id,
      url: json.url,
      bookingId: booking.id
    });
  } catch (error) {
    return sendJson(res, 500, { message: error.message || 'Fehler beim Erstellen der Checkout Session.' });
  }
};
