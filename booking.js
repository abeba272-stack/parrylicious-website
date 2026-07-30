import { services } from './data/services.js';
import { storage, fmtDate, currency, formatMinutes } from './common.js';
import { checkSlotAvailability, getMyProfile, getCustomerEligibility } from './data-client.js';
import { getCurrentUser } from './auth-client.js';
import {
  startBookingCheckout,
  submitWaitlist,
  verifyCheckoutSession
} from './backend-client.js';

// Oberkategorien für die Service-Auswahl (Feature 1).
const BOOKING_CATS = [
  { key: 'locs',       label: 'Locs & Dreads',     img: 'assets/categories/locs.jpg' },
  { key: 'braids',     label: 'Braids & Cornrows', img: 'assets/categories/braids.jpg' },
  { key: 'ponytails',  label: 'Ponytails',         img: 'assets/categories/ponytails.jpg' },
  { key: 'men',        label: 'Herren',            img: 'assets/categories/men.jpg' },
  { key: 'wash',       label: 'Wash & Cut',        img: 'assets/categories/wash.jpg' },
  { key: 'treatment',  label: 'Treatments',        img: 'assets/categories/treatment.jpg' },
  { key: 'extensions', label: 'Extensions',        img: 'assets/categories/extensions.jpg' },
  { key: 'kids',       label: 'Kids',              img: 'assets/categories/kids.jpg' }
];
const inCat = (s, key) => (s.tags || []).includes(key);

const YEAR = document.getElementById('year');
if (YEAR) YEAR.textContent = new Date().getFullYear();

const STATE_KEY = 'parry_booking_state';
const bookingModeHint = document.getElementById('bookingModeHint');
if (bookingModeHint) {
  bookingModeHint.textContent = 'Sichere deinen Termin mit einer Anzahlung – der Restbetrag wird bequem vor Ort im Salon bezahlt.';
}

const stylists = [
  { id: 'auto', name: 'Egal (automatisch)', focus: 'System entscheidet', role: 'auto' },
  { id: 'dreads', name: 'Stylist A (Dreads/Locs)', focus: 'Dreads Fokus', role: 'staff' },
  { id: 'stylist_b', name: 'Stylist B', focus: 'Allround', role: 'staff' },
  { id: 'stylist_c', name: 'Stylist C', focus: 'Allround', role: 'staff' },
  { id: 'stylist_d', name: 'Stylist D', focus: 'Allround', role: 'staff' }
];

function getQueryService() {
  const params = new URLSearchParams(location.search);
  return params.get('service');
}

function getServiceById(serviceId) {
  return services.find((s) => s.id === serviceId) || null;
}

function getStylistName(stylistId) {
  return stylists.find((x) => x.id === stylistId)?.name || 'Egal (automatisch)';
}

const state = storage.get(STATE_KEY, {
  step: 1,
  serviceId: getQueryService() || null,
  stylistId: 'auto',
  dateISO: null,
  time: null,
  customer: null
});

const queryServiceId = getQueryService();
if (queryServiceId && getServiceById(queryServiceId)) {
  state.serviceId = queryServiceId;
}
if (!getServiceById(state.serviceId)) {
  state.serviceId = null;
  state.dateISO = null;
  state.time = null;
  if (Number(state.step) > 1) state.step = 1;
}
if (!stylists.some((s) => s.id === state.stylistId)) {
  state.stylistId = 'auto';
}
storage.set(STATE_KEY, state);

function saveState() { storage.set(STATE_KEY, state); }

function mergeCustomerDraft(next) {
  state.customer = { ...(state.customer || {}), ...(next || {}) };
  saveState();
}

const steps = [...document.querySelectorAll('.step')];
const panels = {
  1: document.getElementById('step1'),
  2: document.getElementById('step2'),
  3: document.getElementById('step3'),
  4: document.getElementById('step4'),
  5: document.getElementById('step5'),
  done: document.getElementById('done')
};

