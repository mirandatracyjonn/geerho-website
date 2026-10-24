#!/usr/bin/env python3
"""Builds a small page for every live listing at /l/<listing id>/ so links shared in iMessage, WhatsApp, Facebook,
and Messenger show the listing's photo, title, and price. (Link previews don't run JavaScript, so a static page
is the only way on GitHub Pages.) Each page sends people on to listing.html, and on iPhones with Geerho installed
the link opens the app instead (see .well-known/apple-app-site-association).

Since 2026-10-24 each page also carries schema.org data for Google (Product + Offer for items, RealEstateListing for
homes), and the run writes sitemap.xml (the site's pages plus every live listing) for Search Console.

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
    columns = ("id,title,description,price_cents,currency,kind,listing_format,rate_type,condition,city,region,country,"
               "bedrooms,bathrooms,floor_area_sqm,published_at,listing_photos(storage_path,position)")
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


CONDITIONS = {"new": "NewCondition", "like_new": "UsedCondition", "good": "UsedCondition", "fair": "UsedCondition",
              "for_parts": "DamagedCondition"}


def schema(listing, image, url):
    """schema.org data Google can read: items as Product + Offer, homes as RealEstateListing; none for services/jobs."""
    kind, fmt = listing["kind"], listing["listing_format"]
    desc = (listing.get("description") or "")[:500]
    price = f"{listing['price_cents'] / 100:.2f}"
    area = {"@type": "Place", "address": {"@type": "PostalAddress", "addressLocality": listing.get("city") or "",
            "addressRegion": listing.get("region") or "", "addressCountry": listing.get("country") or ""}}
    if kind == "item":
        offer = {"@type": "Offer", "price": price, "priceCurrency": listing["currency"], "url": url,
                 "availability": "https://schema.org/InStock"}
        if listing.get("condition") in CONDITIONS:
            offer["itemCondition"] = f"https://schema.org/{CONDITIONS[listing['condition']]}"
        return {"@context": "https://schema.org", "@type": "Product", "name": listing["title"], "description": desc,
                "image": [image], "offers": offer}
    if kind in ("rental", "property_sale"):
        data = {"@context": "https://schema.org", "@type": "RealEstateListing", "name": listing["title"], "description": desc,
                "url": url, "image": [image], "contentLocation": area,
                "offers": {"@type": "Offer", "price": price, "priceCurrency": listing["currency"],
                           "businessFunction": "https://purl.org/goodrelations/v1#" + ("LeaseOut" if kind == "rental" else "Sell")}}
        if listing.get("published_at"):
            data["datePosted"] = listing["published_at"][:10]
        return data
    return None


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
    data = schema(listing, image, f"{SITE}{target}")
    # "</" can't appear inside the script block; escape it so a title can't end the block early.
    ld_json = json.dumps(data, ensure_ascii=False).replace("</", "<\\/") if data else ""
    ld = '\n  <script type="application/ld+json">' + ld_json + "</script>" if data else ""
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
  <meta http-equiv="refresh" content="0; url={target}">{ld}
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
    write_sitemap(listings)


STATIC_PAGES = ["", "browse.html", "plans.html", "download.html", "about.html", "help.html", "faq.html", "news.html",
                "featured.html", "waitlist.html", "community-guidelines.html", "refund-policy.html", "terms.html", "privacy.html",
                "contact.html", "law-enforcement.html"]


def write_sitemap(listings):
    """sitemap.xml: the site's public pages and every live listing (its canonical listing.html URL)."""
    urls = [f"<url><loc>{SITE}/{p}</loc></url>" for p in STATIC_PAGES if p == "" or (ROOT / p).exists()]
    for listing in listings:
        day = (listing.get("published_at") or "")[:10]
        urls.append(f"<url><loc>{SITE}/listing.html?id={listing['id']}</loc>" + (f"<lastmod>{day}</lastmod>" if day else "") + "</url>")
    (ROOT / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                                      + "\n".join(urls) + "\n</urlset>\n")
    print(f"Wrote sitemap.xml ({len(urls)} URLs)")


if __name__ == "__main__":
    main()
