import {
  isAuthConfigured,
  getCurrentUser,
  signInWithPassword,
  signUp,
  requestPasswordReset,
  resetPassword
} from './auth-client.js';

document.getElementById('year').textContent = new Date().getFullYear();

const params = new URLSearchParams(window.location.search);
const nextParam = params.get('next');
const resetToken = params.get('reset_token');

const authTabs = document.getElementById('authTabs');
const panelKunde = document.getElementById('panel-kunde');
const panelTeam = document.getElementById('panel-team');
const panelReset = document.getElementById('panel-reset');
const kundeLogin = document.getElementById('kundeLogin');
const kundeRegister = document.getElementById('kundeRegister');

const custLoginForm = document.getElementById('custLoginForm');
const custRegisterForm = document.getElementById('custRegisterForm');
const teamLoginForm = document.getElementById('teamLoginForm');
const resetForm = document.getElementById('resetForm');
const custStatus = document.getElementById('custStatus');
const teamStatus = document.getElementById('teamStatus');
const resetStatus = document.getElementById('resetStatus');

function setStatus(el, msg, isError = false) {
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? '#d6807b' : '';
}

function mapAuthError(error) {
  const code = String(error?.code || '').toUpperCase();
  if (code === 'INVALID_CREDENTIALS') return 'E-Mail oder Passwort ist falsch.';
  if (code === 'EMAIL_EXISTS') return 'Für diese E-Mail gibt es bereits ein Konto. Bitte einloggen.';
  if (code === 'WEAK_PASSWORD') return 'Das Passwort muss mindestens 8 Zeichen lang sein.';
  if (code === 'EMAIL_INVALID') return 'Bitte eine gültige E-Mail angeben.';
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('network') || message.includes('fetch')) return 'Netzwerkfehler. Bitte erneut versuchen.';
  return error?.message || 'Unbekannter Fehler.';
}

function sanitizeNextPath(path) {
  if (!path) return null;
  if (path.includes('://') || path.startsWith('//')) return null;
  if (!path.endsWith('.html')) return null;
  return path;
}

// Nach erfolgreicher Auth: next-Ziel oder rollenbasiert (Team → Dashboard, Kunde → Konto).
async function redirectAfterAuth() {
  const safe = sanitizeNextPath(nextParam);
  if (safe) { window.location.href = safe; return; }
  let user = null;
  try { user = await getCurrentUser(); } catch (_error) { /* ignore */ }
  const role = user?.role;
  window.location.href = (role === 'staff' || role === 'admin') ? 'admin.html' : 'konto.html';
}

/* ---------------------------------------------------------------------------
 * Tabs Kunde/Team
 * ------------------------------------------------------------------------- */
authTabs?.addEventListener('click', (event) => {
  const btn = event.target.closest('.auth-tab');
  if (!btn) return;
  authTabs.querySelectorAll('.auth-tab').forEach((b) => b.classList.toggle('active', b === btn));
  const mode = btn.dataset.mode;
  panelKunde.classList.toggle('hidden', mode !== 'kunde');
  panelTeam.classList.toggle('hidden', mode !== 'team');
});

document.getElementById('toRegister')?.addEventListener('click', () => {
  kundeLogin.classList.add('hidden');
  kundeRegister.classList.remove('hidden');
  setStatus(custStatus, '');
});
document.getElementById('toLogin')?.addEventListener('click', () => {
  kundeRegister.classList.add('hidden');
  kundeLogin.classList.remove('hidden');
  setStatus(custStatus, '');
});

// „Konto erstellen"-Link (z. B. von der Buchungsseite, ?register=1) öffnet direkt die Registrierung.
if (params.get('register') === '1' && kundeLogin && kundeRegister) {
  kundeLogin.classList.add('hidden');
  kundeRegister.classList.remove('hidden');
}

/* ---------------------------------------------------------------------------
 * Kunden-Login / Registrierung
 * ------------------------------------------------------------------------- */
custLoginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus(custStatus, 'Anmeldung läuft…');
  const fd = new FormData(custLoginForm);
  try {
    await signInWithPassword(String(fd.get('email') || '').trim(), String(fd.get('password') || ''));
  } catch (error) {
    setStatus(custStatus, mapAuthError(error), true);
    return;
  }
  await redirectAfterAuth();
});

custRegisterForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus(custStatus, 'Konto wird erstellt…');
  const fd = new FormData(custRegisterForm);
  try {
    await signUp(
      String(fd.get('email') || '').trim(),
      String(fd.get('password') || ''),
      String(fd.get('fullName') || '').trim()
    );
  } catch (error) {
    setStatus(custStatus, mapAuthError(error), true);
    return;
  }
  await redirectAfterAuth();
});

document.getElementById('custForgotBtn')?.addEventListener('click', async () => {
  const email = String(new FormData(custLoginForm).get('email') || '').trim();
  if (!email) { setStatus(custStatus, 'Bitte zuerst deine E-Mail eintragen.', true); return; }
  try { await requestPasswordReset(email); } catch (_error) { /* immer neutral antworten */ }
  setStatus(custStatus, 'Falls ein Konto existiert, wurde ein Reset-Link per E-Mail versendet.');
});

/* ---------------------------------------------------------------------------
 * Team-Login
 * ------------------------------------------------------------------------- */
teamLoginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus(teamStatus, 'Anmeldung läuft…');
  const fd = new FormData(teamLoginForm);
  try {
    await signInWithPassword(String(fd.get('email') || '').trim(), String(fd.get('password') || ''));
  } catch (error) {
    setStatus(teamStatus, mapAuthError(error), true);
    return;
  }
  await redirectAfterAuth();
});

document.getElementById('teamForgotBtn')?.addEventListener('click', async () => {
  const email = String(new FormData(teamLoginForm).get('email') || '').trim();
  if (!email) { setStatus(teamStatus, 'Bitte zuerst deine E-Mail eintragen.', true); return; }
  try { await requestPasswordReset(email); } catch (_error) { /* neutral */ }
  setStatus(teamStatus, 'Falls ein Konto existiert, wurde ein Reset-Link per E-Mail versendet.');
});

/* ---------------------------------------------------------------------------
 * Passwort-Reset (?reset_token=)
 * ------------------------------------------------------------------------- */
resetForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = String(new FormData(resetForm).get('password') || '');
  if (password.length < 8) { setStatus(resetStatus, 'Mindestens 8 Zeichen.', true); return; }
  setStatus(resetStatus, 'Wird gespeichert…');
  try {
    await resetPassword(resetToken, password);
  } catch (error) {
    setStatus(resetStatus, mapAuthError(error), true);
    return;
  }
  setStatus(resetStatus, 'Passwort geändert. Du kannst dich jetzt anmelden.');
  setTimeout(() => { window.location.href = 'login.html'; }, 1500);
});

/* ---------------------------------------------------------------------------
 * Boot
 * ------------------------------------------------------------------------- */
async function boot() {
  if (!isAuthConfigured) {
    setStatus(custStatus, 'Backend nicht konfiguriert.', true);
    return;
  }
  if (resetToken) {
    authTabs.classList.add('hidden');
    panelKunde.classList.add('hidden');
    panelTeam.classList.add('hidden');
    panelReset.classList.remove('hidden');
    return;
  }
  // Schon eingeloggt? Direkt weiterleiten.
  try {
    const user = await getCurrentUser();
    if (user) { await redirectAfterAuth(); }
  } catch (_error) { /* nicht eingeloggt — Formulare zeigen */ }
}

boot();
