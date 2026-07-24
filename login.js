import {
  isAuthConfigured,
  getSession,
  signInWithPassword,
  signOut,
  requestPasswordReset,
  resetPassword,
  onAuthStateChange
} from './auth-client.js';

document.getElementById('year').textContent = new Date().getFullYear();

const statusEl = document.getElementById('loginStatus');
const form = document.getElementById('loginForm');
const logoutBtn = document.getElementById('logoutBtn');
const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
const loginActions = document.getElementById('loginActions');
const sessionHint = document.getElementById('sessionHint');
const searchParams = new URLSearchParams(window.location.search);
const nextParam = searchParams.get('next');
const resetToken = searchParams.get('reset_token');

function show(msg){ statusEl.textContent = msg; }
function clear(){ statusEl.textContent = ''; }

function mapAuthError(error) {
  const code = String(error?.code || '').toUpperCase();
  if (code === 'INVALID_CREDENTIALS') return 'E-Mail oder Passwort ist falsch.';
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('network') || message.includes('fetch')) return 'Netzwerkfehler. Bitte versuche es erneut.';
  return error?.message || 'Unbekannter Fehler.';
}

function showError(prefix, error) {
  show(`${prefix}: ${mapAuthError(error)}`);
}

function sanitizeNextPath(path) {
  if (!path) return null;
  if (path.includes('://')) return null;
  if (path.startsWith('//')) return null;
  if (!path.endsWith('.html')) return null;
  return path;
}

// Standardziel nach Staff-Login ist das Dashboard.
function getSafeNextPath() {
  return sanitizeNextPath(nextParam) || 'admin.html';
}

function setLoggedInUI(email){
  loginActions.classList.add('hidden');
  logoutBtn.classList.remove('hidden');
  sessionHint.textContent = `Angemeldet als ${email}`;
}

function setLoggedOutUI(){
  loginActions.classList.remove('hidden');
  logoutBtn.classList.add('hidden');
  sessionHint.textContent = 'Noch nicht eingeloggt.';
}

async function refreshSession() {
  let session = null;
  try {
    session = await getSession();
  } catch (error) {
    setLoggedOutUI();
    showError('Fehler beim Laden der Session', error);
    return;
  }
  const email = session?.user?.email;
  if (email) {
    setLoggedInUI(email);
    show('Login erfolgreich.');
    const nextPath = getSafeNextPath();
    if (nextPath) {
      window.location.href = nextPath;
      return;
    }
    return;
  }
  setLoggedOutUI();
  clear();
}

// Passwort-Reset-Modus: bestehendes Formular wiederverwenden — das Passwort-Feld
// wird zum "neues Passwort"-Feld, E-Mail-Feld und Zweit-Aktionen werden versteckt.
function enterResetMode() {
  show('Neues Passwort setzen: Bitte gib dein neues Passwort ein.');

  const emailInput = form.querySelector('input[name="email"]');
  if (emailInput) {
    emailInput.required = false;
    const emailLabel = emailInput.closest('label');
    if (emailLabel) emailLabel.classList.add('hidden');
  }
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = 'Neues Passwort setzen';
  forgotPasswordBtn.classList.add('hidden');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear();
    const fd = new FormData(form);
    const password = String(fd.get('password') || '');
    if (!password) {
      show('Bitte gib ein neues Passwort ein.');
      return;
    }
    try {
      await resetPassword(resetToken, password);
    } catch (error) {
      showError('Passwort zuruecksetzen fehlgeschlagen', error);
      return;
    }
    show('Passwort wurde geaendert. Du kannst dich jetzt einloggen.');
    setTimeout(() => { window.location.href = 'login.html'; }, 1500);
  });
}

function initAuthPage() {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear();
    const fd = new FormData(form);
    const email = String(fd.get('email') || '').trim();
    const password = String(fd.get('password') || '');
    try {
      await signInWithPassword(email, password);
    } catch (error) {
      showError('Login fehlgeschlagen', error);
      return;
    }
    await refreshSession();
  });

  forgotPasswordBtn.addEventListener('click', async () => {
    clear();
    const fd = new FormData(form);
    const email = String(fd.get('email') || '').trim();
    if (!email) {
      show('Bitte zuerst deine E-Mail ins Feld eintragen.');
      return;
    }
    try {
      await requestPasswordReset(email);
    } catch (error) {
      showError('Passwort-Reset fehlgeschlagen', error);
      return;
    }
    show('Falls ein Konto existiert, wurde ein Reset-Link per E-Mail versendet.');
  });

  logoutBtn.addEventListener('click', async () => {
    clear();
    try {
      await signOut();
    } catch (error) {
      showError('Logout fehlgeschlagen', error);
      return;
    }
    setLoggedOutUI();
    show('Erfolgreich abgemeldet.');
    window.location.href = 'home.html';
  });

  onAuthStateChange(() => {
    refreshSession();
  });

  refreshSession();
}

if (!isAuthConfigured) {
  show('Das Backend ist noch nicht konfiguriert. Bitte BACKEND_API_BASE_URL in backend-config.js setzen.');
  form.querySelectorAll('input, button').forEach((el) => { el.disabled = true; });
  forgotPasswordBtn.disabled = true;
} else if (resetToken) {
  enterResetMode();
} else {
  initAuthPage();
}
