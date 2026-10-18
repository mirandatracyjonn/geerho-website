// Listing page: one listing with photos, price, details, seller, and the address rules for homes.
import { CONDITIONS, areaText, el, featuredUntil, formatBadge, getAddress, getListing, getRatingSummary, money, photoURL, priceLine,
  propertyFacts, richText } from "./site.js";

const PETS = { none: "No pets", cats: "Cats OK", dogs: "Dogs OK", cats_and_dogs: "Cats and dogs OK" };
const LAUNDRY = { in_unit: "In unit", on_site: "On site", none: "None" };
const ROLES = { owner: "Owner", agent: "Real estate agent or broker", property_manager: "Property manager" };

const status = document.getElementById("status");
const article = document.getElementById("listing");
const id = new URLSearchParams(location.search).get("id");

// Photos: a swipeable square strip (scroll-snap) with arrows, a "2 / 5" counter, and thumbnails. Each photo fills the
// square (new photos are cropped square when posted; older ones are centered), like the apps.
function gallery(photos) {
  const sorted = [...photos].sort((a, b) => a.position - b.position);
  if (!sorted.length) return el("div", { class: "gallery" }, el("div", { class: "gallery-main" }, el("span", { class: "no-photo" }, "No photo")));
  const urls = sorted.map((photo) => photoURL(photo.storage_path));
  const track = el("ul", { class: "gallery-track", "aria-label": "Photos", tabindex: "0" }, urls.map((url, index) =>
    el("li", { class: "gallery-slide" },
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
  const message = el("button", { type: "button", class: "secondary" }, isHome ? "Message the lister" : listing.kind === "job" ? "Message the poster" : "Message the seller");
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
      ? el("span", {}, "Verify your identity to message sellers. ", el("a", { href: "account.html#verify" }, "Verify now"), ".")
      : friendlyError(problem));
    error.hidden = false;
  });
  // Everything can be done right here, like the app: buy, bid, rent a tool, request a tour or a quote, respond to a job.
  const webBox = el("div", { class: "web-commerce" });
  const panelFor = async () => {
    if (isHome) return (await import("./web-requests.js")).tourPanel(listing);
    if (listing.kind === "service") return (await import("./web-requests.js")).quotePanel(listing);
    if (listing.kind === "job") return (await import("./web-requests.js")).respondPanel(listing);
    if (listing.listing_format === "rental") return (await import("./web-requests.js")).rentPanel(listing);
    const commerce = await import("./web-commerce.js");
    return listing.listing_format === "auction" ? commerce.auctionPanel(listing) : commerce.buyPanel(listing);
  };
  panelFor().then((panel) => { if (panel) webBox.append(panel); });
  // My own listing: manage it from Profile → My Listings, like the app's owner actions (no "Message the seller").
  import("./auth.js").then(async ({ currentUser }) => {
    const user = await currentUser();
    if (user?.id !== listing.seller_id) return;
    message.replaceWith(el("a", { class: "button secondary", href: "account.html#listings" }, "Manage in My Listings"));
  });
  const pinBox = el("div", { class: "pin-box" });
  exactSpot(listing, pinBox);
  return el("div", { class: "in-app" },
    webBox,
    pinBox,
    message,
    error,
    el("p", { class: "hint" }, isHome
      ? "Every member verifies their identity. Never send money before you've seen the home and confirmed the lister is authorized."
      : "Every member verifies their identity before transacting. Pay only through Geerho."),
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
    // Signed in: the winner of an ended auction (or a buyer) can still open it (M81).
    const { currentUser, supabase } = await import("./auth.js");
    if (await currentUser()) {
      const { LISTING_COLUMNS } = await import("./site.js");
      const { data } = await supabase.from("listings").select(LISTING_COLUMNS).eq("id", id).eq("status", "active").maybeSingle();
      listing = data;
    }
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

// --- Exact spot (M35): the poster pins the meeting place; only the people who need it can see it --------------------

const PIN_AUDIENCE = {
  property_sale: ["everyone", "Everyone can see it, like your street address."],
  rental: ["a renter whose tour you confirm", "Only renters whose tour you confirm can see it."],
  job: ["the pro you hire", "Only the pro you hire can see it, to find you and navigate there."],
};
function pinApplies(l) {
  if (l.kind === "property_sale" || l.kind === "rental") return true;
  if (l.kind === "job") return !l.remote_ok;
  if (l.kind === "item") return l.listing_format === "rental" || !!l.offers_pickup;
  return false;
}
function pinAudience(l) {
  if (PIN_AUDIENCE[l.kind]) return PIN_AUDIENCE[l.kind][1];
  return l.listing_format === "rental"
    ? "Only renters whose booking you accept can see it, until the item is returned."
    : "Only a buyer who picks it up can see it, after you accept their purchase.";
}

async function exactSpot(listing, box) {
  if (!pinApplies(listing)) return;
  const { currentUser, friendlyError, supabase } = await import("./auth.js");
  const user = await currentUser();
  if (!user) return;
  const { data: pin } = await supabase.from("listing_pins").select("listing_id, latitude, longitude, note").eq("listing_id", listing.id).maybeSingle();
  const mapLink = (p) => el("a", { class: "button secondary", href: `https://maps.google.com/?q=${p.latitude},${p.longitude}`, target: "_blank", rel: "noopener" }, "Open in Maps");
  if (user.id !== listing.seller_id) {
    if (pin) box.replaceChildren(el("div", { class: "panel" }, el("h3", {}, "📍 Exact spot"),
      pin.note ? el("p", {}, pin.note) : null, el("p", { class: "hint" }, "Shared with you by the poster. Don't share it with others."), mapLink(pin)));
    return;
  }
  const note = el("input", { type: "text", maxlength: "200", value: pin?.note ?? "", placeholder: "Note, e.g. Gate code or which entrance", "aria-label": "Note" });
  const problem = el("p", { class: "status bad", role: "alert", hidden: true });
  const place = el("button", { type: "button" }, pin ? "Move to My Current Location" : "Pin My Current Location");
  place.addEventListener("click", () => {
    problem.hidden = true;
    if (!navigator.geolocation) { problem.textContent = "This browser can't share your location."; problem.hidden = false; return; }
    place.disabled = true;
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const spot = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, note: note.value.trim() || null };
      // Move it if it exists; otherwise place it (same as the app).
      const { data: moved, error } = await supabase.from("listing_pins").update(spot).eq("listing_id", listing.id).select("listing_id");
      const result = !error && !(moved ?? []).length ? await supabase.from("listing_pins").insert({ listing_id: listing.id, ...spot }) : { error };
      place.disabled = false;
      if (result.error) { problem.textContent = friendlyError(result.error); problem.hidden = false; return; }
      exactSpot(listing, box);
    }, () => { place.disabled = false; problem.textContent = "Location wasn't shared. Allow location access and stand at the spot."; problem.hidden = false; },
    { enableHighAccuracy: true, timeout: 15000 });
  });
  const remove = pin ? el("button", { type: "button", class: "secondary" }, "Remove Pin") : null;
  remove?.addEventListener("click", async () => {
    const { error } = await supabase.from("listing_pins").delete().eq("listing_id", listing.id);
    if (error) { problem.textContent = friendlyError(error); problem.hidden = false; return; }
    exactSpot(listing, box);
  });
  box.replaceChildren(el("div", { class: "panel" }, el("h3", {}, "📍 Exact spot"),
    el("p", { class: "hint" }, `${pin ? "Pinned. " : "Stand at the meeting place and pin it. "}${pinAudience(listing)}`),
    note, problem, el("div", { class: "actions" }, place, pin ? mapLink(pin) : null, remove)));
}
