# Brina

A free, anonymous, text-only place to talk. Landing page, visitor chat, and a
listener console. Static files plus a Supabase backend — no server to run, no
build step.

```
index.html    landing page
chat.html     the visitor's chat            → chat.js
admin.html    the listener's console        → admin.js
style.css     everything, both themes
script.js     landing page only
config.js     the two values you fill in
schema.sql    the whole database, for a rebuild from scratch
```

---

## Setup

Already done. The database is live on project `yelznjutyfzgfqroqgrk`, and
`config.js` holds the URL and publishable key.

The only thing left, once: open `admin.html` and choose a passphrase. The first
person to open the console sets it, so do it before the site is public. Ten
characters minimum, and write it down — there is no reset. (If you ever need to
reset it, run this and reload the page:
`update public.listener_auth set passphrase_hash = null, claimed_at = null where id = true;`)

`schema.sql` is the whole database in one file, if you ever rebuild from scratch.

---

## How it works

**The visitor never touches a table.** Anonymous access to `conversations` and
`messages` is revoked outright. Everything the visitor does goes through four
Postgres functions — `start_conversation`, `visitor_send`, `visitor_poll`,
`visitor_close` — each of which checks a token before doing anything.

**The token is the whole identity.** Starting a chat mints a conversation id and
a random token. The pair lives in `sessionStorage`, so it dies with the tab.
There is no account, no cookie, nothing to link two conversations to one person,
and no way to recover a conversation once the tab is gone.

**Deletion is real.** "End and delete" runs a `DELETE`, and the messages go with
it via cascade. You deleting from the console does the same. Anything idle for
24 hours is purged by `purge_stale_conversations()`, which the console calls on
load. To make that reliable rather than incidental, schedule it — Database →
Extensions → enable `pg_cron`, then:

```sql
select cron.schedule('brina-purge', '0 * * * *',
  $$select public.purge_stale_conversations()$$);
```

**Both sides poll every 3 seconds.** Not websockets. At one listener and a
handful of conversations this is simpler, cheaper, and impossible to get subtly
wrong. Revisit it when you have several listeners at once, not before.

### About that "nothing is kept" promise

The original copy said nothing is kept, full stop. That was true of a page with
no backend and false the moment messages had to travel between two people. The
FAQ now says the accurate thing: messages sit on a server while the conversation
is open, and are deleted when it ends or within a day if abandoned. Keep it
accurate. It is the one claim you cannot afford to be loose about.

---

## Deploy

Netlify Drop, Vercel, or Cloudflare Pages — drag the folder in. No build
command, no environment variables, output directory `/`.

`admin.html` ships with `noindex, nofollow` and is not linked from anywhere.
That is obscurity, not security; the security is the `listeners` table and RLS.
If you want a second lock, put the console behind your host's password
protection (Netlify and Cloudflare both offer it on paid plans).

---

## Before you publish

- `hello@brina.in` in `index.html` — volunteer section and footer. Replace it.
- Check the helpline numbers are still current.
- Decide your hours and put them in the availability note, e.g. "back around
  9pm". A specific note reads far better than a grey dot.

---

## On charging

There is no payment code here, deliberately. If you ever do add credits:

- A ₹1 charge costs more in gateway fees than it collects. Any per-conversation
  price that clears the fees is high enough to change who shows up.
- Payment means a payment identity, which is the end of anonymity as a claim.
- The way to control load is the availability toggle and, later, a queue — not
  a price.

If you still want it: add a `credits` table keyed by a purchased token, check
the balance inside `visitor_send`, and decrement on the first message of a
conversation. The function boundary is already the right place for it, which is
part of why the schema is shaped this way.

---

## Changing the name

One place: the `<span data-brand>` in the header of `index.html`. `script.js`
copies it into the footer, the title, and the meta description at load. The
literal fallbacks in `<title>`, `chat.html`, and `admin.html` are there for the
no-JavaScript case — a find-and-replace on `Brina` catches everything.

## Notes on the build

- Every colour is a custom property on `:root`, overridden once for dark mode.
  The sage accent has two variants: `--accent` decorative, `--accent-ink` for
  anything carrying text, so contrast clears WCAG AA.
- Fraunces for headings, Inter for body, both from Google Fonts. No page loads
  any other third-party script — `chat.html` and `admin.html` use the Supabase
  client vendored at `vendor/supabase.js`, not a CDN. (An earlier version
  loaded it live from esm.sh; that meant a slow or blocked connection to a
  third party — far more likely on a phone than a desktop browser — made
  messaging fail silently, with no error shown. Vendoring removes that
  dependency entirely.)
- The FAQ is native `<details>`. It works with JavaScript off.
- Skip link, real focus rings, `prefers-reduced-motion` honoured.

## What the page deliberately does not do

No testimonials, no user counts, no statistics, no trust badges, no claim of
professional qualification. The example openers in "You don't need a reason" are
written as prompts, not quotes from anyone — keep them that way.
