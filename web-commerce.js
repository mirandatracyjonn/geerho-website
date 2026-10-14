// Buying and bidding on geerho.com (website parity, 2026-10-14). Uses the same database functions and payments as the
// apps (place_order, complete_auction_purchase, auction_status, place_bid, payments "checkout" with from: "web"), so a
// purchase made here shows up in the apps at once, and vice versa.
import { el, money } from "./site.js";
import { currentUser, friendlyError, signInURL, supabase } from "./auth.js";

const COUNTRIES = { US: "United States", PH: "Philippines" };

/** Buy Now (fixed price, or Buy It Now on an auction) and, for the auction's winner, Complete Purchase. */
export async function buyPanel(listing, { auctionWin = false } = {}) {
  const panel = el("div", { class: "panel web-buy" });
  const user = await currentUser();
  if (!user) {
    panel.append(el("a", { class: "button", href: signInURL() }, auctionWin ? "Sign in to complete your purchase" : "Sign in to buy"));
    return panel;
  }
  if (user.id === listing.seller_id) return null;

  // Already requested?
  const { data: open } = await supabase.from("orders").select("id, respond_by, status")
    .eq("listing_id", listing.id).eq("buyer_id", user.id).eq("status", "requested").limit(1);
  if (open?.length) {
    const until = new Date(open[0].respond_by).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
    panel.append(el("p", { class: "status good" }, `You asked to buy this. The seller has until ${until} to accept.`),
      el("a", { class: "button secondary", href: "purchases.html" }, "See my purchases"));
    return panel;
  }
  if (!auctionWin) {
    const { data: reserved } = await supabase.rpc("listing_is_reserved", { listing: listing.id });
    if (reserved) {
      panel.append(el("p", { class: "status" }, "Someone else asked to buy this. If the seller doesn't accept within 24 hours, it's available again."));
      return panel;
    }
  }

  const shipping = listing.offers_shipping, pickup = listing.offers_pickup;
  let delivery = shipping && !pickup ? "shipping" : "pickup";
  const form = el("form", { class: "web-buy-form", novalidate: true });
  const choice = el("fieldset", {}, el("legend", {}, "How you'll get it"),
    ...[["pickup", "Local pickup", pickup], ["shipping", `Shipping${listing.shipping_fee_cents ? ` (${money(listing.shipping_fee_cents, listing.currency)})` : listing.shipping_fee_cents === 0 ? " (free)" : ""}`, shipping]]
      .filter(([, , ok]) => ok)
      .map(([value, label]) => el("label", {}, el("input", { type: "radio", name: "delivery", value, checked: value === delivery }), " ", label)));
  const field = (name, label, value = "", required = true) =>
    el("div", {}, el("label", { for: `ship-${name}` }, label), el("input", { id: `ship-${name}`, name, value, required, autocomplete: name === "postal_code" ? "postal-code" : "on" }));
  const { data: home } = await supabase.rpc("my_home_address");
  const a = home?.address ?? {};
  const address = el("div", { class: "web-ship", hidden: delivery !== "shipping" },
    field("name", "Full name", home?.legal_name ?? ""), field("line1", "Street address", a.line1 ?? ""),
    field("line2", "Apt, suite (optional)", a.line2 ?? "", false), field("city", "City", a.city ?? ""),
    field("region", "State / province", a.region ?? ""), field("postal_code", "ZIP / postal code", a.postal_code ?? ""),
    el("div", {}, el("label", { for: "ship-country" }, "Country"),
      el("select", { id: "ship-country", name: "country" }, ...Object.entries(COUNTRIES).map(([code, name]) =>
        el("option", { value: code, selected: code === (a.country ?? (listing.currency === "PHP" ? "PH" : "US")) }, name)))),
    field("phone", "Phone (for the carrier)", "", false));
  choice.addEventListener("change", (event) => { delivery = event.target.value; address.hidden = delivery !== "shipping"; });
  const note = el("textarea", { name: "note", maxlength: 500, placeholder: "Note to the seller (optional)" });
  const error = el("p", { class: "status bad", role: "alert", hidden: true });
  const button = el("button", { type: "submit" }, auctionWin ? "Complete Purchase" : "Buy Now");
  form.append(choice, address, note, button, error,
    el("p", { class: "hint" }, "If the seller takes card payments, you pay now and Geerho holds the money until you have the item. The seller has 24 hours to accept."));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    button.disabled = true;
    const data = new FormData(form);
    const shipTo = delivery === "shipping" ? Object.fromEntries(["name", "line1", "line2", "city", "region", "postal_code", "country", "phone"]
      .map((k) => [k, String(data.get(k) ?? "").trim()])) : null;
    const params = { listing: listing.id, delivery, ...(shipTo ? { ship_to: shipTo } : {}), ...(String(data.get("note")).trim() ? { note: String(data.get("note")).trim() } : {}) };
    const { data: orderId, error: problem } = await supabase.rpc(auctionWin ? "complete_auction_purchase" : "place_order", params);
    if (problem) {
      button.disabled = false;
      error.replaceChildren(/verif/i.test(problem.message)
        ? el("span", {}, "Verify your identity to buy. ", el("a", { href: "account.html" }, "Verify now"), ".")
        : friendlyError(problem));
      error.hidden = false;
      return;
    }
    const { data: cards } = await supabase.rpc("accepts_card_payments", { seller: listing.seller_id });
    if (cards) {
      const { data: session, error: payError } = await supabase.functions.invoke("payments", { body: { action: "checkout", order_id: orderId, from: "web" } });
      if (!payError && session?.url) { location.href = session.url; return; }
    }
    form.replaceWith(el("div", {}, el("p", { class: "status good" }, cards
      ? "Your request is in. Finish paying from My purchases."
      : "Your request is in. This seller doesn't take card payments yet: agree on payment in Messages, and never pay outside Geerho with gift cards, wire transfers, or crypto."),
      el("a", { class: "button secondary", href: "purchases.html" }, "See my purchases")));
  });
  panel.append(form);
  return panel;
}

