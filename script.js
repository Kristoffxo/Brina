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

/* ============================================================
   Availability pill.
   A single unauthenticated call to the listener_status function.
   Deliberately no Supabase library on this page — one POST does
   it, and the landing page stays free of third-party scripts.
   ============================================================ */

(function () {
  'use strict';

  var cfg  = window.BRINA_CONFIG || {};
  var pill = document.getElementById('status-pill');
  var text = document.getElementById('status-text');

  if (!pill || !text) return;

  if (!cfg.ready) {
    pill.hidden = true;
    return;
  }

  function paint(state, label) {
    pill.dataset.state = state;
    text.textContent = label;
  }

  function check() {
    fetch(cfg.url + '/rest/v1/rpc/listener_status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': cfg.anonKey,
        'Authorization': 'Bearer ' + cfg.anonKey
      },
      body: '{}'
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (rows) {
        var row = Array.isArray(rows) ? rows[0] : rows;
        if (!row) return paint('unknown', 'Write any time');

        if (row.is_available) {
          paint('on', row.note || 'Someone is here right now');
        } else {
          paint('off', row.note || 'Nobody is here right now — your message still gets read');
        }
      })
      .catch(function () {
        paint('unknown', 'Write any time — it gets read');
      });
  }

  check();
  setInterval(check, 60000);
}());
