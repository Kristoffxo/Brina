/* ============================================================
   Brina — the About drawer.

   The chat is the whole first screen, so everything explanatory
   lives behind the menu button. Opening it traps focus and locks
   the page behind it; Escape and the backdrop both close it.
   ============================================================ */

(function () {
  'use strict';

  var btn      = document.getElementById('menu-btn');
  var drawer   = document.getElementById('drawer');
  var backdrop = document.getElementById('drawer-backdrop');
  var closeBtn = document.getElementById('drawer-close');

  if (!btn || !drawer || !backdrop) return;

  var lastFocused = null;

  function focusable() {
    return drawer.querySelectorAll(
      'a[href], button:not([disabled]), summary, textarea, input, select, [tabindex]:not([tabindex="-1"])'
    );
  }

  function open() {
    lastFocused = document.activeElement;

    drawer.hidden = false;
    backdrop.hidden = false;

    // Force a synchronous reflow so the transition has a start point to
    // animate from. requestAnimationFrame would be tidier but is throttled
    // in background or non-compositing tabs, which would leave the drawer
    // unhidden but still translated off-screen — open, and invisible.
    void drawer.offsetWidth;

    document.body.classList.add('drawer-open');
    btn.setAttribute('aria-expanded', 'true');

    if (closeBtn) closeBtn.focus();
  }

  function close() {
    document.body.classList.remove('drawer-open');
    btn.setAttribute('aria-expanded', 'false');

    var settled = false;
    var timer = null;

    var done = function () {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      drawer.removeEventListener('transitionend', done);
      drawer.hidden = true;
      backdrop.hidden = true;
    };

    // If motion is switched off there is no transition to wait for.
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      done();
    } else {
      drawer.addEventListener('transitionend', done);
      // transitionend does not fire in throttled or non-compositing tabs,
      // which would strand the drawer visible but closed. Always settle.
      timer = setTimeout(done, 400);
    }

    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  btn.addEventListener('click', function () {
    document.body.classList.contains('drawer-open') ? close() : open();
  });

  if (closeBtn) closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);

  document.addEventListener('keydown', function (e) {
    if (!document.body.classList.contains('drawer-open')) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }

    // Keep tabbing inside the drawer while it is open.
    if (e.key === 'Tab') {
      var items = focusable();
      if (!items.length) return;

      var first = items[0];
      var last = items[items.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
}());
