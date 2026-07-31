// data-client.js — Drop-in-Ersatz für supabase-data.js.
// Spricht die Vercel-Serverless-Routen unter /api (Neon Postgres + eigene Auth) an.
// Jede exportierte Funktion hat denselben Namen, dieselbe Signatur und dieselbe
// Rückgabeform wie in supabase-data.js — booking.js/admin.js/profile-menu.js
// müssen nur ihre Import-Zeile umstellen.

import { BACKEND_API_BASE_URL } from './backend-config.js';
// Auth-Layer: getAccessToken liefert das aktuelle Bearer-Token, getSession refresht
// bei Bedarf automatisch, getCurrentUser liefert den User inkl. Rolle. Kein
// zirkulärer Import — auth-client.js kennt data-client.js nicht.
import {
  getAccessToken,
  getSession,
  getCurrentUser as authGetCurrentUser
} from './auth-client.js';

/* ---------------------------------------------------------------------------
 * URL-Auflösung (Muster aus backend-client.js)
 * ------------------------------------------------------------------------- */

function normalizeBaseUrl(value) {
  if (!value) return '';
  return String(value).replace(/\/$/, '');
}

function resolveApiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  const base = normalizeBaseUrl(BACKEND_API_BASE_URL);
  if (!base) return path;
  return `${base}${String(path).startsWith('/') ? path : `/${path}`}`;
}

/* ---------------------------------------------------------------------------
 * Rollen-Normalisierung (identisch zu supabase-data.js)
 * ------------------------------------------------------------------------- */

function mapRole(value) {
  if (value === 'staff' || value === 'admin') return value;
  return 'customer';
}

/* ---------------------------------------------------------------------------
 * Interner Fetch-Helfer
 *   - Bearer-Injection (nur wenn auth=true)
 *   - JSON-Parsing (robust bei leerem/nicht-JSON Body)
 *   - bei 401 + auth=true: EIN Refresh-Versuch über getSession() (auto-refresht),
 *     danach genau ein Retry
 *   - Fehler -> Error mit .message und .code aus der API-Antwort
 * ------------------------------------------------------------------------- */

async function parseJsonSafe(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { message: text };
  }
}

async function apiFetch(path, { method = 'GET', body = null, auth = true } = {}) {
  const doFetch = async () => {
    const init = { method, headers: {} };
    if (body !== null && body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    if (auth) {
      const token = await getAccessToken();
      if (token) init.headers.Authorization = `Bearer ${token}`;
    }
    return fetch(resolveApiUrl(path), init);
  };

  let response = await doFetch();

  // Genau ein Refresh+Retry bei abgelaufenem Access-Token.
  if (response.status === 401 && auth) {
    let refreshed = false;
    try {
      const session = await getSession(); // refresht automatisch, falls nötig
      refreshed = Boolean(session && session.accessToken);
    } catch (_error) {
      refreshed = false;
    }
    if (refreshed) {
      response = await doFetch();
    }
  }

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    const message =
      (data && (data.message || data.error)) || `HTTP ${response.status}`;
    const error = new Error(message);
    if (data && data.error) error.code = data.error;
    error.status = response.status;
    throw error;
  }
  return data;
}

/* ---------------------------------------------------------------------------
 * User / Rolle
 * ------------------------------------------------------------------------- */

export async function getCurrentUser() {
  const user = await authGetCurrentUser();
  return user || null;
}

export async function getCurrentUserRole() {
  const user = await authGetCurrentUser();
  return mapRole(user?.role);
}

/* ---------------------------------------------------------------------------
 * Profil  ->  /api/profile
 * ------------------------------------------------------------------------- */

export async function getMyProfile() {
  // Nicht angemeldet -> null (wie supabase-data.js), ohne API-Call.
  const user = await authGetCurrentUser();
  if (!user?.id) return null;
  // GET /api/profile liefert bereits die mapProfileRow-Form (leerer Default,
  // falls noch keine profiles-Zeile existiert).
  const data = await apiFetch('/api/profile', { method: 'GET' });
  return data || null;
}

export async function saveMyProfile(profile) {
  const body = {
    fullName: String(profile?.fullName || ''),
    phone: String(profile?.phone || ''),
    address: String(profile?.address || ''),
    avatarUrl: String(profile?.avatarUrl || '')
  };
  // PATCH liefert die aktualisierte Zeile in mapProfileRow-Form zurück.
  return apiFetch('/api/profile', { method: 'PATCH', body });
}

/* ---------------------------------------------------------------------------
 * Admin: Rollenverwaltung  ->  /api/admin/roles
 * ------------------------------------------------------------------------- */

export async function adminSetUserRoleByEmail(email, role) {
  const normalizedEmail = String(email || '').trim();
  const normalizedRole = mapRole(role);
  if (!normalizedEmail) throw new Error('E-Mail fehlt.');

  const data = await apiFetch('/api/admin/roles', {
    method: 'POST',
    body: { email: normalizedEmail, role: normalizedRole }
  });
  if (!data) return null;
  return {
    userId: data.userId || null,
    email: data.email || normalizedEmail.toLowerCase(),
    role: mapRole(data.role)
  };
}

