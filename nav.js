/*
 * nav.js — Mobile-Hamburger für die gemeinsame Topbar-Navigation.
 * Fügt den Toggle-Button per JS ein (kein HTML-Umbau je Seite nötig) und
 * klappt die vorhandene .nav auf/zu. Auf Desktop ist der Button per CSS aus.
 */
(function () {
  const container = document.querySelector('.topbar .container');
  const nav = container && container.querySelector('.nav');
  if (!nav) return;

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

  // Nach Klick auf einen Menüpunkt schließen.
  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });

  // Beim Wechsel auf Desktop-Breite zurücksetzen.
  window.matchMedia('(min-width: 901px)').addEventListener('change', (e) => {
    if (e.matches) setOpen(false);
  });
})();
