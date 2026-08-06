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
  removeMyWaitlistEntry,
  adminListReviews,
  adminSetReviewStatus,
  adminDeleteReview,
  adminListBlockedDays,
  adminBlockDay,
  adminUnblockDay
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

// Feature 8: Terminkalender
const calGrid = document.getElementById('calGrid');
const calLabel = document.getElementById('calLabel');
const calPrev = document.getElementById('calPrev');
const calNext = document.getElementById('calNext');
const calDay = document.getElementById('calDay');
let calMonth = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();

// Feature 2: Reviews-Moderation
const reviewsTable = document.getElementById('reviewsTable');
const reviewStatusFilter = document.getElementById('reviewStatusFilter');

let bookingsCache = [];
let waitlistCache = [];
let roleUsersCache = [];
let reviewsCache = [];
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
  renderStaffCalendar();
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

/* ---------- Feature 8: Terminkalender ---------- */
function bookingsByDay() {
  const map = {};
  bookings().forEach((b) => {
    if (b.status === 'canceled') return;
    const iso = b.dateISO;
    if (!iso) return;
    (map[iso] = map[iso] || []).push(b);
  });
  return map;
}

function renderCalDay(iso, list) {
  if (!calDay) return;
  if (!list.length) {
    calDay.innerHTML = `<div class="muted small">${escapeHtml(fmtDate(iso))}: keine Termine.</div>`;
    return;
  }
  const rows = list.slice().sort((a, b) => (a.time || '').localeCompare(b.time || '')).map((b) => `
    <div class="cal-appt">
      <strong>${escapeHtml(b.time || '')}</strong> · ${escapeHtml(b.serviceName || '')}
      <span class="muted small">${escapeHtml(`${b.customer?.firstName || ''} ${b.customer?.lastName || ''}`.trim())}</span>
      ${pill(b.status)}
    </div>`).join('');
  calDay.innerHTML = `<div class="muted small" style="margin-bottom:8px">${escapeHtml(fmtDate(iso))} · ${list.length} Termin(e)</div>${rows}`;
}

function renderStaffCalendar() {
  if (!calGrid) return;
  const byDay = bookingsByDay();
  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();
  if (calLabel) calLabel.textContent = calMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  calGrid.innerHTML = '';
  ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].forEach((l) => {
    const d = document.createElement('div');
    d.className = 'cal-dow';
    d.textContent = l;
    calGrid.appendChild(d);
  });
  const first = new Date(y, m, 1);
  const pad = (first.getDay() + 6) % 7;
  for (let i = 0; i < pad; i++) {
    const e = document.createElement('div');
    e.className = 'cal-cell empty';
    calGrid.appendChild(e);
  }
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const list = byDay[iso] || [];
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-cell';
    if (iso === todayIso) cell.classList.add('today');
    if (list.length) cell.classList.add('has');
    cell.innerHTML = `<span class="cal-num">${d}</span>${list.length ? `<span class="cal-count">${list.length}</span>` : ''}`;
    cell.addEventListener('click', () => renderCalDay(iso, list));
    calGrid.appendChild(cell);
  }
}

calPrev?.addEventListener('click', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderStaffCalendar(); });
calNext?.addEventListener('click', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderStaffCalendar(); });

/* ---------- Feature 2: Reviews-Moderation ---------- */
function reviewStatusPill(status) {
  const label = status === 'approved' ? 'Freigeschaltet' : status === 'hidden' ? 'Ausgeblendet' : 'Zu prüfen';
  const cls = status === 'approved' ? 'confirmed' : status === 'hidden' ? 'canceled' : 'requested';
  return `<span class="pill ${cls}">${label}</span>`;
}

