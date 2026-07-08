const {
  setCors,
  sendJson,
  bodyFromReq,
  getAuthUser,
  getUserRole,
  isStaffRole,
  getBookingById,
  mapBookingRowToClient
} = require('./_lib');

function pickTemplate(eventType, booking, customer) {
  const firstName = customer?.firstName || 'Kundin/Kunde';
  const date = booking?.dateISO || '';
  const time = booking?.time || '';
  const service = booking?.serviceName || 'Termin';
  if (eventType === 'booking_confirmed') {
    return `Hallo ${firstName}, dein Termin am ${date} um ${time} für ${service} ist bestätigt.`;
  }
  if (eventType === 'booking_canceled') {
    return `Hallo ${firstName}, dein Termin am ${date} um ${time} wurde storniert. Bitte melde dich für einen neuen Termin.`;
  }
  return `Hallo ${firstName}, wir haben deine Anfrage am ${date} um ${time} für ${service} erhalten.`;
}

async function sendResendEmail({ to, subject, message }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from || !to) return { sent: false, skipped: true };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text: message
    })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.message || 'Resend Fehler');
  return { sent: true, id: json?.id || null };
}

async function sendTwilioSms({ to, message }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from || !to) return { sent: false, skipped: true };

  const basic = Buffer.from(`${sid}:${token}`).toString('base64');
  const form = new URLSearchParams();
  form.append('To', to);
  form.append('From', from);
  form.append('Body', message);

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: form
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.message || 'Twilio Fehler');
  return { sent: true, sid: json?.sid || null };
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

  const body = bodyFromReq(req);
  if (!body?.eventType || !body?.booking?.id) {
    return sendJson(res, 400, { message: 'eventType und booking.id sind erforderlich.' });
  }

  if (!['booking_requested', 'booking_confirmed', 'booking_canceled'].includes(body.eventType)) {
    return sendJson(res, 400, { message: 'Ungültiger eventType.' });
  }

  try {
    const authUser = getAuthUser(req);
    if (!authUser?.id) {
      return sendJson(res, 401, { message: 'Nicht eingeloggt.' });
    }

    const bookingRow = await getBookingById(body.booking.id);
    if (!bookingRow) {
      return sendJson(res, 404, { message: 'Buchung nicht gefunden.' });
    }

    const role = await getUserRole(authUser.id);
    const staff = isStaffRole(role);
    const isOwner = bookingRow.user_id === authUser.id;
    const eventType = body.eventType;

    if (!staff && !isOwner) {
      return sendJson(res, 403, { message: 'Keine Berechtigung für diese Buchung.' });
    }
    if (!staff && eventType === 'booking_confirmed') {
      return sendJson(res, 403, { message: 'Nur Staff/Admin darf bestätigen.' });
    }

    const booking = mapBookingRowToClient(bookingRow);
    const customer = booking.customer || {};
    const message = pickTemplate(eventType, booking, customer);
    const subject = eventType === 'booking_confirmed'
      ? 'Termin bestätigt – Parrylicious'
      : eventType === 'booking_canceled'
        ? 'Termin storniert – Parrylicious'
        : 'Termin-Anfrage erhalten – Parrylicious';

    const [email, sms] = await Promise.all([
      sendResendEmail({ to: customer.email, subject, message }),
      sendTwilioSms({ to: customer.phone, message })
    ]);

    return sendJson(res, 200, {
      ok: true,
      email,
      sms
    });
  } catch (error) {
    return sendJson(res, 500, { message: error.message || 'Benachrichtigung fehlgeschlagen.' });
  }
};
