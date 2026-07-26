import { fmtDate, currency, formatMinutes } from './common.js';
import { isAuthConfigured, changePassword, signOut } from './auth-client.js';
import {
  getCurrentUser,
  getCurrentUserRole,
  getMyBookings,
  getMyWaitlist,
  adminSetUserRoleByEmail,
  adminCreateStaff,
  adminDeleteStaff,
  adminListUsersWithRoles,
  updateBookingStatus,
  removeMyWaitlistEntry
} from './data-client.js';
import { sendBookingNotification } from './backend-client.js';

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
const kpiConfirmed = document.getElementById('kpiConfirmed');

const adminRoleCard = document.getElementById('adminRoleCard');
const roleForm = document.getElementById('roleForm');
const roleEmail = document.getElementById('roleEmail');
const roleSelect = document.getElementById('roleSelect');
const roleStatus = document.getElementById('roleStatus');
const roleUsersTable = document.getElementById('roleUsersTable');

const staffForm = document.getElementById('staffForm');
const staffEmail = document.getElementById('staffEmail');
const staffPassword = document.getElementById('staffPassword');
const staffRole = document.getElementById('staffRole');
const staffStatus = document.getElementById('staffStatus');

const passwordForm = document.getElementById('passwordForm');
const currentPasswordInput = document.getElementById('currentPassword');
const newPasswordInput = document.getElementById('newPassword');
const newPassword2Input = document.getElementById('newPassword2');
const passwordStatus = document.getElementById('passwordStatus');
const logoutBtn = document.getElementById('logoutBtn');

let bookingsCache = [];
let waitlistCache = [];
let roleUsersCache = [];
let currentUser = null;
let currentRole = 'customer';

function isAdminRole() {
  return currentRole === 'admin';
}

function bookings() { return bookingsCache; }
function waitlist() { return waitlistCache; }

function normalizeRole(role) {
  return role === 'admin' || role === 'staff' ? role : 'customer';
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
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
  } catch (_error) {
    return '';
  }
  return '';
}

function showRoleStatus(message, isError = false) {
  if (!roleStatus) return;
  roleStatus.textContent = message;
  roleStatus.style.color = isError ? '#8f1c1c' : '';
}

function showStaffStatus(message, isError = false) {
  if (!staffStatus) return;
  staffStatus.textContent = message;
  staffStatus.style.color = isError ? '#8f1c1c' : '';
}