// Nur Admin: Staff-/Admin-Account anlegen (E-Mail + Passwort + Rolle) -> /api/admin/staff.
export async function adminCreateStaff(email, password, role) {
  const data = await apiFetch('/api/admin/staff', {
    method: 'POST',
    body: {
      email: String(email || '').trim(),
      password: String(password || ''),
      role: mapRole(role) === 'admin' ? 'admin' : 'staff'
    }
  });
  return {
    userId: data?.userId || null,
    email: data?.email || String(email || '').trim().toLowerCase(),
    role: mapRole(data?.role)
  };
}

// Nur Admin: Team-Account löschen -> DELETE /api/admin/staff.
export async function adminDeleteStaff(email) {
  await apiFetch('/api/admin/staff', {
    method: 'DELETE',
    body: { email: String(email || '').trim() }
  });
}

export async function adminListUsersWithRoles(limitRows = 120) {
  const list = await apiFetch(
    `/api/admin/roles?limit=${encodeURIComponent(limitRows)}`,
    { method: 'GET' }
  );
  // Antwort der Route: [{ userId, email, fullName, role }]. Auf die supabase-data.js
  // Form ummappen (id statt userId; phone/address/avatarUrl/createdAt liefert die
  // Route nicht -> sinnvolle Defaults, damit admin.js unverändert bleibt).
  return (Array.isArray(list) ? list : []).map((row) => ({
    id: row.userId,
    email: row.email || '',
    role: mapRole(row.role),
    fullName: row.fullName || '',
    phone: row.phone || '',
    address: row.address || '',
    avatarUrl: row.avatarUrl || '',
    createdAt: row.createdAt || null
  }));
}

/* ---------------------------------------------------------------------------
 * Buchungen  ->  /api/bookings
 * ------------------------------------------------------------------------- */

export async function getMyBookings() {
  const list = await apiFetch('/api/bookings', { method: 'GET' });
  return Array.isArray(list) ? list : [];
}

export async function getMyBookingById(id) {
  // 404 (nicht gefunden / kein Zugriff) -> null, wie maybeSingle() in supabase-data.js.
  try {
    const data = await apiFetch(`/api/bookings?id=${encodeURIComponent(id)}`, {
      method: 'GET'
    });
    return data || null;
  } catch (error) {
    if (error && error.status === 404) return null;
    throw error;
  }
}

export async function createMyBooking(model, userId) {
  if (!userId) throw new Error('Kein User gefunden.');
  const body = {
    serviceId: model.serviceId,
    serviceName: model.serviceName,
    durationMin: model.durationMin,
    priceFrom: model.priceFrom || 0,
    deposit: model.deposit || 0,
    stylistId: model.stylistId || 'auto',
    stylistName: model.stylistName || 'Egal (automatisch)',
    dateISO: model.dateISO,
    time: model.time,
    customer: model.customer || {},
    depositPaid: Boolean(model.depositPaid)
  };
  // POST liefert die neue Buchung (201) in mapBookingRow-Form.
  return apiFetch('/api/bookings', { method: 'POST', body });
}

export async function updateBookingStatus(id, status) {
  return apiFetch('/api/bookings', {
    method: 'PATCH',
    body: { id, action: 'set_status', status }
  });
}

export async function cancelMyBooking(id) {
  return apiFetch('/api/bookings', {
    method: 'PATCH',
    body: { id, action: 'cancel' }
  });
}

export async function clearMyBookings(userId) {
  if (!userId) throw new Error('Kein User gefunden.');
  // DELETE ohne id löscht alle eigenen Buchungen. Rückgabe: void (wie Vorlage).
  await apiFetch('/api/bookings', { method: 'DELETE' });
}

/* ---------------------------------------------------------------------------
 * Warteliste  ->  /api/waitlist
 * ------------------------------------------------------------------------- */

export async function getMyWaitlist() {
  const list = await apiFetch('/api/waitlist', { method: 'GET' });
  return Array.isArray(list) ? list : [];
}

export async function createMyWaitlistEntry(model, userId) {
  if (!userId) throw new Error('Kein User gefunden.');
  const body = {
    serviceId: model.serviceId,
    serviceName: model.serviceName,
    email: model.email,
    phone: model.phone,
    note: model.note || ''
  };
  // POST liefert den neuen Eintrag (201) in mapWaitlistRow-Form.
  return apiFetch('/api/waitlist', { method: 'POST', body });
}

