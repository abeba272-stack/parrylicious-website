/*
 * TEMPORÄR — Demo-/Test-Hinweisbanner.
 * Warnt Besucher:innen, dass dies noch eine Testversion ist (Kalender nicht
 * synchronisiert, Zahlungen werden nicht bearbeitet) — damit keine echten
 * Buchungen entstehen.
 *
 * ENTFERNEN vor der Live-Übergabe:
 *   1) <script src="demo-banner.js"></script> aus index.html und booking.html löschen
 *   2) diese Datei löschen
 *
 * Der Banner liegt fixiert ganz oben; die (fixed/sticky) Topbar wird passend
 * nach unten versetzt, damit nichts überlagert wird.
 */
(function () {
  if (typeof document === 'undefined') return;

  function mount() {
    if (document.getElementById('demoBanner')) return;

    var bar = document.createElement('div');
    bar.id = 'demoBanner';
    bar.setAttribute('role', 'alert');
    bar.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:100000',
      'background:#e7c98a', 'color:#1a1205',
      "font:600 13.5px/1.45 Inter,system-ui,-apple-system,sans-serif",
      'text-align:center', 'padding:10px 16px',
      'box-shadow:0 2px 10px rgba(0,0,0,.35)'
    ].join(';');
    bar.innerHTML = '⚠️ Demo-/Testversion – bitte <strong>keine echten Buchungen</strong>. '
      + 'Termine sind noch nicht mit dem Salon-Kalender abgeglichen, und Zahlungen werden '
      + 'nicht bearbeitet (bereits geleistete Anzahlungen werden erstattet).';
    document.body.appendChild(bar);

    function apply() {
      var h = bar.offsetHeight || 44;
      document.body.style.paddingTop = h + 'px';
      var tb = document.querySelector('.topbar');
      if (tb) {
        var pos = window.getComputedStyle(tb).position;
        if (pos === 'fixed' || pos === 'sticky') tb.style.top = h + 'px';
      }
    }
    // Mehrfach anwenden, damit die Höhe erst nach vollständigem Layout + Font-Load
    // gemessen wird (eine einzelne Sofortmessung kann zu früh/falsch sein).
    apply();
    if (window.requestAnimationFrame) {
      requestAnimationFrame(function () { requestAnimationFrame(apply); });
    }
    window.addEventListener('load', apply);
    window.addEventListener('resize', apply);
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(apply);
    }
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
