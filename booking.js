import { services } from './data/services.js';
import { storage, fmtDate, currency, formatMinutes } from './common.js';
import { isAuthConfigured } from './auth-client.js';
import {
  getCurrentUser,
  getMyProfile,
  getMyBookings,
  getMyBookingById,
  getMyWaitlist,
  createMyBooking,
  createMyWaitlistEntry,
  checkSlotAvailability
} from './data-client.js';
import {
  createCheckoutSession,
  verifyCheckoutSession,
  sendBookingNotification
} from './backend-client.js';

const YEAR = document.getElementById('year');
if (YEAR) YEAR.textContent = new Date().getFullYear();

const STATE_KEY = 'parry_booking_state';
const GUEST_BOOKINGS_KEY = 'parry_guest_bookings';
const GUEST_WAITLIST_KEY = 'parry_guest_waitlist';
const bookingModeHint = document.getElementById('bookingModeHint');
let currentUser = null;
let isGuestBooking = true;
let bookingsCache = [];
let waitlistCache = [];
let profileCache = null;

const stylists = [
  { id:'auto', name:'Egal (automatisch)', focus:'System entscheidet', role:'auto' },
  { id:'dreads', name:'Stylist A (Dreads/Locs)', focus:'Dreads Fokus', role:'staff' },
  { id:'stylist_b', name:'Stylist B', focus:'Allround', role:'staff' },
  { id:'stylist_c', name:'Stylist C', focus:'Allround', role:'staff' },
  { id:'stylist_d', name:'Stylist D', focus:'Allround', role:'staff' }
];

function getQueryService(){
  const params = new URLSearchParams(location.search);
  return params.get('service');
}

function getServiceById(serviceId) {
  return services.find((s) => s.id === serviceId) || null;
}

const state = storage.get(STATE_KEY, {
  step: 1,
  serviceId: getQueryService() || null,
  stylistId: 'auto',
  dateISO: null,
  time: null,
  customer: null,
  lastBookingId: null,
  pendingPaymentBookingId: null
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

function saveState(){ storage.set(STATE_KEY, state); }
function saveGuestBookings(){ storage.set(GUEST_BOOKINGS_KEY, bookingsCache); }
function saveGuestWaitlist(){ storage.set(GUEST_WAITLIST_KEY, waitlistCache); }
function guestId(prefix){
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2,10)}`;
}
function syncBookingModeHint(){
  if (!bookingModeHint) return;
  if (isGuestBooking){
    bookingModeHint.textContent = 'Gastmodus aktiv: Du kannst ohne Login buchen. Für Dashboard-Verwaltung bitte einloggen.';
    return;
  }
  bookingModeHint.textContent = `Angemeldet als ${currentUser?.email || 'Konto'}: deine Buchungen landen im Dashboard.`;
}

function splitFullName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  };
}

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

function showStep(n){
  state.step = n;
  saveState();
  steps.forEach(s => s.classList.toggle('active', Number(s.dataset.step) === n));
  Object.entries(panels).forEach(([k,p]) => {
    if (!p) return;
    if (k === 'done') p.classList.toggle('hidden', n !== 'done');
    else p.classList.toggle('hidden', Number(k) !== n);
  });
  if (n === 3) renderCalendar();
  if (n === 4) applyCustomerDraftToForm();
  if (n === 5) renderSummary();
}

document.querySelectorAll('[data-back]').forEach(btn => {
  btn.addEventListener('click', () => showStep(Number(btn.dataset.back)));
});
document.querySelectorAll('[data-next]').forEach(btn => {
  btn.addEventListener('click', () => showStep(Number(btn.dataset.next)));
});

function card(html){
  const div = document.createElement('div');
  div.className = 'card';
  div.innerHTML = html;
  return div;
}

/* Step 1: service */
const servicePicker = document.getElementById('servicePicker');
const toStep2 = document.getElementById('toStep2');

function renderServicePicker(){
  servicePicker.innerHTML = '';
  services.forEach(s => {
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
        <button class="btn small ${selected ? 'ghost':''}" data-service="${s.id}">
          ${selected ? 'Ausgewählt' : 'Auswählen'}
        </button>
      </div>
    `);
    c.querySelector('[data-service]').addEventListener('click', () => {
      state.serviceId = s.id;
      saveState();
      renderServicePicker();
      toStep2.disabled = false;
    });
    servicePicker.appendChild(c);
  });

  toStep2.disabled = !getServiceById(state.serviceId);
}
renderServicePicker();
toStep2.addEventListener('click', () => showStep(2));

