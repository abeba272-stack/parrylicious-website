import { fmtDate, currency, formatMinutes } from './common.js';
import { isAuthConfigured } from './auth-client.js';
import {
  getCurrentUser,
  getCurrentUserRole,
  getMyBookings,
  getMyWaitlist,
  getMyProfile,
  saveMyProfile,
  adminSetUserRoleByEmail,
  adminListUsersWithRoles,
  updateBookingStatus,
  cancelMyBooking,
  removeMyWaitlistEntry,
  clearMyBookings,
  clearMyWaitlist
} from './data-client.js';
import { createCheckoutSession, sendBookingNotification } from './backend-client.js';

document.getElementById('year').textContent = new Date().getFullYear();
document.getElementById('today').textContent = new Date().toLocaleString('de-DE', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: '2-digit'
});

const table = document.getElementById('bookingsTable');
const waitTable = document.getElementById('waitlistTable');
const statusFilter = document.getElementById('statusFilter');
const search = document.getElementById('search');
const roleBadge = document.getElementById('roleBadge');
const sessionUser = document.getElementById('sessionUser');
const dashboardHint = document.getElementById('dashboardHint');

const kpiBookings = document.getElementById('kpiBookings');
const kpiWaitlist = document.getElementById('kpiWaitlist');
const kpiOpenPayments = document.getElementById('kpiOpenPayments');

const profileForm = document.getElementById('profileForm');
const profileStatus = document.getElementById('profileStatus');
const profileAvatar = document.getElementById('profileAvatar');
const profileAvatarUrl = document.getElementById('profileAvatarUrl');
const profileAvatarUpload = document.getElementById('profileAvatarUpload');
const profileAvatarGenerate = document.getElementById('profileAvatarGenerate');
const profileAvatarRemove = document.getElementById('profileAvatarRemove');
const profileFullName = document.getElementById('profileFullName');
const profilePhone = document.getElementById('profilePhone');
const profileAddress = document.getElementById('profileAddress');

const adminRoleCard = document.getElementById('adminRoleCard');
const roleForm = document.getElementById('roleForm');
const roleEmail = document.getElementById('roleEmail');
const roleSelect = document.getElementById('roleSelect');
const roleStatus = document.getElementById('roleStatus');
const roleUsersTable = document.getElementById('roleUsersTable');

let bookingsCache = [];
let waitlistCache = [];
let roleUsersCache = [];
let profileCache = null;
let currentUser = null;
let currentRole = 'customer';

function isStaffRole() {
  return currentRole === 'staff' || currentRole === 'admin';
}

function isAdminRole() {
  return currentRole === 'admin';
}

function bookings() {
  return bookingsCache;
}

function waitlist() {
  return waitlistCache;
}

function normalizeRole(role) {
  return role === 'admin' || role === 'staff' ? role : 'customer';
}

function normalizeAvatarUrl(url) {
  return String(url || '').trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch (_error) {
    return '';
  }
  return '';
}

function avatarFromSeed(seed) {
  const cleanSeed = String(seed || '').trim();
  if (!cleanSeed) return '';
  return `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(cleanSeed)}&backgroundColor=d8bb9a,2b1a12&textColor=0e0604`;
}

function resolveAvatarUrl(profile) {
  const direct = normalizeAvatarUrl(profile?.avatarUrl);
  if (direct) return direct;
  const seed = profile?.fullName || currentUser?.email || 'Parrylicious';
  return avatarFromSeed(seed);
}

function showProfileStatus(message, isError = false) {
  if (!profileStatus) return;
  profileStatus.textContent = message;
  profileStatus.style.color = isError ? '#8f1c1c' : '';
}

function showRoleStatus(message, isError = false) {
  if (!roleStatus) return;
  roleStatus.textContent = message;
  roleStatus.style.color = isError ? '#8f1c1c' : '';
}

