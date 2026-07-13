const crypto = require('crypto');

const { setCors, sendJson, sql } = require('./_lib');
const STRIPE_API_BASE = 'https://api.stripe.com/v1';

async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.body && typeof req.body === 'object') return null;

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJsonSafe(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function parseStripeSignature(headerValue) {
  const parts = String(headerValue || '')
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

  const entries = {};
  parts.forEach((part) => {
    const [key, value] = part.split('=');
    if (!key || !value) return;
    if (!entries[key]) entries[key] = [];
    entries[key].push(value);
  });
  return entries;
}

function secureEqualHex(left, right) {
  const a = Buffer.from(String(left || ''), 'hex');
  const b = Buffer.from(String(right || ''), 'hex');
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function verifyStripeSignature(payload, signatureHeader, webhookSecret) {
  const parsed = parseStripeSignature(signatureHeader);
  const timestamp = parsed.t?.[0];
  const signatures = parsed.v1 || [];
  if (!timestamp || !signatures.length) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  return signatures.some((candidate) => secureEqualHex(candidate, expected));
}

function paymentPatchFromSession(session, paid) {
  const paymentIntentId = session.payment_intent?.id || session.payment_intent || null;
  const receiptUrl = session.payment_intent?.latest_charge?.receipt_url || null;
  return {
    payment_status: paid ? 'paid' : 'failed',
    payment_provider: 'stripe',
    deposit_paid: paid,
    paid_at: paid ? new Date().toISOString() : null,
    stripe_checkout_session_id: session.id || null,
    stripe_payment_intent_id: paymentIntentId,
    payment_reference: paymentIntentId || session.id || null,
    payment_receipt_url: receiptUrl
  };
}

async function fetchStripeEventById(eventId, stripeSecret) {
  if (!eventId || !stripeSecret) return null;
  const response = await fetch(`${STRIPE_API_BASE}/events/${encodeURIComponent(eventId)}`, {
    headers: {
      Authorization: `Bearer ${stripeSecret}`
    }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json?.error?.message || 'Stripe Event konnte nicht geladen werden.');
  }
  return json;
}

async function fetchCheckoutSession(sessionId, stripeSecret) {
  if (!sessionId || !stripeSecret) return null;
  const response = await fetch(
    `${STRIPE_API_BASE}/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent.latest_charge`,
    {
      headers: {
        Authorization: `Bearer ${stripeSecret}`
      }
    }
  );
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json?.error?.message || 'Checkout Session konnte nicht geladen werden.');
  }
  return json;
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

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
  const stripeSecret = process.env.STRIPE_SECRET_KEY || '';
  if (!webhookSecret && !stripeSecret) {
    return sendJson(res, 503, {
      message: 'Stripe Webhook ist nicht konfiguriert (STRIPE_WEBHOOK_SECRET oder STRIPE_SECRET_KEY fehlt).'
    });
  }

  let rawBody = null;
  let parsedBody = null;
  try {
    rawBody = await readRawBody(req);
    parsedBody = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)
      ? req.body
      : parseJsonSafe(rawBody);
  } catch (error) {
    return sendJson(res, 400, { message: `Webhook Body konnte nicht gelesen werden: ${error.message}` });
  }

  let event = null;
  if (rawBody && webhookSecret) {
    const signatureHeader = req.headers['stripe-signature'];
    const validSignature = verifyStripeSignature(rawBody, signatureHeader, webhookSecret);
    if (validSignature) {
      event = parseJsonSafe(rawBody);
      if (!event) {
        return sendJson(res, 400, { message: 'Webhook Body ist kein gültiges JSON.' });
      }
    }
  }

  // Fallback für Hosts, die den Raw-Body nicht unverändert liefern:
  // echtes Event über Stripe API per Event-ID nachladen.
  if (!event) {
    const eventId = parsedBody?.id;
    if (!eventId) {
      return sendJson(res, 400, { message: 'Ungültige Stripe-Signatur und keine Event-ID für Fallback vorhanden.' });
    }
    if (!stripeSecret) {
      return sendJson(res, 400, { message: 'STRIPE_SECRET_KEY fehlt für Webhook-Fallback-Verifikation.' });
    }
    try {
      event = await fetchStripeEventById(eventId, stripeSecret);
    } catch (error) {
      return sendJson(res, 400, { message: error.message || 'Stripe Event konnte nicht verifiziert werden.' });
    }
  }

  const eventType = String(event?.type || '');
  const handledSuccessEvents = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);
  const handledFailureEvents = new Set(['checkout.session.expired', 'checkout.session.async_payment_failed']);

  if (!handledSuccessEvents.has(eventType) && !handledFailureEvents.has(eventType)) {
    return sendJson(res, 200, {
      received: true,
      ignored: true,
      event: eventType
    });
  }

  const eventSession = event?.data?.object || {};
  const sessionId = eventSession?.id || null;
  const bookingId = eventSession?.metadata?.booking_id || eventSession?.client_reference_id || null;

  try {
    if (!bookingId) {
      return sendJson(res, 200, {
        received: true,
        ignored: true,
        event: eventType,
        reason: 'booking_id fehlt'
      });
    }

    let session = eventSession;
    if (sessionId && stripeSecret) {
      try {
        const expanded = await fetchCheckoutSession(sessionId, stripeSecret);
        if (expanded?.id) session = expanded;
      } catch (_error) {
        // Nicht blockieren: Patch geht notfalls mit Event-Session weiter.
      }
    }

    if (handledSuccessEvents.has(eventType)) {
      // Hold -> bestätigte, bezahlte Buchung. Idempotent (paid_at bleibt erhalten).
      const p = paymentPatchFromSession(session, true);
      await sql`
        select * from confirm_booking_payment(
          ${bookingId}, 'stripe', ${p.payment_reference},
          ${p.stripe_checkout_session_id}, ${p.stripe_payment_intent_id}, ${p.payment_receipt_url}
        )
      `;
    } else if (handledFailureEvents.has(eventType)) {
      // Abgebrochen/abgelaufen: nur den unbezahlten Hold freigeben, bestätigte Buchungen bleiben.
      await sql`delete from bookings where id = ${bookingId} and status = 'pending_payment'`;
    }

    return sendJson(res, 200, {
      received: true,
      event: eventType,
      bookingId,
      sessionId: sessionId || null
    });
  } catch (error) {
    return sendJson(res, 500, { message: error.message || 'Webhook Verarbeitung fehlgeschlagen.' });
  }
};