/* Step 2: stylist */
const stylistPicker = document.getElementById('stylistPicker');
function renderStylistPicker(){
  stylistPicker.innerHTML = '';
  stylists.forEach(s => {
    const selected = state.stylistId === s.id;
    const c = card(`
      <div class="row between">
        <h3>${s.name}</h3>
        <span class="pill ${selected ? 'confirmed':''}">${selected ? '✓' : ' '}</span>
      </div>
      <div class="muted">${s.focus}</div>
      <div class="row end gap" style="margin-top:12px">
        <button class="btn small ${selected ? 'ghost':''}" data-stylist="${s.id}">
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

const openDays = [2,3,4,5,6]; // Tue..Sat in JS: 0 Sun
const openStart = "11:00";
const openEnd = "19:30";
const slotStepMin = 30;
const maxDaysAhead = 60;
const capacitySeats = 4;
let slotRenderToken = 0;

function timeToMinutes(t){
  const [h,m] = t.split(':').map(Number);
  return h*60+m;
}
function minutesToTime(min){
  const h = Math.floor(min/60).toString().padStart(2,'0');
  const m = (min%60).toString().padStart(2,'0');
  return `${h}:${m}`;
}

function getBookings(){ return bookingsCache; }

function overlaps(aStart, aDur, bStart, bDur){
  const a0 = timeToMinutes(aStart);
  const a1 = a0 + aDur;
  const b0 = timeToMinutes(bStart);
  const b1 = b0 + bDur;
  return a0 < b1 && b0 < a1;
}

function isSlotAvailableLocal(dateISO, startTime, durMin){
  const bookings = getBookings().filter(b => b.dateISO === dateISO && b.status !== 'canceled');
  const desiredStylist = state.stylistId;
  if (desiredStylist && desiredStylist !== 'auto'){
    // stylist-specific: block if any booking for that stylist overlaps
    return !bookings.some(b => b.stylistId === desiredStylist && overlaps(b.time, b.durationMin, startTime, durMin));
  } else {
    // capacity-based: allow up to 4 overlapping bookings
    const overlapping = bookings.filter(b => overlaps(b.time, b.durationMin, startTime, durMin)).length;
    return overlapping < capacitySeats;
  }
}

function renderCalendar(){
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  calendarEl.innerHTML = '';

  // 7 day header labels
  const labels = ['Mo','Di','Mi','Do','Fr','Sa','So'];
  labels.forEach(l => {
    const d = document.createElement('div');
    d.className = 'muted small';
    d.style.textAlign = 'center';
    d.textContent = l;
    calendarEl.appendChild(d);
  });

  // Determine first day offset (calendar starts Monday)
  const first = new Date(start);
  const dow = (first.getDay()+6)%7; // Monday=0
  for (let i=0;i<dow;i++){
    const pad = document.createElement('div');
    pad.className = 'day disabled';
    pad.style.visibility = 'hidden';
    calendarEl.appendChild(pad);
  }

  const daysToShow = Math.min(maxDaysAhead + 1, 90);
  for (let i=0;i<daysToShow;i++){
    const d = new Date(start);
    d.setDate(d.getDate()+i);
    const iso = d.toISOString().slice(0,10);
    const isOpen = openDays.includes(d.getDay());
    const ahead = Math.floor((d - start)/(1000*60*60*24));
    const inRange = ahead <= maxDaysAhead;

    const btn = document.createElement('button');
    btn.type='button';
    btn.className = 'day';
    if (!isOpen || !inRange) btn.classList.add('disabled');

    const day = d.getDate().toString().padStart(2,'0');
    const mon = (d.getMonth()+1).toString().padStart(2,'0');
    btn.innerHTML = `<div>${day}.${mon}</div><div class="sub">${isOpen ? '' : 'zu'}</div>`;
    if (state.dateISO === iso) btn.classList.add('selected');

    btn.addEventListener('click', () => {
      if (!isOpen || !inRange) return;
      state.dateISO = iso;
      state.time = null;
      saveState();
      [...calendarEl.querySelectorAll('.day')].forEach(x => x.classList.remove('selected'));
      btn.classList.add('selected');
      renderSlots();
    });

    calendarEl.appendChild(btn);
  }

  renderSlots();
}

async function renderSlots(){
  const renderToken = ++slotRenderToken;
  slotsEl.innerHTML = '';
  toStep4.disabled = !state.time || !state.dateISO;

  if (!state.dateISO){
    slotHint.textContent = 'Wähle links ein Datum.';
    return;
  }
  const service = services.find(s => s.id === state.serviceId);
  if (!service){
    slotHint.textContent = 'Service nicht gefunden. Bitte gehe zu Schritt 1 und wähle den Service neu.';
    return;
  }

  slotHint.textContent = `Service-Dauer: ${formatMinutes(service.durationMin)} · Öffnung: ${openStart}–${openEnd} · Verfügbarkeit wird geprüft…`;
  const startMin = timeToMinutes(openStart);
  const endMin = timeToMinutes(openEnd);
  const slotMeta = [];

  for (let t=startMin; t + service.durationMin <= endMin; t += slotStepMin){
    const tt = minutesToTime(t);
    const btn = document.createElement('button');
    btn.type='button';
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

  await Promise.all(slotMeta.map(async (meta) => {
    let available = isSlotAvailableLocal(state.dateISO, meta.time, service.durationMin);
    if (!isGuestBooking){
      try {
        available = await checkSlotAvailability({
          dateISO: state.dateISO,
          time: meta.time,
          durationMin: service.durationMin,
          stylistId: state.stylistId
        });
      } catch (_error) {
        // Fallback to local estimate if RPC check is not available.
      }
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
  state.dateISO = null; state.time = null; saveState(); renderCalendar();
});

joinWaitlist.addEventListener('click', async () => {
  const service = services.find(s => s.id === state.serviceId);
  if (!service) return alert('Bitte zuerst einen Service wählen.');
  const email = prompt('Warteliste: deine E‑Mail?');
  if (!email) return;
  const phone = prompt('Telefonnummer?');
  if (!phone) return;

  if (isGuestBooking){
    waitlistCache = [{
      id: guestId('wait'),
      createdAt: new Date().toISOString(),
      serviceId: service.id,
      serviceName: service.name,
      email,
      phone,
      note: 'Gast-Warteliste'
    }, ...waitlistCache];
    saveGuestWaitlist();
    alert('✅ Warteliste als Gast gespeichert.');
    return;
  }

  try {
    const row = await createMyWaitlistEntry({
      serviceId: service.id,
      serviceName: service.name,
      email,
      phone,
      note: 'Warteliste'
    }, currentUser.id);
    waitlistCache = [row, ...waitlistCache];
    alert('✅ Warteliste gespeichert.');
  } catch (error) {
    alert(`❌ Warteliste fehlgeschlagen: ${error.message}`);
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

function applyProfileDefaultsToCustomer() {
  if (!profileCache || isGuestBooking) return;
  const name = splitFullName(profileCache.fullName);
  const email = currentUser?.email || '';
  mergeCustomerDraft({
    firstName: state.customer?.firstName || name.firstName || '',
    lastName: state.customer?.lastName || name.lastName || '',
    phone: state.customer?.phone || profileCache.phone || '',
    email: state.customer?.email || email || '',
    address: state.customer?.address || profileCache.address || '',
    notes: state.customer?.notes || ''
  });
}

detailsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(detailsForm);
  state.customer = Object.fromEntries(fd.entries());
  saveState();
  showStep(5);
});

/* Step 5: payment */
const summary = document.getElementById('summary');
const doneSummary = document.getElementById('doneSummary');
const payDeposit = document.getElementById('payDeposit');
const skipPay = document.getElementById('skipPay');
const downloadIcs = document.getElementById('downloadIcs');

let isSubmittingBooking = false;
let isSubmittingPayment = false;

function upsertBookingCache(booking) {
  const idx = bookingsCache.findIndex((b) => b.id === booking.id);
  if (idx >= 0) {
    bookingsCache[idx] = { ...bookingsCache[idx], ...booking };
  } else {
    bookingsCache = [booking, ...bookingsCache];
  }
}

function findBookingInCache(bookingId) {
  if (!bookingId) return null;
  return bookingsCache.find((b) => b.id === bookingId) || null;
}

function paymentStatusLabel(status) {
  if (status === 'paid') return 'Bezahlt';
  if (status === 'pending') return 'Ausstehend';
  if (status === 'failed') return 'Fehlgeschlagen';
  if (status === 'refunded') return 'Erstattet';
  return 'Unbezahlt';
}

async function notifyBooking(eventType, booking) {
  const result = await sendBookingNotification({
    eventType,
    booking,
    customer: booking.customer || {}
  });
  if (!result.ok) {
    throw new Error(result.message || 'Notification fehlgeschlagen');
  }
  return result;
}

async function createBookingRecord({ depositPaid }) {
  const service = services.find(s => s.id === state.serviceId);
  if (!service) {
    alert('Bitte zuerst einen Service auswählen.');
    return null;
  }
  const bookingPayload = {
    status: 'requested',
    serviceId: service.id,
    serviceName: service.name,
    durationMin: service.durationMin,
    priceFrom: service.priceFrom,
    deposit: service.deposit,
    stylistId: state.stylistId,
    stylistName: stylists.find(x=>x.id===state.stylistId)?.name || 'Auto',
    dateISO: state.dateISO,
    time: state.time,
    customer: state.customer,
    depositPaid: Boolean(depositPaid),
    paymentStatus: depositPaid ? 'paid' : 'unpaid',
    paymentProvider: depositPaid ? 'manual' : null
  };

  let booking = null;
  if (isGuestBooking){
    booking = {
      ...bookingPayload,
      id: guestId('book'),
      createdAt: new Date().toISOString(),
      paymentStatus: depositPaid ? 'paid' : 'unpaid',
      paymentProvider: depositPaid ? 'manual' : null
    };
    upsertBookingCache(booking);
    saveGuestBookings();
  } else {
    try {
      booking = await createMyBooking(bookingPayload, currentUser.id);
      upsertBookingCache(booking);
    } catch (error) {
      if (String(error.message || '').includes('SLOT_UNAVAILABLE')) {
        alert('❌ Dieser Slot wurde gerade vergeben. Bitte wähle eine neue Uhrzeit.');
        renderSlots();
        return;
      }
      alert(`❌ Buchung konnte nicht gespeichert werden: ${error.message}`);
      return;
    }
  }

  state.lastBookingId = booking.id;
  saveState();
  if (!isGuestBooking) {
    try {
      await notifyBooking('booking_requested', booking);
    } catch (_error) {
      // Notification errors should not block booking creation.
    }
  }
  return booking;
}

async function toDone(booking) {
  state.lastBookingId = booking.id;
  state.pendingPaymentBookingId = null;
  saveState();
  renderDone(booking);
  showStep('done');
}

function renderSummary(){
  const service = services.find(s => s.id === state.serviceId);
  if (!service) return;
  summary.innerHTML = `
    <div class="row"><strong>Service</strong><div>${service.name}</div></div>
    <div class="row"><strong>Dauer</strong><div>${formatMinutes(service.durationMin)}</div></div>
    <div class="row"><strong>Datum</strong><div>${fmtDate(state.dateISO)} · ${state.time}</div></div>
    <div class="row"><strong>Stylist</strong><div>${stylists.find(s=>s.id===state.stylistId)?.name || 'Auto'}</div></div>
    <div class="divider"></div>
    <div class="row"><strong>Anzahlung</strong><div>${currency(service.deposit)}</div></div>
    <div class="row"><strong>Restzahlung</strong><div>im Salon</div></div>
  `;
}

payDeposit.addEventListener('click', async () => {
  if (isSubmittingPayment) return;
  if (isGuestBooking) {
    alert('Online-Anzahlung ist aktuell nur mit Login verfügbar. Du kannst als Gast ohne Online-Zahlung anfragen.');
    return;
  }

  isSubmittingPayment = true;
  payDeposit.disabled = true;

  try {
    let booking = findBookingInCache(state.pendingPaymentBookingId);
    if (!booking) {
      booking = await createBookingRecord({ depositPaid: false });
      if (!booking) return;
      state.pendingPaymentBookingId = booking.id;
      saveState();
    }

    const origin = `${window.location.origin}${window.location.pathname}`;
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
  } finally {
    payDeposit.disabled = false;
    isSubmittingPayment = false;
  }
});

skipPay.addEventListener('click', async () => {
  if (isSubmittingBooking) return;
  isSubmittingBooking = true;
  skipPay.disabled = true;

  try {
    let booking = findBookingInCache(state.pendingPaymentBookingId);
    if (!booking) {
      booking = await createBookingRecord({ depositPaid: false });
      if (!booking) return;
    }
    await toDone(booking);
  } finally {
    skipPay.disabled = false;
    isSubmittingBooking = false;
  }
});

function renderDone(booking){
  const paymentLabel = paymentStatusLabel(booking.paymentStatus || (booking.depositPaid ? 'paid' : 'unpaid'));
  const canStartPayment = !isGuestBooking && !booking.depositPaid && booking.status !== 'canceled';
  doneSummary.innerHTML = `
    <div class="row"><strong>Service</strong><div>${booking.serviceName}</div></div>
    <div class="row"><strong>Datum</strong><div>${fmtDate(booking.dateISO)} · ${booking.time}</div></div>
    <div class="row"><strong>Name</strong><div>${booking.customer.firstName} ${booking.customer.lastName}</div></div>
    <div class="row"><strong>Status</strong><div>Angefragt</div></div>
    <div class="row"><strong>Anzahlung</strong><div>${currency(booking.deposit || 0)} · ${paymentLabel}</div></div>
    ${isGuestBooking ? '<div class="row"><strong>Modus</strong><div>Gastbuchung</div></div>' : '<div class="row"><strong>Modus</strong><div>Konto-Buchung</div></div>'}
    <div class="divider"></div>
    <div class="muted">Bestätigungstext:</div>
    <pre class="template">Hallo ${booking.customer.firstName}, wir haben deine Anfrage am ${fmtDate(booking.dateISO)} um ${booking.time} für ${booking.serviceName} erhalten. Wir bestätigen den Termin in Kürze. – Parrylicious Studio</pre>
    ${booking.paymentReceiptUrl ? `<a class="link" href="${booking.paymentReceiptUrl}" target="_blank" rel="noreferrer">Stripe-Zahlungsbeleg öffnen</a>` : ''}
    ${canStartPayment ? `<button class="btn small" id="payExistingBooking">Anzahlung jetzt zahlen</button>` : ''}
  `;

  const payExistingBtn = document.getElementById('payExistingBooking');
  payExistingBtn?.addEventListener('click', async () => {
    const origin = `${window.location.origin}${window.location.pathname}`;
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
  });
}

downloadIcs.addEventListener('click', () => {
  const list = getBookings();
  const b = list.find(x => x.id === state.lastBookingId);
  if (!b) return alert('Keine Buchung gefunden.');
  const dtStart = new Date(`${b.dateISO}T${b.time}:00`);
  const dtEnd = new Date(dtStart.getTime() + b.durationMin*60000);

  const pad = n => String(n).padStart(2,'0');
  const toICS = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Parrylicious//Booking//DE',
    'BEGIN:VEVENT',
    `UID:${b.id}@parrylicious.store`,
    `DTSTAMP:${toICS(new Date())}`,
    `DTSTART:${toICS(dtStart)}`,
    `DTEND:${toICS(dtEnd)}`,
    `SUMMARY:${b.serviceName} – Parrylicious Studio`,
    'LOCATION:Bahlenstraße 42, 40589 Düsseldorf',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const blob = new Blob([ics], { type:'text/calendar;charset=utf-8' });
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

async function refreshBookingById(bookingId) {
  if (!bookingId || isGuestBooking) return null;
  try {
    const booking = await getMyBookingById(bookingId);
    if (!booking) return null;
    upsertBookingCache(booking);
    return booking;
  } catch (_error) {
    return null;
  }
}

async function handlePaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const paymentState = params.get('payment');
  if (!paymentState) return false;

  if (isGuestBooking) {
    clearPaymentParamsFromUrl();
    alert('Bitte einloggen, um den Zahlungsstatus deiner Buchung zu prüfen.');
    return true;
  }

  if (paymentState === 'cancel') {
    clearPaymentParamsFromUrl();
    alert('Zahlung abgebrochen. Du kannst die Anzahlung jetzt erneut starten oder ohne Online-Zahlung fortfahren.');
    showStep(5);
    return true;
  }

  if (paymentState === 'success') {
    const sessionId = params.get('session_id');
    if (!sessionId) {
      clearPaymentParamsFromUrl();
      alert('Zahlung wurde zurückgeleitet, aber es fehlt eine Session-ID.');
      showStep(5);
      return true;
    }

    const verification = await verifyCheckoutSession(sessionId);
    if (!verification.ok) {
      clearPaymentParamsFromUrl();
      alert(`Zahlung konnte nicht verifiziert werden: ${verification.message || 'Unbekannter Fehler'}`);
      showStep(5);
      return true;
    }

    const bookingId = verification.booking_id || params.get('booking_id') || state.pendingPaymentBookingId || state.lastBookingId;
    let booking = await refreshBookingById(bookingId);
    if (!booking) booking = findBookingInCache(bookingId);

    if (booking) {
      const verifiedStatus = verification.booking_payment_status || (verification.paid ? 'paid' : 'pending');
      booking.depositPaid = Boolean(verification.paid || verifiedStatus === 'paid');
      booking.paymentStatus = verifiedStatus;
      booking.paymentReceiptUrl = verification.payment_receipt_url || booking.paymentReceiptUrl || null;
      upsertBookingCache(booking);
      await toDone(booking);
    } else {
      alert('Zahlung verifiziert, aber die Buchung konnte lokal nicht geladen werden. Bitte Dashboard öffnen.');
      showStep(5);
    }

    clearPaymentParamsFromUrl();
    return true;
  }

  return false;
}

/* init */
async function boot(){
  if (!isAuthConfigured) {
    isGuestBooking = true;
    bookingsCache = storage.get(GUEST_BOOKINGS_KEY, []);
    waitlistCache = storage.get(GUEST_WAITLIST_KEY, []);
    syncBookingModeHint();
    const handledPayment = await handlePaymentReturn();
    if (!handledPayment) showStep(state.step || 1);
    return;
  }
  try {
    currentUser = await getCurrentUser();
    if (currentUser) {
      isGuestBooking = false;
      bookingsCache = await getMyBookings();
      waitlistCache = await getMyWaitlist();
      profileCache = await getMyProfile();
      applyProfileDefaultsToCustomer();
      applyCustomerDraftToForm();
    } else {
      isGuestBooking = true;
      bookingsCache = storage.get(GUEST_BOOKINGS_KEY, []);
      waitlistCache = storage.get(GUEST_WAITLIST_KEY, []);
    }
    syncBookingModeHint();
    const handledPayment = await handlePaymentReturn();
    if (!handledPayment) showStep(state.step || 1);
  } catch (error) {
    isGuestBooking = true;
    bookingsCache = storage.get(GUEST_BOOKINGS_KEY, []);
    waitlistCache = storage.get(GUEST_WAITLIST_KEY, []);
    syncBookingModeHint();
    alert(`Hinweis: Konto konnte nicht geladen werden, Gastmodus aktiv. (${error.message})`);
    showStep(state.step || 1);
  }
}

boot();
