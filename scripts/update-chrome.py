#!/usr/bin/env python3
"""Rewrites the shared header and footer on every page, so the menus stay identical.

Usage: python3 scripts/update-chrome.py   (run from anywhere; edits the .html files in place)
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent

NAV = [
    ("browse.html", "Browse"),
    ("about.html", "About"),
    ("news.html", "News"),
    ("partners.html", "Partners"),
    ("faq.html", "FAQ"),
]
FOOTER = [
    ("about.html", "About"),
    ("news.html", "News"),
    ("partners.html", "Partners"),
    ("faq.html", "FAQ"),
    ("contact.html", "Contact"),
    ("terms.html", "Terms of Service"),
    ("privacy.html", "Privacy Policy"),
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
# Every page loads auth.js so the header shows "Account" and "Messages" for signed-in members. The Supabase
# library is a plain script that must run before it.
LIBRARY_TAG = '  <script src="vendor/supabase-js-2.117.2.js"></script>\n'
AUTH_SCRIPT = '  <script type="module" src="auth.js"></script>\n'


def ensure_head(text):
    if 'class="site-header"' not in text:
        return text
    text = re.sub(r'  <meta http-equiv="Content-Security-Policy"[^>]*>\n', "", text)
    text = re.sub(r'  <meta name="referrer"[^>]*>\n', "", text)
    text = text.replace('<meta charset="utf-8">\n', '<meta charset="utf-8">\n' + CSP_TAG + REFERRER_TAG, 1)
    if 'src="vendor/supabase-js' not in text:
        if 'src="auth.js"' in text:
            text = text.replace(AUTH_SCRIPT, LIBRARY_TAG + AUTH_SCRIPT, 1)
        else:
            text = text.replace("</head>", LIBRARY_TAG + AUTH_SCRIPT + "</head>", 1)
    return text


def link(href, label, current, extra=""):
    attr = ' aria-current="page"' if href == current else ""
    return f'<a href="{href}"{attr}{extra}>{label}</a>'


def header(page):
    current = SECTION.get(page, page)
    items = "\n    ".join(link(href, label, current) for href, label in NAV)
    account = link("account.html", "Sign in", current, " data-account")
    get_app = link("download.html", "Get the app", current, ' class="nav-cta"')
    return (
        '<header class="site-header"><div class="inner">\n'
        '  <a class="brand" href="index.html"><img src="favicon.png" alt="" width="28" height="28">Geerho</a>\n'
        '  <nav aria-label="Site">\n'
        f"    {items}\n"
        f"    {account}\n"
        f"    {get_app}\n"
        "  </nav>\n"
        "</div></header>"
    )


def footer(page):
    items = "\n  ".join(link(href, label, page) for href, label in FOOTER)
    return (
        '<footer class="site-footer"><div class="inner">\n'
        "  <span>© 2026 Geerho, LLC</span>\n"
        f"  {items}\n"
        "</div></footer>"
    )


for path in sorted(ROOT.glob("*.html")):
    text = path.read_text()
    text = re.sub(r'<header class="site-header">.*?</header>', lambda _: header(path.name), text, flags=re.S)
    text = re.sub(r'<footer class="site-footer">.*?</footer>', lambda _: footer(path.name), text, flags=re.S)
    text = ensure_head(text)
    path.write_text(text)
    print("updated", path.name)
