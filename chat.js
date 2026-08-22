/* ============================================================
   Brina — the visitor side of the conversation.

   Everything here talks to Postgres functions, never to tables.
   The visitor holds a conversation id and a token; the pair is
   the only proof of ownership. On the website it lives in
   sessionStorage, so it dies with the tab, matching the promise
   made on the landing page. (The app build of this file swaps
   that one line for localStorage, so closing the app doesn't
   lose the conversation — see brina-app/www/chat.js.)
   ============================================================ */

const cfg = window.BRINA_CONFIG || {};

const thread    = document.getElementById('thread');
const intro     = document.getElementById('intro');
const form      = document.getElementById('composer');
const input     = document.getElementById('input');
const sendBtn   = document.getElementById('send-btn');
const endBtn    = document.getElementById('end-btn');
const pill      = document.getElementById('status-pill');
const pillText  = document.getElementById('status-text');
const warning   = document.getElementById('config-warning');
const note      = document.getElementById('composer-note');

const KEY = 'brina.session';
const STORE = sessionStorage;

let session  = null;   // { conversationId, token }
let polling  = null;
let sending  = false;
const rendered = new Map(); // message id -> { el, readAt }

/* ---- Setup ------------------------------------------------ */

const client = cfg.ready
  ? window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } })
  : null;

if (!client) {
  warning.hidden = false;
  input.disabled = true;
  sendBtn.disabled = true;
  pillText.textContent = 'Offline';
  pill.dataset.state = 'off';
} else {
  start();
}

function start() {
  const saved = STORE.getItem(KEY);
  if (saved) {
    try {
      session = JSON.parse(saved);
      endBtn.hidden = false;
    } catch (e) {
      STORE.removeItem(KEY);
    }
  }
  refreshStatus();
  setInterval(refreshStatus, 30000);
  wireOpeners();
  if (session) poll().then(startPolling);
}

/* ---- Opener chips (fill the blank first screen) ------------ */

function wireOpeners() {
  document.querySelectorAll('.opener-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      input.value = chip.dataset.text || chip.textContent.trim();
      input.dispatchEvent(new Event('input'));
      input.focus();
    });
  });
}

/* ---- Listener availability -------------------------------- */

async function refreshStatus() {
  const { data, error } = await client.rpc('listener_status');
  const row = Array.isArray(data) ? data[0] : data;

  if (error || !row) {
    pill.dataset.state = 'unknown';
    pillText.textContent = 'Status unknown';
    return;
  }

  if (row.is_available) {
    pill.dataset.state = 'on';
    pillText.textContent = row.note || 'Someone is here';
  } else {
    pill.dataset.state = 'off';
    pillText.textContent = row.note || 'Nobody is here right now';
  }
}

/* ---- Messages --------------------------------------------- */

function tickHTML(readAt) {
  return readAt
    ? '<span class="tick tick-read" aria-label="Read" title="Read">' +
        '<svg viewBox="0 0 20 12" aria-hidden="true"><path d="M1 6.5 5 10.5 12 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 6.5 11 10.5 19 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</span>'
    : '<span class="tick tick-sent" aria-label="Sent" title="Sent">' +
        '<svg viewBox="0 0 14 12" aria-hidden="true"><path d="M1 6.5 5 10.5 13 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</span>';
}

function sync(rows) {
  if (!rows.length) return;

  if (intro && intro.parentNode) {
    intro.classList.add('thread-intro-done');
  }

  let appended = false;

  for (const row of rows) {
    const existing = rendered.get(row.id);

    if (!existing) {
      const el = document.createElement('div');
      el.className = 'bubble bubble-' + row.sender;
      el.dataset.mid = row.id;

      const body = document.createElement('p');
      body.textContent = row.body;
      el.appendChild(body);

      if (row.sender === 'visitor') {
        const meta = document.createElement('span');
        meta.className = 'bubble-meta';
        meta.innerHTML = tickHTML(row.read_at);
        el.appendChild(meta);
      }

      thread.appendChild(el);
      rendered.set(row.id, { el: el, readAt: row.read_at });
      appended = true;
      continue;
    }

    // Own message that has since been read — flip the tick in place.
    if (row.sender === 'visitor' && row.read_at && !existing.readAt) {
      const meta = existing.el.querySelector('.bubble-meta');
      if (meta) meta.innerHTML = tickHTML(row.read_at);
      existing.readAt = row.read_at;
    }
  }

  if (appended) thread.scrollTop = thread.scrollHeight;
}

async function poll() {
  if (!session) return;

  const { data, error } = await client.rpc('visitor_poll', {
    p_conversation: session.conversationId,
    p_token: session.token
  });

  if (error) {
    // The conversation is gone — closed from the other side.
    if (/not found/i.test(error.message)) endSession(true);
    return;
  }

  sync(data || []);
}

function startPolling() {
  if (polling) return;
  polling = setInterval(poll, 3000);
}

// Browsers throttle timers in background tabs, so a reply written while
// the visitor is looking elsewhere would sit there until the tab wakes.
// Catch up the moment they come back.
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible' && session) {
    poll();
    refreshStatus();
  }
});

/* ---- Sending ---------------------------------------------- */

form.addEventListener('submit', async function (e) {
  e.preventDefault();
  await send();
});

input.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

input.addEventListener('input', function () {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 200) + 'px';
});

async function send() {
  const body = input.value.trim();
  if (!body || sending || !client) return;

  sending = true;
  sendBtn.disabled = true;

  try {
    if (!session) {
      const { data, error } = await client.rpc('start_conversation');
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      session = { conversationId: row.conversation_id, token: row.visitor_token };
      STORE.setItem(KEY, JSON.stringify(session));
      endBtn.hidden = false;
      startPolling();
    }

    const { error: sendError } = await client.rpc('visitor_send', {
      p_conversation: session.conversationId,
      p_token: session.token,
      p_body: body
    });

    if (sendError) throw sendError;

    input.value = '';
    input.style.height = 'auto';
    await poll();
  } catch (err) {
    note.textContent = /slow down/i.test(err.message || '')
      ? 'That is a lot of messages very quickly. Give it a moment.'
      : 'That did not send. Check your connection and try again.';
    note.classList.add('composer-note-error');
    setTimeout(function () {
      note.textContent = 'Enter sends. Shift and enter starts a new line.';
      note.classList.remove('composer-note-error');
    }, 6000);
  } finally {
    sending = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

/* ---- Ending ----------------------------------------------- */

endBtn.addEventListener('click', async function () {
  if (!session) return;
  if (!confirm('End the conversation and delete it? This cannot be undone.')) return;

  await client.rpc('visitor_close', {
    p_conversation: session.conversationId,
    p_token: session.token
  });

  endSession(false);
});

function endSession(wasClosedElsewhere) {
  clearInterval(polling);
  polling = null;
  session = null;
  rendered.clear();
  STORE.removeItem(KEY);

  thread.innerHTML = '';
  const done = document.createElement('div');
  done.className = 'thread-intro';
  done.innerHTML = wasClosedElsewhere
    ? '<h1>That conversation has ended.</h1><p>It has been deleted. You can start a new one whenever you want.</p>'
    : '<h1>Deleted.</h1><p>Nothing from that conversation is kept. You can start another one any time.</p>';
  thread.appendChild(done);

  endBtn.hidden = true;
  input.value = '';
}
