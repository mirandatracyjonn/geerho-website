// The screens behind each Profile row on geerho.com, copied from the iPhone app (the gold standard, TJ 2026-10-14):
// same titles, sections, wording, and actions, using the same database functions as the apps, so anything done here
// shows up in the apps at once. Opened by profile.js as account.html#<screen>.
import { el, money, photoURL } from "./site.js";
import { friendlyError, supabase } from "./auth.js";
import { icon, rowIcon } from "./icons.js";
import { avatar, inviteFriends, screenHead } from "./profile.js";
import { confirmDialog, reviewDialog, textDialog } from "./ui-dialog.js";

const CARRIERS = { usps: "USPS", ups: "UPS", fedex: "FedEx", dhl: "DHL", lbc: "LBC", jnt: "J&T Express", ninjavan: "Ninja Van",
  flash: "Flash Express", phlpost: "PHLPost", lalamove: "Lalamove" };
const US_CARRIERS = ["usps", "ups", "fedex", "dhl"];
const PH_CARRIERS = ["lbc", "jnt", "ninjavan", "flash", "phlpost", "lalamove"];

// --- Small building blocks ---------------------------------------------------------------------------------------

const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const dayTime = (iso) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const dateOnly = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** "in 2d 4h", "in 35m", or "now". */
function until(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return "now";
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? `in ${d}d ${h}h` : h ? `in ${h}h ${m % 60}m` : `in ${Math.max(m, 1)}m`;
}

function cover(photos) {
  const first = [...(photos ?? [])].sort((a, b) => a.position - b.position)[0];
  return first?.storage_path ?? null;
}

function thumb(path, fallback = "tag") {
  return path ? el("img", { class: "thumb", src: photoURL(path), alt: "", loading: "lazy" }) : el("span", { class: "thumb" }, icon(fallback));
}

/** A row with a photo, a bold title, a detail line, and a colored status line. */
function itemRow(href, path, title, detail, state, tone = "muted", fallback = "tag") {
  const inner = [thumb(path, fallback), el("span", { class: "row-title" }, el("strong", {}, title),
    detail ? el("small", {}, detail) : null, state ? el("span", { class: `state ${tone}` }, state) : null)];
  return href ? el("a", { class: "item-row", href }, ...inner, icon("chevronRight", "chev")) : el("div", { class: "item-row" }, ...inner);
}

function group(rows, title = null, footer = null) {
  const items = rows.filter(Boolean);
  if (!items.length) return null;
  return [title ? el("p", { class: "group-title" }, title) : null,
    el("ul", { class: "group plain" }, items.map((row) => (row.tagName === "LI" ? row : el("li", {}, row)))),
    footer ? el("p", { class: "group-footer" }, footer) : null];
}

function empty(iconName, title, text) {
  return el("div", { class: "empty" }, icon(iconName), el("strong", {}, title), el("p", {}, text));
}

function segmented(options, selected, onChange) {
  const bar = el("div", { class: "segmented", role: "group" });
  for (const [value, label] of options) {
    const b = el("button", { type: "button", "aria-pressed": String(value === selected) }, label);
    b.addEventListener("click", () => onChange(value));
    bar.append(b);
  }
  return bar;
}

function actionsBar(...buttons) {
  const items = buttons.filter(Boolean);
  return items.length ? el("div", { class: "actions" }, items) : null;
}

function button(label, onClick, kind = "") {
  const b = el("button", { type: "button", class: kind }, label);
  b.addEventListener("click", async () => {
    b.disabled = true;
    try { await onClick(); } finally { b.disabled = false; }
  });
  return b;
}

/** Runs a change after a yes/no question; shows a friendly error or reloads the screen. */
function confirmThen(ctx, question, message, okLabel, run, { danger = false } = {}) {
  return async () => {
    if (!(await confirmDialog(question, message, okLabel, { danger }))) return;
    const result = await run();
    if (result?.error) return ctx.fail(friendlyError(result.error));
    ctx.reload();
  };
}

function carrierPicker(country, allowed) {
  const list = (allowed?.length ? allowed : country === "PH" ? PH_CARRIERS : US_CARRIERS).filter((c) => CARRIERS[c]);
  return el("select", { "aria-label": "Carrier" }, list.map((c) => el("option", { value: c }, CARRIERS[c])));
}

async function payWithCard(ctx, body) {
  const { data, error } = await supabase.functions.invoke("payments", { body: { action: "checkout", from: "web", ...body } });
  if (data?.url) location.href = data.url;
  else ctx.fail(error ? "We couldn't open checkout. Please try again." : "");
}

// --- My Bids (MyBidsView): Active · Won · Ended ------------------------------------------------------------------

async function bids(ctx) {
  const { data, error } = await supabase.rpc("my_bids");
  if (error) throw error;
  const rows = data ?? [];
  if (!rows.length) return [empty("hammer", "No bids yet", "Auctions you bid on show up here.")];
  const live = rows.filter((b) => b.auction_state === "live" && new Date(b.auction_ends_at) > new Date());
  const won = rows.filter((b) => !live.includes(b) && b.my_status === "won");
  const ended = rows.filter((b) => !live.includes(b) && !won.includes(b));
  const row = (b) => {
    const detail = `${b.current_bid_cents ? `Bid ${money(b.current_bid_cents, b.currency)}` : "No bids"} · ${b.bid_count} ${b.bid_count === 1 ? "bid" : "bids"}`
      + (b.my_max_cents ? ` · your max ${money(b.my_max_cents, b.currency)}` : "");
    const [state, tone] = b.needs_checkout ? ["You won! Complete your purchase", "good"]
      : b.my_status === "leading" ? [`You're winning · ends ${until(b.auction_ends_at)}`, "info"]
      : b.my_status === "outbid" ? [`Outbid · ends ${until(b.auction_ends_at)}`, "bad"]
      : b.my_status === "won" ? ["Won", "good"]
      : b.auction_state === "sold" ? ["Ended · sold", "muted"] : ["Ended", "muted"];
    const href = `listing.html?id=${b.listing_id}`;
    if (!b.needs_checkout) return itemRow(href, b.cover_path, b.title, detail, state, tone, "hammer");
    return el("div", { class: "item" }, itemRow(href, b.cover_path, b.title, detail, state, tone, "hammer"),
      actionsBar(el("a", { class: "button", href: `${href}#complete` }, "Complete Purchase")));
  };
  return [group(live.map(row), "Active"), group(won.map(row), "Won"), group(ended.map(row), "Ended")];
}

// --- Purchases (PurchasesView) -------------------------------------------------------------------------------------

const PAYMENT_TEXT = { awaiting_payment: "Not paid yet", authorized: "Paid · held by Geerho", processing: "Bank payment processing",
  held: "Paid · held until you confirm", released: "Paid to the seller", refunded: "Refunded", disputed: "On hold for review",
  on_hold: "On hold while Geerho Support reviews a report", canceled: "Payment canceled" };

async function purchases(ctx) {
  const me = ctx.me.id;
  const [{ data: orders }, { data: sales }, { data: payments }, { data: reviews }] = await Promise.all([
    supabase.from("orders").select("id, listing_id, listing_title, price_cents, shipping_fee_cents, currency, status, respond_by")
      .eq("buyer_id", me).eq("status", "requested").gt("respond_by", new Date().toISOString()).order("created_at", { ascending: false }),
    supabase.from("sales").select("id, listing_id, seller_id, listing_title, price_cents, currency, delivery, carrier, shipping_fee_cents, tracking_number, tracking_due_at, received_at, order_id, reference, created_at, listing:listings(listing_photos(storage_path, position))")
      .eq("buyer_id", me).order("created_at", { ascending: false }).limit(100),
    supabase.from("payments").select("order_id, status"),
    supabase.from("reviews").select("sale_id").eq("reviewer_id", me),
  ]);
  const payFor = Object.fromEntries((payments ?? []).filter((p) => p.order_id).map((p) => [p.order_id, p.status]));
  const reviewed = new Set((reviews ?? []).map((r) => r.sale_id));
  if (!(orders ?? []).length && !(sales ?? []).length) {
    return [empty("bag", "No purchases yet", "When a seller marks an item as sold to you, it shows up here with tracking.")];
  }

  const requestRows = (orders ?? []).map((o) => {
    const pay = payFor[o.id];
    return el("div", { class: "item" },
      itemRow(`listing.html?id=${o.listing_id}`, null, o.listing_title,
        `${money(o.price_cents + (o.shipping_fee_cents ?? 0), o.currency)} · the seller answers ${until(o.respond_by)}`,
        pay ? PAYMENT_TEXT[pay] ?? pay : "Waiting for the seller", pay === "awaiting_payment" ? "warn" : "info", "cart"),
      actionsBar(
        pay === "awaiting_payment" ? button("Pay Now", () => payWithCard(ctx, { order_id: o.id })) : null,
        button("Cancel Request", confirmThen(ctx, "Cancel this request?", "The item becomes available to others, and any payment hold is released.",
          "Cancel Request", () => supabase.rpc("cancel_order", { order_id: o.id }), { danger: true }), "secondary")));
  });

  const saleRows = (sales ?? []).map((s) => {
    const pay = payFor[s.order_id];
    const shipping = s.delivery === "shipping";
    const late = shipping && !s.tracking_number && s.tracking_due_at && new Date(s.tracking_due_at) < new Date();
    const [state, tone] = s.received_at ? ["You confirmed you received it", "good"]
      : late ? ["The seller hasn't added tracking on time. Message them, or contact Geerho Support.", "bad"]
      : shipping ? (s.tracking_number ? [`Tracking: ${CARRIERS[s.carrier] ?? "Carrier"} ${s.tracking_number}`, "info"] : ["Waiting for tracking", "warn"])
      : ["Local pickup", "info"];
    const detail = [money(s.price_cents + (s.shipping_fee_cents ?? 0), s.currency), s.reference, pay ? PAYMENT_TEXT[pay] ?? pay : null].filter(Boolean).join(" · ");
    return el("div", { class: "item" },
      itemRow(`listing.html?id=${s.listing_id}`, cover(s.listing?.listing_photos), s.listing_title, detail, state, tone, "bag"),
      actionsBar(
        !s.received_at ? button("I Received It", confirmThen(ctx, `Confirm you received ${s.listing_title}?`,
          "Confirm only once you have it and it's as described. Geerho then pays the seller.", "Yes", () => supabase.rpc("confirm_received", { sale: s.id }))) : null,
        !s.received_at ? button("Report a Problem", async () => {
          const details = await textDialog("Report a Problem", "Geerho keeps holding your payment, so the seller isn't paid while Geerho Support reviews this. We'll reply in your Inbox, usually within 1–2 business days.",
            { okLabel: "Send", placeholder: "Not received, not as described, damaged…" });
          if (!details) return;
          const { error } = await supabase.rpc("report_payment_problem", { sale: s.id, details });
          if (error) return ctx.fail(friendlyError(error));
          ctx.reload();
        }, "secondary") : null,
        s.received_at && !reviewed.has(s.id) ? button("Review the Seller", async () => {
          const result = await reviewDialog("the seller");
          if (!result) return;
          const { error } = await supabase.rpc("leave_review", { sale: s.id, rating: result.rating, ...(result.body ? { body: result.body } : {}) });
          if (error) return ctx.fail(friendlyError(error));
          ctx.reload();
        }) : null));
  });

  return [group(requestRows, "Waiting for the seller"), group(saleRows, "Purchases",
    "Payments through Geerho are held until you confirm you have the item (or 3 days after pickup / 7 days after tracking is added).")];
}

