// Listing page: one listing with photos, price, details, seller, and the address rules for homes.
import { CONDITIONS, appLink, areaText, el, featuredUntil, formatBadge, getAddress, getListing, getRatingSummary, money, photoURL, priceLine,
  propertyFacts, richText } from "./site.js";

const PETS = { none: "No pets", cats: "Cats OK", dogs: "Dogs OK", cats_and_dogs: "Cats and dogs OK" };
const LAUNDRY = { in_unit: "In unit", on_site: "On site", none: "None" };
const ROLES = { owner: "Owner", agent: "Real estate agent or broker", property_manager: "Property manager" };

const status = document.getElementById("status");
const article = document.getElementById("listing");
const id = new URLSearchParams(location.search).get("id");

// Photos: a swipeable square strip (scroll-snap) with arrows, a "2 / 5" counter, and thumbnails. Each photo is shown
// whole over a soft blurred copy of itself, so tall and wide photos fill the square without cropping.
function gallery(photos) {
  const sorted = [...photos].sort((a, b) => a.position - b.position);
  if (!sorted.length) return el("div", { class: "gallery" }, el("div", { class: "gallery-main" }, el("span", { class: "no-photo" }, "No photo")));
  const urls = sorted.map((photo) => photoURL(photo.storage_path));
  const track = el("ul", { class: "gallery-track", "aria-label": "Photos", tabindex: "0" }, urls.map((url, index) =>
    el("li", { class: "gallery-slide" },
      el("img", { class: "gallery-backdrop", src: url, alt: "", "aria-hidden": "true", loading: index ? "lazy" : "eager" }),
      el("img", { class: "gallery-photo", src: url, alt: `Photo ${index + 1} of ${urls.length}`, loading: index ? "lazy" : "eager" }))));
  const counter = el("span", { class: "gallery-count", "aria-hidden": "true" }, `1 / ${urls.length}`);
  const show = (index) => track.scrollTo({ left: index * track.clientWidth, behavior: "smooth" });
  const current = () => Math.round(track.scrollLeft / Math.max(track.clientWidth, 1));
  const thumbs = urls.length > 1 ? el("ul", { class: "thumbs" }, urls.map((url, index) => {
    const button = el("button", { type: "button", "aria-label": `Show photo ${index + 1}`, "aria-pressed": index === 0 ? "true" : "false" },
      el("img", { src: url, alt: "", loading: "lazy" }));
    button.addEventListener("click", () => show(index));
    return el("li", {}, button);
  })) : null;
  track.addEventListener("scroll", () => {
    const index = current();
    counter.textContent = `${index + 1} / ${urls.length}`;
    thumbs?.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String(i === index)));
  }, { passive: true });
  track.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") show(Math.min(current() + 1, urls.length - 1));
    if (event.key === "ArrowLeft") show(Math.max(current() - 1, 0));
  });
  const arrow = (dir, label) => {
    const b = el("button", { type: "button", class: `gallery-arrow ${dir}`, "aria-label": label }, dir === "prev" ? "‹" : "›");
    b.addEventListener("click", () => show(Math.max(0, Math.min(urls.length - 1, current() + (dir === "prev" ? -1 : 1)))));
    return b;
  };
  return el("div", { class: "gallery" },
    el("div", { class: "gallery-main" }, track, urls.length > 1 && [arrow("prev", "Previous photo"), arrow("next", "Next photo"), counter]),
    thumbs);
}