function renderReviews() {
  if (!reviewsTable) return;
  reviewsTable.innerHTML = '';
  if (!reviewsCache.length) {
    const empty = document.createElement('div');
    empty.className = 'item';
    empty.innerHTML = '<div class="muted">Keine Bewertungen in dieser Ansicht.</div>';
    reviewsTable.appendChild(empty);
    return;
  }
  reviewsCache.forEach((r) => {
    const rating = Math.max(1, Math.min(5, Number(r.rating) || 5));
    const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
    const name = escapeHtml(r.firstName || 'Gast');
    const service = escapeHtml(r.serviceName || '');
    const text = escapeHtml(r.text || '');
    const when = escapeHtml(fmtDate(String(r.createdAt || '').slice(0, 10)));
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <div class="row between">
        <div>
          ${reviewStatusPill(r.status)}
          <strong>${name}</strong>
          ${service ? `<span class="muted small"> · ${service}</span>` : ''}
        </div>
        <div style="text-align:right">
          <div style="color:var(--accent); letter-spacing:2px">${stars}</div>
          <div class="muted small">${when}</div>
        </div>
      </div>
      ${text ? `<div class="divider"></div><div class="muted small">„${text}"</div>` : ''}
      <div class="row end gap" style="margin-top:12px">
        ${r.status !== 'approved' ? `<button class="btn small" data-approve="${r.id}">Freischalten</button>` : ''}
        ${r.status !== 'hidden' ? `<button class="btn small ghost" data-hide="${r.id}">Ausblenden</button>` : ''}
        <button class="btn small ghost" data-delete="${r.id}">Löschen</button>
      </div>
    `;
    div.querySelector('[data-approve]')?.addEventListener('click', () => setReviewStatus(r.id, 'approved'));
    div.querySelector('[data-hide]')?.addEventListener('click', () => setReviewStatus(r.id, 'hidden'));
    div.querySelector('[data-delete]')?.addEventListener('click', () => deleteReview(r.id));
    reviewsTable.appendChild(div);
  });
}

async function setReviewStatus(id, status) {
  try {
    await adminSetReviewStatus(id, status);
  } catch (error) {
    alert(`Konnte nicht aktualisiert werden: ${error.message}`);
    return;
  }
  await loadReviews();
}

async function deleteReview(id) {
  if (!confirm('Diese Bewertung endgültig löschen?')) return;
  try {
    await adminDeleteReview(id);
  } catch (error) {
    alert(`Löschen fehlgeschlagen: ${error.message}`);
    return;
  }
  await loadReviews();
}

async function loadReviews() {
  if (!reviewsTable) return;
  const status = reviewStatusFilter?.value || 'approved';
  try {
    reviewsCache = await adminListReviews(status);
    renderReviews();
  } catch (error) {
    reviewsCache = [];
    reviewsTable.innerHTML = `<div class="item"><div class="muted">Bewertungen konnten nicht geladen werden: ${escapeHtml(error.message)}</div></div>`;
  }
}

reviewStatusFilter?.addEventListener('change', loadReviews);

/* ---------- Kalender-Sperrtage ---------- */
async function loadBlockedDays() {
  const list = document.getElementById('blockedDaysList');
  if (!list) return;
  let days = [];
  try {
    days = await adminListBlockedDays();
  } catch (error) {
    list.innerHTML = `<div class="item"><div class="muted">Sperrtage konnten nicht geladen werden: ${escapeHtml(error.message)}</div></div>`;
    return;
  }
  if (!days.length) {
    list.innerHTML = '<div class="item"><div class="muted">Keine gesperrten Tage. (Samstage & Sonntage sind automatisch gesperrt.)</div></div>';
    return;
  }
  list.innerHTML = '';
  days.forEach((day) => {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `<div class="row between"><strong>${escapeHtml(fmtDate(day))}</strong><button class="btn small ghost" data-unblock="${escapeHtml(day)}">Freigeben</button></div>`;
    div.querySelector('[data-unblock]')?.addEventListener('click', async () => {
      try {
        await adminUnblockDay(day);
      } catch (error) {
        alert(`Freigeben fehlgeschlagen: ${error.message}`);
        return;
      }
      await loadBlockedDays();
    });
    list.appendChild(div);
  });
}

document.getElementById('blockDayForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('blockDayInput');
  const status = document.getElementById('blockDayStatus');
  const day = String(input?.value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    if (status) { status.style.color = '#8f1c1c'; status.textContent = 'Bitte ein Datum wählen.'; }
    return;
  }
  if (status) { status.style.color = ''; status.textContent = 'Speichere…'; }
  try {
    await adminBlockDay(day);
  } catch (error) {
    if (status) { status.style.color = '#8f1c1c'; status.textContent = `Konnte nicht gesperrt werden: ${error.message}`; }
    return;
  }
  if (status) status.textContent = `${fmtDate(day)} gesperrt.`;
  if (input) input.value = '';
  await loadBlockedDays();
});

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
    const blockInput = document.getElementById('blockDayInput');
    if (blockInput) {
      const t = new Date();
      blockInput.min = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    }
    await loadData();
    await loadRoleUsers();
    render();
    loadReviews();
    loadBlockedDays();
  } catch (error) {
    alert(`Dashboard konnte nicht geladen werden: ${error.message}`);
    window.location.href = 'login.html?next=admin.html';
  }
}

boot();