// --- Sales (SalesView) ---------------------------------------------------------------------------------------------

async function sales(ctx) {
  const { data, error } = await supabase.from("sales")
    .select("id, listing_id, seller_id, buyer_id, listing_title, price_cents, currency, delivery, carrier, shipping_fee_cents, tracking_number, tracking_due_at, shipped_at, received_at, reference, created_at, listing:listings(country, shipping_carriers, listing_photos(storage_path, position))")
    .order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  // Mine, plus (Team v2) sales of team listings I posted, which are my Elite's.
  const all = (data ?? []).filter((s) => s.seller_id && s.buyer_id !== ctx.me.id);
  if (!all.length) return [empty("tag", "No sales yet", "Items you sell show up here, with tracking to add for shipped orders.")];
  const filter = ctx.state.salesFilter ?? "all";
  const needs = all.filter((s) => s.delivery === "shipping" && !s.tracking_number);
  const shown = filter === "tracking" ? needs : all;
  const rows = shown.map((s) => {
    const shipping = s.delivery === "shipping";
    const [state, tone] = s.received_at ? ["The buyer confirmed they received it.", "good"]
      : shipping && !s.tracking_number ? [`Add tracking${s.tracking_due_at ? ` by ${dayTime(s.tracking_due_at)}` : ""}`, "warn"]
      : shipping ? [`Shipped · ${CARRIERS[s.carrier] ?? ""} ${s.tracking_number}`, "info"] : ["Sold · local pickup", "info"];
    const parts = [itemRow(`listing.html?id=${s.listing_id}`, cover(s.listing?.listing_photos), s.listing_title,
      [money(s.price_cents + (s.shipping_fee_cents ?? 0), s.currency), s.reference, shortDate(s.created_at),
        s.seller_id !== ctx.me.id ? "For your Elite (paid to them)" : null].filter(Boolean).join(" · "), state, tone)];
    if (shipping && !s.tracking_number) {
      const carrier = carrierPicker(s.listing?.country, s.listing?.shipping_carriers);
      if (s.carrier) carrier.value = s.carrier;
      const number = el("input", { type: "text", placeholder: "Tracking number", "aria-label": "Tracking number", autocapitalize: "characters", spellcheck: "false" });
      parts.push(el("div", { class: "form-grid" }, carrier, number,
        actionsBar(button("Add Tracking", async () => {
          const { error: e } = await supabase.rpc("add_tracking", { sale: s.id, carrier: carrier.value, tracking_number: number.value.trim() });
          if (e) return ctx.fail(friendlyError(e));
          ctx.reload();
        })), el("p", { class: "hint" }, "The buyer gets the tracking link in their chat.")));
    }
    return el("div", { class: "item" }, ...parts);
  });
  return [segmented([["all", "All"], ["tracking", `Needs Tracking${needs.length ? ` (${needs.length})` : ""}`]], filter, (v) => { ctx.state.salesFilter = v; ctx.reload(); }),
    rows.length ? group(rows) : empty("check", "All caught up", "Every shipped order has tracking.")];
}

// --- Purchase Requests (PurchaseRequestsView): everything waiting for my answer -----------------------------------

async function requests(ctx) {
  const me = ctx.me.id;
  const now = new Date().toISOString();
  const [{ data: orders }, { data: rentals }, { data: tours }, { data: jobs }] = await Promise.all([
    supabase.from("orders").select("id, listing_id, buyer_id, delivery, listing_title, price_cents, shipping_fee_cents, currency, ship_to, note, respond_by, listing:listings(country, shipping_carriers)")
      .neq("buyer_id", me).eq("status", "requested").gt("respond_by", now).order("respond_by"),
    supabase.from("rental_bookings").select("id, listing_id, renter_id, listing_title, start_date, end_date, days, rent_cents, deposit_cents, currency, note, respond_by")
      .neq("renter_id", me).eq("status", "requested").gt("respond_by", now).order("respond_by"),
    supabase.from("tour_requests").select("id, listing_id, requester_id, listing_title, options, note").neq("requester_id", me).eq("status", "requested"),
    supabase.rpc("my_job_responses"),
  ]);
  const jobRows = (jobs ?? []).filter((j) => j.poster_id === me && j.status === "sent");
  const people = new Set([...(orders ?? []).map((o) => o.buyer_id), ...(rentals ?? []).map((r) => r.renter_id), ...(tours ?? []).map((t) => t.requester_id)]);
  const { data: profiles } = people.size ? await supabase.from("profiles").select("id, username, display_name, avatar_url").in("id", [...people]) : { data: [] };
  const who = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]));
  const nameOf = (id) => who[id]?.display_name || (who[id]?.username ? `@${who[id].username}` : "A member");
  const total = (orders ?? []).length + (rentals ?? []).length + (tours ?? []).length + jobRows.length;
  if (!total) return [empty("cart", "No purchase requests", "Nothing to answer right now. Purchase, rental, and tour requests, and responses to your jobs, show up here.")];

  const orderRows = (orders ?? []).map((o) => {
    const shipping = o.delivery === "shipping";
    const carrier = shipping ? carrierPicker(o.listing?.country, o.listing?.shipping_carriers) : null;
    return el("div", { class: "item" },
      el("div", { class: "item-row" }, avatar(who[o.buyer_id]?.avatar_url, nameOf(o.buyer_id), 44),
        el("span", { class: "row-title" }, el("strong", {}, `${nameOf(o.buyer_id)} wants to buy`),
          el("small", {}, `${o.listing_title} · ${money(o.price_cents + (o.shipping_fee_cents ?? 0), o.currency)}`),
          el("span", { class: "state warn" }, `${shipping ? "Shipping" : "Local pickup"} · answer ${until(o.respond_by)}`))),
      o.note ? el("p", { class: "hint" }, `“${o.note}”`) : null,
      shipping ? el("div", { class: "form-grid" }, el("label", {}, "Ship with:"), carrier,
        el("p", { class: "hint" }, "The buyer pays for shipping, so add tracking within 3 business days of accepting.")) : el("p", { class: "hint" }, "Arrange the pickup in your chat."),
      actionsBar(
        button("Accept & Mark Sold", confirmThen(ctx, "Accept this purchase?", "The listing is marked sold to them.", "Accept",
          () => supabase.rpc("respond_to_order", { order_id: o.id, accept: true, ...(carrier ? { carrier: carrier.value } : {}) }))),
        button("Decline", confirmThen(ctx, "Decline this purchase request?", "They're told, and any payment hold is released.", "Decline",
          () => supabase.rpc("respond_to_order", { order_id: o.id, accept: false }), { danger: true }), "secondary")));
  });
  const rentalRows = (rentals ?? []).map((r) => el("div", { class: "item" },
    el("div", { class: "item-row" }, avatar(who[r.renter_id]?.avatar_url, nameOf(r.renter_id), 44),
      el("span", { class: "row-title" }, el("strong", {}, `${nameOf(r.renter_id)} wants to rent`),
        el("small", {}, `${r.listing_title} · ${dateOnly(r.start_date)} – ${dateOnly(r.end_date)} · ${r.days} ${r.days === 1 ? "day" : "days"}`),
        el("span", { class: "state warn" }, `Rent ${money(r.rent_cents, r.currency)}${r.deposit_cents ? ` + ${money(r.deposit_cents, r.currency)} deposit` : ""} · answer ${until(r.respond_by)}`))),
    r.note ? el("p", { class: "hint" }, `“${r.note}”`) : null,
    actionsBar(
      button("Accept", confirmThen(ctx, "Accept this rental?", "The dates are booked for them.", "Accept", () => supabase.rpc("respond_to_rental", { booking: r.id, accept: true }))),
      button("Decline", confirmThen(ctx, "Decline this rental request?", "They're told right away.", "Decline", () => supabase.rpc("respond_to_rental", { booking: r.id, accept: false }), { danger: true }), "secondary"))));
  const tourRows = (tours ?? []).map((t) => {
    const choice = el("select", { "aria-label": "Tour time" }, (t.options ?? []).map((o) => el("option", { value: o }, dayTime(o))));
    return el("div", { class: "item" },
      el("div", { class: "item-row" }, avatar(who[t.requester_id]?.avatar_url, nameOf(t.requester_id), 44),
        el("span", { class: "row-title" }, el("strong", {}, `${nameOf(t.requester_id)} wants a tour`), el("small", {}, t.listing_title))),
      t.note ? el("p", { class: "hint" }, `“${t.note}”`) : null,
      el("div", { class: "form-grid" }, el("label", {}, "Confirm a time:"), choice),
      actionsBar(
        button("Confirm", async () => {
          if (!(await confirmDialog(`Confirm the tour for ${choice.selectedOptions[0]?.textContent}?`, "They're told right away.", "Confirm"))) return;
          const { error } = await supabase.rpc("respond_to_tour", { tour: t.id, confirm_time: choice.value });
          if (error) return ctx.fail(friendlyError(error));
          ctx.reload();
        }),
        button("Decline", confirmThen(ctx, "Decline this tour request?", "You can suggest another time in the chat.", "Decline",
          () => supabase.rpc("respond_to_tour", { tour: t.id }), { danger: true }), "secondary")));
  });
  const jobItems = jobRows.map((j) => {
    const name = j.freelancer_display_name || (j.freelancer_username ? `@${j.freelancer_username}` : "A pro");
    return el("div", { class: "item" },
      el("div", { class: "item-row" }, avatar(j.freelancer_avatar_url, name, 44),
        el("span", { class: "row-title" }, el("strong", {}, `${name} responded`), el("small", {}, j.job_title),
          j.quote_cents ? el("span", { class: "state info" }, money(j.quote_cents, j.currency) + (j.quote_type === "hourly" ? " / hour" : " for the job")) : null)),
      el("p", { class: "hint" }, j.message),
      actionsBar(button(`Hire ${name}`, confirmThen(ctx, `Hire ${name}?`, "The job closes to other responses.", "Hire", () => supabase.rpc("accept_job_response", { response: j.id })))));
  });
  return [group(orderRows, "Purchases"), group(rentalRows, "Rentals"), group(tourRows, "Home tours"), group(jobItems, "Responses to your jobs")];
}

