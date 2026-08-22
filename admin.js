/* ============================================================
   Brina — the listener's console.

   Signed-in listeners read and write the tables directly; row
   level security checks their user id against public.listeners,
   so an account alone is not enough to get in.
   ============================================================ */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cfg = window.BRINA_CONFIG || {};

const signinView   = document.getElementById('signin');
const consoleView  = document.getElementById('console');
const signinForm   = document.getElementById('signin-form');
const signinError  = document.getElementById('signin-error');
const signinBtn    = document.getElementById('signin-btn');
const warning      = document.getElementById('config-warning');

const list         = document.getElementById('convo-list');
const count        = document.getElementById('count');
const emptyState   = document.getElementById('console-empty');
const threadWrap   = document.getElementById('thread-wrap');
const thread       = document.getElementById('thread');
const openId       = document.getElementById('open-id');
const openMeta     = document.getElementById('open-meta');
const composer     = document.getElementById('composer');
const reply        = document.getElementById('reply');
const replyBtn     = document.getElementById('reply-btn');
const deleteBtn    = document.getElementById('delete-btn');
const toggle       = document.getElementById('available-toggle');
const toggleLabel  = document.getElementById('available-label');
const noteInput    = document.getElementById('availability-note');

const supabase = cfg.ready
  ? createClient(cfg.url, cfg.anonKey)
  : null;

let openConversation = null;
let lastId = 0;
let timer = null;
let seenIds = new Set();

/* ---- Boot ------------------------------------------------- */

if (!supabase) {
  signinView.hidden = false;
  warning.hidden = false;
  signinBtn.disabled = true;
} else {
  supabase.auth.getSession().then(function (res) {
    if (res.data.session) enterConsole();
    else signinView.hidden = false;
  });
}

signinForm.addEventListener('submit', async function (e) {
  e.preventDefault();
  signinError.hidden = true;
  signinBtn.disabled = true;

  const { error } = await supabase.auth.signInWithPassword({
    email: document.getElementById('email').value.trim(),
    password: document.getElementById('password').value
  });

  signinBtn.disabled = false;

  if (error) {
    signinError.textContent = error.message;
    signinError.hidden = false;
    return;
  }

  enterConsole();
});

document.getElementById('signout-btn').addEventListener('click', async function () {
  clearInterval(timer);
  await supabase.auth.signOut();
  location.reload();
});

async function enterConsole() {
  // Confirm this account is actually on the listener list. Without a
  // row in public.listeners every query comes back empty, which is
  // confusing to look at, so say it plainly instead.
  const { data: me } = await supabase.from('listeners').select('user_id').limit(1);

  if (!me || !me.length) {
    signinView.hidden = false;
    signinError.textContent =
      'Signed in, but this account is not on the listener list. Add your user id to the listeners table.';
    signinError.hidden = false;
    await supabase.auth.signOut();
    return;
  }

  signinView.hidden = true;
  consoleView.hidden = false;

  supabase.rpc('purge_stale_conversations');
  loadPresence();
  await refresh();
  timer = setInterval(refresh, 3000);
}

/* ---- Availability ----------------------------------------- */

async function loadPresence() {
  const { data } = await supabase
    .from('listener_presence')
    .select('is_available, note')
    .eq('id', true)
    .single();

  if (!data) return;
  toggle.checked = data.is_available;
  noteInput.value = data.note || '';
  paintToggle();
}

function paintToggle() {
  toggleLabel.textContent = toggle.checked ? 'Available now' : 'Not available';
}

async function savePresence() {
  paintToggle();
  await supabase
    .from('listener_presence')
    .update({
      is_available: toggle.checked,
      note: noteInput.value.trim() || null,
      updated_at: new Date().toISOString()
    })
    .eq('id', true);
}

toggle.addEventListener('change', savePresence);
noteInput.addEventListener('change', savePresence);

/* ---- Conversation list ------------------------------------ */

function ago(iso) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
}

async function refresh() {
  const { data: convos, error } = await supabase
    .from('conversations')
    .select('id, created_at, last_message_at, visitor_last_seen')
    .order('last_message_at', { ascending: false })
    .limit(50);

  if (error) return;

  count.textContent = convos.length
    ? convos.length + (convos.length === 1 ? ' conversation' : ' conversations')
    : 'No conversations';

  list.innerHTML = '';

  for (const c of convos) {
    const here = (Date.now() - new Date(c.visitor_last_seen).getTime()) < 20000;

    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'convo' + (openConversation === c.id ? ' convo-open' : '');

    btn.innerHTML =
      '<span class="convo-id">' + c.id.slice(0, 8) + '</span>' +
      '<span class="convo-meta">' + ago(c.last_message_at) +
      (here ? ' &middot; <span class="here">here now</span>' : '') + '</span>';

    btn.addEventListener('click', function () { openThread(c.id); });
    li.appendChild(btn);
    list.appendChild(li);
  }

  if (openConversation) await pullMessages();
}

/* ---- One conversation ------------------------------------- */

async function openThread(id) {
  openConversation = id;
  lastId = 0;
  seenIds = new Set();
  thread.innerHTML = '';
  emptyState.hidden = true;
  threadWrap.hidden = false;
  openId.textContent = id.slice(0, 8);
  await pullMessages();
  reply.focus();
}

async function pullMessages() {
  const { data, error } = await supabase
    .from('messages')
    .select('id, sender, body, created_at')
    .eq('conversation_id', openConversation)
    .gt('id', lastId)
    .order('id');

  if (error) return;

  // The visitor may have deleted it while it was open.
  if (!data.length && lastId === 0) {
    const { count: still } = await supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('id', openConversation);

    if (still === 0) {
      closeThread('This conversation was deleted by the person on the other side.');
      return;
    }
  }

  for (const m of data) {
    if (seenIds.has(m.id)) continue;
    seenIds.add(m.id);
    lastId = Math.max(lastId, m.id);

    const el = document.createElement('div');
    el.className = 'bubble bubble-' + m.sender;
    const body = document.createElement('p');
    body.textContent = m.body;
    el.appendChild(body);
    thread.appendChild(el);
  }

  if (data.length) thread.scrollTop = thread.scrollHeight;
  openMeta.textContent = seenIds.size + (seenIds.size === 1 ? ' message' : ' messages');
}

composer.addEventListener('submit', async function (e) {
  e.preventDefault();
  await sendReply();
});

reply.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendReply();
  }
});

reply.addEventListener('input', function () {
  reply.style.height = 'auto';
  reply.style.height = Math.min(reply.scrollHeight, 200) + 'px';
});

async function sendReply() {
  const body = reply.value.trim();
  if (!body || !openConversation) return;

  replyBtn.disabled = true;

  const { error } = await supabase
    .from('messages')
    .insert({ conversation_id: openConversation, sender: 'listener', body: body });

  if (!error) {
    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', openConversation);

    reply.value = '';
    reply.style.height = 'auto';
    await pullMessages();
  }

  replyBtn.disabled = false;
  reply.focus();
}

deleteBtn.addEventListener('click', async function () {
  if (!openConversation) return;
  if (!confirm('Delete this conversation for good? The other person loses it too.')) return;

  await supabase.from('conversations').delete().eq('id', openConversation);
  closeThread('Deleted.');
  await refresh();
});

function closeThread(message) {
  openConversation = null;
  threadWrap.hidden = true;
  emptyState.hidden = false;
  emptyState.querySelector('p').textContent = message;
}