function showStep(n) {
  state.step = n;
  saveState();
  steps.forEach((s) => s.classList.toggle('active', Number(s.dataset.step) === n));
  Object.entries(panels).forEach(([k, p]) => {
    if (!p) return;
    if (k === 'done') p.classList.toggle('hidden', n !== 'done');
    else p.classList.toggle('hidden', Number(k) !== n);
  });
  if (n === 3) renderCalendar();
  if (n === 4) applyCustomerDraftToForm();
  if (n === 5) renderSummary();
}

document.querySelectorAll('[data-back]').forEach((btn) => {
  btn.addEventListener('click', () => showStep(Number(btn.dataset.back)));
});
document.querySelectorAll('[data-next]').forEach((btn) => {
  btn.addEventListener('click', () => showStep(Number(btn.dataset.next)));
});

function card(html) {
  const div = document.createElement('div');
  div.className = 'card';
  div.innerHTML = html;
  return div;
}

/* Step 1: service */
const servicePicker = document.getElementById('servicePicker');
const toStep2 = document.getElementById('toStep2');

let activeBookingCat = null;

function serviceCardEl(s) {
  const selected = state.serviceId === s.id;
  const imageSrc = s.image || 'assets/placeholder-editorial.jpg';
  const c = card(`
    <img class="service-thumb" src="${imageSrc}" alt="${s.name} Beispielbild" loading="lazy" />
    <div class="row between">
      <h3>${s.name}</h3>
      <div class="price">ab ${currency(s.priceFrom)}</div>
    </div>
    <div class="muted small">${s.category}</div>
    <p class="muted">${s.description}</p>
    <div class="row between">
      <div class="tag">⏱ ${formatMinutes(s.durationMin)}</div>
      <button class="btn small ${selected ? 'ghost' : ''}" data-service="${s.id}">
        ${selected ? 'Ausgewählt' : 'Auswählen'}
      </button>
    </div>
  `);
  c.querySelector('[data-service]').addEventListener('click', () => {
    state.serviceId = s.id;
    saveState();
    renderServicesOfCat();
    toStep2.disabled = false;
  });
  return c;
}

function renderCategoryTiles() {
  servicePicker.classList.remove('grid');
  servicePicker.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'booking-cats';
  BOOKING_CATS.forEach((cat) => {
    const count = services.filter((s) => inCat(s, cat.key)).length;
    if (!count) return;
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'booking-cat';
    t.innerHTML = `<img src="${cat.img}" alt="${cat.label}" loading="lazy"><span class="booking-cat__label"><span class="booking-cat__name">${cat.label}</span><span class="booking-cat__count">${count} Styles</span></span>`;
    t.addEventListener('click', () => { activeBookingCat = cat; renderServicesOfCat(); });
    wrap.appendChild(t);
  });
  servicePicker.appendChild(wrap);
  toStep2.disabled = !getServiceById(state.serviceId);
}

function renderServicesOfCat() {
  if (!activeBookingCat) return renderCategoryTiles();
  servicePicker.classList.remove('grid');
  servicePicker.innerHTML = '';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'btn small ghost';
  back.textContent = '← Alle Kategorien';
  back.style.marginBottom = '16px';
  back.addEventListener('click', () => { activeBookingCat = null; renderCategoryTiles(); });
  servicePicker.appendChild(back);
  const grid = document.createElement('div');
  grid.className = 'grid';
  services.filter((s) => inCat(s, activeBookingCat.key)).forEach((s) => grid.appendChild(serviceCardEl(s)));
  servicePicker.appendChild(grid);
  toStep2.disabled = !getServiceById(state.serviceId);
}

function renderServicePicker() {
  const sel = getServiceById(state.serviceId);
  activeBookingCat = sel ? (BOOKING_CATS.find((c) => inCat(sel, c.key)) || null) : null;
  if (activeBookingCat) renderServicesOfCat();
  else renderCategoryTiles();
}
renderServicePicker();
toStep2.addEventListener('click', () => showStep(2));

