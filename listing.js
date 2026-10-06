import { CONDITIONS, appLink, el, formatBadge, getListing, getRatingSummary, money, photoURL, priceLine, timeLeft } from "./site.js";

const status = document.getElementById("status");
const article = document.getElementById("listing");
const id = new URLSearchParams(location.search).get("id");

function gallery(photos) {
  const sorted = [...photos].sort((a, b) => a.position - b.position);
  if (!sorted.length) return el("div", { class: "gallery-main" }, el("span", { class: "no-photo" }, "No photo"));
  const main = el("img", { src: photoURL(sorted[0].storage_path), alt: "Photo 1 of " + sorted.length });
  const thumbs = sorted.length > 1
    ? el("ul", { class: "thumbs" }, sorted.map((photo, index) => {
        const button = el("button", { type: "button", "aria-label": `Show photo ${index + 1}`, "aria-pressed": index === 0 ? "true" : "false" },
          el("img", { src: photoURL(photo.storage_path), alt: "", loading: "lazy" }));
        button.addEventListener("click", () => {
          main.src = photoURL(photo.storage_path);
          main.alt = `Photo ${index + 1} of ${sorted.length}`;
          for (const other of button.closest("ul").querySelectorAll("button")) other.setAttribute("aria-pressed", "false");
          button.setAttribute("aria-pressed", "true");
        });
        return el("li", {}, button);
      }))
    : null;
  return el("div", { class: "gallery" }, el("div", { class: "gallery-main" }, main), thumbs);
}

function facts(listing) {
  const rows = [];
  const add = (label, value) => value && rows.push(el("div", {}, el("dt", {}, label), el("dd", {}, value)));
  const c = listing.currency;
  if (listing.listing_format === "rental") {
    add("Daily rate", money(listing.price_cents, c));
    if (listing.weekly_rate_cents) add("Weekly rate", money(listing.weekly_rate_cents, c));
    if (listing.deposit_cents) add("Refundable deposit", money(listing.deposit_cents, c));
    if (listing.late_fee_cents) add("Late fee", `${money(listing.late_fee_cents, c)} a day, from the deposit`);
    if (listing.max_rental_days) add("Longest rental", `${listing.max_rental_days} days`);
    add("Handover", listing.lending_radius_miles
      ? `Local pickup only, for renters within ${listing.lending_radius_miles} miles`
      : "Local pickup only");
  } else {
    if (listing.listing_format === "auction") {
      const bids = listing.bid_count ?? 0;
      add(bids ? "Current bid" : "Starting bid", money(listing.current_bid_cents ?? listing.price_cents, c));
      add("Bids", String(bids));
      if (listing.auction_ends_at) {
        add("Ends", `${new Date(listing.auction_ends_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} (${timeLeft(listing.auction_ends_at)})`);
      }
      if (listing.buy_now_cents && bids === 0) add("Buy It Now", money(listing.buy_now_cents, c));
      if (listing.reserve_met === false && bids > 0) add("Reserve", "Not met yet");
    }
    const handover = [];
    if (listing.offers_pickup) handover.push("Local pickup");
    if (listing.offers_shipping) {
      handover.push(listing.shipping_fee_cents === 0 ? "Free shipping"
        : listing.shipping_fee_cents ? `Shipping ${money(listing.shipping_fee_cents, c)}` : "Shipping");
    }
    add("Handover", handover.join(" or "));
  }
  add("Condition", CONDITIONS[listing.condition]);
  add("Location", [listing.city, listing.region].filter(Boolean).join(", "));
  add("Listing ID", listing.reference);
  return el("dl", { class: "facts" }, rows);
}

function actions(listing) {
  const verb = listing.listing_format === "rental" ? "Rent"
    : listing.listing_format === "auction" ? "Bid"
    : "Buy";
  return el("div", { class: "in-app" },
    el("a", { class: "button", href: appLink(listing.reference) }, `${verb} in the app`),
    el("a", { class: "button secondary", href: appLink(listing.reference) }, "Message the seller"),
    el("p", { class: "hint" }, "Buying, bidding, renting, and messaging happen in the Geerho app, where every member verifies their identity."),
  );
}

async function render() {
  if (!id) {
    status.textContent = "This listing wasn't found.";
    return;
  }
  let listing;
  try {
    listing = await getListing(id);
  } catch {
    status.textContent = "We couldn't load this listing right now. Please try again later.";
    return;
  }
  if (!listing) {
    status.replaceChildren("This listing is no longer available. It may have sold or expired. ",
      el("a", { href: "browse.html" }, "Browse other listings"), ".");
    return;
  }

  document.title = `${listing.title} · Geerho`;
  const badge = formatBadge(listing);
  const seller = el("p", { class: "seller" }, "Sold by a verified Geerho member.");
  article.append(
    gallery(listing.listing_photos ?? []),
    el("div", { class: "listing-body" },
      badge && el("span", { class: "badge inline" }, badge),
      el("h1", {}, listing.title),
      el("p", { class: "listing-price" }, priceLine(listing)),
      actions(listing),
      facts(listing),
      el("h2", {}, "Description"),
      el("p", { class: "description" }, listing.description),
      seller,
    ),
  );
  status.hidden = true;
  article.hidden = false;

  try {
    const rating = await getRatingSummary(listing.seller_id);
    if (rating?.total) {
      seller.textContent = `Seller rating: ★ ${Number(rating.average).toFixed(1)} from ${rating.total} ${rating.total === 1 ? "review" : "reviews"}.`;
    }
  } catch {
    // The rating is optional.
  }
}

render();
