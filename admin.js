/* ============================================================
   Brina — the listener's console.

   No accounts. One passphrase, chosen the first time this page
   is opened, checked against a hash in the database. A successful
   sign-in returns a session token that expires after twelve hours.

   Like the visitor's side, this page never touches a table
   directly — every call is a function that checks the token.
   ============================================================ */

const cfg = window.BRINA_CONFIG || {};

const signinView  = document.getElementById('signin');
const consoleView = document.getElementById('console');
const signinForm  = document.getElementById('signin-form');
const signinTitle = document.getElementById('signin-title');
const signinError = document.getElementById('signin-error');
const signinBtn   = document.getElementById('signin-btn');
const claimNote   = document.getElementById('claim-note');
const passLabel   = document.getElementById('passphrase-label');
const passInput   = document.getElementById('passphrase');
const warning     = document.getElementById('config-warning');

const list        = document.getElementById('convo-list');
const count       = document.getElementById('count');
const emptyState  = document.getElementById('console-empty');
const threadWrap  = document.getElementById('thread-wrap');
const thread      = document.getElementById('thread');
const openId      = document.getElementById('open-id');
const openMeta    = document.getElementById('open-meta');
const composer    = document.getElementById('composer');
const reply       = document.getElementById('reply');
const replyBtn    = document.getElementById('reply-btn');
const deleteBtn   = document.getElementById('delete-btn');
const toggle      = document.getElementById('available-toggle');
const toggleLabel = document.getElementById('available-label');
const noteInput   = document.getElementById('availability-note');
const whoami      = document.getElementById('whoami');
const volPanel    = document.getElementById('volunteers');
const volList     = document.getElementById('volunteer-list');

const KEY = 'brina.listener';

const client = cfg.ready ? window.supabase.createClient(cfg.url, cfg.anonKey, {
  auth: { persistSession: false }
}) : null;

let token   = null;
let claimed = true;
let open    = null;
let timer   = null;
let openRow = null;      // the list row for the open conversation
let me      = null;      // { label, display_name, is_admin }
const rendered = new Map(); // message id -> { el, readAt }

/* ---- Boot ------------------------------------------------- */

if (!client) {
  signinView.hidden = false;
  warning.hidden = false;
  signinBtn.disabled = true;
} else {
  boot();
}

async function boot() {
  const saved = localStorage.getItem(KEY);

  if (saved) {
    token = saved;
    const { data } = await client.rpc('listener_conversations', { p_token: token });
    if (data) { enterConsole(); return; }
    localStorage.removeItem(KEY);
    token = null;
  }

  const { data: isClaimed, error } = await client.rpc('listener_claimed');

  if (error) {
    signinView.hidden = false;
    fail('Cannot reach the database. Has schema.sql been run yet?');
    return;
  }

  claimed = isClaimed === true;

  if (!claimed) {
    signinTitle.textContent = 'Set a passphrase';
    claimNote.hidden = false;
    passLabel.textContent = 'Choose a passphrase';
    passInput.setAttribute('autocomplete', 'new-password');
    signinBtn.textContent = 'Claim this console';
  }

  signinView.hidden = false;
  passInput.focus();
}

function fail(message) {
  signinError.textContent = message;
  signinError.hidden = false;
}

signinForm.addEventListener('submit', async function (e) {
  e.preventDefault();
  signinError.hidden = true;
  signinBtn.disabled = true;

  const phrase = passInput.value;

  if (!claimed && phrase.length < 10) {
    signinBtn.disabled = false;
    fail('Ten characters or more, please. This is the only lock on the conversations.');
    return;
  }

  const { data, error } = await client.rpc(
    claimed ? 'listener_login' : 'listener_claim',
    { p_passphrase: phrase }
  );

  signinBtn.disabled = false;

  if (error) {
    const m = error.message || '';
    if (/too many attempts/i.test(m))   return fail('Too many wrong tries. Wait fifteen minutes.');
    if (/wrong passphrase/i.test(m))    return fail('That is not the passphrase.');
    if (/already claimed/i.test(m))     return fail('This console already has a passphrase. Reload the page.');
    if (/too short/i.test(m))           return fail('Ten characters or more, please.');
    return fail(m);
  }

  token = data;
  localStorage.setItem(KEY, token);
  passInput.value = '';
  enterConsole();
});

// Same reason as the visitor side: background tabs throttle timers.
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible' && token) refresh();
});

async function enterConsole() {
  signinView.hidden = true;
  consoleView.hidden = false;

  await loadMe();
  loadPresence();
  await refresh();
  timer = setInterval(refresh, 3000);
}

/* ---- Who is signed in ------------------------------------- */

