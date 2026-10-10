#!/usr/bin/env python3
"""Rewrites the shared header and footer on every page, so the menus stay identical.

Usage: python3 scripts/update-chrome.py   (run from anywhere; edits the .html files in place)
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Header menu, top to bottom: Browse, About, News, Sign in (Account when signed in), Contact, then Get the app.
NAV = [
    ("browse.html", "Browse"),
    ("about.html", "About"),
    ("news.html", "News"),
]
# The footer is only the legal pages and the FAQ; everything else is in the header menu.
FOOTER = [
    ("terms.html", "Terms"),
    ("privacy.html", "Privacy"),
    ("faq.html", "FAQs"),
    ("partners.html", "Partners"),
]
# Pages that belong under a menu item (listing.html is part of Browse).
SECTION = {"listing.html": "browse.html"}
SUPABASE = "https://zdumomkbwgognuehsgtq.supabase.co"
# Content Security Policy: code and styles only from geerho.com; data only from our Supabase project.
CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; "
    f"img-src 'self' data: blob: {SUPABASE}; connect-src 'self' {SUPABASE} wss://zdumomkbwgognuehsgtq.supabase.co; "
    "font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"
)
CSP_TAG = f'  <meta http-equiv="Content-Security-Policy" content="{CSP}">\n'
REFERRER_TAG = '  <meta name="referrer" content="strict-origin-when-cross-origin">\n'
# iPhone Safari turns things that look like addresses, phone numbers, or dates into links (e.g. "Street Bob 114"
# in a motorcycle's title became a map link). Listings are member text, so turn that off.
FORMAT_TAG = '  <meta name="format-detection" content="telephone=no, address=no, email=no, date=no">\n'
# Every page loads auth.js so the header shows "Account" and "Messages" for signed-in members. The Supabase
# library is a plain script that must run before it.
# Home Screen web app: full screen with the brand color behind the status bar, like the iPhone app.
VIEWPORT_TAG = '  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
WEBAPP_TAGS = (
    '  <link rel="manifest" href="manifest.webmanifest">\n'
    '  <meta name="theme-color" content="#5a6ff4">\n'
    '  <meta name="mobile-web-app-capable" content="yes">\n'
    '  <meta name="apple-mobile-web-app-capable" content="yes">\n'
    '  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n'
    '  <meta name="apple-mobile-web-app-title" content="Geerho">\n'
)
LIBRARY_TAG = '  <script src="vendor/supabase-js-2.117.2.js"></script>\n'
AUTH_SCRIPT = '  <script type="module" src="auth.js"></script>\n'


def ensure_head(text):
    if 'class="site-header"' not in text:
        return text
    text = re.sub(r'  <meta http-equiv="Content-Security-Policy"[^>]*>\n', "", text)
    text = re.sub(r'  <meta name="referrer"[^>]*>\n', "", text)
    text = re.sub(r'  <meta name="format-detection"[^>]*>\n', "", text)
    text = text.replace('<meta charset="utf-8">\n', '<meta charset="utf-8">\n' + CSP_TAG + REFERRER_TAG + FORMAT_TAG, 1)
    text = re.sub(r'  <meta name="viewport"[^>]*>\n', lambda _: VIEWPORT_TAG, text, count=1)
    text = re.sub(r'  (<link rel="manifest"|<meta name="theme-color"|<meta name="(apple-)?mobile-web-app-[^"]+")[^>]*>\n', "", text)
    text = text.replace('  <link rel="apple-touch-icon"', WEBAPP_TAGS + '  <link rel="apple-touch-icon"', 1)
    if 'src="vendor/supabase-js' not in text:
        if 'src="auth.js"' in text:
            text = text.replace(AUTH_SCRIPT, LIBRARY_TAG + AUTH_SCRIPT, 1)
        else:
            text = text.replace("</head>", LIBRARY_TAG + AUTH_SCRIPT + "</head>", 1)
    return add_preview_tags(text)


def add_preview_tags(text):
    """Link previews (iMessage, Facebook, ...) for regular pages: the page's title and description with the Geerho icon."""
    text = re.sub(r'  <meta (property="og:[^"]+"|name="twitter:[^"]+") content="[^"]*">\n', "", text)
    title = re.search(r"<title>(.*?)</title>", text, re.S)
    description = re.search(r'<meta name="description" content="([^"]*)">', text)
    if not title:
        return text
    tags = (
        '  <meta property="og:site_name" content="Geerho">\n'
        f'  <meta property="og:title" content="{title.group(1).strip()}">\n'
        + (f'  <meta property="og:description" content="{description.group(1)}">\n' if description else "")
        + '  <meta property="og:image" content="https://geerho.com/app-icon-large.png">\n'
        '  <meta name="twitter:card" content="summary">\n'
    )
    return text.replace("</head>", tags + "</head>", 1)


def link(href, label, current, extra=""):
    attr = ' aria-current="page"' if href == current else ""
    return f'<a href="{href}"{attr}{extra}>{label}</a>'


def header(page):
    current = SECTION.get(page, page)
    items = "\n    ".join(link(href, label, current) for href, label in NAV)
    account = link("account.html", "Sign in", current, " data-account")
    contact = link("contact.html", "Contact", current)
    get_app = link("download.html", "Get the app", current, ' class="nav-cta"')
    # The menu is always a hamburger (a <details> element, so it works even without JavaScript).
    return (
        '<header class="site-header"><div class="inner">\n'
        '  <a class="brand" href="index.html"><img src="logo-mark.png" alt="" width="44" height="44">Geerho</a>\n'
        '  <details class="menu">\n'
        '    <summary aria-label="Menu"><span class="bars" aria-hidden="true"></span></summary>\n'
        '    <nav aria-label="Site">\n'
        f"      {items}\n"
        f"      {account}\n"
        f"      {contact}\n"
        f"      {get_app}\n"
        "    </nav>\n"
        "  </details>\n"
        "</div></header>"
    )


TABS = [
    ("index.html", "Home", '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>'),
    ("browse.html", "Browse", '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
    ("messages.html", "Messages", '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    ("account.html", "Account", '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
]


ARIA_CURRENT = ' aria-current="page"'


def tab_bar(page):
    """App-style tabs at the bottom; CSS shows them only when Geerho is opened from the Home Screen."""
    current = SECTION.get(page, page)
    tabs = "\n  ".join(
        f'<a href="{href}"{ARIA_CURRENT if href == current else ""}>'
        f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
        f'stroke-linejoin="round" aria-hidden="true" focusable="false">{icon}</svg><span>{label}</span></a>'
        for href, label, icon in TABS
    )
    return f'<nav class="tab-bar" aria-label="App">\n  {tabs}\n</nav>'


def footer(page):
    items = "\n    ".join(link(href, label, page) for href, label in FOOTER)
    return (
        '<footer class="site-footer"><div class="inner">\n'
        '  <nav aria-label="Legal">\n'
        f"    {items}\n"
        "  </nav>\n"
        '  <p class="copyright">© 2026 Geerho, LLC</p>\n'
        "</div></footer>"
    )


for path in sorted(ROOT.glob("*.html")):
    text = path.read_text()
    text = re.sub(r'<header class="site-header">.*?</header>', lambda _: header(path.name), text, flags=re.S)
    text = re.sub(r'\n<nav class="tab-bar".*?</nav>', "", text, flags=re.S)
    text = re.sub(r'<footer class="site-footer">.*?</footer>', lambda _: footer(path.name) + "\n" + tab_bar(path.name), text, flags=re.S)
    text = ensure_head(text)
    path.write_text(text)
    print("updated", path.name)
