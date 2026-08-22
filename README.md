# Brina — landing page

A single static page. Three files, no framework, no build step, no dependencies
beyond Google Fonts.

```
index.html
style.css
script.js
```

## Run it locally

Open `index.html` in a browser. That's it. Or, if you'd rather serve it:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000

## Deploy

**Netlify** — go to https://app.netlify.com/drop and drag this folder onto the page.

**Vercel** — `npx vercel` inside this folder, or drag the folder into the dashboard's
"Add New → Project → Deploy" upload box.

**Cloudflare Pages** — Workers & Pages → Create → Pages → "Upload assets", drag the folder.

No environment variables, no build command, no output directory. If a build command is
asked for, leave it blank and set the output directory to `/`.

## Changing the name

The service name lives in **one place**: the `<span data-brand>` inside the header
wordmark in `index.html`. `script.js` copies it into the footer, the page title and the
meta description at load time.

The footer and `<title>` still carry `Brina` as a literal fallback for the case where
JavaScript doesn't run. If you rename, it's worth updating those two fallbacks too — they
are both marked, and a find-and-replace on `Brina` covers everything.

## Before you publish

Three placeholders are marked with `TODO` comments in `index.html`:

1. **The chat link.** Both "Start a conversation" buttons point at `#`. Point them at the
   chat product when it exists.
2. **The email address.** `hello@brina.in` appears in the volunteer section and the
   footer. Replace it with the real one.
3. Nothing else. There is no form backend, no analytics, no tracking, no third-party
   script.

## Notes on how it's built

- **Colour** — every colour is a custom property on `:root`, overridden in a single
  `prefers-color-scheme: dark` block. The sage accent has two variants: `--accent` for
  decorative marks and `--accent-ink`, darker, for anything carrying text, so button and
  link contrast clears WCAG AA.
- **Type** — Fraunces for headings, Inter for body, both from Google Fonts. Body line
  height 1.7, text columns capped at 65ch.
- **Spacing** — an 8px scale, `--s1` through `--s8`.
- **The crisis bar** is `position: fixed` at the bottom below 700px and sits in the flow
  just above the footer above it. Dismissal is held in a JS variable only, so it returns
  on the next page load. That is deliberate.
- **The FAQ** uses native `<details>`/`<summary>`. It works with JavaScript disabled.
- **Accessibility** — skip link, real focus rings, semantic landmarks, and
  `prefers-reduced-motion` honoured.

## What the page deliberately does not do

No testimonials, no user counts, no statistics, no trust badges, and no claim of
professional qualification. It is a new service run by one person and the page says so.