function renderProfile() {
  if (!profileForm) return;

  const profile = profileCache || {
    fullName: '',
    phone: '',
    address: '',
    avatarUrl: ''
  };

  profileFullName.value = profile.fullName || '';
  profilePhone.value = profile.phone || '';
  profileAddress.value = profile.address || '';

  const avatar = resolveAvatarUrl(profile);
  profileAvatarUrl.value = normalizeAvatarUrl(profile.avatarUrl) || avatar;
  profileAvatar.src = avatar || 'assets/logo.jpg';
}

function setProfileAvatarUrl(url) {
  if (!profileAvatar || !profileAvatarUrl) return;
  const clean = normalizeAvatarUrl(url);
  profileAvatarUrl.value = clean;
  profileAvatar.src = clean || 'assets/logo.jpg';
}

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.readAsDataURL(file);
  });
}

function canPayDeposit(booking) {
  if (!booking) return false;
  if (isStaffRole()) return false;
  if (booking.status === 'canceled') return false;
  if (booking.depositPaid || booking.paymentStatus === 'paid') return false;
  return true;
}

function paymentActionLabel(booking) {
  if (!booking) return 'Anzahlung zahlen';
  if (booking.paymentStatus === 'pending') return 'Anzahlung fortsetzen';
  if (booking.paymentStatus === 'failed') return 'Erneut zahlen';
  return 'Anzahlung zahlen';
}

function pill(status) {
  const label = status === 'requested' ? 'Angefragt' : status === 'confirmed' ? 'Bestätigt' : 'Storniert';
  return `<span class="pill ${status}">${label}</span>`;
}

function paymentPill(status) {
  const normalized = status || 'unpaid';
  const label = normalized === 'paid'
    ? 'Anzahlung: bezahlt'
    : normalized === 'pending'
      ? 'Anzahlung: ausstehend'
      : normalized === 'failed'
        ? 'Anzahlung: fehlgeschlagen'
        : normalized === 'refunded'
          ? 'Anzahlung: erstattet'
          : 'Anzahlung: offen';
  return `<span class="pill payment-${normalized}">${label}</span>`;
}

function matches(b) {
  const f = statusFilter.value;
  if (f !== 'all' && b.status !== f) return false;
  const q = search.value.trim().toLowerCase();
  if (!q) return true;
  const hay = `${b.customer?.firstName || ''} ${b.customer?.lastName || ''} ${b.serviceName || ''} ${b.customer?.phone || ''}`.toLowerCase();
  return hay.includes(q);
}

function renderKpis() {
  if (kpiBookings) kpiBookings.textContent = String(bookings().length);
  if (kpiWaitlist) kpiWaitlist.textContent = String(waitlist().length);
  if (kpiOpenPayments) {
    const open = bookings().filter((b) => b.status !== 'canceled' && !b.depositPaid && b.paymentStatus !== 'paid').length;
    kpiOpenPayments.textContent = String(open);
  }
}

function renderRoleUsers() {
  if (!roleUsersTable) return;

  roleUsersTable.innerHTML = '';
  if (!isAdminRole()) return;

  if (!roleUsersCache.length) {
    const empty = document.createElement('div');
    empty.className = 'item';
    empty.innerHTML = '<div class="muted">Noch keine Benutzerdaten geladen.</div>';
    roleUsersTable.appendChild(empty);
    return;
  }

  roleUsersCache.forEach((u) => {
    const fullName = escapeHtml(u.fullName || u.email || '-');
    const email = escapeHtml(u.email || '-');
    const phone = escapeHtml(u.phone || '-');
    const address = escapeHtml(u.address || '-');
    const role = escapeHtml(u.role || 'customer');
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `
      <div class="row between">
        <div>
          <strong>${fullName}</strong>
          <div class="muted small">${email}</div>
          <div class="muted small">📞 ${phone} · 🏠 ${address}</div>
        </div>
        <span class="pill">${role}</span>
      </div>
    `;
    roleUsersTable.appendChild(item);
  });
}