function showPasswordStatus(message, isError = false) {
  if (!passwordStatus) return;
  passwordStatus.textContent = message;
  passwordStatus.style.color = isError ? '#8f1c1c' : '';
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
  if (kpiConfirmed) {
    const confirmed = bookings().filter((b) => b.status === 'confirmed').length;
    kpiConfirmed.textContent = String(confirmed);
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

  const myEmail = String(currentUser?.email || '').toLowerCase();
  roleUsersCache.forEach((u) => {
    const rawEmail = String(u.email || '');
    const fullName = escapeHtml(u.fullName || u.email || '-');
    const email = escapeHtml(u.email || '-');
    const role = escapeHtml(u.role || 'customer');
    const isSelf = rawEmail.toLowerCase() === myEmail;
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `
      <div class="row between">
        <div>
          <strong>${fullName}</strong>
          <div class="muted small">${email}</div>
        </div>
        <div class="row gap">
          <span class="pill">${role}</span>
          ${isSelf ? '<span class="muted small">(du)</span>' : `<button class="btn small ghost" data-remove-user="${email}">Entfernen</button>`}
        </div>
      </div>
    `;
    item.querySelector('[data-remove-user]')?.addEventListener('click', async () => {
      if (!confirm(`Account ${rawEmail} wirklich entfernen? Der Zugang wird sofort gelöscht.`)) return;
      try {
        await adminDeleteStaff(rawEmail);
        showRoleStatus(`Account ${rawEmail} entfernt.`);
        await loadRoleUsers();
      } catch (error) {
        showRoleStatus(`Entfernen fehlgeschlagen: ${error.message}`, true);
      }
    });
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
        <button class="btn small" data-confirm="${b.id}" ${b.status === 'confirmed' ? 'disabled' : ''}>Bestätigen</button>
        <button class="btn small ghost" data-cancel="${b.id}" ${b.status === 'canceled' ? 'disabled' : ''}>Stornieren</button>
      </div>
    `;

    div.querySelector('[data-confirm]')?.addEventListener('click', () => updateStatus(b.id, 'confirmed'));
    div.querySelector('[data-cancel]')?.addEventListener('click', () => updateStatus(b.id, 'canceled'));
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
  const current = bookings().find((x) => x.id === id);
  if (!current) return;

  try {
    const updated = await updateBookingStatus(id, status);
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
}

function renderIdentity() {
  if (roleBadge) roleBadge.textContent = `Rolle: ${currentRole}`;
  if (sessionUser) sessionUser.textContent = currentUser?.email || '';

  if (dashboardHint) {
    dashboardHint.textContent = isAdminRole()
      ? 'Admin-Ansicht: Du verwaltest alle Termine und kannst Team-Accounts und Rollen verwalten.'
      : 'Team-Ansicht: Du verwaltest alle Termine (bestätigen, stornieren, Warteliste).';
  }

  if (adminRoleCard) {
    adminRoleCard.classList.toggle('hidden', !isAdminRole());
  }
}

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
      showRoleStatus(`Rolle für ${email} auf ${role} gesetzt.`);
    } else {
      showRoleStatus(`Rollenregel für ${email} auf ${role} gespeichert (aktiv sobald der Account existiert).`);
    }
    roleEmail.value = '';
    await loadRoleUsers();
  } catch (error) {
    showRoleStatus(`Rolle konnte nicht gesetzt werden: ${error.message}`, true);
  }
});

staffForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  showStaffStatus('');
  const email = String(staffEmail?.value || '').trim();
  const password = String(staffPassword?.value || '');
  const role = staffRole?.value === 'admin' ? 'admin' : 'staff';
  if (!email || password.length < 8) {
    showStaffStatus('Bitte E-Mail und ein Passwort mit mindestens 8 Zeichen angeben.', true);
    return;
  }
  try {
    await adminCreateStaff(email, password, role);
    showStaffStatus(`Account für ${email} (${role}) angelegt. Die Person kann sich jetzt einloggen.`);
    staffEmail.value = '';
    staffPassword.value = '';
    await loadRoleUsers();
  } catch (error) {
    showStaffStatus(`Account konnte nicht angelegt werden: ${error.message}`, true);
  }
});

passwordForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  showPasswordStatus('');
  const current = String(currentPasswordInput?.value || '');
  const next = String(newPasswordInput?.value || '');
  const confirmNext = String(newPassword2Input?.value || '');

  if (!current) {
    showPasswordStatus('Bitte das aktuelle Passwort eingeben.', true);
    return;
  }
  if (next.length < 8) {
    showPasswordStatus('Das neue Passwort muss mindestens 8 Zeichen lang sein.', true);
    return;
  }
  if (next !== confirmNext) {
    showPasswordStatus('Die beiden neuen Passwörter stimmen nicht überein.', true);
    return;
  }

  try {
    await changePassword(current, next);
    passwordForm.reset();
    showPasswordStatus('Passwort erfolgreich geändert.');
  } catch (error) {
    showPasswordStatus(`Passwort konnte nicht geändert werden: ${error.message}`, true);
  }
});

logoutBtn?.addEventListener('click', async () => {
  logoutBtn.disabled = true;
  try {
    await signOut();
  } catch (_error) {
    // Lokale Session wird ohnehin gelöscht — weiter zum Login.
  }
  window.location.href = 'login.html';
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
    // Nur Team-Mitglieder haben Zugriff auf das Dashboard.
    if (currentRole !== 'staff' && currentRole !== 'admin') {
      alert('Dieser Bereich ist nur für Mitarbeitende.');
      window.location.href = 'home.html';
      return;
    }
    renderIdentity();
    await loadData();
    await loadRoleUsers();
    render();
  } catch (error) {
    alert(`Dashboard konnte nicht geladen werden: ${error.message}`);
    window.location.href = 'login.html?next=admin.html';
  }
}

boot();
