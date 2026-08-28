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
const statusNote = document.getElementById('status-note');
const pillText  = document.getElementById('status-text');
const warning   = document.getElementById('config-warning');
const note      = document.getElementById('composer-note');

const KEY = 'brina.session';
const STORE = sessionStorage;

let session  = null;   // { conversationId, token }
let polling  = null;
let sending  = false;
let chosenMood = null;   // set by the mood grid, sent when the conversation starts
const rendered = new Map(); // message id -> { el, readAt }

/* ---- Setup ------------------------------------------------ */

const client = cfg.ready
  ? window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } })
  : null;

if (!client) {
  warning.hidden = false;
  input.disabled = true;
  sendBtn.disabled = true;
  pillText.textContent = 'Not connected.';
  statusNote.dataset.state = 'off';
  statusNote.hidden = false;
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
  wireMoods();
  wireOpeners();
  if (session) poll().then(startPolling);
}

/* ---- Opener chips (fill the blank first screen) ------------ */

// The mood grid is built from the shared definitions rather than
// hard-coded markup, so the console and the chat can never disagree
// about what a mood looks like.
function wireMoods() {
  const grid = document.getElementById('mood-grid');
  if (!grid || !window.BRINA_MOODS) return;

  window.BRINA_MOODS.list.forEach(function (m) {
    const li = document.createElement('li');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mood';
    btn.dataset.mood = m.id;
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = window.BRINA_MOODS.svg(m.id, 40) +
                    '<span class="mood-label">' + m.label + '</span>';

    btn.addEventListener('click', function () {
      // Tapping the selected mood again clears it — nobody should be
      // trapped into declaring a feeling they did not mean to pick.
      const already = chosenMood === m.id;
      grid.querySelectorAll('.mood').forEach(function (el) {
        el.classList.remove('mood-on');
        el.setAttribute('aria-pressed', 'false');
      });
      if (already) {
        chosenMood = null;
      } else {
        chosenMood = m.id;
        btn.classList.add('mood-on');
        btn.setAttribute('aria-pressed', 'true');
      }
    });

    li.appendChild(btn);
    grid.appendChild(li);
  });
}

function chosenName() {
  const el = document.getElementById('display-name');
  return el ? el.value.trim().slice(0, 24) : '';
}

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
    statusNote.hidden = true;
    return;
  }

  if (row.is_available) {
    statusNote.dataset.state = 'on';
    pillText.textContent = row.note || 'Someone is here right now.';
    statusNote.hidden = false;
  } else {
    statusNote.dataset.state = 'off';
    pillText.textContent = row.note || 'Nobody is here right now — your message still gets read.';
    statusNote.hidden = false;
  }
}

/* ---- Crisis safety net -------------------------------------
   If a message contains language that plainly signals danger to the
   person's own life, an automatic reply with real helplines appears in
   the thread immediately — before the listener could possibly see and
   answer it. The conversation is never closed or interrupted; the
   visitor's message still sends and a human still sees it. This is a
   floor, not a replacement for the listener actually responding.
   ------------------------------------------------------------ */

const CRISIS_PATTERNS = [
  // Bare keywords. Deliberately broad, including common misspellings —
  // someone in distress types fast and does not proofread. A false
  // positive costs a helpline card nobody needed; a false negative costs
  // far more, and the card never blocks or ends the conversation.
  /\bsu[ei]*[cs][ei]*d(e|al|es)?\b/i,
  /\bkms\b/i,
  /\bself\s*-?\s*harm/i,

  // Phrases in English.
  /\bi\s*(just\s*)?can'?t\s*(take|do|handle)\s*(it|this)\s*(any\s*more|anymore)\b/i,
  /\bi\s*(want|wanna|wish)\s*(to\s*)?di(e|ing)\b/i,
  /\bi\s*(want|wanna)\s*to\s*(commit\s*)?su+[ei]c+[ei]?d/i,
  /\b(i'?m|im|i\s*am)\s*(going\s*to|gonna)\s*(kill|end)\s*(myself|my\s*life)\b/i,
  /\b(kill|hurt|harm)\s*(myself|meself)\b/i,
  /\bend\s*(my|it)\s*(life|all)\b/i,
  /\bi\s*don'?t\s*want\s*to\s*(live|be\s*alive|exist|wake\s*up)\b/i,
  /\bno\s*(reason|point)\s*(to|in)\s*liv/i,
  /\bbetter\s*off\s*(dead|without\s*me)\b/i,
  /\bnobody\s*would\s*(miss|notice)\s*me\b/i,
  /\bi\s*want\s*(it|everything)\s*to\s*(end|stop)\b/i,

  // Transliterated Hindi.
  /\bmar\s*na\s*chah/i,
  /\bmarna\s*chaht/i,
  /\bjeena\s*nahi/i,
  /\bjine\s*ka\s*mann?\s*nahi/i,
  /\bkhatam\s*kar(na)?\s*chaht/i,
  /\bapne\s*aap\s*ko\s*(maar|marna)/i
];

let crisisShownAt = 0;

function looksLikeCrisis(text) {
  return CRISIS_PATTERNS.some(function (re) { return re.test(text); });
}

function showCrisisResponse() {
  // Don't repeat it on every single message once it's already showing —
  // once per five minutes of continued crisis language is enough to stay
  // present without turning into noise on top of what they're saying.
  if (Date.now() - crisisShownAt < 5 * 60 * 1000) return;
  crisisShownAt = Date.now();

  if (intro && intro.parentNode) intro.classList.add('thread-intro-done');

  const el = document.createElement('div');
  el.className = 'bubble bubble-safety';

  el.innerHTML =
    '<p class="bubble-safety-lead">Please reach out to people trained for this right now &mdash; ' +
    'they answer any hour, and the calls are free.</p>' +
    '<ul class="bubble-safety-list">' +
      '<li><span>Tele-MANAS</span> <a href="tel:14416">14416</a></li>' +
      '<li><span>Vandrevala Foundation</span> <a href="tel:+919999666555">9999 666 555</a></li>' +
      '<li><span>AASRA</span> <a href="tel:+919820466726">98204 66726</a></li>' +
    '</ul>' +
    '<p class="bubble-safety-foot">This chat is staying open. Keep writing if you want to &mdash; someone here will read it too.</p>';

  thread.appendChild(el);
  thread.scrollTop = thread.scrollHeight;
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

  const flagCrisis = looksLikeCrisis(body);

  sending = true;
  sendBtn.disabled = true;

  try {
    if (!session) {
      const { data, error } = await client.rpc('start_conversation', {
        p_name: chosenName() || null,
        p_mood: chosenMood
      });
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
    if (flagCrisis) showCrisisResponse();
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