function render() {
  const list = bookings().slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  table.innerHTML = '';

  const filtered = list.filter(matches);
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'item';
    empty.innerHTML = '<div class="muted">Keine Buchungen gefunden.</div>';
    table.appendChild(empty);
  }

  filtered.forEach((b) => {
    const div = document.createElement('div');
    div.className = 'item';
    const firstName = escapeHtml(b.customer?.firstName || '');
    const lastName = escapeHtml(b.customer?.lastName || '');
    const serviceName = escapeHtml(b.serviceName || '');
    const dateLabel = escapeHtml(fmtDate(b.dateISO));
    const timeLabel = escapeHtml(b.time || '');
    const phone = escapeHtml(b.customer?.phone || '-');
    const email = escapeHtml(b.customer?.email || '-');
    const address = escapeHtml(b.customer?.address || '-');
    const notes = escapeHtml(b.customer?.notes || '');
    const receiptUrl = safeHttpUrl(b.paymentReceiptUrl);

    const actions = isStaffRole()
      ? `
        <button class="btn small" data-confirm="${b.id}" ${b.status === 'confirmed' ? 'disabled' : ''}>Bestätigen</button>
        <button class="btn small ghost" data-cancel="${b.id}" ${b.status === 'canceled' ? 'disabled' : ''}>Stornieren</button>
      `
      : `
        ${canPayDeposit(b) ? `<button class="btn small" data-pay="${b.id}">${paymentActionLabel(b)}</button>` : ''}
        <button class="btn small ghost" data-cancel-own="${b.id}" ${b.status === 'canceled' ? 'disabled' : ''}>Termin stornieren</button>
      `;

    div.innerHTML = `
      <div class="row between">
        <div>
          ${pill(b.status)}
          ${paymentPill(b.paymentStatus)}
          <strong>${firstName} ${lastName}</strong>
          <div class="muted small">${serviceName}</div>
        </div>
        <div style="text-align:right">
          <div><strong>${dateLabel} · ${timeLabel}</strong></div>
          <div class="muted small">⏱ ${formatMinutes(b.durationMin)} · Anz.: ${currency(b.deposit || 0)}</div>
        </div>
      </div>
      <div class="divider"></div>
      <div class="muted small">
        📞 ${phone} · ✉️ ${email} · 🏠 ${address}
      </div>
      ${notes ? `<div class="muted small" style="margin-top:8px">📝 ${notes}</div>` : ''}
      ${receiptUrl ? `<div class="muted small" style="margin-top:8px">🧾 <a href="${receiptUrl}" target="_blank" rel="noreferrer">Stripe-Zahlungsbeleg</a></div>` : ''}
      <div class="row end gap" style="margin-top:12px">
        ${actions}
      </div>
    `;

    div.querySelector('[data-confirm]')?.addEventListener('click', () => updateStatus(b.id, 'confirmed'));
    div.querySelector('[data-cancel]')?.addEventListener('click', () => updateStatus(b.id, 'canceled'));
    div.querySelector('[data-cancel-own]')?.addEventListener('click', () => updateStatus(b.id, 'canceled'));
    div.querySelector('[data-pay]')?.addEventListener('click', () => payDepositForBooking(b));
    table.appendChild(div);
  });

  renderWaitlist();
  renderKpis();
}

function renderWaitlist() {
  const wl = waitlist().slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  waitTable.innerHTML = '';
  if (!wl.length) {
    const empty = document.createElement('div');
    empty.className = 'item';
    empty.innerHTML = '<div class="muted">Keine Einträge.</div>';
    waitTable.appendChild(empty);
    return;
  }
  wl.forEach((w) => {
    const div = document.createElement('div');
    div.className = 'item';
    const serviceName = escapeHtml(w.serviceName || '');
    const email = escapeHtml(w.email || '');
    const phone = escapeHtml(w.phone || '');
    div.innerHTML = `
      <div class="row between">
        <div>
          <strong>${serviceName}</strong>
          <div class="muted small">✉️ ${email} · 📞 ${phone}</div>
        </div>
        <button class="btn small ghost" data-remove="${w.id}">Entfernen</button>
      </div>
    `;
    div.querySelector('[data-remove]')?.addEventListener('click', async () => {
      try {
        await removeMyWaitlistEntry(w.id);
        waitlistCache = waitlistCache.filter((x) => x.id !== w.id);
        renderWaitlist();
        renderKpis();
      } catch (error) {
        alert(`Fehler beim Entfernen: ${error.message}`);
      }
    });
    waitTable.appendChild(div);
  });
}