// --- My Listings (MyListingsView): Active · Sold · Drafts -----------------------------------------------------------

function standing(l) {
  const expires = l.expires_at ? new Date(l.expires_at) : null;
  if (l.status === "draft") return ["Draft", "muted"];
  if (l.status === "sold") return ["Sold", "good"];
  if (l.status === "removed") return ["Removed by Geerho", "bad"];
  if (l.hidden_at) return ["Under review", "warn"];
  if (l.listing_format === "auction" && l.auction_state === "awaiting_checkout") return ["Ended · waiting for the winner", "info"];
  if (l.listing_format === "auction" && l.auction_state === "ended_no_sale") return ["Ended · not sold", "muted"];
  if (expires && expires < new Date()) return ["Expired · renew to show it again", "warn"];
  return [expires ? `Expires in ${Math.max(0, Math.floor((expires - Date.now()) / 86400000))} days` : "Active", "info"];
}

async function listings(ctx) {
  const { data, error } = await supabase.from("listings")
    .select("id, title, price_cents, currency, kind, listing_format, status, expires_at, hidden_at, auction_state, current_bid_cents, bid_count, rate_type, offers_pickup, offers_shipping, shipping_carriers, shipping_fee_cents, listing_photos(storage_path, position)")
    .or(`seller_id.eq.${ctx.me.id},posted_by.eq.${ctx.me.id}`).order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  const tab = ctx.state.listingsTab ?? "active";
  const all = data ?? [];
  const shown = all.filter((l) => (tab === "sold" ? l.status === "sold" : tab === "drafts" ? l.status === "draft" : !["sold", "draft"].includes(l.status)));
  const rows = shown.map((l) => {
    const [state, tone] = standing(l);
    const price = l.listing_format === "auction" && l.current_bid_cents ? `${money(l.current_bid_cents, l.currency)} · ${l.bid_count} ${l.bid_count === 1 ? "bid" : "bids"}` : money(l.price_cents, l.currency);
    const expired = l.status === "active" && l.expires_at && new Date(l.expires_at) < new Date();
    const update = (fields) => () => supabase.from("listings").update(fields).eq("id", l.id);
    return el("div", { class: "item" },
      itemRow(`listing.html?id=${l.id}`, cover(l.listing_photos), l.title, price, state, tone),
      actionsBar(
        ["draft", "active"].includes(l.status) ? el("a", { class: "button secondary", href: `post.html?edit=${l.id}` }, "Edit") : null,
        l.status === "draft" ? button("Publish", confirmThen(ctx, "Publish this listing?", "People nearby can see it for 60 days.", "Publish", update({ status: "active" }))) : null,
        l.status === "active" && l.listing_format !== "auction" && ["item", "property_sale"].includes(l.kind) ? button("Mark as Sold", () => openMarkSold(ctx, l)) : null,
        l.status === "sold" ? button("Mark as Available", confirmThen(ctx, "Mark as available?", "It shows on Geerho again.", "Yes", update({ status: "active" }))) : null,
        expired ? button("Renew for 60 Days", confirmThen(ctx, "Renew for 60 days?", "It shows on Geerho again for 60 days.", "Renew", () => supabase.rpc("renew_listing", { listing_id: l.id }))) : null,
        l.listing_format === "auction" && l.auction_state === "live" && !l.bid_count
          ? button("End Early", confirmThen(ctx, "End the auction now?", "Nobody has bid yet.", "End Auction", () => supabase.rpc("end_auction_early", { listing: l.id }), { danger: true }), "secondary") : null,
        l.listing_format === "auction" && l.auction_state === "ended_no_sale"
          ? button("Relist Auction", confirmThen(ctx, "Relist this auction?", "It starts again with the same details.", "Relist", () => supabase.rpc("relist_auction", { listing: l.id }))) : null,
        button("Delete", confirmThen(ctx, "Delete this listing?", "This can't be undone.", "Delete Listing", () => supabase.from("listings").delete().eq("id", l.id), { danger: true }), "secondary")));
  });
  const count = (f) => all.filter(f).length;
  return [
    segmented([["active", `Active (${count((l) => !["sold", "draft"].includes(l.status))})`], ["sold", `Sold (${count((l) => l.status === "sold")})`],
      ["drafts", `Drafts (${count((l) => l.status === "draft")})`]], tab, (v) => { ctx.state.listingsTab = v; ctx.reload(); }),
    rows.length ? group(rows)
      : empty("tag", tab === "drafts" ? "No drafts" : tab === "sold" ? "Nothing sold yet" : "No listings yet", "Tap Post to sell, rent out, or offer something."),
  ];
}

/** "Mark as Sold" (the app's MarkSoldSheet): who bought it and how it gets to them. */
async function openMarkSold(ctx, l) {
  const { data: conversations } = await supabase.rpc("my_conversations");
  const candidates = (conversations ?? []).filter((c) => c.listing_id === l.id && c.i_am_seller && c.other_user_id);
  const buyer = el("select", { "aria-label": "Buyer" }, el("option", { value: "" }, "Choose"),
    ...candidates.map((c) => el("option", { value: c.other_user_id }, c.other_display_name || `@${c.other_username}`)),
    el("option", { value: "elsewhere" }, "Someone else / not on Geerho"));
  const methods = [...(l.offers_pickup ? [["pickup", "Local pickup"]] : []), ...(l.offers_shipping ? [["shipping", "Shipping"]] : []), ["other", "Other"]];
  const delivery = el("select", { "aria-label": "Delivery" }, ...methods.map(([v, t]) => el("option", { value: v }, t)));
  const carrier = el("select", { "aria-label": "Carrier" }, el("option", { value: "" }, "Choose"),
    ...(l.shipping_carriers ?? []).map((c) => el("option", { value: c }, CARRIERS[c] ?? c)));
  const fee = l.shipping_fee_cents ?? 0;
  const carrierBox = el("div", { hidden: true }, el("label", {}, "Carrier", carrier),
    el("p", { class: "group-footer" }, fee > 0
      ? `The buyer pays ${money(fee, l.currency)} shipping & handling. Add the tracking number within 3 business days, or the sale is flagged.`
      : "Free shipping. Adding a tracking number is optional."));
  const save = el("button", { type: "button", disabled: true }, "Mark as Sold");
  const problem = el("p", { class: "status bad", role: "alert", hidden: true });
  const check = () => {
    carrierBox.hidden = delivery.value !== "shipping";
    save.disabled = !buyer.value || (delivery.value === "shipping" && !carrier.value);
  };
  [buyer, delivery, carrier].forEach((x) => x.addEventListener("change", check)); check();
  save.addEventListener("click", async () => {
    save.disabled = true; problem.hidden = true;
    const params = { listing: l.id, delivery: delivery.value };
    if (buyer.value !== "elsewhere") params.buyer = buyer.value;
    if (delivery.value === "shipping") params.carrier = carrier.value;
    const { error } = await supabase.rpc("mark_listing_sold", params);
    if (error) { problem.textContent = friendlyError(error); problem.hidden = false; save.disabled = false; return; }
    ctx.reload();
  });
  const cancel = el("button", { type: "button", class: "secondary" }, "Cancel");
  const form = el("div", { class: "decision" }, el("strong", {}, `Mark “${l.title}” as sold`),
    el("label", {}, "Who bought it?", buyer),
    candidates.length ? null : el("p", { class: "group-footer" }, "People who message you about this listing appear here."),
    el("label", {}, "How is it getting to them?", delivery), carrierBox, problem, el("div", { class: "actions" }, save, cancel));
  cancel.addEventListener("click", () => form.remove());
  document.querySelector(".decision.mark-sold")?.remove();
  form.classList.add("mark-sold");
  document.querySelector("main")?.prepend(form);
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

// --- Watching (WatchingView) and Favorites -------------------------------------------------------------------------

function listingLine(l) {
  if (l.listing_format === "auction") return `${money(l.current_bid_cents ?? l.price_cents, l.currency)} · ${l.bid_count ?? 0} ${l.bid_count === 1 ? "bid" : "bids"}`;
  return money(l.price_cents, l.currency);
}

async function watching(ctx) {
  const [{ data, error }, { data: alerts }] = await Promise.all([supabase.rpc("my_watches"),
    supabase.from("watch_alerts").select("id, listing_id, kind, message, created_at, read_at").order("created_at", { ascending: false }).limit(10)]);
  if (error) throw error;
  // Alerts first, like the app; opening Watching marks them read.
  const alertRows = (alerts ?? []).map((a) => el("a", { class: "item-row", href: `listing.html?id=${a.listing_id}` },
    el("span", { class: "row-title" }, el("strong", {}, a.message), el("small", {}, `${a.read_at ? "" : "New · "}${new Date(a.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`)),
    icon("chevronRight", "chev")));
  if ((alerts ?? []).some((a) => !a.read_at)) supabase.rpc("mark_watch_alerts_read").then(() => {}, () => {});
  const alertSection = alertRows.length ? group(alertRows, "Alerts") : null;
  if (!(data ?? []).length) return [alertSection, empty("eye", "Nothing watched yet", "Tap the eye on any listing to watch it. You get an alert when the price drops, an auction is ending, or it sells.")];
  return [alertSection, group(data.map((w) => el("div", { class: "item" },
    itemRow(`listing.html?id=${w.id}`, w.cover_path, w.title, listingLine(w),
      w.status !== "active" ? (w.status === "sold" ? "Sold" : "No longer available")
        : w.listing_format === "auction" && w.auction_ends_at ? `Ends ${until(w.auction_ends_at)}` : [w.city, w.region].filter(Boolean).join(", "),
      w.status === "active" ? "info" : "muted", "eye"),
    actionsBar(button("Stop Watching", async () => {
      const { error: e } = await supabase.from("watches").delete().eq("user_id", ctx.me.id).eq("listing_id", w.id);
      if (e) return ctx.fail(friendlyError(e));
      ctx.reload();
    }, "secondary")))))];
}

async function favorites(ctx) {
  const { data, error } = await supabase.from("favorites")
    .select("created_at, listing:listings(id, title, price_cents, currency, listing_format, current_bid_cents, bid_count, status, city, region, listing_photos(storage_path, position))")
    .eq("user_id", ctx.me.id).order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []).filter((f) => f.listing);
  if (!rows.length) return [empty("heart", "No favorites yet", "Tap the heart on any listing to save it here.")];
  return [group(rows.map(({ listing: l }) => el("div", { class: "item" },
    itemRow(`listing.html?id=${l.id}`, cover(l.listing_photos), l.title, listingLine(l),
      l.status === "active" ? [l.city, l.region].filter(Boolean).join(", ") : "No longer available", l.status === "active" ? "muted" : "warn", "heart"),
    actionsBar(button("Remove", async () => {
      const { error: e } = await supabase.from("favorites").delete().eq("user_id", ctx.me.id).eq("listing_id", l.id);
      if (e) return ctx.fail(friendlyError(e));
      ctx.reload();
    }, "secondary")))))];
}

