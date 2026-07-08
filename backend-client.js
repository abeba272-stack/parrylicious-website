import { isAuthConfigured, getAccessToken } from './auth-client.js';
import { BACKEND_API_BASE_URL } from './backend-config.js';

function getErrorMessage(error) {
  return error?.message || 'Unbekannter Fehler';
}

async function parseJsonSafe(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { message: text };
  }
}

async function requestJson(path, { method = 'GET', body = null } = {}) {
  const url = resolveApiUrl(path);
  const init = { method, headers: {} };
  if (body !== null) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const token = await getAccessTokenSafe();
  if (token) {
    init.headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, init);
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    const notFoundApi = response.status === 404 && String(path).startsWith('/api/');
    const detail = notFoundApi
      ? 'API nicht erreichbar. Setze BACKEND_API_BASE_URL in backend-config.js auf dein Backend (z. B. Vercel).'
      : (data?.message || data?.error || `HTTP ${response.status}`);
    throw new Error(detail);
  }
  return data || {};
}

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

async function getAccessTokenSafe() {
  if (!isAuthConfigured) return null;
  try {
    return await getAccessToken();
  } catch (_error) {
    return null;
  }
}

export async function createCheckoutSession(input) {
  try {
    const data = await requestJson('/api/create-checkout-session', {
      method: 'POST',
      body: input
    });
    return { ok: true, ...data };
  } catch (error) {
    return { ok: false, message: getErrorMessage(error) };
  }
}

export async function verifyCheckoutSession(sessionId) {
  try {
    const data = await requestJson(`/api/verify-checkout-session?session_id=${encodeURIComponent(sessionId)}`);
    return { ok: true, ...data };
  } catch (error) {
    return { ok: false, message: getErrorMessage(error) };
  }
}

export async function sendBookingNotification(payload) {
  try {
    const data = await requestJson('/api/send-booking-notification', {
      method: 'POST',
      body: payload
    });
    return { ok: true, ...data };
  } catch (error) {
    return { ok: false, message: getErrorMessage(error) };
  }
}