async function updateStatus(id, status) {
  const list = bookings();
  const current = list.find((x) => x.id === id);
  if (!current) return;

  try {
    let updated = null;
    if (isStaffRole()) {
      updated = await updateBookingStatus(id, status);
    } else {
      if (status !== 'canceled') return;
      updated = await cancelMyBooking(id);
    }
    Object.assign(current, updated);
    render();
  } catch (error) {
    alert(`Status-Update fehlgeschlagen: ${error.message}`);
    return;
  }

  try {
    const eventType = status === 'confirmed' ? 'booking_confirmed' : 'booking_canceled';
    const notifyResult = await sendBookingNotification({
      eventType,
      booking: current,
      customer: current.customer || {}
    });
    if (!notifyResult.ok) {
      console.warn('Notification konnte nicht versendet werden:', notifyResult.message);
    }
  } catch (_error) {
    // Versandfehler blockieren den Statuswechsel nicht.
  }

  const msg = status === 'confirmed'
    ? `✅ Termin für ${current.customer?.firstName || ''} am ${fmtDate(current.dateISO)} um ${current.time} bestätigt.`
    : `❌ Termin für ${current.customer?.firstName || ''} am ${fmtDate(current.dateISO)} wurde storniert.`;
  alert(msg);
}

async function payDepositForBooking(booking) {
  if (!booking?.id) return;
  const origin = `${window.location.origin}/booking.html`;
  const checkout = await createCheckoutSession({
    bookingId: booking.id,
    successUrl: `${origin}?payment=success&session_id={CHECKOUT_SESSION_ID}&booking_id=${booking.id}`,
    cancelUrl: `${origin}?payment=cancel&booking_id=${booking.id}`
  });
  if (!checkout.ok || !checkout.url) {
    alert(`Checkout konnte nicht gestartet werden: ${checkout.message || 'Unbekannter Fehler'}`);
    return;
  }
  window.location.href = checkout.url;
}

statusFilter.addEventListener('change', render);
search.addEventListener('input', render);

