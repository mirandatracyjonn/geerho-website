#!/usr/bin/env python3
"""Builds a small page for every live listing at /l/<listing id>/ so links shared in iMessage, WhatsApp, Facebook,
and Messenger show the listing's photo, title, and price. (Link previews don't run JavaScript, so a static page
is the only way on GitHub Pages.) Each page sends people on to listing.html, and on iPhones with Geerho installed
the link opens the app instead (see .well-known/apple-app-site-association).

Run by .github/workflows/share-pages.yml every 15 minutes; also fine to run by hand:
    python3 scripts/build-share-pages.py
Uses only the public, read-only listing data any visitor can see.
"""
import html
import json
import pathlib
import re
import shutil
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = "https://geerho.com"
SUPABASE = "https://zdumomkbwgognuehsgtq.supabase.co"
KEY = re.search(r'SUPABASE_KEY = "([^"]+)"', (ROOT / "site.js").read_text()).group(1)
PHOTOS = f"{SUPABASE}/storage/v1/object/public/listing-photos/"
OUT = ROOT / "l"
SYMBOLS = {"USD": "$", "PHP": "₱", "EUR": "€", "GBP": "£", "CAD": "CA$", "AUD": "A$"}


def fetch_listings():
    rows, offset = [], 0
    columns = "id,title,price_cents,currency,kind,listing_format,rate_type,city,region,listing_photos(storage_path,position)"
    while True:
        url = f"{SUPABASE}/rest/v1/listings?select={columns}&status=eq.active&order=id&limit=1000&offset={offset}"
        request = urllib.request.Request(url, headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"})
        page = json.load(urllib.request.urlopen(request, timeout=30))
        rows += page
        if len(page) < 1000:
            return rows
        offset += 1000


def money(cents, currency):
    amount = cents / 100
    text = f"{amount:,.0f}" if cents % 100 == 0 else f"{amount:,.2f}"
    symbol = SYMBOLS.get((currency or "USD").upper())
    return f"{symbol}{text}" if symbol else f"{text} {currency}"


def price_line(listing):
    cents, currency = listing["price_cents"], listing["currency"]
    kind, fmt, rate = listing["kind"], listing["listing_format"], listing.get("rate_type")
    if kind == "item" and fmt == "fixed" and cents == 0:
        return "Free"
    if kind == "item" and fmt == "auction":
        return f"Starting bid {money(cents, currency)}"
    if kind == "item" and fmt == "rental":
        return f"{money(cents, currency)}/day"
    if kind == "rental":
        return f"{money(cents, currency)}/month"
    if kind == "service":
        return f"{money(cents, currency)}/hr" if rate == "hourly" else money(cents, currency)
    if kind == "job":
        return f"Budget {money(cents, currency)}" + ("/hr" if rate == "hourly" else "")
    return money(cents, currency)


WHAT = {"item": "For sale", "rental": "Home for rent", "property_sale": "Home for sale", "service": "Service", "job": "Job"}


def page(listing):
    listing_id = listing["id"]
    photos = sorted(listing.get("listing_photos") or [], key=lambda p: p["position"])
    image = PHOTOS + photos[0]["storage_path"] if photos else f"{SITE}/app-icon.png"
    what = WHAT.get(listing["kind"], "Listing")
    if listing["kind"] == "item" and listing["listing_format"] == "auction":
        what = "Auction"
    elif listing["kind"] == "item" and listing["listing_format"] == "rental":
        what = "For rent"
    place = ", ".join(p for p in (listing.get("city"), listing.get("region")) if p)
    title = f"{listing['title']} · {price_line(listing)}"
    description = f"{what}{' in ' + place if place else ''} on Geerho, where every member is ID-verified."
    target = f"/listing.html?id={listing_id}"
    e = lambda s: html.escape(s, quote=True)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="format-detection" content="telephone=no, address=no, email=no, date=no">
  <title>{e(title)}</title>
  <meta name="description" content="{e(description)}">
  <link rel="canonical" href="{SITE}{target}">
  <meta property="og:type" content="product">
  <meta property="og:site_name" content="Geerho">
  <meta property="og:title" content="{e(title)}">
  <meta property="og:description" content="{e(description)}">
  <meta property="og:image" content="{e(image)}">
  <meta property="og:url" content="{SITE}/l/{listing_id}/">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{e(title)}">
  <meta name="twitter:description" content="{e(description)}">
  <meta name="twitter:image" content="{e(image)}">
  <meta http-equiv="refresh" content="0; url={target}">
</head>
<body>
  <p><a href="{target}">{e(title)}</a></p>
</body>
</html>
"""


def main():
    listings = fetch_listings()
    if OUT.exists():
        shutil.rmtree(OUT)
    for listing in listings:
        folder = OUT / listing["id"]
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "index.html").write_text(page(listing))
    print(f"Built {len(listings)} share pages in l/")


if __name__ == "__main__":
    main()
