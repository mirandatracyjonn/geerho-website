// Geerho website: shared settings and helpers. Listings are read live from the same Supabase project as the
// iPhone app, using the public (publishable) key: visitors see exactly what a signed-out app user sees. Buying,
// bidding, renting, and messaging happen only in the app, after identity verification.

export const SUPABASE_URL = "https://zdumomkbwgognuehsgtq.supabase.co";
// Publishable key: safe to ship in a web page. Row-level security decides what it can read.
const SUPABASE_KEY = "sb_publishable_SEag6fSR5xQemF6KmEEtZA_vr6ot6B3";

// Fill these in when the links exist; until then the Download page says "coming soon".
export const TESTFLIGHT_URL = null; // e.g. "https://testflight.apple.com/join/XXXXXXXX"
export const APP_STORE_URL = null;  // e.g. "https://apps.apple.com/app/id0000000000"

const PHOTO_BASE = `${SUPABASE_URL}/storage/v1/object/public/listing-photos/`;

export const CONDITIONS = {
  new: "New",
  like_new: "Like new",
  good: "Good",
  fair: "Fair",
  for_parts: "For parts or not working",
};

async function request(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

/** Same search the app uses. Null fields are left out so the database defaults apply. */
export function searchListings(params) {
  const body = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== null && value !== undefined && value !== ""));
  return request("rpc/search_listings", { method: "POST", body: JSON.stringify(body) });
}

const LISTING_COLUMNS = [
  "id", "category_id", "title", "description", "price_cents", "currency", "condition", "status", "city", "region",
  "published_at", "expires_at", "offers_pickup", "offers_shipping", "shipping_carriers", "shipping_fee_cents",
  "reference", "listing_format", "auction_ends_at", "buy_now_cents", "current_bid_cents", "bid_count", "reserve_met",
  "auction_state", "weekly_rate_cents", "deposit_cents", "max_rental_days", "late_fee_cents", "lending_radius_miles",
  "seller_id", "listing_photos(storage_path,position,width,height)",
].join(",");

export async function getListing(id) {
  const rows = await request(`listings?select=${LISTING_COLUMNS}&id=eq.${encodeURIComponent(id)}&status=eq.active`);
  return rows[0] ?? null;
}

export function getCategories() {
  return request("categories?select=id,name,parent_id,kind,position&order=position");
}

export async function getRatingSummary(userId) {
  const rows = await request("rpc/rating_summary", { method: "POST", body: JSON.stringify({ target: userId }) });
  return rows[0] ?? null;
}

export const photoURL = (path) => PHOTO_BASE + path.split("/").map(encodeURIComponent).join("/");

export function money(cents, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** "2d 4h left", "35m left", or "Ended". */
export function timeLeft(isoDate) {
  const ms = new Date(isoDate) - Date.now();
  if (ms <= 0) return "Ended";
  const minutes = Math.floor(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes % 60}m left`;
  return `${Math.max(minutes, 1)}m left`;
}

/** Small DOM helper: el("p", { class: "x" }, "text", child). Text is always set as text, never as HTML. */
export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** What the card's price line says, by listing format. */
export function priceLine(listing) {
  if (listing.listing_format === "rental") return `${money(listing.price_cents, listing.currency)} / day`;
  if (listing.listing_format === "auction") {
    const bids = listing.bid_count ?? 0;
    const amount = money(listing.current_bid_cents ?? listing.price_cents, listing.currency);
    return bids > 0 ? `${amount} · ${bids} ${bids === 1 ? "bid" : "bids"}` : `${amount} starting bid`;
  }
  return money(listing.price_cents, listing.currency);
}

export function formatBadge(listing) {
  if (listing.listing_format === "rental") return "For rent";
  if (listing.listing_format === "auction") return "Auction";
  return null;
}

export function listingCard(listing) {
  const badge = formatBadge(listing);
  const place = [listing.city, listing.region].filter(Boolean).join(", ");
  const extra = listing.listing_format === "auction" && listing.auction_ends_at
    ? timeLeft(listing.auction_ends_at)
    : listing.offers_shipping
      ? (listing.shipping_fee_cents === 0 ? "Free shipping" : "Ships")
      : listing.offers_pickup ? "Local pickup" : null;
  return el("li", { class: "card" },
    el("a", { href: `listing.html?id=${encodeURIComponent(listing.id)}` },
      el("div", { class: "card-photo" },
        listing.cover_path
          ? el("img", { src: photoURL(listing.cover_path), alt: "", loading: "lazy" })
          : el("span", { class: "no-photo" }, "No photo"),
        badge && el("span", { class: "badge" }, badge),
      ),
      el("span", { class: "card-title" }, listing.title),
      el("span", { class: "card-price" }, priceLine(listing)),
      el("span", { class: "card-meta" }, [place, extra].filter(Boolean).join(" · ")),
    ),
  );
}

/** The download link for "do this in the app" buttons. */
export function appLink(reason) {
  return reason ? `download.html?for=${encodeURIComponent(reason)}` : "download.html";
}