// --- Rentals (RentalsView) ----------------------------------------------------------------------------------------

const RENTAL_PAYMENT = (status, owner) => ({
  awaiting_payment: owner ? "The renter is paying by card." : "Payment not finished. Tap Pay Now to complete it.",
  authorized: owner ? "Paid by the renter. You'll get the rent when you confirm pickup." : "Paid. If the owner doesn't accept, you're refunded.",
  held: owner ? "Paid by the renter. You'll get the rent when you confirm pickup." : "Paid. Geerho holds it; the owner gets the rent at pickup.",
  deposit_held: owner ? "Rent paid out. Geerho holds the deposit until you confirm the return." : "Rent paid to the owner. Geerho holds your deposit until you return the item.",
  released: "Settled.", refunded: "Refunded.", canceled: "Not charged.", on_hold: "On hold while Geerho Support reviews a report.",
}[status] ?? null);

function rentalStatus(b, owner) {
  const end = new Date(`${b.end_date}T23:59:59`);
  const expired = b.status === "requested" && new Date(b.respond_by) < new Date();
  if (b.status === "picked_up" && end < new Date()) return [`Overdue · was due back ${dateOnly(b.end_date)}`, "bad"];
  if (expired) return ["Expired · the owner didn't answer in time", "muted"];
  return ({
    requested: [owner ? "New request · answer within 24 hours" : "Waiting for the owner to accept", "warn"],
    accepted: [owner ? "Accepted · take pickup photos at handover" : "Accepted · arrange pickup with the owner", "info"],
    picked_up: [`Rented out · due back ${dateOnly(b.end_date)}`, "info"],
    returned: ["Returned", "good"], kept: ["Kept by the renter · late fees used up the deposit", "warn"],
    declined: ["Declined", "muted"], cancelled: ["Cancelled", "muted"],
  })[b.status] ?? [b.status, "muted"];
}

async function addRentalPhotos(ctx, booking, stage, files) {
  const bucket = supabase.storage.from("rental-photos");
  const paths = [];
  for (const file of files) {
    const path = `${ctx.me.id}/${booking.id}/${stage}-${crypto.randomUUID().slice(0, 8)}.jpg`;
    const { error } = await bucket.upload(path, await shrinkJPEG(file), { contentType: "image/jpeg" });
    if (error) return ctx.fail("A photo couldn't be uploaded. Check your connection and try again.");
    paths.push(path);
  }
  const { error } = await supabase.rpc("add_rental_photos", { booking: booking.id, stage, paths });
  if (error) return ctx.fail(friendlyError(error));
  ctx.reload();
}

/** Resizes a photo to at most 1600 px on the long side, as a JPEG (like the apps). */
async function shrinkJPEG(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("photo"))), "image/jpeg", 0.85));
}

function photoPicker(label, onFiles) {
  const input = el("input", { type: "file", accept: "image/*", multiple: true, class: "sr-only" });
  const id = `p-${crypto.randomUUID().slice(0, 6)}`;
  input.id = id;
  input.addEventListener("change", () => input.files?.length && onFiles([...input.files]));
  return el("span", {}, el("label", { for: id, class: "button secondary", style: "cursor:pointer" }, label), input);
}

async function rentals(ctx) {
  const me = ctx.me.id;
  const side = ctx.state.rentalSide ?? "renting";
  const { data, error } = await supabase.from("rental_bookings")
    .select("id, reference, listing_id, owner_id, renter_id, listing_title, start_date, end_date, days, rent_cents, deposit_cents, currency, note, status, respond_by, late_fee_cents, late_fees:rental_late_fees_due")
    .order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  const all = data ?? [];
  if (!all.length) return [empty("wrench", "No rentals yet", "Tools you rent, and rentals of your tools, show up here.")];
  const shown = all.filter((b) => (side === "lending" ? b.owner_id && b.renter_id !== me : b.renter_id === me));
  const ids = shown.map((b) => b.id);
  const [{ data: pays }, { data: photos }, { data: reviews }] = ids.length ? await Promise.all([
    supabase.from("payments").select("rental_booking_id, status").in("rental_booking_id", ids),
    supabase.from("rental_photos").select("booking_id, stage, storage_path").in("booking_id", ids),
    supabase.from("reviews").select("rental_booking_id").eq("reviewer_id", me).in("rental_booking_id", ids),
  ]) : [{ data: [] }, { data: [] }, { data: [] }];
  const payFor = Object.fromEntries((pays ?? []).map((p) => [p.rental_booking_id, p.status]));
  const reviewed = new Set((reviews ?? []).map((r) => r.rental_booking_id));
  const rows = shown.map((b) => {
    const owner = b.renter_id !== me; // the owner, or the team member who posted it
    const status = b.status === "requested" && new Date(b.respond_by) < new Date() ? "expired" : b.status;
    const [state, tone] = rentalStatus(b, owner);
    const pay = payFor[b.id];
    const pics = (photos ?? []).filter((p) => p.booking_id === b.id);
    const pickupCount = pics.filter((p) => p.stage === "pickup").length;
    const returnCount = pics.filter((p) => p.stage === "return").length;
    const call = (name) => () => supabase.rpc(name, { booking: b.id });
    return el("div", { class: "item" },
      itemRow(`listing.html?id=${b.listing_id}`, null, b.listing_title,
        `${b.reference} · ${dateOnly(b.start_date)} – ${dateOnly(b.end_date)} · ${money(b.rent_cents, b.currency)}${b.deposit_cents ? ` + ${money(b.deposit_cents, b.currency)} deposit` : ""}`,
        state, tone, "wrench"),
      b.late_fees > 0 ? el("p", { class: "state bad" }, `Late fees so far: ${money(b.late_fees, b.currency)} (${money(b.late_fee_cents, b.currency)} a day)`) : null,
      pay && RENTAL_PAYMENT(pay, owner) ? el("p", { class: "hint" }, RENTAL_PAYMENT(pay, owner)) : null,
      ["accepted", "picked_up", "returned", "kept"].includes(status) ? el("p", { class: "hint" }, `Pickup photos: ${pickupCount} · Return photos: ${returnCount}`) : null,
      owner && status === "accepted" ? el("p", { class: "hint" }, "At handover, add pickup photos, then confirm.") : null,
      owner && status === "picked_up" ? el("p", { class: "hint" }, "When it's back, add return photos, then confirm.") : null,
      actionsBar(
        !owner && status === "requested" && pay === "awaiting_payment" ? button("Pay Now", () => payWithCard(ctx, { rental_id: b.id })) : null,
        owner && status === "requested" ? button("Accept Request", confirmThen(ctx, "Accept this rental?", "The dates are booked for them.", "Yes", () => supabase.rpc("respond_to_rental", { booking: b.id, accept: true }))) : null,
        owner && status === "requested" ? button("Decline", confirmThen(ctx, "Decline this rental request?", "They're told right away.", "Yes", () => supabase.rpc("respond_to_rental", { booking: b.id, accept: false }), { danger: true }), "secondary") : null,
        status === "accepted" ? photoPicker("Add Pickup Photos", (files) => addRentalPhotos(ctx, b, "pickup", files)) : null,
        owner && status === "accepted" && pickupCount ? button("Confirm Pickup", confirmThen(ctx, "Confirm the renter picked it up?", "The rent goes to you.", "Yes", call("confirm_rental_pickup"))) : null,
        ["picked_up", "kept"].includes(status) ? photoPicker("Add Return Photos", (files) => addRentalPhotos(ctx, b, "return", files)) : null,
        owner && status === "picked_up" && returnCount ? button("Confirm Return", confirmThen(ctx, "Confirm it's back?", "The renter's deposit is settled.", "Yes", call("confirm_rental_return"))) : null,
        owner && status === "kept" && returnCount ? button("Accept Return Anyway", confirmThen(ctx, "Accept the return anyway?", "Have them pay what they owe first.", "Yes", call("accept_kept_rental_return")), "secondary") : null,
        ["returned", "kept"].includes(status) && !reviewed.has(b.id) ? button(owner ? "Review the Renter" : "Review the Owner", async () => {
          const result = await reviewDialog(owner ? "the renter" : "the owner");
          if (!result) return;
          const { error: e } = await supabase.rpc("leave_rental_review", { booking: b.id, rating: result.rating, ...(result.body ? { body: result.body } : {}) });
          if (e) return ctx.fail(friendlyError(e));
          ctx.reload();
        }) : null,
        ["requested", "accepted"].includes(status) ? button("Cancel Rental", confirmThen(ctx, "Cancel this rental?", "The other person gets an automatic message.", "Yes", call("cancel_rental"), { danger: true }), "secondary") : null));
  });
  return [segmented([["renting", "Renting"], ["lending", "Lending"]], side, (v) => { ctx.state.rentalSide = v; ctx.reload(); }),
    rows.length ? group(rows) : empty("wrench", "None yet.", side === "lending" ? "Rentals of your tools show up here." : "Tools you rent show up here.")];
}