/* Step 2: stylist */
const stylistPicker = document.getElementById('stylistPicker');
function renderStylistPicker() {
  stylistPicker.innerHTML = '';
  stylists.forEach((s) => {
    const selected = state.stylistId === s.id;
    const c = card(`
      <div class="row between">
        <h3>${s.name}</h3>
        <span class="pill ${selected ? 'confirmed' : ''}">${selected ? '✓' : ' '}</span>
      </div>
      <div class="muted">${s.focus}</div>
      <div class="row end gap" style="margin-top:12px">
        <button class="btn small ${selected ? 'ghost' : ''}" data-stylist="${s.id}">
          ${selected ? 'Ausgewählt' : 'Wählen'}
        </button>
      </div>
    `);
    c.querySelector('[data-stylist]').addEventListener('click', () => {
      state.stylistId = s.id;
      saveState();
      renderStylistPicker();
    });
    stylistPicker.appendChild(c);
  });
}
renderStylistPicker();

/* Step 3: calendar + slots */
const calendarEl = document.getElementById('calendar');
const slotsEl = document.getElementById('slots');
const slotHint = document.getElementById('slotHint');
const toStep4 = document.getElementById('toStep4');
const resetDate = document.getElementById('resetDate');
const joinWaitlist = document.getElementById('joinWaitlist');
toStep4.addEventListener('click', () => {
  if (!(state.dateISO && state.time)) return;
  showStep(4);
});