/** The auction box: current bid, time left, Place Bid; the winner completes the purchase here. */
export async function auctionPanel(listing) {
  const panel = el("div", { class: "panel web-auction" });
  const { data } = await supabase.rpc("auction_status", { listing: listing.id });
  const a = data?.[0];
  if (!a) return panel;
  const ends = a.auction_ends_at ? new Date(a.auction_ends_at) : null;
  const live = a.auction_state === "live" && ends && ends > new Date();
  panel.append(el("p", { class: "listing-price" }, a.current_bid_cents ? `${money(a.current_bid_cents, listing.currency)} · ${a.bid_count} ${a.bid_count === 1 ? "bid" : "bids"}` : "No bids yet"),
    el("p", { class: "meta" }, live ? `Ends ${ends.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "This auction has ended.",
      a.reserve_met === false ? " · Reserve not met yet" : ""));
  if (a.i_won && a.needs_checkout) {
    panel.append(el("p", { class: "status good" }, "You won! Complete your purchase."), await buyPanel(listing, { auctionWin: true }));
    return panel;
  }
  if (!live) return panel;
  const user = await currentUser();
  if (!user) { panel.append(el("a", { class: "button", href: signInURL() }, "Sign in to bid")); return panel; }
  if (user.id === listing.seller_id) return panel;
  if (a.am_leading) panel.append(el("p", { class: "status good" }, `You're the highest bidder${a.my_max_cents ? ` (your maximum: ${money(a.my_max_cents, listing.currency)})` : ""}.`));
  const min = (a.min_next_bid_cents ?? 0) / 100;
  const input = el("input", { type: "number", min, step: "0.01", value: min.toFixed(2), "aria-label": "Your maximum bid", inputmode: "decimal" });
  const error = el("p", { class: "status", role: "status", hidden: true });
  const button = el("button", { type: "button" }, a.my_max_cents ? "Raise My Maximum" : "Place Bid");
  button.addEventListener("click", async () => {
    button.disabled = true;
    const cents = Math.round(Number(input.value) * 100);
    const { data: result, error: problem } = await supabase.rpc("place_bid", { listing: listing.id, max_bid_cents: cents });
    button.disabled = false;
    error.hidden = false;
    error.className = problem ? "status bad" : "status good";
    error.textContent = problem ? friendlyError(problem)
      : result?.status === "leading" ? `You're the highest bidder at ${money(result.current_bid_cents, listing.currency)}.`
      : `Someone has a higher maximum. Current bid: ${money(result.current_bid_cents, listing.currency)}.`;
  });
  panel.append(el("label", {}, `Your maximum bid (at least ${money(a.min_next_bid_cents, listing.currency)})`), input, button, error,
    el("p", { class: "hint" }, "Geerho bids for you only as much as needed to keep you in the lead, up to your maximum."));
  if (a.buy_now_available) {
    const buy = await buyPanel(listing);
    if (buy) panel.append(el("h3", {}, "Or buy it now"), buy);
  }
  return panel;
}