export async function removeMyWaitlistEntry(id) {
  await apiFetch(`/api/waitlist?id=${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
}

export async function clearMyWaitlist(userId) {
  if (!userId) throw new Error('Kein User gefunden.');
  // DELETE ohne id löscht alle eigenen Warteliste-Einträge. Rückgabe: void.
  await apiFetch('/api/waitlist', { method: 'DELETE' });
}

/* ---------------------------------------------------------------------------
 * Slot-Verfügbarkeit (öffentlich, KEINE Auth)  ->  /api/slots
 * ------------------------------------------------------------------------- */

export async function checkSlotAvailability({
  dateISO,
  time,
  durationMin,
  stylistId = 'auto',
  excludeBookingId = null
}) {
  const params = new URLSearchParams({
    dateISO: String(dateISO ?? ''),
    time: String(time ?? ''),
    durationMin: String(durationMin ?? ''),
    stylistId: String(stylistId ?? 'auto')
  });
  if (excludeBookingId) params.set('excludeBookingId', String(excludeBookingId));

  const data = await apiFetch(`/api/slots?${params.toString()}`, {
    method: 'GET',
    auth: false
  });
  return Boolean(data && data.available);
}

/* ---------------------------------------------------------------------------
 * Kunden-Konto  ->  /api/customer/*   (API-Vertrag „Parry Neu")
 * ------------------------------------------------------------------------- */

// Eigene Buchungen des eingeloggten Kunden.
export async function getCustomerBookings() {
  const list = await apiFetch('/api/customer/bookings', { method: 'GET' });
  return Array.isArray(list) ? list : [];
}

// Profil aktualisieren (Name/Telefon).
export async function saveCustomerProfile(profile) {
  return apiFetch('/api/customer/profile', {
    method: 'PATCH',
    body: {
      fullName: String(profile?.fullName || ''),
      phone: String(profile?.phone || '')
    }
  });
}

// Termin stornieren (nur wenn canCancel; Server erzwingt 48h-Regel + Erstattung).
export async function cancelCustomerBooking(id) {
  return apiFetch('/api/customer/bookings', {
    method: 'PATCH',
    body: { id, action: 'cancel' }
  });
}

// Termin verschieben (neuer Slot; Server erzwingt 48h-Regel, Anzahlung wandert mit).
export async function rescheduleCustomerBooking(id, dateISO, time) {
  return apiFetch('/api/customer/bookings', {
    method: 'PATCH',
    body: { id, action: 'reschedule', dateISO, time }
  });
}

// Neukunden-Rabatt-Berechtigung (Feature 3).
export async function getCustomerEligibility() {
  try {
    return await apiFetch('/api/customer/eligibility', { method: 'GET' });
  } catch (_error) {
    return { newCustomerDiscount: false, discountPercent: 0 };
  }
}

// Treuepunkte-Stand + Historie (Feature 4).
export async function getCustomerPoints() {
  try {
    return await apiFetch('/api/customer/points', { method: 'GET' });
  } catch (_error) {
    return { balance: 0, history: [] };
  }
}

/* ---------------------------------------------------------------------------
 * Reviews  ->  /api/reviews   (Feature 2; Backend ggf. noch nicht live -> graceful)
 * ------------------------------------------------------------------------- */

export async function getReviews(serviceId, limit) {
  try {
    const params = new URLSearchParams();
    if (serviceId) params.set('serviceId', serviceId);
    if (limit) params.set('limit', String(limit));
    const q = params.toString();
    const list = await apiFetch(`/api/reviews${q ? `?${q}` : ''}`, { method: 'GET', auth: false });
    return Array.isArray(list) ? list : [];
  } catch (_error) {
    return [];
  }
}

export async function getReviewsSummary(serviceId) {
  try {
    // Zusammenfassung läuft über dieselbe Route mit ?summary=1 (kein /summary-Subpfad).
    const params = new URLSearchParams({ summary: '1' });
    if (serviceId) params.set('serviceId', serviceId);
    return await apiFetch(`/api/reviews?${params.toString()}`, { method: 'GET', auth: false });
  } catch (_error) {
    return null;
  }
}

// bookingId optional: mit ID = buchungsbezogen, ohne = allgemeine Bewertung
// (nur bei bestätigter E-Mail, serverseitig geprüft).
export async function submitReview(bookingId, rating, text) {
  const body = { rating: Number(rating), text: String(text || '') };
  if (bookingId) body.bookingId = bookingId;
  return apiFetch('/api/reviews', { method: 'POST', body });
}

/* ---------------------------------------------------------------------------
 * Admin: Reviews-Moderation  ->  /api/admin/reviews   (Feature 2)
 *   GET ?status=pending|approved|hidden|all  ·  PATCH { id, status }  ·  DELETE ?id=
 * ------------------------------------------------------------------------- */

export async function adminListReviews(status = 'pending') {
  const s = ['pending', 'approved', 'hidden', 'all'].includes(String(status)) ? status : 'pending';
  const list = await apiFetch(`/api/admin/reviews?status=${encodeURIComponent(s)}`, { method: 'GET' });
  return Array.isArray(list) ? list : [];
}

export async function adminSetReviewStatus(id, status) {
  return apiFetch('/api/admin/reviews', {
    method: 'PATCH',
    body: { id: String(id || ''), status: String(status || '') }
  });
}

export async function adminDeleteReview(id) {
  return apiFetch(`/api/admin/reviews?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
}