const openDays = [2, 3, 4, 5, 6]; // Tue..Sat in JS: 0 Sun
const openStart = '11:00';
const openEnd = '19:30';
const slotStepMin = 30;
const maxDaysAhead = 60;
let slotRenderToken = 0;

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function minutesToTime(min) {
  const h = Math.floor(min / 60).toString().padStart(2, '0');
  const m = (min % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

function renderCalendar() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  calendarEl.innerHTML = '';

  const labels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  labels.forEach((l) => {
    const d = document.createElement('div');
    d.className = 'muted small';
    d.style.textAlign = 'center';
    d.textContent = l;
    calendarEl.appendChild(d);
  });

  const first = new Date(start);
  const dow = (first.getDay() + 6) % 7; // Monday=0
  for (let i = 0; i < dow; i++) {
    const pad = document.createElement('div');
    pad.className = 'day disabled';
    pad.style.visibility = 'hidden';
    calendarEl.appendChild(pad);
  }

  const daysToShow = Math.min(maxDaysAhead + 1, 90);
  for (let i = 0; i < daysToShow; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const isOpen = openDays.includes(d.getDay());
    const ahead = Math.floor((d - start) / (1000 * 60 * 60 * 24));
    const inRange = ahead <= maxDaysAhead;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day';
    if (!isOpen || !inRange) btn.classList.add('disabled');

    const day = d.getDate().toString().padStart(2, '0');
    const mon = (d.getMonth() + 1).toString().padStart(2, '0');
    btn.innerHTML = `<div>${day}.${mon}</div><div class="sub">${isOpen ? '' : 'zu'}</div>`;
    if (state.dateISO === iso) btn.classList.add('selected');

    btn.addEventListener('click', () => {
      if (!isOpen || !inRange) return;
      state.dateISO = iso;
      state.time = null;
      saveState();
      [...calendarEl.querySelectorAll('.day')].forEach((x) => x.classList.remove('selected'));
      btn.classList.add('selected');
      renderSlots();
    });

    calendarEl.appendChild(btn);
  }

  renderSlots();
}

async function renderSlots() {
  const renderToken = ++slotRenderToken;
  slotsEl.innerHTML = '';
  toStep4.disabled = !state.time || !state.dateISO;

  if (!state.dateISO) {
    slotHint.textContent = 'Wähle links ein Datum.';
    return;
  }
  const service = getServiceById(state.serviceId);
  if (!service) {
    slotHint.textContent = 'Service nicht gefunden. Bitte gehe zu Schritt 1 und wähle den Service neu.';
    return;
  }

  slotHint.textContent = `Service-Dauer: ${formatMinutes(service.durationMin)} · Öffnung: ${openStart}–${openEnd} · Verfügbarkeit wird geprüft…`;
  const startMin = timeToMinutes(openStart);
  const endMin = timeToMinutes(openEnd);
  const slotMeta = [];

  for (let t = startMin; t + service.durationMin <= endMin; t += slotStepMin) {
    const tt = minutesToTime(t);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'slot';
    btn.textContent = tt;
    btn.classList.add('full');
    btn.disabled = true;
    if (state.time === tt) btn.classList.add('selected');

    const meta = { time: tt, btn, available: false };
    btn.addEventListener('click', () => {
      if (!meta.available) return;
      state.time = tt;
      saveState();
      renderSlots();
    });
    slotsEl.appendChild(btn);
    slotMeta.push(meta);
  }

  // Verfügbarkeit serverseitig prüfen (öffentlicher /api/slots-Endpoint).
  // Bei Fehler optimistisch anzeigen — der Server prüft final beim Checkout (Advisory-Lock).
  await Promise.all(slotMeta.map(async (meta) => {
    let available = true;
    try {
      available = await checkSlotAvailability({
        dateISO: state.dateISO,
        time: meta.time,
        durationMin: service.durationMin,
        stylistId: state.stylistId
      });
    } catch (_error) {
      available = true;
    }
    if (renderToken !== slotRenderToken) return;
    meta.available = available;
    meta.btn.classList.toggle('full', !available);
    meta.btn.disabled = !available;
  }));

  if (renderToken !== slotRenderToken) return;

  if (state.time && !slotMeta.some((s) => s.time === state.time && s.available)) {
    state.time = null;
    saveState();
  }

  slotHint.textContent = `Service-Dauer: ${formatMinutes(service.durationMin)} · Öffnung: ${openStart}–${openEnd}`;
  toStep4.disabled = !(state.time && state.dateISO);
}

resetDate.addEventListener('click', () => {
  state.dateISO = null;
  state.time = null;
  saveState();
  renderCalendar();
});

joinWaitlist.addEventListener('click', async () => {
  const service = getServiceById(state.serviceId);
  if (!service) return alert('Bitte zuerst einen Service wählen.');
  const email = prompt('Warteliste: deine E‑Mail?');
  if (!email) return;
  const phone = prompt('Telefonnummer?');
  if (!phone) return;

  const result = await submitWaitlist({
    serviceId: service.id,
    serviceName: service.name,
    email,
    phone,
    note: 'Warteliste-Anfrage'
  });
  if (result.ok) {
    alert('✅ Du stehst auf der Warteliste. Wir melden uns, sobald ein Termin frei wird.');
  } else {
    alert(`❌ Warteliste fehlgeschlagen: ${result.message || 'Unbekannter Fehler'}`);
  }
});

/* Step 4: details form */
const detailsForm = document.getElementById('detailsForm');

function applyCustomerDraftToForm() {
  if (!detailsForm || !state.customer) return;
  ['firstName', 'lastName', 'phone', 'email', 'address', 'notes'].forEach((key) => {
    const input = detailsForm.elements.namedItem(key);
    if (!input) return;
    if (!input.value && state.customer?.[key]) {
      input.value = state.customer[key];
    }
  });
}

detailsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(detailsForm);
  state.customer = Object.fromEntries(fd.entries());
  saveState();
  showStep(5);
});

/* Step 5: payment (Anzahlung ist Pflicht) */
const summary = document.getElementById('summary');
const doneSummary = document.getElementById('doneSummary');
const payDeposit = document.getElementById('payDeposit');
const downloadIcs = document.getElementById('downloadIcs');

