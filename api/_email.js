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
  const payFull = String(customer.paymentMode || 'deposit') === 'full';
  const charged = Number(customer.chargedOnline != null ? customer.chargedOnline : deposit);
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
    (payFull
      ? `Gesamtbetrag (online bezahlt): ${euro(charged)}\nKein Restbetrag im Salon.\n\n`
      : `Anzahlung (online bezahlt): ${euro(deposit)}\nRestbetrag im Salon (bar): ab ${euro(rest)}\n\n`) +
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
    (payFull
      ? `<tr><td style="padding:12px 16px 4px;color:#6e5c60;">Gesamtbetrag (online bezahlt)</td><td style="padding:12px 16px 4px;text-align:right;"><strong>${euro(charged)}</strong></td></tr>` +
        `<tr><td style="padding:4px 16px 12px;color:#6e5c60;" colspan="2">Kein Restbetrag im Salon.</td></tr>`
      : `<tr><td style="padding:12px 16px 4px;color:#6e5c60;">Anzahlung (online bezahlt)</td><td style="padding:12px 16px 4px;text-align:right;"><strong>${euro(deposit)}</strong></td></tr>` +
        `<tr><td style="padding:4px 16px 12px;color:#6e5c60;">Restbetrag im Salon (bar)</td><td style="padding:4px 16px 12px;text-align:right;"><strong>ab ${euro(rest)}</strong></td></tr>`) +
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

// Baut die Termin-Erinnerung (wird am Vortag verschickt). Nutzt dieselbe
// Buchungszeile (public.bookings) wie die Bestätigung.
function buildBookingReminderEmail(booking) {
  const b = booking || {};
  const customer = b.customer || {};
  const to = String(customer.email || '').trim();

  const firstName = String(customer.firstName || '').trim();
  const service = String(b.service_name || 'Termin');
  const dateStr = formatDateDE(b.date_iso);
  const timeStr = String(b.time || '');
  const payFull = String(customer.paymentMode || 'deposit') === 'full';
  const rest = Math.max(0, Number(b.price_from || 0) - Number(b.deposit || 0));
  const greeting = firstName ? `Hallo ${firstName},` : 'Hallo,';

  const subject = 'Erinnerung: morgen ist dein Termin – Parrylicious 💛';

  const restLine = payFull
    ? 'Alles schon bezahlt – es fällt nichts mehr an.'
    : `Bitte denk an den Restbetrag im Salon (bar): ab ${euro(rest)}.`;

  const text =
    `${greeting}\n\n` +
    `kleine Erinnerung – morgen ist es so weit, wir freuen uns auf dich!\n\n` +
    `DEIN TERMIN\n` +
    `Leistung: ${service}\n` +
    `Datum: ${dateStr}\n` +
    `Uhrzeit: ${timeStr} Uhr\n\n` +
    `${restLine}\n\n` +
    `SALON\n` +
    `Parrylicious – ${SALON_ADDRESS}\n\n` +
    `Du kannst morgen doch nicht? Sag uns so früh wie möglich per WhatsApp Bescheid: ${SALON_WHATSAPP}.\n\n` +
    `Bis morgen!\nDein Parrylicious-Team`;

  const html =
    `<div style="margin:0;padding:24px;background:#f4ece0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#2b1e24;">` +
    `<div style="max-width:540px;margin:0 auto;background:#fbf6ee;border:1px solid #e4d6c4;border-radius:14px;overflow:hidden;">` +
    `<div style="background:#4a2e3e;padding:24px 28px;">` +
    `<div style="color:#e6c888;font-size:12px;letter-spacing:2px;text-transform:uppercase;">Parrylicious</div>` +
    `<div style="color:#fbf6ee;font-family:Georgia,serif;font-size:24px;margin-top:6px;">Morgen ist dein Termin &#128153;</div></div>` +
    `<div style="padding:24px 28px;">` +
    `<p style="margin:0 0 16px;font-size:15px;">${escapeHtml(greeting)}<br>kleine Erinnerung &ndash; morgen ist es so weit, wir freuen uns auf dich!</p>` +
    `<table role="presentation" width="100%" style="border-collapse:collapse;font-size:15px;margin:0 0 18px;">` +
    `<tr><td style="padding:6px 0;color:#6e5c60;">Leistung</td><td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(service)}</td></tr>` +
    `<tr><td style="padding:6px 0;color:#6e5c60;">Datum</td><td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(dateStr)}</td></tr>` +
    `<tr><td style="padding:6px 0;color:#6e5c60;">Uhrzeit</td><td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(timeStr)} Uhr</td></tr>` +
    `</table>` +
    `<p style="margin:0 0 18px;font-size:14px;color:#6e5c60;">${escapeHtml(restLine)}</p>` +
    `<p style="margin:0;font-size:15px;">Parrylicious &middot; ${escapeHtml(SALON_ADDRESS)}</p>` +
    `<p style="margin:18px 0 0;font-size:14px;color:#6e5c60;">Du kannst morgen doch nicht? Sag uns so fr&uuml;h wie m&ouml;glich per WhatsApp Bescheid: <strong style="color:#2b1e24;">${escapeHtml(SALON_WHATSAPP)}</strong>.</p>` +
    `</div>` +
    `<div style="background:#efe4d3;padding:16px 28px;font-size:12px;color:#94858a;text-align:center;">Bis morgen &ndash; dein Parrylicious-Team</div>` +
    `</div></div>`;

  return { to, subject, text, html };
}

