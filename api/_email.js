/*
 * api/_email.js — Vorgefertigte Kunden-Mails (Resend). EINE Quelle für den
 * Webhook (Live-Versand) und Tests, damit Test-Mail == Live-Mail.
 *
 * buildBookingConfirmationEmail(booking) -> { to, subject, text, html }
 * sendBookingConfirmationEmail(booking)  -> sendet via Resend (best effort)
 *
 * ENV: RESEND_API_KEY, RESEND_FROM_EMAIL, optional RESEND_REPLY_TO, RESEND_BCC.
 */

const SALON_ADDRESS = 'Bahlenstraße 42, 40589 Düsseldorf';
const SALON_WHATSAPP = '0151 70588497';

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

// Baut Betreff + Text- und HTML-Body aus einer Buchungszeile (public.bookings).
function buildBookingConfirmationEmail(booking) {
  const b = booking || {};
  const customer = b.customer || {};
  const to = String(customer.email || '').trim();

  const firstName = String(customer.firstName || '').trim();
  const service = String(b.service_name || 'Termin');
  const dateStr = formatDateDE(b.date_iso);
  const timeStr = String(b.time || '');
  const price = Number(b.price_from || 0);
  const deposit = Number(b.deposit || 0);
  const rest = Math.max(0, price - deposit);
  const greeting = firstName ? `Hallo ${firstName},` : 'Hallo,';

  const subject = 'Termin bestätigt – Parrylicious ✨';

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
    `Parrylicious – ${SALON_ADDRESS}\n\n` +
    `Fragen oder Umbuchung? Schreib uns per WhatsApp: ${SALON_WHATSAPP}.\n\n` +
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
    `<p style="margin:0;font-size:15px;">Parrylicious &middot; ${escapeHtml(SALON_ADDRESS)}</p>` +
    `<p style="margin:18px 0 0;font-size:14px;color:#6e5c60;">Fragen oder Umbuchung? Schreib uns per WhatsApp: <strong style="color:#2b1e24;">${escapeHtml(SALON_WHATSAPP)}</strong>.</p>` +
    `</div>` +
    `<div style="background:#efe4d3;padding:16px 28px;font-size:12px;color:#94858a;text-align:center;">Bis bald &ndash; dein Parrylicious-Team</div>` +
    `</div></div>`;

  return { to, subject, text, html };
}

// Sendet die Bestätigungs-Mail via Resend. Best effort: wirft nur bei echtem
// API-Fehler (der Aufrufer im Webhook fängt das ab und blockiert die Buchung nie).
async function sendBookingConfirmationEmail(booking) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from || !booking) return { skipped: true };

  const built = buildBookingConfirmationEmail(booking);
  if (!built.to) return { skipped: true };

  const payload = { from, to: [built.to], subject: built.subject, text: built.text, html: built.html };
  const replyTo = process.env.RESEND_REPLY_TO;
  if (replyTo) payload.reply_to = replyTo;
  const bcc = process.env.RESEND_BCC;
  if (bcc) payload.bcc = bcc.split(',').map((s) => s.trim()).filter(Boolean);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json?.message || `Resend HTTP ${response.status}`);
  }
  return { id: json?.id || null, to: built.to };
}

module.exports = { buildBookingConfirmationEmail, sendBookingConfirmationEmail };