let isSubmittingPayment = false;

function renderSummary() {
  const service = getServiceById(state.serviceId);
  if (!service) return;
  const rest = Math.max(0, Number(service.priceFrom || 0) - Number(service.deposit || 0));
  summary.innerHTML = `
    <div class="row"><strong>Service</strong><div>${service.name}</div></div>
    <div class="row"><strong>Dauer</strong><div>${formatMinutes(service.durationMin)}</div></div>
    <div class="row"><strong>Datum</strong><div>${fmtDate(state.dateISO)} · ${state.time}</div></div>
    <div class="row"><strong>Stylist</strong><div>${getStylistName(state.stylistId)}</div></div>
    <div class="divider"></div>
    <div class="row"><strong>Anzahlung (jetzt online)</strong><div>${currency(service.deposit)}</div></div>
    <div class="row"><strong>Restbetrag (im Salon)</strong><div>ab ${currency(rest)}</div></div>
  `;
}

function buildCustomerPayload() {
  const c = state.customer || {};
  const firstName = String(c.firstName || '').trim();
  const lastName = String(c.lastName || '').trim();
  return {
    firstName,
    lastName,
    name: `${firstName} ${lastName}`.trim(),
    email: String(c.email || '').trim(),
    phone: String(c.phone || '').trim(),
    address: String(c.address || '').trim(),
    note: String(c.notes || '').trim()
  };
}

payDeposit.addEventListener('click', async () => {
  if (isSubmittingPayment) return;
  const service = getServiceById(state.serviceId);
  if (!service || !state.dateISO || !state.time) {
    alert('Bitte Service, Datum und Uhrzeit vollständig wählen.');
    return;
  }

  isSubmittingPayment = true;
  payDeposit.disabled = true;
  const originalLabel = payDeposit.textContent;
  payDeposit.textContent = 'Weiterleitung zur Zahlung…';

  try {
    const checkout = await startBookingCheckout({
      serviceId: service.id,
      stylistId: state.stylistId,
      stylistName: getStylistName(state.stylistId),
      dateISO: state.dateISO,
      time: state.time,
      customer: buildCustomerPayload()
    });

    if (!checkout.ok || !checkout.url) {
      if (checkout.code === 'SLOT_UNAVAILABLE' || /nicht mehr verfügbar/i.test(checkout.message || '')) {
        alert('❌ Dieser Termin wurde gerade vergeben. Bitte wähle eine andere Uhrzeit.');
        showStep(3);
        return;
      }
      alert(`Zahlung konnte nicht gestartet werden: ${checkout.message || 'Unbekannter Fehler'}`);
      return;
    }
    window.location.href = checkout.url;
  } finally {
    payDeposit.disabled = false;
    payDeposit.textContent = originalLabel;
    isSubmittingPayment = false;
  }
});