async function loadMe() {
  const { data, error } = await client.rpc('listener_me', { p_token: token });
  if (error) {
    // Pre-migration database: the console still works, there is just
    // no per-person identity to show.
    if (/listener_me/.test(error.message || '')) return;
    if (/session expired/i.test(error.message || '')) signedOut();
    return;
  }

  me = Array.isArray(data) ? data[0] : data;
  if (!me) return;

  whoami.textContent = me.display_name
    ? me.display_name + (me.is_admin ? ' · admin' : '')
    : me.label;
  whoami.hidden = false;

  // A volunteer who has not named themselves yet gets asked once.
  if (!me.display_name && !me.is_admin) {
    document.getElementById('name-backdrop').hidden = false;
    document.getElementById('name-modal').hidden = false;
    document.getElementById('name-input').focus();
  }

  if (me.is_admin) {
    volPanel.hidden = false;
    loadVolunteers();
    setInterval(loadVolunteers, 15000);
  }
}

document.getElementById('name-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const val = document.getElementById('name-input').value.trim();
  const err = document.getElementById('name-error');
  if (!val) return;

  const { error } = await client.rpc('listener_set_name', {
    p_token: token, p_name: val
  });

  if (error) {
    err.textContent = 'Could not save that. Try again.';
    err.hidden = false;
    return;
  }

  document.getElementById('name-backdrop').hidden = true;
  document.getElementById('name-modal').hidden = true;
  loadMe();
});

/* ---- Admin: who else is on ------------------------------- */

function agoShort(iso) {
  if (!iso) return 'never';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}

async function loadVolunteers() {
  if (!me || !me.is_admin) return;

  const { data, error } = await client.rpc('admin_listeners', { p_token: token });
  if (error || !data) return;

  volList.innerHTML = '';

  data.forEach(function (v) {
    const li = document.createElement('li');
    li.className = 'volunteer' + (v.signed_in_now ? ' volunteer-on' : '');

    const name = v.display_name || v.label;
    li.innerHTML =
      '<span class="volunteer-dot" aria-hidden="true"></span>' +
      '<span class="volunteer-body">' +
        '<span class="volunteer-name">' + esc(name) +
          (v.is_admin ? ' <span class="volunteer-tag">admin</span>' : '') +
          (!v.is_active ? ' <span class="volunteer-tag volunteer-tag-off">off</span>' : '') +
        '</span>' +
        '<span class="volunteer-meta">' +
          esc(v.label) + ' · ' +
          (v.signed_in_now ? 'signed in now' : 'last seen ' + agoShort(v.last_seen_at)) +
        '</span>' +
      '</span>';

    // Admins cannot be switched off from here — that is how you avoid
    // locking yourself out of your own console.
    if (!v.is_admin) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'volunteer-toggle';
      btn.textContent = v.is_active ? 'Disable' : 'Enable';
      btn.addEventListener('click', async function () {
        if (v.is_active && !confirm('Sign ' + name + ' out and block their passcode?')) return;
        await client.rpc('admin_set_active', {
          p_token: token, p_account: v.account_id, p_active: !v.is_active
        });
        loadVolunteers();
      });
      li.appendChild(btn);
    }

    volList.appendChild(li);
  });
}

function signedOut() {
  clearInterval(timer);
  localStorage.removeItem(KEY);
  location.reload();
}

document.getElementById('signout-btn').addEventListener('click', async function () {
  await client.rpc('listener_signout', { p_token: token });
  signedOut();
});

/* ---- Availability ----------------------------------------- */

async function loadPresence() {
  const { data } = await client.rpc('listener_get_presence', { p_token: token });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return;
  toggle.checked = row.is_available;
  noteInput.value = row.note || '';
  paintToggle();
}

function paintToggle() {
  toggleLabel.textContent = toggle.checked ? 'Available now' : 'Not available';
}

async function savePresence() {
  paintToggle();
  await client.rpc('listener_set_presence', {
    p_token: token,
    p_available: toggle.checked,
    p_note: noteInput.value.trim() || null
  });
}

toggle.addEventListener('change', savePresence);
noteInput.addEventListener('change', savePresence);

/* ---- The list --------------------------------------------- */

function esc(str) {
  return String(str).replace(/[&<>"']/g, function (ch) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
  });
}

// What to call this person in the console. The chosen name if they
// gave one, otherwise the short id — never nothing.
function whoHTML(c, size) {
  const avatar = window.BRINA_MOODS
    ? window.BRINA_MOODS.svg(c.mood, size || 26)
    : '';
  const moodLabel = window.BRINA_MOODS ? window.BRINA_MOODS.label(c.mood) : null;
  const name = c.display_name ? esc(c.display_name) : c.conv_id.slice(0, 8);

  return '<span class="who">' + avatar +
         '<span class="who-text">' +
           '<span class="who-name">' + name + '</span>' +
           (moodLabel ? '<span class="who-mood">' + moodLabel + '</span>' : '') +
         '</span></span>';
}


