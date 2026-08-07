const {
  sql,
  setCors,
  sendJson,
  bodyFromReq,
  requireAuthUser,
  mapProfileRow,
  pgErrorStatus
} = require('./_lib');

// User-friendly German messages for the mapped Postgres exception codes.
const CODE_MESSAGES = {
  AUTH_REQUIRED: 'Anmeldung erforderlich.',
  FORBIDDEN: 'Keine Berechtigung.'
};

function sendError(res, error) {
  const { status, code } = pgErrorStatus(error);
  if (status === 500) {
    return sendJson(res, 500, {
      error: 'INTERNAL',
      message: 'Unerwarteter Serverfehler. Bitte später erneut versuchen.'
    });
  }
  return sendJson(res, status, {
    error: code,
    message: CODE_MESSAGES[code] || 'Anfrage fehlgeschlagen.'
  });
}

// Trim, then collapse empty strings to null so mapProfileRow renders '' back.
function cleanValue(value) {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

async function handleGet(req, res, userId) {
  const rows = await sql`select * from profiles where id = ${userId} limit 1`;
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    // Mirror getMyProfile() from supabase-data.js: no row -> empty default.
    return sendJson(res, 200, mapProfileRow({
      id: userId,
      role: 'customer',
      full_name: '',
      phone: '',
      address: '',
      avatar_url: '',
      created_at: null,
      updated_at: null
    }));
  }
  return sendJson(res, 200, mapProfileRow(row));
}

async function handlePatch(req, res, userId) {
  const body = bodyFromReq(req) || {};
  const fullName = cleanValue(body.fullName);
  const phone = cleanValue(body.phone);
  const address = cleanValue(body.address);
  const avatarUrl = cleanValue(body.avatarUrl);
  // Marketing-Einwilligung nur ändern, wenn explizit mitgesendet (sonst null -> bestehenden Wert behalten).
  const hasMarketing = Object.prototype.hasOwnProperty.call(body, 'marketingOptIn');
  const marketingOptIn = hasMarketing ? (body.marketingOptIn === true || String(body.marketingOptIn) === 'true') : null;

  // Upsert. role is never writable via this route: on insert it falls back to the
  // table default, on conflict it is untouched.
  const rows = await sql`
    insert into profiles (id, full_name, phone, address, avatar_url, marketing_opt_in)
    values (${userId}, ${fullName}, ${phone}, ${address}, ${avatarUrl}, coalesce(${marketingOptIn}, false))
    on conflict (id) do update
      set full_name = excluded.full_name,
          phone = excluded.phone,
          address = excluded.address,
          avatar_url = excluded.avatar_url,
          marketing_opt_in = coalesce(${marketingOptIn}, profiles.marketing_opt_in)
    returning *
  `;
  return sendJson(res, 200, mapProfileRow(rows[0]));
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const user = requireAuthUser(req, res);
  if (!user) return;

  try {
    if (req.method === 'GET') {
      return await handleGet(req, res, user.id);
    }
    if (req.method === 'PATCH') {
      return await handlePatch(req, res, user.id);
    }
    res.setHeader('Allow', 'GET,PATCH,OPTIONS');
    return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Methode nicht erlaubt.' });
  } catch (error) {
    return sendError(res, error);
  }
};