function renderDone() {
  const service = getServiceById(state.serviceId);
  const c = state.customer || {};
  const name = `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Gast';
  doneSummary.innerHTML = `
    <div class="row"><strong>Service</strong><div>${service ? service.name : '—'}</div></div>
    <div class="row"><strong>Datum</strong><div>${fmtDate(state.dateISO)} · ${state.time || ''}</div></div>
    <div class="row"><strong>Name</strong><div>${name}</div></div>
    <div class="row"><strong>Anzahlung</strong><div>${service ? currency(service.deposit) : ''} · Bezahlt ✅</div></div>
    <div class="row"><strong>Restbetrag</strong><div>im Salon</div></div>
    <div class="divider"></div>
    <pre class="template">Hallo ${c.firstName || ''}, wir haben deine Anzahlung erhalten und deinen Termin am ${fmtDate(state.dateISO)} um ${state.time || ''} für ${service ? service.name : 'deinen Service'} bestätigt. Wir freuen uns auf dich! – Parrylicious Studio</pre>
  `;
}

downloadIcs.addEventListener('click', () => {
  const service = getServiceById(state.serviceId);
  if (!service || !state.dateISO || !state.time) return alert('Keine Buchung gefunden.');
  const dtStart = new Date(`${state.dateISO}T${state.time}:00`);
  const dtEnd = new Date(dtStart.getTime() + service.durationMin * 60000);

  const pad = (n) => String(n).padStart(2, '0');
  const toICS = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Parrylicious//Booking//DE',
    'BEGIN:VEVENT',
    `UID:${state.dateISO}-${state.time}@parrylicious.store`,
    `DTSTAMP:${toICS(new Date())}`,
    `DTSTART:${toICS(dtStart)}`,
    `DTEND:${toICS(dtEnd)}`,
    `SUMMARY:${service.name} – Parrylicious Studio`,
    'LOCATION:Bahlenstraße 42, 40589 Düsseldorf',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'parrylicious-termin.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

function clearPaymentParamsFromUrl() {
  const params = new URLSearchParams(window.location.search);
  ['payment', 'session_id', 'booking_id'].forEach((key) => params.delete(key));
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}`;
  window.history.replaceState({}, '', nextUrl);
}

// Rückkehr von Stripe: ?payment=success|cancel.
async function handlePaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const paymentState = params.get('payment');
  if (!paymentState) return false;

  if (paymentState === 'cancel') {
    clearPaymentParamsFromUrl();
    alert('Zahlung abgebrochen. Der Termin wurde nicht reserviert – du kannst es erneut versuchen.');
    showStep(5);
    return true;
  }

  if (paymentState === 'success') {
    const sessionId = params.get('session_id');
    // Best-effort-Verifikation der Session (der Webhook bestätigt die Buchung serverseitig).
    if (sessionId) {
      try { await verifyCheckoutSession(sessionId); } catch (_error) { /* nicht blockierend */ }
    }
    renderDone();
    showStep('done');
    clearPaymentParamsFromUrl();
    return true;
  }

  return false;
}

/* init */

// Phase 0: Kontaktfelder für eingeloggte Kunden vorbefüllen.
async function prefillFromAccount() {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'customer') return;
    const c = { ...(state.customer || {}) };
    if (!c.email && user.email) c.email = user.email;
    const fullName = String(user.fullName || '').trim();
    if (fullName && !c.firstName && !c.lastName) {
      const parts = fullName.split(/\s+/);
      c.firstName = parts.shift() || '';
      c.lastName = parts.join(' ');
    }
    try {
      const p = await getMyProfile();
      if (p && p.phone && !c.phone) c.phone = p.phone;
    } catch (_e) { /* Profil optional */ }
    state.customer = c;
    saveState();
    applyCustomerDraftToForm();
  } catch (_e) { /* nicht eingeloggt */ }
}

// Feature 3: Neukunden-Rabatt-Banner (Endbetrag rechnet der Server im Checkout).
async function showDiscountBanner() {
  try {
    const el = await getCustomerEligibility();
    if (!el || !el.newCustomerDiscount) return;
    const wiz = document.querySelector('.wizard');
    if (!wiz || !wiz.parentNode || document.getElementById('discountBanner')) return;
    const b = document.createElement('div');
    b.id = 'discountBanner';
    b.className = 'discount-banner';
    b.innerHTML = `✨ <strong>&minus;${el.discountPercent || 10}%</strong> auf deine erste Buchung &ndash; wird beim Bezahlen automatisch abgezogen.`;
    wiz.parentNode.insertBefore(b, wiz);
  } catch (_e) { /* nicht eingeloggt / kein Anspruch */ }
}

async function boot() {
  const handledPayment = await handlePaymentReturn();
  if (!handledPayment) showStep(state.step || 1);
  prefillFromAccount();
  showDiscountBanner();
}

boot();