function ago(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

async function refresh() {
  const { data, error } = await client.rpc('listener_conversations', { p_token: token });

  if (error) {
    if (/session expired/i.test(error.message || '')) signedOut();
    return;
  }

  const rows = data || [];
  const waiting = rows.filter(function (r) { return r.waiting; }).length;

  count.textContent = rows.length
    ? rows.length + (rows.length === 1 ? ' conversation' : ' conversations') +
      (waiting ? ' · ' + waiting + ' waiting on you' : '')
    : 'No conversations yet';

  document.title = (waiting ? '(' + waiting + ') ' : '') + 'Brina — listening';

  list.innerHTML = '';

  for (const c of rows) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'convo' + (open === c.conv_id ? ' convo-open' : '');

    btn.innerHTML =
      '<span class="convo-id">' + whoHTML(c, 26) +
        (c.waiting ? ' <span class="waiting-dot" title="waiting on you"></span>' : '') +
      '</span>' +
      '<span class="convo-meta">' + ago(c.last_at) +
        ' · ' + c.message_count + (c.message_count === 1 ? ' message' : ' messages') +
        (c.visitor_here ? ' · <span class="here">here now</span>' : '') +
      '</span>';

    btn.addEventListener('click', function () { openThread(c.conv_id, c); });
    li.appendChild(btn);
    list.appendChild(li);
  }

  // Refresh the header identity in case the mood or name is only now
  // arriving (the row is created before the first message lands).
  const current = rows.find(function (r) { return r.conv_id === open; });
  if (current) {
    openRow = current;
    openId.innerHTML = whoHTML(current, 30);
  }

  if (open && !rows.some(function (r) { return r.conv_id === open; })) {
    closeThread('That conversation is gone — the other person ended it.');
    return;
  }

  if (open) await pull();
}

/* ---- One conversation ------------------------------------- */

async function openThread(id, row) {
  open = id;
  rendered.clear();
  thread.innerHTML = '';
  emptyState.hidden = true;
  threadWrap.hidden = false;

  // Keep the row so the header can show who this is even before the
  // next list refresh lands.
  if (row) openRow = row;
  openId.innerHTML = openRow ? whoHTML(openRow, 30) : esc(id.slice(0, 8));

  await pull();
  reply.focus();
}

function tickHTML(readAt) {
  return readAt
    ? '<span class="tick tick-read" aria-label="Read" title="Read">' +
        '<svg viewBox="0 0 20 12" aria-hidden="true"><path d="M1 6.5 5 10.5 12 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 6.5 11 10.5 19 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</span>'
    : '<span class="tick tick-sent" aria-label="Sent" title="Sent">' +
        '<svg viewBox="0 0 14 12" aria-hidden="true"><path d="M1 6.5 5 10.5 13 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</span>';
}

async function pull() {
  const { data, error } = await client.rpc('listener_messages', {
    p_token: token,
    p_conversation: open
  });

  if (error) {
    if (/session expired/i.test(error.message || '')) signedOut();
    return;
  }

  const rows = data || [];
  let appended = false;

  for (const m of rows) {
    const existing = rendered.get(m.id);

    if (!existing) {
      const el = document.createElement('div');
      el.className = 'bubble bubble-' + m.sender;
      el.dataset.mid = m.id;

      const p = document.createElement('p');
      p.textContent = m.body;
      el.appendChild(p);

      if (m.sender === 'listener') {
        const meta = document.createElement('span');
        meta.className = 'bubble-meta';
        meta.innerHTML = tickHTML(m.read_at);
        el.appendChild(meta);
      }

      thread.appendChild(el);
      rendered.set(m.id, { el: el, readAt: m.read_at });
      appended = true;
      continue;
    }

    if (m.sender === 'listener' && m.read_at && !existing.readAt) {
      const meta = existing.el.querySelector('.bubble-meta');
      if (meta) meta.innerHTML = tickHTML(m.read_at);
      existing.readAt = m.read_at;
    }
  }

  if (appended) thread.scrollTop = thread.scrollHeight;
  openMeta.textContent = rendered.size + (rendered.size === 1 ? ' message' : ' messages');
}

composer.addEventListener('submit', async function (e) {
  e.preventDefault();
  await send();
});

reply.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

reply.addEventListener('input', function () {
  reply.style.height = 'auto';
  reply.style.height = Math.min(reply.scrollHeight, 200) + 'px';
});

async function send() {
  const body = reply.value.trim();
  if (!body || !open) return;

  replyBtn.disabled = true;

  const { error } = await client.rpc('listener_send', {
    p_token: token,
    p_conversation: open,
    p_body: body
  });

  if (!error) {
    reply.value = '';
    reply.style.height = 'auto';
    await pull();
  } else if (/session expired/i.test(error.message || '')) {
    signedOut();
  }

  replyBtn.disabled = false;
  reply.focus();
}

deleteBtn.addEventListener('click', async function () {
  if (!open) return;
  if (!confirm('Delete this conversation for good? The other person loses it too.')) return;

  await client.rpc('listener_delete', { p_token: token, p_conversation: open });
  closeThread('Deleted.');
  await refresh();
});

function closeThread(message) {
  open = null;
  openRow = null;
  threadWrap.hidden = true;
  emptyState.hidden = false;
  emptyState.querySelector('p').textContent = message;
}