// --- Home Tours (ToursView) -----------------------------------------------------------------------------------------

async function tours(ctx) {
  const me = ctx.me.id;
  const { data, error } = await supabase.from("tour_requests")
    .select("id, listing_id, requester_id, owner_id, listing_title, status, confirmed_time, options, note").order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  const all = data ?? [];
  if (!all.length) return [empty("calendar", "No tours yet", "Request a tour from any home's listing.")];
  const row = (t) => {
    const mine = t.requester_id === me;
    const [state, tone] = t.status === "confirmed" ? [`Confirmed for ${dayTime(t.confirmed_time)}`, "good"]
      : t.status === "requested" ? [mine ? "Waiting for the lister" : "Answer in Purchase Requests", "warn"]
      : t.status === "declined" ? ["Declined", "muted"] : ["Cancelled", "muted"];
    return el("div", { class: "item" },
      itemRow(`listing.html?id=${t.listing_id}`, null, t.listing_title, mine ? "Your tour request" : "Someone wants to tour your home", state, tone, "calendar"),
      ["requested", "confirmed"].includes(t.status) ? actionsBar(
        !mine && t.status === "requested" ? el("a", { class: "button", href: "#requests" }, "Answer") : null,
        button("Cancel Tour", confirmThen(ctx, "Cancel this tour?", "The other person is told.", "Cancel Tour", () => supabase.rpc("cancel_tour", { tour: t.id }), { danger: true }), "secondary")) : null);
  };
  return [
    group(all.filter((t) => t.requester_id !== me && t.status === "requested").map(row), "Waiting for your answer"),
    group(all.filter((t) => t.requester_id === me).map(row), "Homes you want to see"),
    group(all.filter((t) => t.requester_id !== me && t.status !== "requested").map(row), "Your homes"),
  ];
}

// --- Jobs and Quotes (MyJobResponsesView) ---------------------------------------------------------------------------

const JOB_PAYMENT = (status, client) => ({
  awaiting_payment: client ? "Payment not finished. Tap Pay for This Job to try again." : "The client is paying by card.",
  authorized: client ? "Paid. Geerho holds it until you confirm the work is done." : "Geerho holds your pay until the client confirms the work is done (or 3 days after you tap Job Done).",
  held: client ? "Paid. Geerho holds it until you confirm the work is done." : "Geerho holds your pay until the client confirms the work is done (or 3 days after you tap Job Done).",
  released: client ? "Paid. Your pro has been paid." : "Paid out to you.",
  refunded: "Refunded to the client.", on_hold: "On hold while Geerho Support reviews a report.",
}[status] ?? null);

async function jobs(ctx) {
  const me = ctx.me.id;
  const { data, error } = await supabase.rpc("my_job_responses");
  if (error) throw error;
  const all = data ?? [];
  if (!all.length) return [empty("briefcase", "No jobs yet", "Your responses to jobs, and responses to jobs you post, show up here.")];
  const hired = all.filter((r) => r.status === "accepted").map((r) => r.id);
  const [{ data: pays }, { data: done }, { data: myReviews }] = hired.length ? await Promise.all([
    supabase.from("payments").select("job_response_id, status").in("job_response_id", hired),
    supabase.from("job_responses").select("id, work_done_at").in("id", hired),
    supabase.from("reviews").select("job_response_id").eq("reviewer_id", me).in("job_response_id", hired),
  ]) : [{ data: [] }, { data: [] }, { data: [] }];
  const jobReviewed = new Set((myReviews ?? []).map((x) => x.job_response_id));
  const payFor = Object.fromEntries((pays ?? []).map((p) => [p.job_response_id, p.status]));
  const doneAt = Object.fromEntries((done ?? []).filter((d) => d.work_done_at).map((d) => [d.id, d.work_done_at]));
  const label = { sent: "Sent", accepted: "Hired", declined: "Not chosen", withdrawn: "Withdrawn" };
  const act = (name, id, details) => supabase.rpc(name, { response: id, ...(details ? { details } : {}) });
  const row = (r) => {
    const client = r.poster_id === me;
    const name = r.freelancer_display_name || (r.freelancer_username ? `@${r.freelancer_username}` : "Freelancer");
    const pay = payFor[r.id];
    const parts = [itemRow(`listing.html?id=${r.job_id}`, null, r.job_title,
      r.quote_cents ? money(r.quote_cents, r.currency) + (r.quote_type === "hourly" ? " / hour" : " for the job") : null,
      `${client ? `${name} responded` : "Your response"} · ${label[r.status] ?? r.status}`, r.status === "accepted" ? "info" : "muted", "briefcase"),
    el("p", { class: "hint" }, r.message)];
    if (pay && pay !== "canceled" && JOB_PAYMENT(pay, client)) parts.push(el("p", { class: `state ${pay === "awaiting_payment" || pay === "on_hold" ? "warn" : "muted"}` }, JOB_PAYMENT(pay, client)));
    const buttons = [];
    if (!client && r.status === "sent") buttons.push(button("Withdraw", confirmThen(ctx, "Withdraw your response?", "The client won't see it anymore.", "Withdraw", () => act("withdraw_job_response", r.id), { danger: true }), "secondary"));
    if (r.status === "accepted" && client) {
      if (!pay || pay === "awaiting_payment" || pay === "canceled") {
        const amount = el("input", { type: "number", min: "1", step: "0.01", inputmode: "decimal", "aria-label": "Agreed price", value: r.quote_cents ? (r.quote_cents / 100).toFixed(2) : "" });
        parts.push(el("div", { class: "form-grid" }, el("label", {}, "Agreed price"), amount,
          el("p", { class: "hint" }, "Geerho holds your payment and pays your pro when you confirm the work is done. If something goes wrong, report a problem and Geerho Support reviews it.")));
        buttons.push(button("Pay for This Job", async () => {
          const cents = Math.round(Number(amount.value) * 100);
          if (!(cents >= 100)) return ctx.fail("Enter the price you agreed on.");
          await payWithCard(ctx, { job_response_id: r.id, amount_cents: String(cents) });
        }));
      }
      if (pay === "held") {
        buttons.push(button("Confirm Work Is Done", confirmThen(ctx, `Confirm the work is done?`, `Geerho then pays ${name}.`, "Yes", () => act("confirm_job_done", r.id))));
        buttons.push(button("Report a Problem", async () => {
          const details = await textDialog("Report a Problem", "Geerho keeps holding your payment, so the pro isn't paid while Geerho Support reviews this. We'll reply in your Inbox, usually within 1–2 business days.", { okLabel: "Send", placeholder: "What went wrong?" });
          if (!details) return;
          const { error: e } = await act("report_job_problem", r.id, details);
          if (e) return ctx.fail(friendlyError(e));
          ctx.reload();
        }, "secondary"));
      }
    }
    if (r.status === "accepted" && !client) {
      if (doneAt[r.id]) parts.push(el("p", { class: "state info" }, `You marked the job done ${dayTime(doneAt[r.id])}${pay === "released" ? "." : ". Waiting for your client to confirm (or 3 days)."}`));
      else if (!pay || ["held", "awaiting_payment", "canceled"].includes(pay)) buttons.push(button("Job Done", confirmThen(ctx, "Mark the job done?", "The client is asked to confirm; you're paid when they do (or after 3 days).", "Yes", () => act("mark_job_done", r.id))));
      if (pay === "held" || pay === "authorized") buttons.push(button("Refund Client", confirmThen(ctx, "Refund your client?", "They get their full payment back, and you won't be paid for this job through Geerho.", "Refund", () => act("refund_job_payment", r.id), { danger: true }), "secondary"));
    }
    // Hired jobs: the client and the pro review each other (M32), within 60 days of the hire; blind until both review.
    if (r.status === "accepted" && !jobReviewed.has(r.id)) {
      buttons.push(button(client ? "Review Your Pro" : "Review the Client", async () => {
        const result = await reviewDialog(client ? name : "the client");
        if (!result) return;
        const { error: e } = await supabase.rpc("leave_job_review", { response: r.id, rating: result.rating, body: result.body || null });
        if (e) return ctx.fail(friendlyError(e));
        ctx.reload();
      }, "secondary"));
    }
    parts.push(actionsBar(...buttons));
    return el("div", { class: "item" }, ...parts);
  };
  return [group(all.filter((r) => r.poster_id === me).map(row), "Responses to your jobs"), group(all.filter((r) => r.poster_id !== me).map(row), "Jobs you responded to")];
}

// --- Get Paid (GetPaidView) -----------------------------------------------------------------------------------------

