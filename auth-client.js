/*
 * auth-client.js — Frontend-Auth gegen das eigene Backend (/api/auth/*).
 * ---------------------------------------------------------------------------
 * Vollständiger Ersatz für supabase.js/supabase-config.js aus Sicht des
 * Frontends. Kein externes SDK; nur fetch + localStorage.
 *
 * Session-Vertrag (localStorage 'parry_auth_session'):
 *   { accessToken, refreshToken, expiresAt (Epoch-ms), user }
 *
 * Events (Supabase-kompatible Namen): 'SIGNED_IN', 'SIGNED_OUT',
 * 'TOKEN_REFRESHED'. Callbacks werden als (event, session) aufgerufen.
 */

import { BACKEND_API_BASE_URL } from './backend-config.js';

const STORAGE_KEY = 'parry_auth_session';
const REFRESH_SKEW_MS = 60 * 1000; // Access-Token 60s vor Ablauf erneuern.

/* ---------------------------------------------------------------------------
 * Konfiguration / URL-Auflösung (Muster aus backend-client.js)
 * ------------------------------------------------------------------------- */

function normalizeBaseUrl(value) {
  if (!value) return '';
  return String(value).replace(/\/$/, '');
}

function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  const base = normalizeBaseUrl(BACKEND_API_BASE_URL);
  if (!base) return path;
  return `${base}${String(path).startsWith('/') ? path : `/${path}`}`;
}

// Konfiguriert, sobald es ein Backend zu erreichen gibt: entweder eine explizit
// gesetzte Backend-URL (Split-Setup) ODER wir laufen im Browser — dann ist das
// /api same-origin verfügbar (Vercel-Deployment oder lokaler Dev-Server).
export const isAuthConfigured = Boolean(BACKEND_API_BASE_URL) || (typeof window !== 'undefined');

/* ---------------------------------------------------------------------------
 * Storage-Helfer (try/catch für Safari Private Mode, mit Memory-Fallback)
 * ------------------------------------------------------------------------- */

let memorySession = null;

function loadSession() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (_error) {
    // localStorage nicht verfügbar — auf Memory-Fallback ausweichen.
  }
  return memorySession;
}

// Erwartet eine API-Payload ({ accessToken, refreshToken, expiresIn, user }).
function saveSession(payload) {
  const session = {
    accessToken: payload.accessToken || null,
    refreshToken: payload.refreshToken || null,
    expiresAt: Date.now() + (Number(payload.expiresIn) || 3600) * 1000,
    user: payload.user || null
  };
  memorySession = session;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch (_error) {
    // Nur Memory — Session lebt bis zum Reload.
  }
  return session;
}

function clearSession() {
  memorySession = null;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (_error) {
    // ignore
  }
}

/* ---------------------------------------------------------------------------
 * Event-Emitter + Cross-Tab-Sync
 * ------------------------------------------------------------------------- */

const listeners = new Set();
let storageBound = false;
let cachedUser = null; // Cache für getCurrentUser(); bei jedem Event invalidiert.

function emit(event) {
  cachedUser = null;
  const session = loadSession();
  listeners.forEach((callback) => {
    try {
      callback(event, session);
    } catch (_error) {
      // Ein defekter Listener darf die anderen nicht blockieren.
    }
  });
}

function bindStorageListener() {
  if (storageBound || typeof window === 'undefined') return;
  storageBound = true;
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    // Andere Tabs: newValue vorhanden -> eingeloggt, sonst ausgeloggt.
    emit(event.newValue ? 'SIGNED_IN' : 'SIGNED_OUT');
  });
}

export function onAuthStateChange(callback) {
  if (typeof callback !== 'function') return () => {};
  listeners.add(callback);
  bindStorageListener();
  return function unsubscribe() {
    listeners.delete(callback);
  };
}

/* ---------------------------------------------------------------------------
 * Fetch-Helfer
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

// Error aus API-Antwort bauen (deutsche message, error-Code als error.code).
function makeApiError(data, response) {
  const message =
    (data && (data.message || data.error)) ||
    (response ? `HTTP ${response.status}` : 'Anfrage fehlgeschlagen.');
  const error = new Error(message);
  if (data && data.error) error.code = data.error;
  if (response) error.status = response.status;
  return error;
}

function postJson(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(apiUrl(path), {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {})
  });
}

/* ---------------------------------------------------------------------------
 * Session-Zustand
 * ------------------------------------------------------------------------- */

// Ausloggen ohne Server-Roundtrip (z. B. wenn Refresh scheitert).
function forceSignOut() {
  const had = loadSession();
  clearSession();
  cachedUser = null;
  if (had) emit('SIGNED_OUT');
}

let refreshPromise = null;

