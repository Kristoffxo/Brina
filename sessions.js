/* ============================================================
   Brina 2.0 — paid phone sessions.

   Two things happen on this page:

   1. The urgent path. One button, one confirmation, and a real
      dial to 14416. Nothing is dialled until the person taps
      "Yes, call them" — the confirmation exists so that someone
      who tapped out of curiosity, or by accident, has a way back
      that doesn't feel like a mistake.

   2. The booking path. Open slots come from the database, never
      from this file, and the 30-minute lead time is enforced in
      SQL as well as here. A client-side check is a courtesy; the
      server's is the one that counts.
   ============================================================ */

(function () {
  'use strict';

  var cfg = window.BRINA_CONFIG || {};

  var client = cfg.ready
    ? window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } })
    : null;

  var calendar   = document.getElementById('calendar');
  var slotsNote  = document.getElementById('slots-note');
  var warning    = document.getElementById('config-warning');

  var lastBooking = null;   // { id, token, startsAt }
  var pendingSlot = null;

  /* ---- Modal plumbing -------------------------------------- */

  function openModal(name) {
    document.getElementById(name + '-backdrop').hidden = false;
    document.getElementById(name + '-modal').hidden = false;
    document.body.classList.add('modal-open');
  }

  function closeModal(name) {
    document.getElementById(name + '-backdrop').hidden = true;
    document.getElementById(name + '-modal').hidden = true;
    document.body.classList.remove('modal-open');
  }

  /* ---- Urgent ---------------------------------------------- */

  document.getElementById('urgent-btn').addEventListener('click', function () {
    openModal('urgent');
  });

  document.getElementById('urgent-cancel').addEventListener('click', function () {
    closeModal('urgent');
  });

  document.getElementById('urgent-backdrop').addEventListener('click', function () {
    closeModal('urgent');
  });

  // The dial itself is a plain tel: link, so the phone's own confirm
  // sheet is the last step. Close ours behind it so returning from
  // the call doesn't land back on a dialog.
  document.getElementById('urgent-call').addEventListener('click', function () {
    setTimeout(function () { closeModal('urgent'); }, 400);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    ['urgent', 'book', 'done'].forEach(function (n) {
      if (!document.getElementById(n + '-modal').hidden) closeModal(n);
    });
  });

  /* ---- Slots ----------------------------------------------- */

  function fmtTime(d) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function fmtDayLabel(d) {
    var today = new Date();
    var tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    function sameDay(a, b) {
      return a.getFullYear() === b.getFullYear() &&
             a.getMonth() === b.getMonth() &&
             a.getDate() === b.getDate();
    }

    if (sameDay(d, today)) return 'Today';
    if (sameDay(d, tomorrow)) return 'Tomorrow';
    return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function rupees(n) {
    return '₹' + Number(n).toLocaleString('en-IN');
  }

  async function loadSlots() {
    if (!client) {
      warning.hidden = false;
      slotsNote.textContent = 'Not connected.';
      return;
    }

    var res = await client.rpc('open_slots', { p_days: 14 });

    if (res.error) {
      slotsNote.textContent =
        /open_slots/.test(res.error.message || '')
          ? 'Sessions aren’t set up yet — run sessions-schema.sql.'
          : 'Could not load times. Try again in a moment.';
      return;
    }

    var rows = res.data || [];

    if (!rows.length) {
      slotsNote.textContent = 'No times open in the next two weeks.';
      return;
    }

    // Group by day so the calendar reads as days, not a flat list.
    var days = [];
    var byKey = {};

    rows.forEach(function (r) {
      var d = new Date(r.starts_at);
      var key = d.toDateString();
      if (!byKey[key]) {
        byKey[key] = { date: d, slots: [] };
        days.push(byKey[key]);
      }
      byKey[key].slots.push(r);
    });

    slotsNote.textContent =
      rows.length + (rows.length === 1 ? ' time open' : ' times open') +
      ' over the next two weeks.';

    calendar.innerHTML = '';

    days.forEach(function (day) {
      var col = document.createElement('div');
      col.className = 'cal-day';

      var head = document.createElement('p');
      head.className = 'cal-day-label';
      head.textContent = fmtDayLabel(day.date);
      col.appendChild(head);

      day.slots.forEach(function (s) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cal-slot';
        btn.innerHTML =
          '<span class="cal-time">' + fmtTime(new Date(s.starts_at)) + '</span>' +
          '<span class="cal-meta">' + s.duration_min + ' min · ' + rupees(s.price_inr) + '</span>' +
          '<span class="cal-who">' + escapeHTML(s.listener_name) +
            ' · <span class="cal-qual">' + escapeHTML(s.qualification) + '</span></span>';

        btn.addEventListener('click', function () {
          pendingSlot = s;
          document.getElementById('book-when').textContent =
            fmtDayLabel(new Date(s.starts_at)) + ', ' + fmtTime(new Date(s.starts_at)) +
            ' · ' + s.duration_min + ' minutes · ' + rupees(s.price_inr) +
            ' · with ' + s.listener_name;
          document.getElementById('book-error').hidden = true;
          openModal('book');
          document.getElementById('book-phone').focus();
        });

        col.appendChild(btn);
      });

      calendar.appendChild(col);
    });
  }

  // Listener names and qualifications are set by you, not by visitors,
  // but they still land in innerHTML — escape them anyway.
  function escapeHTML(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  /* ---- Booking --------------------------------------------- */

  document.getElementById('book-cancel').addEventListener('click', function () {
    closeModal('book');
  });

  document.getElementById('book-backdrop').addEventListener('click', function () {
    closeModal('book');
  });

  document.getElementById('book-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!pendingSlot || !client) return;

    var btn = document.getElementById('book-submit');
    var err = document.getElementById('book-error');
    btn.disabled = true;
    err.hidden = true;

    var res = await client.rpc('book_slot', {
      p_slot: pendingSlot.slot_id,
      p_phone: document.getElementById('book-phone').value,
      p_name: document.getElementById('book-name').value || null,
      p_note: document.getElementById('book-note').value || null
    });

    btn.disabled = false;

    if (res.error) {
      var m = res.error.message || '';
      err.textContent =
        /phone looks wrong/.test(m) ? 'That phone number doesn’t look right.' :
        /slot taken/.test(m)        ? 'Someone just took that time. Pick another.' :
        /too late/.test(m)          ? 'That’s too soon now — bookings need 30 minutes’ notice.' :
        'Could not book that. Try again.';
      err.hidden = false;
      if (/slot taken|too late/.test(m)) loadSlots();
      return;
    }

    var row = Array.isArray(res.data) ? res.data[0] : res.data;
    lastBooking = {
      id: row.booking_id,
      token: row.booking_token,
      startsAt: new Date(row.starts_at)
    };

    closeModal('book');
    document.getElementById('done-when').textContent =
      fmtDayLabel(lastBooking.startsAt) + ', ' + fmtTime(lastBooking.startsAt) +
      ' — we’ll call you then.';
    openModal('done');

    document.getElementById('book-form').reset();
    loadSlots();
  });

  /* ---- After booking --------------------------------------- */

  document.getElementById('done-close').addEventListener('click', function () {
    closeModal('done');
  });

  document.getElementById('done-cancel').addEventListener('click', async function () {
    if (!lastBooking || !client) return;
    if (!confirm('Cancel this call?')) return;

    await client.rpc('cancel_booking', {
      p_booking: lastBooking.id,
      p_token: lastBooking.token
    });

    lastBooking = null;
    closeModal('done');
    loadSlots();
  });

  /* ---- Theme toggle (same behaviour as the chat) ------------ */

  var themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var root = document.documentElement;
      var explicit = root.getAttribute('data-theme');
      var dark = explicit === 'dark' ||
                 (!explicit && window.matchMedia &&
                  window.matchMedia('(prefers-color-scheme: dark)').matches);
      var next = dark ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('brina.theme', next); } catch (e) {}
    });
  }

  loadSlots();
}());
