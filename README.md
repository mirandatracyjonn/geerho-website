# geerho.com

The Geerho website: a static site on GitHub Pages that uses the same Supabase project as the Geerho iPhone app.

## Security model

- **No secrets here.** The only key in this repo is Supabase's *publishable* key, which is designed to be public.
  What it can read or change is decided by row-level security and database functions in the app repo, so the
  website can never do more than the app. Signed-out visitors can read active listings, reviews, and categories only.
- **Server-side secrets stay on the server.** The Didit API key, webhook secret, and Supabase secret key live only
  in Supabase Edge Function settings, never in this repo or the app.
- **Code comes only from geerho.com.** The Supabase library is copied into `vendor/` (from npm, checked against its
  published checksum), and every page has a Content Security Policy that allows scripts and styles from this site
  only, and network requests to our Supabase project only.
- **User text is never inserted as HTML.** Pages build elements with `textContent` (see `el()` in `site.js`).
- **Signed-in pages refuse to be framed** by other sites (`auth.js`).
- **Sign-in uses OAuth with PKCE** through Supabase; only the redirect URLs listed in Supabase Auth are allowed.

## Editing

- Shared header, footer, and security headers: edit `scripts/update-chrome.py`, then run
  `python3 scripts/update-chrome.py`.
- Terms, Privacy, and FAQ must match the copies in the app repo (`docs/` and `Geerho/Resources/Legal/`).
- Preview locally: `python3 -m http.server 8765`, then open http://localhost:8765.
