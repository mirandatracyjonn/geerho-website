#!/usr/bin/env python3
"""Rewrites the shared header and footer on every page, so the menus stay identical.

Usage: python3 scripts/update-chrome.py   (run from anywhere; edits the .html files in place)
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent

# The iPhone app is the gold standard (TJ, 2026-10-14): the same five tabs, in the same order, with the same names:
# Home, Search, Post, Inbox, Profile. On phones they're a bottom tab bar like the app's; on wider screens they sit in
# the header. The bell (notifications) is beside them, and "More" holds the website-only pages.
MORE = [
    ("live.html", "Live"),
    ("featured.html", "Featured listings"),
    ("help.html", "User Handbook"),
    ("faq.html", "FAQs"),
    ("about.html", "About"),
    ("news.html", "News"),
    ("contact.html", "Contact"),
]
FOOTER = [
    ("terms.html", "Terms"),
    ("privacy.html", "Privacy"),
    ("help.html", "User Handbook"),
    ("faq.html", "FAQs"),
    ("community-guidelines.html", "Community Guidelines"),
    ("partners.html", "Partners"),
    ("plans.html", "Plans"),
    ("featured.html", "Featured listings"),
    ("law-enforcement.html", "Law Enforcement"),
]
# Pages that belong under a menu item (listing.html is part of Browse).
SECTION = {
    "listing.html": "browse.html", "featured.html": "browse.html", "live.html": "browse.html",
    "purchases.html": "account.html", "plans.html": "account.html", "member.html": "account.html",
}
SUPABASE = "https://zdumomkbwgognuehsgtq.supabase.co"
# Content Security Policy: code and styles only from geerho.com; data only from our Supabase project.
CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; "
    # Profile photos can come from the member's Google or GitHub account (as in the apps).
    f"img-src 'self' data: blob: {SUPABASE} https://*.googleusercontent.com https://avatars.githubusercontent.com; connect-src 'self' {SUPABASE} wss://zdumomkbwgognuehsgtq.supabase.co; "
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
        # The public beta artwork (1200×630; source: Design/OG/og-beta.html in the app repo).
        + '  <meta property="og:image" content="https://geerho.com/og-beta.png">\n'
        '  <meta property="og:image:width" content="1200">\n'
        '  <meta property="og:image:height" content="630">\n'
        '  <meta property="og:image:alt" content="Geerho public beta now open: buy and sell, jobs, real estate, and rentals. Join on TestFlight at geerho.com.">\n'
        '  <meta name="twitter:card" content="summary_large_image">\n'
    )
    return text.replace("</head>", tags + "</head>", 1)


def link(href, label, current, extra=""):
    attr = ' aria-current="page"' if href == current else ""
    return f'<a href="{href}"{attr}{extra}>{label}</a>'


ICONS = {
    name: path for name, path in re.findall(r"^  (\w+): '([^']*)',$", (ROOT / "icons.js").read_text(), re.M)
}


def svg(name):
    return (f'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
            f'stroke-linejoin="round" aria-hidden="true" focusable="false">{ICONS[name]}</svg>')


TABS = [
    ("index.html", "Home", "home"),
    ("browse.html", "Search", "search"),
    ("post.html", "Post", "post"),
    ("messages.html", "Inbox", "inbox"),
    ("account.html", "Profile", "profile"),
]
ARIA_CURRENT = ' aria-current="page"'


def header(page):
    current = SECTION.get(page, page)
    tabs = "\n    ".join(
        f'<a href="{href}" data-tab="{icon}"{ARIA_CURRENT if href == current else ""}>{svg(icon)}<span>{label}</span></a>'
        for href, label, icon in TABS
    )
    more = "\n        ".join(link(href, label, page) for href, label in MORE)
    get_app = link("download.html", "Get the app", page, ' class="nav-cta"')
    bell_current = ARIA_CURRENT if page == "notifications.html" else ""
    # The More menu is a <details> element, so it works even without JavaScript.
    return (
        '<header class="site-header"><div class="inner">\n'
        '  <a class="brand" href="index.html"><img src="logo-mark.png" alt="" width="44" height="44">Geerho</a>\n'
        '  <nav class="tab-bar" aria-label="Main">\n'
        f"    {tabs}\n"
        "  </nav>\n"
        f'  <a class="bell" href="notifications.html" aria-label="Notifications"{bell_current}>{svg("bell")}</a>\n'
        '  <details class="menu">\n'
        f'    <summary aria-label="More">{svg("more")}</summary>\n'
        '    <nav aria-label="More">\n'
        f"        {more}\n"
        f"        {get_app}\n"
        "    </nav>\n"
        "  </details>\n"
        "</div></header>"
    )


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
    text = re.sub(r'<footer class="site-footer">.*?</footer>', lambda _: footer(path.name), text, flags=re.S)
    text = ensure_head(text)
    path.write_text(text)
    print("updated", path.name)