// POST /api/auth/refresh — single-flight (laufenden Refresh wiederverwenden).
function refresh() {
  if (refreshPromise) return refreshPromise;

  const current = loadSession();
  const token = current && current.refreshToken;
  if (!token) return Promise.resolve(null);

  refreshPromise = (async () => {
    try {
      const response = await postJson('/api/auth/refresh', { refreshToken: token });
      const data = await parseJsonSafe(response);
      if (!response.ok || !data || !data.accessToken) {
        return null;
      }
      const session = saveSession(data);
      emit('TOKEN_REFRESHED');
      return session;
    } catch (_error) {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// Gespeicherte Session ohne Netzwerk.
export function getStoredSession() {
  return loadSession();
}

// Geladene Session; erneuert bei (nahender) Ablaufzeit. Bei Refresh-Fehler
// Session löschen und null.
export async function getSession() {
  const session = loadSession();
  if (!session) return null;

  const expiresAt = Number(session.expiresAt) || 0;
  const stillValid = session.accessToken && Date.now() < expiresAt - REFRESH_SKEW_MS;
  if (stillValid) return session;

  const refreshed = await refresh();
  if (refreshed) return refreshed;

  forceSignOut();
  return null;
}

export async function getAccessToken() {
  const session = await getSession();
  return (session && session.accessToken) || null;
}

function fetchMe(token) {
  return fetch(apiUrl('/api/auth/me'), {
    headers: { Authorization: `Bearer ${token}` }
  });
}

// GET /api/auth/me. Ohne gespeicherte Session sofort null (Gastmodus bleibt
// schnell, kein Netzwerk). Bei 401 einmal refresh + retry. Antwort wird
// gecacht bis zum nächsten Event (signOut/authStateChange/refresh).
export async function getCurrentUser() {
  if (!loadSession()) return null;
  if (cachedUser) return cachedUser;

  const token = await getAccessToken();
  if (!token) return null;

  let response = await fetchMe(token);
  if (response.status === 401) {
    const refreshed = await refresh();
    if (!refreshed) {
      forceSignOut();
      return null;
    }
    response = await fetchMe(refreshed.accessToken);
  }

  const data = await parseJsonSafe(response);
  if (!response.ok || !data || !data.id) return null;

  cachedUser = data;
  return cachedUser;
}

/* ---------------------------------------------------------------------------
 * E-Mail / Passwort
 * ------------------------------------------------------------------------- */

async function passwordAuth(path, email, password) {
  const response = await postJson(path, { email, password });
  const data = await parseJsonSafe(response);
  if (!response.ok || !data || !data.accessToken) {
    throw makeApiError(data, response);
  }
  saveSession(data);
  emit('SIGNED_IN');
  return data.user || null;
}

// Kunden-Selbstregistrierung: sendet zusätzlich fullName (API-Vertrag).
export async function signUp(email, password, fullName) {
  const response = await postJson('/api/auth/signup', {
    email,
    password,
    fullName: String(fullName || '').trim()
  });
  const data = await parseJsonSafe(response);
  if (!response.ok || !data || !data.accessToken) {
    throw makeApiError(data, response);
  }
  saveSession(data);
  emit('SIGNED_IN');
  return data.user || null;
}

export async function signInWithPassword(email, password) {
  return passwordAuth('/api/auth/login', email, password);
}

/* ---------------------------------------------------------------------------
 * Logout
 * ------------------------------------------------------------------------- */

export async function signOut() {
  const session = loadSession();
  try {
    if (session && session.accessToken) {
      await postJson(
        '/api/auth/logout',
        { refreshToken: session.refreshToken || null },
        session.accessToken
      );
    }
  } catch (_error) {
    // best effort — lokale Session wird ohnehin gelöscht.
  }
  clearSession();
  emit('SIGNED_OUT');
}

/* ---------------------------------------------------------------------------
 * Passwort zurücksetzen
 * ------------------------------------------------------------------------- */

export async function requestPasswordReset(email) {
  const response = await postJson('/api/auth/request-password-reset', { email });
  if (!response.ok) {
    throw makeApiError(await parseJsonSafe(response), response);
  }
  return true;
}

export async function resetPassword(token, newPassword) {
  const response = await postJson('/api/auth/reset-password', { token, newPassword });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw makeApiError(data, response);
  }
  return true;
}

// Passwort im eingeloggten Zustand ändern (aktuelles Passwort erforderlich).
// Der Server gibt eine frische Session zurück -> lokal speichern, Sitzung bleibt aktiv.
export async function changePassword(currentPassword, newPassword) {
  const token = await getAccessToken();
  if (!token) throw new Error('Nicht angemeldet.');

  const response = await postJson(
    '/api/auth/change-password',
    { currentPassword, newPassword },
    token
  );
  const data = await parseJsonSafe(response);
  if (!response.ok || !data || !data.accessToken) {
    throw makeApiError(data, response);
  }
  saveSession(data);
  emit('TOKEN_REFRESHED');
  return true;
}

// Bestätigungsmail erneut anfordern (eingeloggt). 60-Sek-Cooldown serverseitig;
// bei 429 wird nicht geworfen, sondern { cooldown:true, retryAfter } zurückgegeben.
export async function resendVerification() {
  const token = await getAccessToken();
  if (!token) throw new Error('Nicht angemeldet.');
  const response = await postJson('/api/auth/resend-verification', {}, token);
  const data = await parseJsonSafe(response);
  if (response.status === 429) {
    return { ok: false, cooldown: true, retryAfter: Number(data && data.retryAfter) || 60, message: data && data.message };
  }
  if (!response.ok) throw makeApiError(data, response);
  return data || { ok: true };
}
