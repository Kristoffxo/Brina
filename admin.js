/* ============================================================
   Brina — the listener's console.

   No accounts. One passphrase, chosen the first time this page
   is opened, checked against a hash in the database. A successful
   sign-in returns a session token that expires after twelve hours.

   Like the visitor's side, this page never touches a table
   directly — every call is a function that checks the token.
   ============================================================ */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

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

const KEY = 'brina.listener';

const supabase = cfg.ready ? createClient(cfg.url, cfg.anonKey, {
  auth: { persistSession: false }
}) : null;

let token   = null;
let claimed = true;
let open    = null;
let lastId  = 0;
let seen    = new Set();
let timer   = null;

/* ---- Boot ------------------------------------------------- */

if (!supabase) {
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
    const { data } = await supabase.rpc('listener_conversations', { p_token: token });
    if (data) { enterConsole(); return; }
    localStorage.removeItem(KEY);
    token = null;
  }

  const { data: isClaimed, error } = await supabase.rpc('listener_claimed');

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

  const { data, error } = await supabase.rpc(
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
  supabase.rpc('purge_stale', { p_token: token });
  loadPresence();
  await refresh();
  timer = setInterval(refresh, 3000);
}

function signedOut() {
  clearInterval(timer);
  localStorage.removeItem(KEY);
  location.reload();
}

document.getElementById('signout-btn').addEventListener('click', async function () {
  await supabase.rpc('listener_signout', { p_token: token });
  signedOut();
});

/* ---- Availability ----------------------------------------- */

async function loadPresence() {
  const { data } = await supabase.rpc('listener_get_presence', { p_token: token });
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
  await supabase.rpc('listener_set_presence', {
    p_token: token,
    p_available: toggle.checked,
    p_note: noteInput.value.trim() || null
  });
}

toggle.addEventListener('change', savePresence);
noteInput.addEventListener('change', savePresence);

/* ---- The list --------------------------------------------- */

function ago(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

async function refresh() {
  const { data, error } = await supabase.rpc('listener_conversations', { p_token: token });

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
      '<span class="convo-id">' + c.conv_id.slice(0, 8) +
        (c.waiting ? ' <span class="waiting-dot" title="waiting on you"></span>' : '') +
      '</span>' +
      '<span class="convo-meta">' + ago(c.last_at) +
        ' · ' + c.message_count + (c.message_count === 1 ? ' message' : ' messages') +
        (c.visitor_here ? ' · <span class="here">here now</span>' : '') +
      '</span>';

    btn.addEventListener('click', function () { openThread(c.conv_id); });
    li.appendChild(btn);
    list.appendChild(li);
  }

  if (open && !rows.some(function (r) { return r.conv_id === open; })) {
    closeThread('That conversation is gone — the other person ended it.');
    return;
  }

  if (open) await pull();
}

/* ---- One conversation ------------------------------------- */

async function openThread(id) {
  open = id;
  lastId = 0;
  seen = new Set();
  thread.innerHTML = '';
  emptyState.hidden = true;
  threadWrap.hidden = false;
  openId.textContent = id.slice(0, 8);
  await pull();
  reply.focus();
}

async function pull() {
  const { data, error } = await supabase.rpc('listener_messages', {
    p_token: token,
    p_conversation: open,
    p_after: lastId
  });

  if (error) {
    if (/session expired/i.test(error.message || '')) signedOut();
    return;
  }

  for (const m of (data || [])) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    lastId = Math.max(lastId, m.id);

    const el = document.createElement('div');
    el.className = 'bubble bubble-' + m.sender;
    const p = document.createElement('p');
    p.textContent = m.body;
    el.appendChild(p);
    thread.appendChild(el);
  }

  if (data && data.length) thread.scrollTop = thread.scrollHeight;
  openMeta.textContent = seen.size + (seen.size === 1 ? ' message' : ' messages');
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

  const { error } = await supabase.rpc('listener_send', {
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

  await supabase.rpc('listener_delete', { p_token: token, p_conversation: open });
  closeThread('Deleted.');
  await refresh();
});

function closeThread(message) {
  open = null;
  threadWrap.hidden = true;
  emptyState.hidden = false;
  emptyState.querySelector('p').textContent = message;
}
