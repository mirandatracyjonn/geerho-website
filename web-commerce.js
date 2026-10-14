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
  const choice = el("fieldset", { class: "choice-cards" }, el("legend", {}, "How you'll get it"),
    ...[["pickup", "Local pickup", pickup], ["shipping", `Shipping${listing.shipping_fee_cents ? ` (${money(listing.shipping_fee_cents, listing.currency)})` : listing.shipping_fee_cents === 0 ? " (free)" : ""}`, shipping]]
      .filter(([, , ok]) => ok)
      .map(([value, label]) => el("label", {}, el("input", { type: "radio", name: "delivery", value, checked: value === delivery }), " ", label)));
  const field = (name, label, value = "", required = true) =>
    el("div", {}, el("label", { for: `ship-${name}` }, label), el("input", { id: `ship-${name}`, name, value, required, autocomplete: name === "postal_code" ? "postal-code" : "on" }));
  const { data: home } = await supabase.rpc("my_home_address");
  const a = home?.address ?? {};
  const address = el("div", { class: "web-ship form-grid", hidden: delivery !== "shipping" },
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

/** The final stretch of an auction gets the big red timer (2 minutes, TJ 2026-10-14). */
const FINAL_MS = 2 * 60 * 1000;

/** "Thu, Oct 15, 11:42 AM": the full end date, so a week-long auction never reads as today. */
function endText(date) {
  return date.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "23h 41m 05s left" under a day, "2d 4h left" otherwise. */
function countdown(date) {
  const ms = date - Date.now();
  if (ms <= 0) return "Ending…";
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h left`;
  return `${h ? `${h}h ` : ""}${m}m ${String(s % 60).padStart(2, "0")}s left`;
}

/** The auction box, laid out like the big marketplaces: current bid, live countdown, a large bid field with quick-bid
 *  amounts, Place Bid, and Buy It Now behind its own button. Re-checks the auction every 20 seconds. */
export async function auctionPanel(listing) {
  const panel = el("div", { class: "panel web-auction" });
  const user = await currentUser();
  let timer = null, poll = null;
  const cur = listing.currency;

  async function draw(message) {
    const { data } = await supabase.rpc("auction_status", { listing: listing.id });
    const a = data?.[0];
    clearInterval(timer);
    if (!a) { panel.replaceChildren(); return; }
    const ends = a.auction_ends_at ? new Date(a.auction_ends_at) : null;
    const live = a.auction_state === "live" && ends && ends > new Date();
    const bids = a.bid_count ?? 0;
    const head = el("div", { class: "au-head" },
      el("p", { class: "au-label" }, bids ? "Current bid" : "Starting bid"),
      el("p", { class: "au-price" }, money(a.current_bid_cents ?? listing.price_cents, cur)),
      el("p", { class: "au-sub" }, `${bids} ${bids === 1 ? "bid" : "bids"}`,
        a.bidders ? ` · ${a.bidders} ${a.bidders === 1 ? "bidder" : "bidders"}` : "",
        a.reserve_met === false ? " · Reserve not met" : a.reserve_met === true && bids ? " · Reserve met" : ""));
    const clock = el("span", { class: "au-left" });
    const time = el("p", { class: "au-time" }, live ? [clock, el("span", { class: "au-ends" }, ` · Ends ${endText(ends)}`)]
      : a.auction_state === "live" ? "Time's up. Closing the auction, the winner shows here in about a minute."
      : a.auction_state ? "This auction has ended." : "This auction hasn't started yet.");
    // The final 2 minutes (like eBay): a red banner with a big mm:ss timer, and the bids re-checked every 5 seconds.
    const finalClock = el("span", { class: "au-final-clock", role: "timer", "aria-live": "off" });
    const final = el("div", { class: "au-final", hidden: true }, el("span", { class: "au-final-label" }, "Ending soon · bid now"), finalClock);
    panel.replaceChildren(head, final, time);
    if (live) {
      let lastFastCheck = Date.now();
      const tick = () => {
        const ms = ends - Date.now();
        clock.textContent = countdown(ends);
        clock.classList.toggle("soon", ms < 3600000);
        final.hidden = !(ms > 0 && ms <= FINAL_MS);
        if (!final.hidden) {
          const secs = Math.ceil(ms / 1000);
          finalClock.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
          if (Date.now() - lastFastCheck >= 5000 && !panel.contains(document.activeElement)) { lastFastCheck = Date.now(); clearInterval(timer); draw(); return; }
        }
        if (ms <= 0) { clearInterval(timer); setTimeout(() => draw(), 4000); }
      };
      tick();
      timer = setInterval(tick, 1000);
    }

    if (a.i_won && a.needs_checkout) {
      panel.append(el("p", { class: "status good" }, "You won! Complete your purchase."), await buyPanel(listing, { auctionWin: true }));
      return;
    }
    if (!live) return;
    if (!user) { panel.append(el("a", { class: "button au-bid", href: signInURL() }, "Sign in to bid")); return; }
    if (user.id === listing.seller_id) { panel.append(el("p", { class: "hint" }, "This is your auction. Bidders see a Place Bid button here.")); return; }

    if (a.am_leading) panel.append(el("p", { class: "status good au-status" },
      `You're the highest bidder${a.my_max_cents ? `. Your maximum: ${money(a.my_max_cents, cur)}` : ""}.`));
    else if (a.my_max_cents) panel.append(el("p", { class: "status bad au-status" }, "You've been outbid. Bid again to get back in the lead."));
    if (message) panel.append(message);

    const min = a.min_next_bid_cents ?? listing.price_cents;
    const step = a.current_bid_cents ? Math.max(min - a.current_bid_cents, 50) : Math.max(Math.round(min / 1000) * 100, 100);
    const input = el("input", { id: "au-amount", type: "number", min: (min / 100).toFixed(2), step: "0.01", inputmode: "decimal",
      placeholder: (min / 100).toFixed(2), "aria-describedby": "au-help" });
    const quick = el("div", { class: "au-quick", role: "group", "aria-label": "Quick bids" },
      [min, min + step, min + step * 3].map((cents) => {
        const b = el("button", { type: "button", class: "secondary" }, `Bid ${money(cents, cur)}`);
        b.addEventListener("click", () => { input.value = (cents / 100).toFixed(2); place(); });
        return b;
      }));
    const button = el("button", { type: "button", class: "au-bid" }, a.my_max_cents ? "Raise my maximum" : "Place bid");
    async function place() {
      const cents = Math.round(Number(input.value) * 100);
      if (!cents || cents < min) {
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      input.removeAttribute("aria-invalid");
      const { confirmDialog } = await import("./ui-dialog.js");
      if (!(await confirmDialog("Confirm your bid", `Your maximum bid is ${money(cents, cur)}. Geerho bids for you only as much as needed to keep you in the lead. A winning bid is a promise to buy.`, "Confirm bid"))) return;
      button.disabled = true;
      const { data: result, error: problem } = await supabase.rpc("place_bid", { listing: listing.id, max_bid_cents: cents });
      button.disabled = false;
      const note = el("p", { class: `status ${problem || result?.status !== "leading" ? "bad" : "good"} au-status`, role: "status" },
        problem ? friendlyError(problem)
          : result?.status === "leading" ? `Bid placed. You're the highest bidder at ${money(result.current_bid_cents, cur)}.`
          : `Someone has a higher maximum. Current bid: ${money(result.current_bid_cents, cur)}.`);
      draw(note);
    }
    button.addEventListener("click", place);
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") place(); });
    panel.append(
      el("label", { class: "au-field", for: "au-amount" }, el("span", { class: "au-currency", "aria-hidden": "true" }, cur === "PHP" ? "₱" : "$"), input),
      el("p", { id: "au-help", class: "hint" }, `Enter ${money(min, cur)} or more`),
      button, quick,
      el("p", { class: "hint" }, "Geerho bids for you only as much as needed to keep you in the lead, up to your maximum."));
    if (a.buy_now_available && listing.buy_now_cents) {
      const box = el("div", { class: "au-buynow", hidden: true });
      const open = el("button", { type: "button", class: "secondary au-bid" }, `Buy It Now · ${money(listing.buy_now_cents, cur)}`);
      open.addEventListener("click", async () => {
        if (!box.childElementCount) { const buy = await buyPanel(listing); if (buy) box.append(buy); }
        box.hidden = !box.hidden;
        open.setAttribute("aria-expanded", String(!box.hidden));
      });
      panel.append(el("div", { class: "au-or" }, "or"), open, box);
    }
  }

  await draw();
  poll = setInterval(() => { if (!panel.isConnected) return clearInterval(poll); if (!panel.contains(document.activeElement) && !panel.querySelector(".au-buynow:not([hidden])")) draw(); }, 20000);
  return panel;
}
