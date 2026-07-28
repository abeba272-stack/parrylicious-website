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

function formatDateDE(dateISO) {
  const m = String(dateISO || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(dateISO || '');
}

function euro(value) {
  return `${Number(value || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// Bestätigungs-Mail an den Gast via Resend. Best effort: Fehler blockieren den Webhook nie.
async function sendBookingConfirmationEmail(booking) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from || !booking) return;

  const customer = booking.customer || {};
  const to = String(customer.email || '').trim();
  if (!to) return;

  const firstName = String(customer.firstName || '').trim();
  const service = String(booking.service_name || 'Termin');
  const dateStr = formatDateDE(booking.date_iso);
  const timeStr = String(booking.time || '');
  const price = Number(booking.price_from || 0);
  const deposit = Number(booking.deposit || 0);
  const rest = Math.max(0, price - deposit);
  const greeting = firstName ? `Hallo ${firstName},` : 'Hallo,';

  const text =
    `${greeting}\n\n` +
    `deine Buchung bei Parrylicious ist bestätigt – wir freuen uns auf dich!\n\n` +
    `DEIN TERMIN\n` +
    `Leistung: ${service}\n` +
    `Datum: ${dateStr}\n` +
    `Uhrzeit: ${timeStr} Uhr\n\n` +
    `ZAHLUNG\n` +
    `Anzahlung (online bezahlt): ${euro(deposit)}\n` +
    `Restbetrag im Salon (bar): ab ${euro(rest)}\n\n` +
    `SALON\n` +
    `Parrylicious – Bahlenstraße 42, 40589 Düsseldorf\n\n` +
    `Fragen oder Umbuchung? Schreib uns per WhatsApp: 0151 70588497.\n\n` +
    `Bis bald!\nDein Parrylicious-Team`;

  const html =
    `<div style="margin:0;padding:24px;background:#f4ece0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#2b1e24;">` +
    `<div style="max-width:540px;margin:0 auto;background:#fbf6ee;border:1px solid #e4d6c4;border-radius:14px;overflow:hidden;">` +
    `<div style="background:#4a2e3e;padding:24px 28px;">` +
    `<div style="color:#e6c888;font-size:12px;letter-spacing:2px;text-transform:uppercase;">Parrylicious</div>` +
    `<div style="color:#fbf6ee;font-family:Georgia,serif;font-size:24px;margin-top:6px;">Termin best&auml;tigt &#10024;</div></div>` +
    `<div style="padding:24px 28px;">` +
    `<p style="margin:0 0 16px;font-size:15px;">${escapeHtml(greeting)}<br>deine Buchung ist best&auml;tigt &ndash; wir freuen uns auf dich!</p>` +
    `<table role="presentation" width="100%" style="border-collapse:collapse;font-size:15px;margin:0 0 18px;">` +
    `<tr><td style="padding:6px 0;color:#6e5c60;">Leistung</td><td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(service)}</td></tr>` +
    `<tr><td style="padding:6px 0;color:#6e5c60;">Datum</td><td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(dateStr)}</td></tr>` +
    `<tr><td style="padding:6px 0;color:#6e5c60;">Uhrzeit</td><td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(timeStr)} Uhr</td></tr>` +
    `</table>` +
    `<table role="presentation" width="100%" style="border-collapse:collapse;background:#efe4d3;border-radius:10px;font-size:15px;">` +
    `<tr><td style="padding:12px 16px 4px;color:#6e5c60;">Anzahlung (online bezahlt)</td><td style="padding:12px 16px 4px;text-align:right;"><strong>${euro(deposit)}</strong></td></tr>` +
    `<tr><td style="padding:4px 16px 12px;color:#6e5c60;">Restbetrag im Salon (bar)</td><td style="padding:4px 16px 12px;text-align:right;"><strong>ab ${euro(rest)}</strong></td></tr>` +
    `</table>` +
    `<p style="margin:20px 0 2px;font-size:13px;color:#94858a;text-transform:uppercase;letter-spacing:1px;">Salon</p>` +
    `<p style="margin:0;font-size:15px;">Parrylicious &middot; Bahlenstra&szlig;e 42, 40589 D&uuml;sseldorf</p>` +
    `<p style="margin:18px 0 0;font-size:14px;color:#6e5c60;">Fragen oder Umbuchung? Schreib uns per WhatsApp: <strong style="color:#2b1e24;">0151 70588497</strong>.</p>` +
    `</div>` +
    `<div style="background:#efe4d3;padding:16px 28px;font-size:12px;color:#94858a;text-align:center;">Bis bald &ndash; dein Parrylicious-Team</div>` +
    `</div></div>`;

  const payload = { from, to: [to], subject: 'Termin bestätigt – Parrylicious ✨', text, html };
  const replyTo = process.env.RESEND_REPLY_TO;
  if (replyTo) payload.reply_to = replyTo;
  const bcc = process.env.RESEND_BCC;
  if (bcc) payload.bcc = bcc.split(',').map((s) => s.trim()).filter(Boolean);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const j = await response.json().catch(() => ({}));
    throw new Error(j?.message || `Resend HTTP ${response.status}`);
  }
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

      // War die Buchung vorher schon bestätigt? -> Duplikat-Schutz gegen Webhook-Retries.
      const prior = await sql`select status from bookings where id = ${bookingId} limit 1`;
      const alreadyConfirmed = Array.isArray(prior) && prior[0]?.status === 'confirmed';

      const rows = await sql`
        select * from confirm_booking_payment(
          ${bookingId}, 'stripe', ${p.payment_reference},
          ${p.stripe_checkout_session_id}, ${p.stripe_payment_intent_id}, ${p.payment_receipt_url}
        )
      `;
      const booking = Array.isArray(rows) ? rows[0] : null;

      // Bestätigungs-Mail nur beim ersten Mal senden, best effort (blockiert den Webhook nie).
      if (!alreadyConfirmed && booking) {
        try {
          await sendBookingConfirmationEmail(booking);
        } catch (_error) {
          // Versandfehler ignorieren — die Buchung ist trotzdem bestätigt.
        }
      }
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
