import { getCurrentUser, signOut, onAuthStateChange, isAuthConfigured, resendVerification } from './auth-client.js';
import {
  getCustomerBookings,
  saveCustomerProfile,
  cancelCustomerBooking,
  rescheduleCustomerBooking,
  getCustomerPoints,
  submitReview
} from './data-client.js';

document.getElementById('year').textContent = new Date().getFullYear();

const greetName = document.getElementById('greetName');
const bookingsList = document.getElementById('bookingsList');
const profileForm = document.getElementById('profileForm');
const pfName = document.getElementById('pfName');
const pfPhone = document.getElementById('pfPhone');
const pfEmail = document.getElementById('pfEmail');
const pfMarketing = document.getElementById('pfMarketing');
const profileStatus = document.getElementById('profileStatus');
const logoutBtn = document.getElementById('logoutBtn');
const verifyBanner = document.getElementById('verifyBanner');

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
      ${(canCancel || canReschedule || b.status === 'confirmed') ? `<div class="booking-actions">
        ${canReschedule ? '<button class="btn small ghost" data-reschedule>Verschieben</button>' : ''}
        ${canCancel ? '<button class="btn small ghost" data-cancel>Stornieren</button>' : ''}
        ${b.status === 'confirmed' ? '<button class="btn small ghost" data-review>Bewerten</button>' : ''}
      </div>` : ''}
      ${(!canCancel && !canReschedule && b.status === 'confirmed') ? '<div class="fineprint">Änderungen sind bis 48 h vor dem Termin möglich.</div>' : ''}
    `;

    const cancelBtn = item.querySelector('[data-cancel]');
    if (cancelBtn) cancelBtn.addEventListener('click', () => doCancel(b));

    const rescheduleBtn = item.querySelector('[data-reschedule]');
    if (rescheduleBtn) rescheduleBtn.addEventListener('click', () => toggleReschedule(b, item, rescheduleBtn));

    const reviewBtn = item.querySelector('[data-review]');
    if (reviewBtn) reviewBtn.addEventListener('click', () => toggleReview(b, item));

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

// Feature 2: Bewertung zu einem abgeschlossenen Termin (graceful, falls Backend fehlt).
function toggleReview(b, item) {
  const existing = item.querySelector('.review-box');
  if (existing) { existing.remove(); return; }
  const box = document.createElement('div');
  box.className = 'review-box';
  box.innerHTML = `
    <div class="fineprint">Wie war dein Termin? Deine Bewertung erscheint direkt auf der Startseite.</div>
    <div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star" data-star="${n}">★</button>`).join('')}</div>
    <textarea class="rv-text" rows="3" placeholder="Erzähl kurz, wie es war (optional)…"></textarea>
    <div class="row gap"><button class="btn small rv-go" type="button">Bewertung senden</button></div>
    <div class="fineprint rv-status"></div>
  `;
  item.appendChild(box);
  let rating = 5;
  const stars = [...box.querySelectorAll('.star')];
  const paint = () => stars.forEach((s) => s.classList.toggle('on', Number(s.dataset.star) <= rating));
  stars.forEach((s) => s.addEventListener('click', () => { rating = Number(s.dataset.star); paint(); }));
  paint();
  const rvStatus = box.querySelector('.rv-status');
  box.querySelector('.rv-go').addEventListener('click', async () => {
    rvStatus.style.color = '';
    rvStatus.textContent = 'Sende…';
    try {
      await submitReview(b.id, rating, box.querySelector('.rv-text').value);
    } catch (error) {
      rvStatus.textContent = String(error?.status || '') === '404'
        ? 'Bewertungen sind bald verfügbar — danke für deine Geduld.'
        : `Konnte nicht gesendet werden: ${error.message}`;
      rvStatus.style.color = '#d6807b';
      return;
    }
    box.innerHTML = '<div class="fineprint">Danke! Deine Bewertung ist jetzt sichtbar.</div>';
  });
}

// Feature 4: Treuepunkte anzeigen. Für verifizierte Kunden immer sichtbar (auch bei 0),
// damit sie sehen, wie viele Punkte sie gesammelt haben.
async function loadPoints() {
  let data;
  try {
    data = await getCustomerPoints();
  } catch (_error) { return; }
  const balance = Number(data?.balance || 0);
  const history = Array.isArray(data?.history) ? data.history : [];
  const card = document.getElementById('pointsCard');
  const balEl = document.getElementById('pointsBalance');
  const histEl = document.getElementById('pointsHistory');
  if (balEl) balEl.textContent = String(balance);
  if (histEl) {
    histEl.innerHTML = history.length
      ? history.slice(0, 8).map((h) => `
        <div class="item" style="display:flex; justify-content:space-between; gap:12px">
          <span>${escapeHtml(h.reason || '')}</span>
          <strong style="color:${Number(h.delta) >= 0 ? 'var(--accent-2)' : 'var(--ink-soft)'}">${Number(h.delta) >= 0 ? '+' : ''}${escapeHtml(String(h.delta))}</strong>
        </div>`).join('')
      : '<div class="points-empty">Noch keine Punkte gesammelt – mit jedem abgeschlossenen Termin sammelst du Treuepunkte (1 Punkt je 1 €).</div>';
  }
  if (card) card.hidden = false;
}

// Belohnungs-Bereich: verifiziert → Treuepunkte-Anzeige; noch nicht verifiziert →
// Hinweis, dass nach der Bestätigung Neukundenrabatt + Treuepunkte warten.
function renderRewards() {
  const verified = Boolean(currentUser?.emailVerified);
  if (verifyBanner) verifyBanner.hidden = verified;
  const card = document.getElementById('pointsCard');
  if (verified) {
    loadPoints();
  } else if (card) {
    card.hidden = true;
  }
  renderReviewCard(verified);
}

// Bewertung schreiben: verifizierte Konten bekommen ein Sterne-Formular (1–5),
// nicht verifizierte einen Hinweis, dass dies nach der Bestätigung freigeschaltet wird.
function renderReviewCard(verified) {
  const card = document.getElementById('reviewCard');
  const body = document.getElementById('reviewCardBody');
  if (!card || !body) return;
  card.hidden = false;

  if (!verified) {
    body.innerHTML = '<p class="muted">🔒 Sobald du deine E-Mail bestätigt hast, kannst du hier eine Bewertung mit <strong>bis zu 5 Sternen</strong> hinterlassen. Sie erscheint direkt auf der Startseite.</p>';
    return;
  }

  body.innerHTML = `
    <div class="review-box">
      <div class="fineprint">Wie war dein Erlebnis bei Parrylicious? Deine Bewertung erscheint direkt auf der Startseite.</div>
      <div class="stars" id="genStars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star" data-star="${n}" aria-label="${n} Sterne">★</button>`).join('')}</div>
      <textarea class="rv-text" id="genReviewText" rows="3" placeholder="Erzähl kurz, wie es war…"></textarea>
      <div class="row gap"><button class="btn small" id="genReviewSubmit" type="button">Bewertung senden</button></div>
      <div class="fineprint" id="genReviewStatus"></div>
    </div>`;

  let rating = 5;
  const stars = [...body.querySelectorAll('#genStars .star')];
  const paint = () => stars.forEach((s) => s.classList.toggle('on', Number(s.dataset.star) <= rating));
  stars.forEach((s) => s.addEventListener('click', () => { rating = Number(s.dataset.star); paint(); }));
  paint();

  const status = body.querySelector('#genReviewStatus');
  body.querySelector('#genReviewSubmit').addEventListener('click', async () => {
    status.style.color = '';
    status.textContent = 'Sende…';
    try {
      await submitReview(null, rating, body.querySelector('#genReviewText').value);
    } catch (error) {
      status.textContent = String(error?.code || '') === 'EMAIL_NOT_VERIFIED'
        ? 'Bitte bestätige zuerst deine E-Mail-Adresse.'
        : `Konnte nicht gesendet werden: ${error.message}`;
      status.style.color = '#d6807b';
      return;
    }
    body.innerHTML = '<p class="muted">Danke! Deine Bewertung ist jetzt auf der Startseite sichtbar. Du kannst sie jederzeit erneut einreichen, um sie zu aktualisieren.</p>';
  });
}

profileForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  profileStatus.style.color = '';
  profileStatus.textContent = 'Speichere…';
  try {
    await saveCustomerProfile({ fullName: pfName.value, phone: pfPhone.value, marketingOptIn: !!(pfMarketing && pfMarketing.checked) });
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

// Bestätigungsmail erneut senden — mit 60-Sekunden-Cooldown (Server + Button).
let resendTimer = null;
function startResendCooldown(seconds) {
  const btn = document.getElementById('resendVerifyBtn');
  if (!btn) return;
  let remaining = Math.max(1, Math.ceil(Number(seconds) || 60));
  btn.disabled = true;
  const tick = () => {
    if (remaining <= 0) {
      btn.disabled = false;
      btn.textContent = 'Bestätigungsmail erneut senden';
      if (resendTimer) { clearInterval(resendTimer); resendTimer = null; }
      return;
    }
    btn.textContent = `Erneut senden in ${remaining}s`;
    remaining -= 1;
  };
  tick();
  if (resendTimer) clearInterval(resendTimer);
  resendTimer = setInterval(tick, 1000);
}

document.getElementById('resendVerifyBtn')?.addEventListener('click', async () => {
  const status = document.getElementById('resendVerifyStatus');
  const setStatus = (msg, isError) => { if (status) { status.style.color = isError ? '#d6807b' : ''; status.textContent = msg; } };
  setStatus('Sende…');
  let res;
  try {
    res = await resendVerification();
  } catch (error) {
    setStatus(`Konnte nicht gesendet werden: ${error.message}`, true);
    return;
  }
  if (res.alreadyVerified) { setStatus('Deine E-Mail ist bereits bestätigt — lade die Seite neu.'); return; }
  if (res.cooldown) { setStatus(res.message || 'Bitte kurz warten.'); startResendCooldown(res.retryAfter); return; }
  setStatus('E-Mail gesendet — bitte schau in dein Postfach (auch Spam).');
  startResendCooldown(60);
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
  if (pfMarketing) pfMarketing.checked = Boolean(currentUser.profile?.marketingOptIn);
  await loadBookings();
  renderRewards();
}

boot();