document.getElementById('exportCsv').addEventListener('click', () => {
  const list = bookings();
  const rows = [
    ['id', 'status', 'createdAt', 'date', 'time', 'service', 'durationMin', 'deposit', 'firstName', 'lastName', 'phone', 'email', 'address', 'notes'].join(',')
  ];
  list.forEach((b) => {
    const c = b.customer || {};
    const row = [
      b.id,
      b.status,
      b.createdAt,
      b.dateISO,
      b.time,
      `"${(b.serviceName || '').replaceAll('"', '""')}"`,
      b.durationMin,
      b.deposit,
      `"${(c.firstName || '').replaceAll('"', '""')}"`,
      `"${(c.lastName || '').replaceAll('"', '""')}"`,
      c.phone || '',
      c.email || '',
      `"${(c.address || '').replaceAll('"', '""')}"`,
      `"${(c.notes || '').replaceAll('"', '""')}"`
    ].join(',');
    rows.push(row);
  });
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'parrylicious-bookings.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

document.getElementById('clearData').addEventListener('click', () => {
  clearAllData();
});

async function clearAllData() {
  if (!confirm('Wirklich alle eigenen Daten löschen?')) return;
  try {
    await clearMyBookings(currentUser?.id);
    await clearMyWaitlist(currentUser?.id);
    bookingsCache = [];
    waitlistCache = [];
    render();
  } catch (error) {
    alert(`Loeschen fehlgeschlagen: ${error.message}`);
  }
}

async function loadRoleUsers() {
  if (!isAdminRole()) {
    roleUsersCache = [];
    renderRoleUsers();
    return;
  }
  try {
    roleUsersCache = await adminListUsersWithRoles(120);
    renderRoleUsers();
  } catch (error) {
    roleUsersCache = [];
    renderRoleUsers();
    showRoleStatus(`Benutzerliste konnte nicht geladen werden: ${error.message}`, true);
  }
}

async function loadData() {
  bookingsCache = await getMyBookings();
  waitlistCache = await getMyWaitlist();
  profileCache = await getMyProfile();
}

function renderIdentity() {
  if (roleBadge) roleBadge.textContent = `Rolle: ${currentRole}`;
  if (sessionUser) sessionUser.textContent = currentUser?.email || '';

  if (dashboardHint) {
    if (currentRole === 'admin') {
      dashboardHint.textContent = 'Admin-Ansicht: Du verwaltest alle Termine und kannst Rollen vergeben.';
    } else if (currentRole === 'staff') {
      dashboardHint.textContent = 'Staff-Ansicht: Du verwaltest alle Termine, ohne Rollenverwaltung.';
    } else {
      dashboardHint.textContent = 'Kundenansicht: Du verwaltest nur deine eigenen Buchungen und Profilinfos.';
    }
  }

  if (adminRoleCard) {
    adminRoleCard.classList.toggle('hidden', !isAdminRole());
  }
}

profileAvatarUpload?.addEventListener('change', async (event) => {
  const file = event.target?.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await readFileAsDataUrl(file);
    setProfileAvatarUrl(dataUrl);
    showProfileStatus('Profilbild geladen. Bitte Profil speichern.');
  } catch (error) {
    showProfileStatus(error.message, true);
  }
});

profileAvatarGenerate?.addEventListener('click', () => {
  const seed = profileFullName?.value || currentUser?.email || 'Parrylicious';
  const avatarUrl = avatarFromSeed(seed);
  setProfileAvatarUrl(avatarUrl);
  showProfileStatus('Avatar erstellt. Bitte Profil speichern.');
});

profileAvatarRemove?.addEventListener('click', () => {
  setProfileAvatarUrl('');
  showProfileStatus('Profilbild entfernt. Bitte Profil speichern.');
});

profileForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const saved = await saveMyProfile({
      fullName: profileFullName?.value || '',
      phone: profilePhone?.value || '',
      address: profileAddress?.value || '',
      avatarUrl: profileAvatarUrl?.value || ''
    });
    profileCache = saved;
    renderProfile();
    showProfileStatus('Profil erfolgreich gespeichert.');
  } catch (error) {
    showProfileStatus(`Profil konnte nicht gespeichert werden: ${error.message}`, true);
  }
});

roleForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  showRoleStatus('');
  const email = String(roleEmail?.value || '').trim();
  const role = normalizeRole(roleSelect?.value || 'customer');
  if (!email) {
    showRoleStatus('Bitte E-Mail eingeben.', true);
    return;
  }

  try {
    const result = await adminSetUserRoleByEmail(email, role);
    if (result?.userId) {
      showRoleStatus(`Rolle für ${email} auf ${role} gesetzt (sofort aktiv + für zukünftige Logins).`);
    } else {
      showRoleStatus(`Rollenregel für ${email} auf ${role} gespeichert (aktiv sobald Account erstellt wird).`);
    }
    roleEmail.value = '';
    await loadRoleUsers();
  } catch (error) {
    showRoleStatus(`Rolle konnte nicht gesetzt werden: ${error.message}`, true);
  }
});

async function boot() {
  if (!isAuthConfigured) {
    alert('Das Backend ist nicht konfiguriert. Bitte zuerst login.html einrichten.');
    window.location.href = 'login.html?next=admin.html';
    return;
  }
  try {
    currentUser = await getCurrentUser();
    if (!currentUser) {
      window.location.href = 'login.html?next=admin.html';
      return;
    }
    currentRole = await getCurrentUserRole();
    renderIdentity();
    await loadData();
    renderProfile();
    await loadRoleUsers();
    render();
  } catch (error) {
    alert(`Dashboard konnte nicht geladen werden: ${error.message}`);
    window.location.href = 'login.html?next=admin.html';
  }
}

boot();