// Sendet die Erinnerung via Resend. Best effort; wirft nur bei echtem API-Fehler.
async function sendBookingReminderEmail(booking) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from || !booking) return { skipped: true };

  const built = buildBookingReminderEmail(booking);
  if (!built.to) return { skipped: true };

  const payload = { from, to: [built.to], subject: built.subject, text: built.text, html: built.html };
  const replyTo = process.env.RESEND_REPLY_TO;
  if (replyTo) payload.reply_to = replyTo;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.message || `Resend HTTP ${response.status}`);
  return { id: json?.id || null, to: built.to };
}

// E-Mail-Verifizierung (Kunden-Registrierung). Best effort; wirft nur bei API-Fehler.
async function sendVerificationEmail(to, verifyUrl) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from || !to) return { skipped: true };

  const text =
    'Hallo,\n\n' +
    'bitte bestätige deine E-Mail-Adresse für dein Parrylicious-Konto:\n\n' +
    `${verifyUrl}\n\n` +
    'Der Link ist 24 Stunden gültig. Falls du dich nicht registriert hast, ' +
    'kannst du diese E-Mail ignorieren.\n\nDein Parrylicious-Team';

  const html =
    `<div style="margin:0;padding:24px;background:#f4ece0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#2b1e24;">` +
    `<div style="max-width:540px;margin:0 auto;background:#fbf6ee;border:1px solid #e4d6c4;border-radius:14px;overflow:hidden;">` +
    `<div style="background:#4a2e3e;padding:24px 28px;">` +
    `<div style="color:#e6c888;font-size:12px;letter-spacing:2px;text-transform:uppercase;">Parrylicious</div>` +
    `<div style="color:#fbf6ee;font-family:Georgia,serif;font-size:22px;margin-top:6px;">E-Mail best&auml;tigen</div></div>` +
    `<div style="padding:24px 28px;font-size:15px;">` +
    `<p style="margin:0 0 16px;">Hallo,<br>bitte best&auml;tige deine E-Mail-Adresse f&uuml;r dein Parrylicious-Konto.</p>` +
    `<p style="margin:0 0 20px;"><a href="${verifyUrl}" style="display:inline-block;background:#4a2e3e;color:#fbf6ee;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">E-Mail best&auml;tigen</a></p>` +
    `<p style="margin:0;font-size:13px;color:#6e5c60;">Der Link ist 24 Stunden g&uuml;ltig. Falls du dich nicht registriert hast, ignoriere diese E-Mail.</p>` +
    `</div></div></div>`;

  const payload = { from, to: [to], subject: 'Bitte bestätige deine E-Mail – Parrylicious', text, html };
  const replyTo = process.env.RESEND_REPLY_TO;
  if (replyTo) payload.reply_to = replyTo;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.message || `Resend HTTP ${response.status}`);
  return { id: json?.id || null };
}

module.exports = {
  buildBookingConfirmationEmail, sendBookingConfirmationEmail,
  buildBookingReminderEmail, sendBookingReminderEmail,
  sendVerificationEmail
};
