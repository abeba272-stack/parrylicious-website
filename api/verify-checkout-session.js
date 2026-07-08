const STRIPE_API_BASE = 'https://api.stripe.com/v1';

const {
  setCors,
  sendJson,
  sql,
  getAuthUser,
  getUserRole,
  isStaffRole,
  getBookingById
} = require('./_lib');

async function patchBookingPayment(bookingId, patch) {
  if (!bookingId) return null;
  const rows = await sql`
    update bookings
    set payment_status = ${patch.payment_status},
        payment_provider = ${patch.payment_provider},
        deposit_paid = ${patch.deposit_paid},
        paid_at = ${patch.paid_at},
        stripe_checkout_session_id = ${patch.stripe_checkout_session_id},
        stripe_payment_intent_id = ${patch.stripe_payment_intent_id},
        payment_reference = ${patch.payment_reference},
        payment_receipt_url = ${patch.payment_receipt_url}
    where id = ${bookingId}
    returning *
  `;
  return Array.isArray(rows) ? rows[0] || null : null;
}

function deriveBookingPaymentState(session) {
  const stripePaymentStatus = String(session?.payment_status || '');
  const stripeSessionStatus = String(session?.status || '');

  if (stripePaymentStatus === 'paid') {
    return { paid: true, bookingPaymentStatus: 'paid' };
  }
  if (stripeSessionStatus === 'expired') {
    return { paid: false, bookingPaymentStatus: 'failed' };
  }
  if (stripeSessionStatus === 'complete' && stripePaymentStatus !== 'paid') {
    return { paid: false, bookingPaymentStatus: 'failed' };
  }
  return { paid: false, bookingPaymentStatus: 'pending' };
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {});
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { message: 'Method not allowed' });
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    return sendJson(res, 503, { message: 'Stripe ist nicht konfiguriert (STRIPE_SECRET_KEY fehlt).' });
  }

  const sessionId = req.query?.session_id;
  if (!sessionId) {
    return sendJson(res, 400, { message: 'session_id fehlt.' });
  }

  try {
    const authUser = getAuthUser(req);
    if (!authUser?.id) {
      return sendJson(res, 401, { message: 'Nicht eingeloggt.' });
    }

    const response = await fetch(
      `${STRIPE_API_BASE}/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent.latest_charge`,
      {
        headers: {
          Authorization: `Bearer ${stripeSecret}`
        }
      }
    );
    const json = await response.json();
    if (!response.ok) {
      return sendJson(res, response.status, { message: json?.error?.message || 'Stripe Fehler' });
    }

    const paymentState = deriveBookingPaymentState(json);
    const bookingId = json.metadata?.booking_id || json.client_reference_id || null;
    const paid = paymentState.paid;
    const receiptUrl = json.payment_intent?.latest_charge?.receipt_url || null;
    const paymentIntentId = json.payment_intent?.id || json.payment_intent || null;

    if (bookingId) {
      const booking = await getBookingById(bookingId);
      if (!booking) {
        return sendJson(res, 404, { message: 'Buchung nicht gefunden.' });
      }
      const role = await getUserRole(authUser.id);
      const canAccess = booking.user_id === authUser.id || isStaffRole(role);
      if (!canAccess) {
        return sendJson(res, 403, { message: 'Keine Berechtigung für diese Buchung.' });
      }

      await patchBookingPayment(bookingId, {
        payment_status: paymentState.bookingPaymentStatus,
        payment_provider: 'stripe',
        deposit_paid: paid,
        paid_at: paid ? new Date().toISOString() : null,
        stripe_checkout_session_id: json.id,
        stripe_payment_intent_id: paymentIntentId,
        payment_reference: paymentIntentId || json.id,
        payment_receipt_url: receiptUrl
      });
    }

    return sendJson(res, 200, {
      id: json.id,
      paid,
      payment_status: json.payment_status,
      booking_payment_status: paymentState.bookingPaymentStatus,
      amount_total: json.amount_total || 0,
      currency: json.currency || 'eur',
      metadata: json.metadata || {},
      booking_id: bookingId,
      payment_intent_id: paymentIntentId,
      payment_receipt_url: receiptUrl
    });
  } catch (error) {
    return sendJson(res, 500, { message: error.message || 'Fehler beim Verifizieren der Zahlung.' });
  }
};