function facts(listing, address) {
  const rows = [];
  const add = (label, value) => value && rows.push(el("div", {}, el("dt", {}, label), el("dd", {}, value)));
  const c = listing.currency;
  if (listing.kind === "rental" || listing.kind === "property_sale") {
    add("Home", propertyFacts(listing));
    if (address) add("Address", [address.street, address.unit, listing.city, listing.region].filter(Boolean).join(", "));
    else add("Area", [listing.city, listing.region].filter(Boolean).join(", "));
    if (listing.kind === "rental") {
      if (listing.security_deposit_cents) add("Security deposit", money(listing.security_deposit_cents, c));
      if (listing.lease_months) add("Lease", listing.lease_months === 1 ? "Month to month" : `${listing.lease_months} months`);
      if (listing.available_from) add("Available", new Date(`${listing.available_from}T12:00:00`).toLocaleDateString([], { dateStyle: "medium" }));
      if (listing.furnished != null) add("Furnished", listing.furnished ? "Yes" : "No");
      if (listing.pets) add("Pets", PETS[listing.pets]);
      if (listing.utilities_included) add("Utilities included", listing.utilities_included);
    } else {
      if (listing.hoa_fee_cents) add("HOA fee", `${money(listing.hoa_fee_cents, c)} / month`);
      add("Lot", areaText(listing.lot_area_sqm, listing.country));
    }
    if (listing.year_built) add("Built", String(listing.year_built));
    if (listing.parking_spaces != null) add("Parking", listing.parking_spaces === 0 ? "None" : `${listing.parking_spaces} spaces`);
    if (listing.laundry) add("Laundry", LAUNDRY[listing.laundry]);
    if (listing.lister_role) add("Listed by", ROLES[listing.lister_role]);
    add("Listing ID", listing.reference);
    return el("dl", { class: "facts" }, rows);
  }
  if (listing.kind === "service" || listing.kind === "job") {
    add(listing.kind === "job" ? "Budget" : "Price", priceLine(listing));
    if (listing.profession) add("Kind of work", listing.profession.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()));
    if (listing.remote_ok) add("Remote", listing.kind === "job" ? "Can be done remotely" : "Works remotely");
    if (listing.travel_radius_km) add("Travels", `Up to ${Math.round(listing.travel_radius_km / 1.609)} miles`);
    if (listing.years_experience != null) add("Experience", `${listing.years_experience} years`);
    if (listing.needed_by) add("Needed by", new Date(`${listing.needed_by}T12:00:00`).toLocaleDateString([], { dateStyle: "medium" }));
    add("Location", [listing.city, listing.region].filter(Boolean).join(", "));
    add("Listing ID", listing.reference);
    return el("dl", { class: "facts" }, rows);
  }
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
  const isHome = listing.kind === "rental" || listing.kind === "property_sale";
  const verb = isHome ? "Request a tour" : listing.kind === "service" ? "Request a quote" : listing.kind === "job" ? "Respond"
    : listing.listing_format === "rental" ? "Rent"
    : listing.listing_format === "auction" ? "Bid"
    : "Buy";
  const message = el("button", { type: "button", class: "secondary" }, "Message the seller");
  const error = el("p", { class: "status bad", role: "alert", hidden: true });
  message.addEventListener("click", async () => {
    // Loaded only when needed, so browsing stays light.
    const { currentUser, friendlyError, signInURL, supabase } = await import("./auth.js");
    if (!(await currentUser())) {
      location.assign(signInURL());
      return;
    }
    message.disabled = true;
    error.hidden = true;
    const { data: conversationId, error: problem } = await supabase.rpc("start_conversation", { listing: listing.id });
    if (!problem) {
      location.assign(`messages.html?c=${conversationId}`);
      return;
    }
    message.disabled = false;
    error.replaceChildren(/verif/i.test(problem.message)
      ? el("span", {}, "Verify your identity to message sellers. ", el("a", { href: "account.html" }, "Verify now"), ".")
      : friendlyError(problem));
    error.hidden = false;
  });
  // Items and auctions can be bought and bid on right here (website parity); rentals, homes, and services still in the app.
  const onWeb = (listing.kind ?? "item") === "item" && listing.listing_format !== "rental";
  const webBox = el("div", { class: "web-commerce" });
  if (onWeb) {
    import("./web-commerce.js").then(async ({ auctionPanel, buyPanel }) => {
      const panel = listing.listing_format === "auction" ? await auctionPanel(listing) : await buyPanel(listing);
      if (panel) webBox.append(panel);
    });
  }
  return el("div", { class: "in-app" },
    onWeb ? webBox : el("a", { class: "button", href: appLink(listing.reference) }, `${verb} in the app`),
    message,
    error,
    el("p", { class: "hint" }, listing.kind === "service" || listing.kind === "job"
      ? "Quote requests and job responses on the website are coming soon. Every member verifies their identity first."
      : isHome
      ? "Tour requests on the website are coming soon. Never send money before you've seen the home and confirmed the lister is authorized."
      : onWeb ? "Every member verifies their identity before buying or bidding. Pay only through Geerho."
      : "Renting on the website is coming soon. Every member verifies their identity before transacting."),
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
  const isHome = listing.kind === "rental" || listing.kind === "property_sale";
  const address = isHome ? await getAddress(listing.id).catch(() => null) : null;
  const badge = formatBadge(listing);
  const featured = await featuredUntil(listing.id).catch(() => null);
  const seller = el("p", { class: "seller" }, isHome ? "Listed by a verified Geerho member." : "Sold by a verified Geerho member.");
  article.append(
    gallery(listing.listing_photos ?? []),
    el("div", { class: "listing-body" },
      badge && el("span", { class: "badge inline" }, badge),
      featured && el("span", { class: "badge inline featured" }, "Featured"),
      el("h1", {}, listing.title),
      listing.listing_format !== "auction" && el("p", { class: "listing-price" }, priceLine(listing)),
      actions(listing),
      facts(listing, address),
      el("h2", {}, "Description"),
      richText(listing.description),
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