async function getpaid(ctx) {
  const country = ctx.state.payCountry ?? "US";
  const picker = segmented([["US", "United States"], ["PH", "Philippines"]], country, (v) => { ctx.state.payCountry = v; ctx.reload(); });
  const intro = el("p", { class: "group-footer", style: "margin-top:0" }, "Where you sell");
  if (country === "PH") {
    const { data: account } = await supabase.rpc("my_ph_payout_account");
    if (account) {
      return [intro, picker, group([el("div", { class: "cell-pad" }, el("strong", {}, account.bank_name ?? "Bank or e-wallet"),
        el("p", { class: "hint" }, `${account.account_name ?? ""} · ending ${account.account_last4 ?? ""}`))], "Bank or e-wallet",
        "Geerho pays your sales in pesos to this account."),
        el("ul", { class: "group plain" }, el("li", {}, el("button", { type: "button", class: "row danger", id: "remove-ph" }, "Remove Payout Account")))]
        .concat(wireRemovePH(ctx));
    }
    const { data: banks } = await supabase.functions.invoke("payments", { body: { action: "ph_banks" } });
    const bank = el("select", { "aria-label": "Bank or e-wallet" }, (banks?.banks ?? []).map((b) => el("option", { value: b.code, "data-name": b.name }, b.name)));
    const number = el("input", { type: "text", inputmode: "numeric", placeholder: "Account or mobile number", "aria-label": "Account number" });
    const name = el("input", { type: "text", placeholder: "Account name", "aria-label": "Account name", autocomplete: "name" });
    return [intro, picker, group([el("div", { class: "cell-pad form-grid" }, bank, number, name,
      button("Save Payout Account", async () => {
        const { error } = await supabase.rpc("save_ph_payout_account", { bank_code: bank.value, bank_name: bank.selectedOptions[0]?.dataset.name ?? "",
          account_number: number.value.trim(), account_name: name.value.trim() });
        if (error) return ctx.fail(friendlyError(error));
        ctx.reload();
      }))], "Bank or e-wallet", "Buyers in the Philippines pay with cards, GCash, Maya, and more; Geerho pays you in pesos.")];
  }
  let { data: p } = await supabase.rpc("my_payouts");
  // Ask Stripe for the latest status while setup or tax information isn't finished (M154).
  if (p?.connected && (!p.payouts_ready || p.tax_status !== "complete")) {
    await supabase.functions.invoke("payments", { body: { action: "payout_status" } }).catch(() => {});
    ({ data: p } = await supabase.rpc("my_payouts"));
  }
  // M154: Personal seller (SSN) or Business (EIN), chosen before the Stripe account is made.
  const sellerType = el("select", { "aria-label": "You're selling as" },
    el("option", { value: "individual" }, "Personal: yourself or a sole proprietor (SSN)"),
    el("option", { value: "company" }, "Business: an LLC or corporation (EIN)"));
  const open = (action) => async () => {
    const body = { action, from: "web" };
    if (action === "connect" && !p?.connected) body.seller_type = sellerType.value;
    const { data, error } = await supabase.functions.invoke("payments", { body });
    if (data?.url) location.href = data.url; else ctx.fail(error ? "We couldn't open Stripe. Please try again." : "");
  };
  const taxDone = p?.tax_status === "complete";
  const status = !p?.connected ? ["Not set up yet. Set up payouts to take card payments.", "warn"]
    : p.payouts_ready ? ["Ready · buyers can pay you by card", "good"]
    : !taxDone && p.details_submitted ? ["Payouts paused · add your tax information", "warn"]
    : ["Almost there · finish your Stripe setup", "warn"];
  const taxLabel = { complete: ["On file", "good"], pending: ["Being checked", "warn"] }[p?.tax_status] ?? ["Needed", "warn"];
  const taxNote = (taxDone ? "" : "Payouts are paused until your tax information is on file. ")
    + "Stripe keeps your SSN or EIN; Geerho never sees it. Geerho reports your sales to the IRS on Form 1099-K when they reach the federal threshold ($20,000 and 200 sales in a year; some states lower), and you report your own income.";
  return [intro, picker,
    p?.connected ? null : group([el("div", { class: "cell-pad form-grid" }, el("label", {}, "You're selling as", sellerType))], "Seller type",
      "Stripe asks for your Social Security number (Personal) or your company's EIN (Business)."),
    group([el("div", { class: "cell-pad" }, el("span", { class: `state ${status[1]}` }, status[0]),
      el("p", { class: "hint" }, `Paid to you: ${money(p?.paid_cents ?? 0, "USD")} · Held until delivery: ${money(p?.held_cents ?? 0, "USD")}`
        + (p?.commission_rate != null ? ` · Commission: ${Math.round(p.commission_rate * 1000) / 10}%` : "")))], "Your money"),
    p?.connected ? group([el("div", { class: "cell-pad" },
      el("p", {}, `Selling as: ${p.seller_type === "company" ? "Business" : p.seller_type === "individual" ? "Personal" : "—"}`),
      el("p", {}, `${p.seller_type === "company" ? "EIN" : "SSN or EIN"}: `, el("span", { class: `state ${taxLabel[1]}` }, taxLabel[0])))], "Taxes", taxNote) : null,
    el("div", { class: "stack-actions" },
      button(!p?.connected ? "Set Up Payouts" : !taxDone && p.tax_status !== "pending" && p.details_submitted ? "Add Tax Information"
        : p.payouts_ready ? "Update Payout Details" : "Continue Setup", open("connect")),
      p?.connected ? button("Open Stripe Dashboard", open("dashboard"), "secondary") : null),
    el("p", { class: "group-footer" }, "Stripe handles payouts and verifies sellers. Geerho never sees your bank details or tax number.")];
}

function wireRemovePH(ctx) {
  queueMicrotask(() => document.getElementById("remove-ph")?.addEventListener("click", confirmThen(ctx, "Remove your payout account?",
    "Buyers can't pay you by card in the Philippines until you add one again.", "Remove", () => supabase.rpc("remove_ph_payout_account"), { danger: true })));
  return [];
}

// --- Team (TeamView) -----------------------------------------------------------------------------------------------

async function team(ctx) {
  const [{ data: members }, { data: teams }] = await Promise.all([supabase.rpc("my_team"), supabase.rpc("my_teams")]);
  // my_teams: teams I'm on or invited to (is_elite: the team's owner still has the Elite plan).
  const invites = (teams ?? []).filter((t) => t.status !== "active");
  const joined = (teams ?? []).filter((t) => t.status === "active");
  const name = (p) => p.display_name || `@${p.username}`;
  const out = [];
  if (invites.length) out.push(group(invites.map((t) => el("div", { class: "item" },
    el("div", { class: "item-row" }, avatar(t.avatar_url, name(t), 44), el("span", { class: "row-title" }, el("strong", {}, name(t)), el("small", {}, "invited you to their team"))),
    actionsBar(button("Join", confirmThen(ctx, `Join ${name(t)}'s team?`, "You can help with their listings and chats.", "Join", () => supabase.rpc("respond_team_invite", { elite: t.elite_id, accept: true }))),
      button("Decline", confirmThen(ctx, "Decline the invitation?", "They're told.", "Decline", () => supabase.rpc("respond_team_invite", { elite: t.elite_id, accept: false })), "secondary")))), "Invitations"));
  if (joined.length) out.push(group(joined.map((t) => el("div", { class: "item" },
    el("div", { class: "item-row" }, avatar(t.avatar_url, name(t), 44), el("span", { class: "row-title" }, el("strong", {}, name(t)), el("small", {}, t.is_elite ? "You're on their team. Your new posts can be theirs (Post → Post for …)." : "Their Elite plan has ended, so posting for them is paused."))),
    actionsBar(button("Leave Team", confirmThen(ctx, "Leave this team?", "You stop helping with their listings and chats.", "Leave", () => supabase.rpc("remove_team_member", { elite: t.elite_id, member: ctx.me.id }), { danger: true }), "secondary")))), "Teams you're on"));
  const { data: plan } = await supabase.from("member_plans").select("plan, status").eq("user_id", ctx.me.id).maybeSingle();
  if (plan?.plan === "elite" && plan.status === "active") {
    const input = el("input", { type: "text", placeholder: "@username", "aria-label": "Username to invite", autocapitalize: "none", spellcheck: "false" });
    out.push(group([el("div", { class: "cell-pad form-grid" }, input, button("Invite", async () => {
      const { error } = await supabase.rpc("invite_team_member", { username: input.value.trim().replace(/^@/, "").toLowerCase() });
      if (error) return ctx.fail(friendlyError(error));
      ctx.reload();
    }))], "Invite a team member", "Elite members can add team members to post and answer chats for their business."));
    out.push(group((members ?? []).map((m) => el("div", { class: "item" },
      el("div", { class: "item-row" }, avatar(m.avatar_url, name(m), 44), el("span", { class: "row-title" }, el("strong", {}, name(m)),
        el("small", {}, m.status === "invited" ? "Invited" : `${m.live_listings} live · ${m.sold_listings} sold · ${m.chats} chats`))),
      actionsBar(button("Remove", confirmThen(ctx, `Remove ${name(m)}?`, "They stop helping with your listings and chats.", "Remove", () => supabase.rpc("remove_team_member", { elite: ctx.me.id, member: m.member_id }), { danger: true }), "secondary")))), "Your team"));
  } else if (!out.length) {
    out.push(empty("team", "Teams are part of Elite", "With the Elite plan, team members can post and answer chats for your business."), el("p", { style: "text-align:center" }, el("a", { class: "button", href: "plans.html" }, "See Plans")));
  }
  return out;
}

// --- Professional Licenses, Milestone Level, Home Address ------------------------------------------------------------

const LICENSE_STATUS = { pending: ["Pending review", "warn"], approved: ["Verified", "good"], rejected: ["Not approved", "bad"], expired: ["Expired", "muted"] };

async function licenses(ctx) {
  const { data, error } = await supabase.rpc("my_licenses");
  if (error) throw error;
  const rows = (data ?? []).map((l) => {
    const [state, tone] = LICENSE_STATUS[l.status] ?? [l.status, "muted"];
    return el("div", { class: "item" },
      itemRow(null, null, l.profession_name ?? l.profession, [l.issuing_body, l.license_number, [l.subdivision, l.country].filter(Boolean).join(", ")].filter(Boolean).join(" · "), state, tone, "seal"),
      l.review_note ? el("p", { class: "hint" }, `Moderator: ${l.review_note}`) : null,
      actionsBar(button("Delete", confirmThen(ctx, "Delete this license?", "It's removed from your profile.", "Delete", () => supabase.rpc("delete_license", { license: l.id }), { danger: true }), "secondary")));
  });
  if (ctx.state.addingLicense) return [await licenseForm(ctx)];
  const add = button("Add License", async () => { ctx.state.addingLicense = true; ctx.reload(); });
  return [rows.length ? group(rows, "Your licenses") : empty("seal", "No licenses yet", "Add a professional license so clients see it's verified."),
    el("div", { class: "stack-actions" }, add)];
}

const US_STATES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana",
  IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };

function input(attrs) { return el("input", { type: "text", ...attrs }); }
function labeled(label, control) { return el("label", { class: "form-row" }, el("span", { class: "form-label" }, label), control); }

