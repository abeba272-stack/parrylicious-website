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

function isLocalHost() {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

// Konfiguriert, wenn ein Backend gesetzt ist ODER wir lokal (vercel dev,
// same-origin /api) laufen.
export const isAuthConfigured = Boolean(BACKEND_API_BASE_URL) || isLocalHost();

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

export async function signUp(email, password) {
  return passwordAuth('/api/auth/signup', email, password);
}

export async function signInWithPassword(email, password) {
  return passwordAuth('/api/auth/login', email, password);
}

/* ---------------------------------------------------------------------------
 * Google OAuth
 * ------------------------------------------------------------------------- */

export function signInWithGoogle(nextPath) {
  const url = `${apiUrl('/api/auth/google')}?next=${encodeURIComponent(nextPath || '')}`;
  window.location.href = url;
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

/* ---------------------------------------------------------------------------
 * OAuth-Redirect-Handoff (login.html#code=... bzw. #error=...)
 * ------------------------------------------------------------------------- */

const REDIRECT_ERRORS = {
  missing_params: 'Google-Anmeldung unvollständig. Bitte erneut versuchen.',
  invalid_state: 'Die Anmelde-Sitzung ist abgelaufen. Bitte erneut versuchen.',
  token_exchange_failed: 'Google-Anmeldung fehlgeschlagen. Bitte erneut versuchen.',
  userinfo_failed: 'Google-Profil konnte nicht geladen werden. Bitte erneut versuchen.',
  no_email: 'Für dieses Google-Konto ist keine E-Mail hinterlegt.',
  code_invalid: 'Der Anmelde-Code ist ungültig oder abgelaufen.',
  server_error: 'Ein Serverfehler ist aufgetreten. Bitte später erneut versuchen.'
};

function mapRedirectError(code) {
  return REDIRECT_ERRORS[code] || 'Die Anmeldung ist fehlgeschlagen. Bitte erneut versuchen.';
}

// Hash aus der URL entfernen, damit ein Reload den Handoff nicht wiederholt.
function cleanHash() {
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch (_error) {
    // ignore
  }
}

// Parst location.hash: bei #code= gegen Session tauschen und { next } liefern,
// bei #error= Error werfen, sonst null.
export async function handleAuthRedirect() {
  if (typeof window === 'undefined') return null;

  const rawHash = window.location.hash || '';
  const hash = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  if (!hash) return null;

  let params;
  try {
    params = new URLSearchParams(hash);
  } catch (_error) {
    return null;
  }

  const errorCode = params.get('error');
  const code = params.get('code');
  if (!errorCode && !code) return null;

  if (errorCode) {
    cleanHash();
    const error = new Error(mapRedirectError(errorCode));
    error.code = errorCode;
    throw error;
  }

  const next = params.get('next') || null;
  const response = await postJson('/api/auth/exchange', { code });
  const data = await parseJsonSafe(response);
  if (!response.ok || !data || !data.accessToken) {
    cleanHash();
    throw makeApiError(data, response);
  }

  saveSession(data);
  cleanHash();
  emit('SIGNED_IN');
  return { next };
}
