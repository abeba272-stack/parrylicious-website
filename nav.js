/*
 * nav.js — Mobile-Hamburger für die gemeinsame Topbar-Navigation +
 * rollenabhängiger Konto-/Anmelden-Link. Auf internen Seiten (Login/Admin/Konto)
 * wird der Konto-Link ausgelassen.
 */
import { getCurrentUser } from './auth-client.js';

(function () {
  const container = document.querySelector('.topbar .container');
  const nav = container && container.querySelector('.nav');
  if (!nav) return;

  // --- Hamburger ---
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-toggle';
  btn.setAttribute('aria-label', 'Menü öffnen');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<span></span><span></span><span></span>';
  nav.parentNode.insertBefore(btn, nav);

  function setOpen(open) {
    nav.classList.toggle('open', open);
    btn.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
  }
  btn.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
  nav.addEventListener('click', (event) => { if (event.target.closest('a')) setOpen(false); });
  window.matchMedia('(min-width: 901px)').addEventListener('change', (e) => { if (e.matches) setOpen(false); });

  // --- Konto-/Anmelden-Link (nicht auf internen Seiten) ---
  const path = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (['login.html', 'admin.html', 'konto.html'].includes(path)) return;

  (async () => {
    let user = null;
    try { user = await getCurrentUser(); } catch (_error) { /* nicht eingeloggt */ }
    const a = document.createElement('a');
    if (user && (user.role === 'staff' || user.role === 'admin')) { a.href = 'admin.html'; a.textContent = 'Dashboard'; }
    else if (user) { a.href = 'konto.html'; a.textContent = 'Mein Konto'; }
    else { a.href = 'login.html'; a.textContent = 'Anmelden'; }
    const firstBtn = nav.querySelector('.btn');
    if (firstBtn) nav.insertBefore(a, firstBtn); else nav.appendChild(a);
  })();
})();
