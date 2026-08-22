/* ============================================================
   Brina — the only JavaScript on the page.
   Two jobs:
     1. Sync the service name from the header wordmark into the
        page title, meta description and footer, so renaming
        means editing exactly one span in index.html.
     2. Dismiss the persistent crisis bar. The dismissal lives in
        a variable in memory only — no cookie, no localStorage —
        so it comes back on the next visit, by design.
   ============================================================ */

(function () {
  'use strict';

  /* ---- 1. Service name ------------------------------------ */

  var brandNodes = document.querySelectorAll('[data-brand]');

  if (brandNodes.length) {
    var name = brandNodes[0].textContent.trim();

    for (var i = 1; i < brandNodes.length; i++) {
      brandNodes[i].textContent = name;
    }

    document.title = name + ' — a free, anonymous place to talk';

    var meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute(
        'content',
        name + ' is free, anonymous, text-only conversation for anyone who wants to ' +
        'talk to someone who won\'t judge them. Prayagraj, India. Adults only. ' +
        'Not therapy or crisis support.'
      );
    }
  }

  /* ---- 2. Crisis bar -------------------------------------- */

  var crisisBarDismissed = false;

  var bar = document.getElementById('crisis-bar');
  var closeBtn = document.getElementById('crisis-bar-close');

  if (bar && closeBtn) {
    closeBtn.addEventListener('click', function () {
      crisisBarDismissed = true;
      bar.hidden = true;
      document.body.classList.add('bar-dismissed');
    });
  }
}());