/** Add a License (the app's LicenseForm): what and where, details, contact, an optional photo of the license. */
async function licenseForm(ctx) {
  const { data: professions } = await supabase.from("professions").select("slug, name, license_required").order("position");
  const profession = el("select", {}, el("option", { value: "" }, "Choose a profession"),
    (professions ?? []).filter((p) => p.license_required).map((p) => el("option", { value: p.slug }, p.name)));
  const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
  const codes = "US PH CA MX GB AU NZ SG JP KR AE SA QA DE FR ES IT NL IE IN".split(" ");
  const country = el("select", {}, codes.map((c) => el("option", { value: c, selected: c === "US" }, countryNames.of(c))));
  const state = el("select", {}, Object.entries(US_STATES).map(([code, name]) => el("option", { value: code, selected: code === "CA" }, name)));
  const stateRow = labeled("State", state);
  country.addEventListener("change", () => { stateRow.hidden = country.value !== "US"; });
  const issuer = input({ maxlength: 100, placeholder: "Issued by (e.g. California DRE, PRC)" });
  const number = input({ maxlength: 50, placeholder: "License number" });
  const fullName = input({ maxlength: 100, placeholder: "Full name exactly as on the license", autocomplete: "name" });
  const birth = el("input", { type: "date", "aria-label": "Date of birth", max: new Date(Date.now() - 18 * 365.25 * 86400000).toISOString().slice(0, 10) });
  const expires = el("input", { type: "date", "aria-label": "Expires (optional)", min: new Date().toISOString().slice(0, 10) });
  const phone = el("input", { type: "tel", maxlength: 30, placeholder: "Phone", autocomplete: "tel" });
  const email = el("input", { type: "email", maxlength: 100, placeholder: "Email (optional)", autocomplete: "email" });
  const business = input({ maxlength: 100, placeholder: "Business or brokerage name (optional)" });
  const details = el("textarea", { maxlength: 1000, rows: 2, placeholder: "Anything else moderators should know (optional)" });
  let photo = null;
  const photoLabel = el("span", {}, "Add a Photo of Your License");
  const photoInput = el("input", { type: "file", accept: "image/*", class: "sr-only", id: "license-photo" });
  photoInput.addEventListener("change", () => { photo = photoInput.files?.[0] ?? null; photoLabel.textContent = photo ? "Photo added · Change" : "Add a Photo of Your License"; });
  const submit = button("Submit", async () => {
    if (!profession.value || !issuer.value.trim() || !number.value.trim() || !fullName.value.trim() || !birth.value || !phone.value.trim()) {
      return ctx.fail("Fill in the profession, issuer, license number, full name, date of birth, and phone.");
    }
    let path = null;
    if (photo) {
      path = `${ctx.me.id}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage.from("license-documents").upload(path, await shrinkJPEG(photo), { contentType: "image/jpeg" });
      if (error) return ctx.fail("The photo couldn't be uploaded. Check your connection and try again.");
    }
    const { error } = await supabase.rpc("submit_license", {
      profession: profession.value, country: country.value, subdivision: country.value === "US" ? state.value : null,
      issuing_body: issuer.value.trim(), license_number: number.value.trim(), full_name: fullName.value.trim(), date_of_birth: birth.value,
      contact_phone: phone.value.trim(), ...(email.value.trim() ? { contact_email: email.value.trim() } : {}), ...(expires.value ? { expires_on: expires.value } : {}),
      ...(business.value.trim() ? { business_name: business.value.trim() } : {}), ...(details.value.trim() ? { details: details.value.trim() } : {}),
      ...(path ? { document_path: path } : {}),
    });
    if (error) {
      if (path) await supabase.storage.from("license-documents").remove([path]).catch(() => {});
      return ctx.fail(friendlyError(error));
    }
    ctx.state.addingLicense = false;
    ctx.reload();
  });
  const cancel = button("Cancel", () => { ctx.state.addingLicense = false; ctx.reload(); }, "secondary");
  return [
    el("p", { class: "group-title" }, "What and where"),
    el("div", { class: "group form-group" }, labeled("Profession", profession), labeled("Country", country), stateRow),
    el("p", { class: "group-footer" }, "Where the license was issued and where you practice."),
    el("p", { class: "group-title" }, "License details"),
    el("div", { class: "group form-group" }, labeled("Issued by", issuer), labeled("License number", number), labeled("Full name", fullName),
      labeled("Date of birth", birth), labeled("Expires (optional)", expires)),
    el("p", { class: "group-footer" }, "Moderators compare these with the issuer's public records and with your verified ID."),
    el("p", { class: "group-title" }, "Contact"),
    el("div", { class: "group form-group" }, labeled("Phone", phone), labeled("Email (optional)", email), labeled("Business (optional)", business), labeled("Notes (optional)", details)),
    el("p", { class: "group-title" }, "License photo (optional)"),
    el("div", { class: "group form-group" }, el("div", { class: "form-row" }, el("label", { for: "license-photo", class: "button secondary" }, photoLabel), photoInput)),
    el("p", { class: "group-footer" }, "Helps moderators approve you faster. Only you and moderators can see it."),
    el("div", { class: "stack-actions" }, submit, cancel),
  ];
}

async function milestone(ctx) {
  const { data: m, error } = await supabase.rpc("my_milestone", { display_currency: "USD" });
  if (error) throw error;
  const span = Math.max(1, (m.next_level_floor ?? 1) - (m.level_floor ?? 0));
  const progress = Math.min(100, Math.round(((m.xp - m.level_floor) / span) * 100));
  return [el("div", { class: "profile-card", style: "text-align:center;justify-items:center" },
    el("span", { class: "pill on-brand" }, "Milestone Level"),
    el("strong", { style: "font-size:3rem;line-height:1" }, String(m.level)),
    el("div", { style: "width:100%;height:10px;border-radius:999px;background:rgba(255,255,255,.25);overflow:hidden" },
      el("div", { style: `width:${progress}%;height:100%;background:#fff` })),
    el("span", {}, `${m.xp_to_next.toLocaleString()} points to Level ${m.level + 1}`)),
    el("p", { class: "group-footer", style: "margin-top:0" }, "You earn points for each dollar you buy and sell on Geerho. Higher levels show on your profile."),
    m.transferred_at ? el("p", { class: "group-footer" }, "Your TikTok level was transferred.") : transferSection(ctx, m)];
}

// TikTok level transfer (the app's LevelTransferSheet): get a code, send it to @aceallen82 on TikTok, we approve it.
const TIKTOK_HANDLE = "aceallen82";
function transferSection(ctx, m) {
  const pending = m.request?.status === "pending" ? m.request : null;
  if (pending) {
    return [el("p", { class: "group-title" }, "TikTok level transfer"),
      el("div", { class: "decision" },
        el("strong", { class: "state warn" }, "Waiting for review"),
        el("p", {}, `Send this code to @${TIKTOK_HANDLE} in a TikTok message from @${pending.tiktok_username}. We'll check your gifter level (Level ${pending.requested_level}) and approve it, usually within 24 hours.`),
        el("p", { class: "transfer-code" }, pending.code),
        el("a", { class: "button secondary", href: `https://www.tiktok.com/@${TIKTOK_HANDLE}`, target: "_blank", rel: "noopener" }, `Open @${TIKTOK_HANDLE} on TikTok`),
        actionsBar(button("Cancel This Transfer", confirmThen(ctx, "Cancel this transfer?", "You can start a new one later.", "Cancel Transfer", () => supabase.rpc("cancel_level_transfer"), { danger: true }), "secondary")))];
  }
  const username = el("input", { type: "text", maxlength: "40", placeholder: "your TikTok username", autocapitalize: "none", autocomplete: "off", spellcheck: "false", "aria-label": "Your TikTok username" });
  const level = el("select", { "aria-label": "Your TikTok gifter level" }, ...Array.from({ length: 50 }, (_, i) => el("option", { value: String(i + 1), selected: i + 1 === 10 }, `Level ${i + 1}`)));
  const bonus = el("p", {});
  const updateBonus = () => { bonus.textContent = `🎁 +1 Geerho welcome bonus: you'll start at Level ${Math.min(Number(level.value) + 1, 50)} on Geerho once we approve it.`; };
  level.addEventListener("change", updateBonus); updateBonus();
  const send = button("Get My Code", async () => {
    const name = username.value.trim().replace(/^@+/, "");
    if (name.length < 2) return ctx.fail("Enter your TikTok username.");
    const { error } = await supabase.rpc("request_level_transfer", { tiktok_username: name, level: Number(level.value) });
    if (error) return ctx.fail(friendlyError(error));
    ctx.reload();
  });
  return [el("p", { class: "group-title" }, "Transfer your TikTok level"),
    el("div", { class: "decision" }, el("label", {}, "@ ", username), el("label", {}, "Your TikTok gifter level", level),
      el("p", { class: "hint" }, "Use the account you'll send the code from. We check the gifter level shown on your TikTok profile."),
      bonus,
      el("ol", { class: "hint" }, el("li", {}, "Tap Get My Code."), el("li", {}, `Send the code to @${TIKTOK_HANDLE} in a TikTok message.`),
        el("li", {}, "We check your gifter level and approve it, usually within 24 hours. You'll hear back in Geerho Support.")),
      el("p", { class: "hint" }, "Each person can transfer a TikTok level to one verified Geerho account."),
      actionsBar(send))];
}

const PROOF_KINDS = [["utility_bill", "Utility bill (power, water, internet)"], ["bank_statement", "Bank or credit card statement"],
  ["lease", "Lease or rental agreement"], ["government_letter", "Letter from a government office"], ["insurance", "Insurance policy or bill"],
  ["tax_document", "Tax document"], ["employer_letter", "Letter or pay slip from your employer"], ["other", "Other official document"]];

/** Home Address (the app's HomeAddressView): private; a change needs 2–3 proofs that a moderator checks. */
async function address(ctx) {
  const { data, error } = await supabase.rpc("my_home_address");
  if (error) throw error;
  const a = data?.address;
  const pending = data?.request?.status === "pending";
  const out = [group([el("div", { class: "cell-pad" }, a
    ? [el("p", { class: "address-lines" }, [a.line1, a.line2, `${a.city ?? ""}${a.region ? `, ${a.region}` : ""} ${a.postal_code ?? ""}`].filter(Boolean).join("\n")),
      el("span", { class: "state muted" }, a.country)]
    : el("p", {}, "No address yet. If your ID shows your address, we add it when you verify."))], "Your address",
    "Private: it's never on your profile. It fills in checkout, and only the seller of something you buy sees the address you send them.")];
  if (pending) {
    out.push(group([el("div", { class: "cell-pad" }, el("p", {}, "A moderator checks your documents, usually within 1–2 business days. You'll hear back in Geerho Support."),
      actionsBar(button("Cancel This Change", confirmThen(ctx, "Cancel this change?", "Your documents are deleted.", "Cancel Change", () => supabase.rpc("cancel_address_change"), { danger: true }), "secondary")))], "Change requested"));
    return out;
  }
  if (!ctx.state.changingAddress) {
    out.push(el("div", { class: "stack-actions" }, button(a ? "Change My Address" : "Add My Address", () => { ctx.state.changingAddress = true; ctx.reload(); }, "secondary")));
    return out;
  }
  const line1 = input({ maxlength: 200, placeholder: "Street address", autocomplete: "address-line1" });
  const line2 = input({ maxlength: 100, placeholder: "Apt, suite (optional)", autocomplete: "address-line2" });
  const city = input({ maxlength: 100, placeholder: "City", autocomplete: "address-level2" });
  const region = input({ maxlength: 100, placeholder: "State / province", autocomplete: "address-level1" });
  const postal = input({ maxlength: 20, placeholder: "ZIP / postal code", autocomplete: "postal-code" });
  const country = el("select", { autocomplete: "country" }, [["US", "United States"], ["PH", "Philippines"]].map(([v, n]) => el("option", { value: v, selected: v === (a?.country ?? "US") }, n)));
  const proofs = [];
  const list = el("ul", { class: "proof-list" });
  const kind = el("select", { "aria-label": "Document type" }, PROOF_KINDS.map(([v, n]) => el("option", { value: v }, n)));
  const file = el("input", { type: "file", accept: "image/*", class: "sr-only", id: "proof-file" });
  const addLabel = el("label", { for: "proof-file", class: "button secondary" }, "Add a Photo of This Document");
  const count = el("p", { class: "group-title" });
  const drawProofs = () => {
    count.textContent = `Proofs of address (${proofs.length} of 2–3)`;
    list.replaceChildren(...proofs.map((p, i) => {
      const remove = el("button", { type: "button", class: "secondary" }, "Remove");
      remove.addEventListener("click", () => { proofs.splice(i, 1); drawProofs(); });
      return el("li", {}, el("span", {}, `${i + 1}. ${PROOF_KINDS.find(([v]) => v === p.kind)[1]}`), remove);
    }));
    addLabel.hidden = kind.hidden = proofs.length >= 3;
  };
  file.addEventListener("change", () => { const f = file.files?.[0]; if (f && proofs.length < 3) proofs.push({ kind: kind.value, file: f }); file.value = ""; drawProofs(); });
  drawProofs();
  const send = button("Send for Review", async () => {
    if (proofs.length < 2) return ctx.fail("Add at least 2 proofs of address.");
    if (!line1.value.trim() || !city.value.trim() || !postal.value.trim()) return ctx.fail("Fill in the street, city, and ZIP or postal code.");
    const bucket = supabase.storage.from("address-proofs");
    const uploaded = [];
    for (const p of proofs) {
      const path = `${ctx.me.id}/${crypto.randomUUID()}.jpg`;
      const { error: e } = await bucket.upload(path, await shrinkJPEG(p.file), { contentType: "image/jpeg" });
      if (e) {
        if (uploaded.length) await bucket.remove(uploaded.map((u) => u.path)).catch(() => {});
        return ctx.fail("A document couldn't be uploaded. Check your connection and try again.");
      }
      uploaded.push({ path, kind: p.kind });
    }
    const { error: e } = await supabase.rpc("submit_address_change", {
      address: { line1: line1.value.trim(), ...(line2.value.trim() ? { line2: line2.value.trim() } : {}), city: city.value.trim(),
        ...(region.value.trim() ? { region: region.value.trim() } : {}), postal_code: postal.value.trim(), country: country.value },
      proofs: uploaded,
    });
    if (e) {
      // Don't leave documents behind when the request is refused.
      await bucket.remove(uploaded.map((u) => u.path)).catch(() => {});
      return ctx.fail(friendlyError(e));
    }
    ctx.state.changingAddress = false;
    ctx.reload();
  });
  out.push(el("p", { class: "group-title" }, "New address"),
    el("div", { class: "group form-group" }, ...[line1, line2, city, region, postal, country].map((x) => el("div", { class: "form-row" }, x))),
    el("p", { class: "group-footer" }, "You'll need 2 or 3 recent documents showing your name and the new address, like a utility bill and a bank statement. A moderator checks them, then they're deleted."),
    count, el("div", { class: "group form-group" }, el("div", { class: "form-row" }, list, kind, addLabel, file)),
    el("div", { class: "stack-actions" }, send, button("Cancel", () => { ctx.state.changingAddress = false; ctx.reload(); }, "secondary")));
  return out;
}

// --- Followers · Following · Contacts, and Blocked Users ------------------------------------------------------------

async function follows(ctx, which) {
  const { data, error } = await supabase.rpc("follow_list", { member: ctx.me.id, which, page_size: 100, page: 0 });
  if (error) throw error;
  if (!(data ?? []).length) return [empty("team", `No ${which} yet`, which === "contacts" ? "People you follow who follow you back show up here." : "")];
  const row = (p) => el("a", { class: "item-row", href: `member.html?id=${p.id}` }, avatar(p.avatar_url, p.display_name || p.username, 44),
    el("span", { class: "row-title" }, el("strong", {}, p.display_name || `@${p.username}`), el("small", {}, `@${p.username}`)), icon("chevronRight", "chev"));
  if (which !== "followers") return [group(data.map(row))];
  // Your own followers can be removed (the app's swipe → Remove); they aren't told.
  return [group(data.map((p) => el("div", { class: "item" }, row(p),
    actionsBar(button("Remove", confirmThen(ctx, `Remove ${p.display_name || "@" + p.username}?`, "They won't be told. They can follow you again later.", "Remove",
      () => supabase.rpc("remove_followers", { members: [p.id] }), { danger: true }), "secondary")))))];
}

async function blocked(ctx) {
  const { data: rows } = await supabase.from("blocks").select("blocked_id").eq("blocker_id", ctx.me.id);
  const ids = (rows ?? []).map((r) => r.blocked_id);
  if (!ids.length) return [empty("lock", "No blocked users", "People you block can't message you or see your listings.")];
  const { data: people } = await supabase.from("profiles").select("id, username, display_name, avatar_url").in("id", ids);
  return [group((people ?? []).map((p) => el("div", { class: "item" },
    el("div", { class: "item-row" }, avatar(p.avatar_url, p.display_name || p.username, 44), el("span", { class: "row-title" }, el("strong", {}, p.display_name || `@${p.username}`))),
    actionsBar(button("Unblock", confirmThen(ctx, `Unblock ${p.display_name || "@" + p.username}?`, "They can message you again.", "Unblock",
      () => supabase.from("blocks").delete().eq("blocker_id", ctx.me.id).eq("blocked_id", p.id)), "secondary")))))];
}

// --- Invite Friends (InviteFriendsView, M142) --------------------------------------------------------------------------

async function invites(ctx) {
  const { data: s, error } = await supabase.rpc("my_invites");
  if (error) throw error;
  const share = el("button", { type: "button", class: "row link-row" }, rowIcon("invite", "accent"), el("span", { class: "row-title" }, "Share My Invitation"));
  share.addEventListener("click", () => inviteFriends(s.username, share));
  const line = (label, value) => el("div", { class: "cell-pad" }, el("span", {}, label), el("strong", { style: "float:right" }, String(value)));
  const out = [
    group([el("div", { class: "cell-pad" }, el("p", {}, el("strong", {}, "Invite a friend, both sell for free")),
      el("p", { class: "muted" }, "When a friend you invite joins and verifies their ID, you both get one sale with no Geerho commission. Card or bank processing still applies.")),
      share, s.username ? line("Your invite code", `@${s.username}`) : null], null,
      "Your friend enters your username under Profile → Invite Friends after joining. Geerho never messages anyone for you."),
    group([line("Friends who joined", s.friends_joined), line("Friends who verified", s.friends_verified),
      line("Free sales left", s.free_sales_left), s.free_sales_used ? line("Free sales used", s.free_sales_used) : null], "Your invitations"),
  ];
  if (s.invited_by) {
    out.push(group([line("Invited by", `@${s.invited_by}`)], "Who invited you"));
  } else if (s.can_claim) {
    const field = el("input", { type: "text", placeholder: "Their username, like @maria_s", "aria-label": "Who invited you", autocapitalize: "none", spellcheck: "false" });
    out.push(group([el("div", { class: "cell-pad form-grid" }, field, button("Save", async () => {
      const { error: e } = await supabase.rpc("claim_invite", { username: field.value });
      if (e) return ctx.fail(friendlyError(e));
      ctx.reload();
    }))], "Who invited you?",
    `You can add this once, until ${new Date(s.claim_until).toLocaleDateString(undefined, { dateStyle: "medium" })}. You both get your free sale when you verify your ID.`));
  }
  return out.flat().filter(Boolean);
}

// --- Router ----------------------------------------------------------------------------------------------------------

const SCREENS = {
  bids: ["My Bids", bids], purchases: ["Purchases", purchases], sales: ["Sales", sales], requests: ["Purchase Requests", requests],
  listings: ["My Listings", listings], watching: ["Watching", watching], favorites: ["Favorites", favorites], rentals: ["Rentals", rentals],
  tours: ["Home Tours", tours], jobs: ["Jobs and Quotes", jobs], getpaid: ["Get Paid", getpaid], team: ["Team", team], invites: ["Invite Friends", invites],
  licenses: ["Professional Licenses", licenses], milestone: ["Milestone Level", milestone], address: ["Home Address", address],
  "follows-followers": ["Followers", (ctx) => follows(ctx, "followers")], "follows-following": ["Following", (ctx) => follows(ctx, "following")],
  "follows-contacts": ["Contacts", (ctx) => follows(ctx, "contacts")], blocked: ["Blocked Users", blocked],
};
const state = {};

export async function renderScreen(name, container, { me, profile }) {
  if (name === "public") { location.href = `member.html?id=${profile.id}`; return; }
  const entry = SCREENS[name];
  if (!entry) { location.hash = ""; return; }
  const [title, build] = entry;
  const back = name === "blocked" ? { back: "#settings", backLabel: "Settings" } : {};
  document.title = `${title} · Geerho`;
  const error = el("p", { class: "status bad", role: "alert", hidden: true });
  const ctx = {
    me, profile, state,
    fail(message) { error.textContent = message; error.hidden = !message; if (message) error.scrollIntoView({ block: "nearest" }); },
    reload() { renderScreen(name, container, { me, profile }); },
  };
  const body = await build(ctx);
  if (location.hash.slice(1) !== name) return;   // the visitor moved on while this loaded
  container.replaceChildren(screenHead(title, back), error, ...body.flat(Infinity).filter(Boolean));
}
