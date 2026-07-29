import { getCurrentUser, signOut, onAuthStateChange, isAuthConfigured } from './auth-client.js';
import {
  getCustomerBookings,
  saveCustomerProfile,
  cancelCustomerBooking,
  rescheduleCustomerBooking
} from './data-client.js';

document.getElementById('year').textContent = new Date().getFullYear();

const greetName = document.getElementById('greetName');
const bookingsList = document.getElementById('bookingsList');
const profileForm = document.getElementById('profileForm');
const pfName = document.getElementById('pfName');
const pfPhone = document.getElementById('pfPhone');
const pfEmail = document.getElementById('pfEmail');
const profileStatus = document.getElementById('profileStatus');
const logoutBtn = document.getElementById('logoutBtn');

let currentUser = null;

const fmtDate = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || '');
};
const euro = (n) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function statusPill(status) {
  const label = status === 'confirmed' ? 'Bestätigt' : status === 'canceled' ? 'Storniert' : 'Angefragt';
  const cls = status === 'confirmed' ? 'confirmed' : status === 'canceled' ? 'canceled' : 'requested';
  return `<span class="pill ${cls}">${label}</span>`;
}

// Zeitoptionen fürs Verschieben (Salon Di–Sa 11:00–19:30; letzter Start 18:30).
function timeOptions() {
  const out = [];
  for (let h = 11; h <= 18; h++) {
    out.push(`${String(h).padStart(2, '0')}:00`);
    out.push(`${String(h).padStart(2, '0')}:30`);
  }
  return out;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function loadBookings() {
  bookingsList.innerHTML = '<div class="empty">Lädt…</div>';
  let list;
  try {
    list = await getCustomerBookings();
  } catch (error) {
    bookingsList.innerHTML = `<div class="empty">Termine konnten nicht geladen werden: ${escapeHtml(error.message)}</div>`;
    return;
  }
  renderBookings(list);
}

function renderBookings(list) {
  bookingsList.innerHTML = '';
  if (!Array.isArray(list) || !list.length) {
    bookingsList.innerHTML = '<div class="empty">Noch keine Termine. <a class="link" href="booking.html">Jetzt buchen →</a></div>';
    return;
  }
  list.forEach((b) => {
    const item = document.createElement('div');
    item.className = 'item booking-item';
    const canCancel = Boolean(b.canCancel);
    const canReschedule = Boolean(b.canReschedule);
    item.innerHTML = `
      <div class="b-head">
        <div>
          ${statusPill(b.status)}
          <span class="b-title">${escapeHtml(b.serviceName || 'Termin')}</span>
        </div>
        <div style="text-align:right">
          <div class="b-when">${escapeHtml(fmtDate(b.dateISO))} · ${escapeHtml(b.time || '')} Uhr</div>
          <div class="muted small">Anzahlung: ${euro(b.deposit)}${b.priceFrom ? ` · Gesamt ab ${euro(b.priceFrom)}` : ''}</div>
        </div>
      </div>
      ${(canCancel || canReschedule) ? `<div class="booking-actions">
        ${canReschedule ? '<button class="btn small ghost" data-reschedule>Verschieben</button>' : ''}
        ${canCancel ? '<button class="btn small ghost" data-cancel>Stornieren</button>' : ''}
      </div>` : (b.status === 'confirmed' ? '<div class="fineprint">Änderungen sind bis 48 h vor dem Termin möglich.</div>' : '')}
    `;

    const cancelBtn = item.querySelector('[data-cancel]');
    if (cancelBtn) cancelBtn.addEventListener('click', () => doCancel(b));

    const rescheduleBtn = item.querySelector('[data-reschedule]');
    if (rescheduleBtn) rescheduleBtn.addEventListener('click', () => toggleReschedule(b, item, rescheduleBtn));

    bookingsList.appendChild(item);
  });
}

async function doCancel(b) {
  const ok = confirm(`Termin am ${fmtDate(b.dateISO)} um ${b.time} Uhr stornieren?\n\nStornierung bis 48 h vorher möglich. Die Anzahlung wird dir zurückerstattet.`);
  if (!ok) return;
  try {
    await cancelCustomerBooking(b.id);
  } catch (error) {
    alert(`Stornierung fehlgeschlagen: ${error.message}`);
    return;
  }
  await loadBookings();
}

function toggleReschedule(b, item, btn) {
  const existing = item.querySelector('.reschedule-box');
  if (existing) { existing.remove(); return; }

  const box = document.createElement('div');
  box.className = 'reschedule-box';
  box.innerHTML = `
    <div class="fineprint">Verschieben bis 48 h vorher — die Anzahlung wandert mit.</div>
    <div class="rs-row">
      <label>Neues Datum
        <input type="date" class="rs-date" min="${todayISO()}" />
      </label>
      <label>Uhrzeit
        <select class="rs-time">${timeOptions().map((t) => `<option value="${t}">${t} Uhr</option>`).join('')}</select>
      </label>
      <button class="btn small rs-go" type="button">Termin verschieben</button>
    </div>
    <div class="fineprint rs-status"></div>
  `;
  item.appendChild(box);

  const dateInput = box.querySelector('.rs-date');
  const timeSelect = box.querySelector('.rs-time');
  const go = box.querySelector('.rs-go');
  const rsStatus = box.querySelector('.rs-status');
  if (b.time && timeOptions().includes(b.time)) timeSelect.value = b.time;

  go.addEventListener('click', async () => {
    rsStatus.style.color = '';
    const dateISO = String(dateInput.value || '');
    const time = String(timeSelect.value || '');
    if (!dateISO) { rsStatus.textContent = 'Bitte ein Datum wählen.'; rsStatus.style.color = '#d6807b'; return; }
    go.disabled = true;
    rsStatus.textContent = 'Prüfe Verfügbarkeit…';
    try {
      await rescheduleCustomerBooking(b.id, dateISO, time);
    } catch (error) {
      const msg = String(error?.code || '') === 'SLOT_UNAVAILABLE'
        ? 'Dieser Termin ist leider nicht mehr frei. Bitte einen anderen wählen.'
        : `Verschieben fehlgeschlagen: ${error.message}`;
      rsStatus.textContent = msg; rsStatus.style.color = '#d6807b';
      go.disabled = false;
      return;
    }
    await loadBookings();
  });
}

profileForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  profileStatus.style.color = '';
  profileStatus.textContent = 'Speichere…';
  try {
    await saveCustomerProfile({ fullName: pfName.value, phone: pfPhone.value });
  } catch (error) {
    profileStatus.textContent = `Speichern fehlgeschlagen: ${error.message}`;
    profileStatus.style.color = '#d6807b';
    return;
  }
  profileStatus.textContent = 'Profil gespeichert.';
});

logoutBtn?.addEventListener('click', async () => {
  try { await signOut(); } catch (_error) { /* lokal wird die Session ohnehin gelöscht */ }
  window.location.href = '/';
});

onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') window.location.href = 'login.html';
});

async function boot() {
  if (!isAuthConfigured) {
    bookingsList.innerHTML = '<div class="empty">Backend nicht konfiguriert.</div>';
    return;
  }
  try {
    currentUser = await getCurrentUser();
  } catch (_error) {
    window.location.href = 'login.html?next=konto.html';
    return;
  }
  if (!currentUser) {
    window.location.href = 'login.html?next=konto.html';
    return;
  }
  // „Mein Konto" ist für Kundinnen und Kunden. Team/Admin → Dashboard.
  if (currentUser.role === 'staff' || currentUser.role === 'admin') {
    window.location.href = 'admin.html';
    return;
  }
  greetName.textContent = (currentUser.fullName || currentUser.profile?.fullName || currentUser.email || '').split(' ')[0] || 'schön dich zu sehen';
  pfName.value = currentUser.profile?.fullName || currentUser.fullName || '';
  pfPhone.value = currentUser.profile?.phone || '';
  pfEmail.value = currentUser.email || '';
  await loadBookings();
}

boot();
