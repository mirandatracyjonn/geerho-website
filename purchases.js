// My purchases on geerho.com (website parity): requests waiting for the seller, and purchases to confirm, review, or
// report. Same tables and functions as the apps' Profile → Purchases.
import { el, money } from "./site.js";
import { currentUser, friendlyError, signInURL, supabase } from "./auth.js";

const status = document.getElementById("p-status");
const requestsBox = document.getElementById("requests");
const purchasesBox = document.getElementById("purchases");
const user = await currentUser();
if (!user) location.replace(signInURL());

const PAYMENT_TEXT = { awaiting_payment: "Not paid yet", authorized: "Paid · held by Geerho", processing: "Bank payment processing",
  held: "Paid · held until you confirm", released: "Paid to the seller", refunded: "Refunded", disputed: "On hold for review",
  canceled: "Payment canceled" };

async function act(promise, done) {
  const { error } = await promise;
  status.textContent = error ? friendlyError(error) : done;
  if (!error) render();
}

async function render() {
  const [{ data: orders }, { data: sales }, { data: payments }, { data: reviews }] = await Promise.all([
    supabase.from("orders").select("id, listing_id, listing_title, price_cents, shipping_fee_cents, currency, status, respond_by")
      .eq("buyer_id", user.id).eq("status", "requested").order("created_at", { ascending: false }),
    supabase.from("sales").select("id, listing_id, seller_id, listing_title, price_cents, currency, delivery, carrier, shipping_fee_cents, tracking_number, received_at, order_id, reference, created_at")
      .eq("buyer_id", user.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("payments").select("order_id, status, problem"),
    supabase.from("reviews").select("sale_id").eq("reviewer_id", user.id),
  ]);
  const payFor = Object.fromEntries((payments ?? []).filter((p) => p.order_id).map((p) => [p.order_id, p]));
  const reviewed = new Set((reviews ?? []).map((r) => r.sale_id));

  requestsBox.replaceChildren(...((orders ?? []).length ? orders.map((o) => {
    const pay = payFor[o.id];
    const row = el("div", { class: "panel" },
      el("h3", {}, el("a", { href: `listing.html?id=${o.listing_id}` }, o.listing_title)),
      el("p", { class: "meta" }, `${money(o.price_cents + (o.shipping_fee_cents ?? 0), o.currency)} · seller answers by ${new Date(o.respond_by).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`
        + (pay ? ` · ${PAYMENT_TEXT[pay.status] ?? pay.status}` : "")));
    const buttons = el("div", { class: "actions" });
    if (pay && pay.status === "awaiting_payment") {
      const payButton = el("button", { type: "button" }, "Pay now");
      payButton.addEventListener("click", async () => {
        const { data, error } = await supabase.functions.invoke("payments", { body: { action: "checkout", order_id: o.id, from: "web" } });
        if (data?.url) location.href = data.url; else status.textContent = error ? "We couldn't open checkout. Please try again." : "";
      });
      buttons.append(payButton);
    }
    const cancel = el("button", { type: "button", class: "secondary" }, "Cancel request");
    cancel.addEventListener("click", () => { if (confirm("Cancel this purchase request?")) act(supabase.rpc("cancel_order", { order_id: o.id }), "Request canceled."); });
    buttons.append(cancel);
    row.append(buttons);
    return row;
  }) : [el("p", { class: "hint" }, "No open requests.")]));

  purchasesBox.replaceChildren(...((sales ?? []).length ? sales.map((s) => {
    const pay = payFor[s.order_id];
    const row = el("div", { class: "panel" },
      el("h3", {}, el("a", { href: `listing.html?id=${s.listing_id}` }, s.listing_title)),
      el("p", { class: "meta" }, [money(s.price_cents + (s.shipping_fee_cents ?? 0), s.currency), s.reference,
        s.delivery === "shipping" ? (s.tracking_number ? `${s.carrier ?? "Tracking"}: ${s.tracking_number}` : "Waiting for tracking") : "Pickup",
        pay ? PAYMENT_TEXT[pay.status] ?? pay.status : null, s.received_at ? "Received" : null].filter(Boolean).join(" · ")));
    const buttons = el("div", { class: "actions" });
    if (!s.received_at) {
      const got = el("button", { type: "button" }, "I got it");
      got.addEventListener("click", () => { if (confirm("Confirm you have the item? Any held payment goes to the seller.")) act(supabase.rpc("confirm_received", { sale: s.id }), "Thanks! The seller has been paid."); });
      const problem = el("button", { type: "button", class: "secondary" }, "Report a problem");
      problem.addEventListener("click", () => {
        const details = prompt("What's wrong? (A moderator reviews it; the payment stays on hold.)");
        if (details && details.trim().length >= 10) act(supabase.rpc("report_payment_problem", { sale: s.id, details: details.trim() }), "Reported. A moderator will review it.");
      });
      buttons.append(got, problem);
    } else if (!reviewed.has(s.id)) {
      const review = el("button", { type: "button", class: "secondary" }, "Leave a review");
      review.addEventListener("click", () => {
        const rating = Number(prompt("Rate the seller from 1 to 5 stars", "5"));
        if (!(rating >= 1 && rating <= 5)) return;
        const body = prompt("A few words about the seller (optional)") ?? "";
        act(supabase.rpc("leave_review", { sale: s.id, rating: Math.round(rating), ...(body.trim() ? { body: body.trim() } : {}) }), "Thanks for your review!");
      });
      buttons.append(review);
    }
    if (buttons.childElementCount) row.append(buttons);
    return row;
  }) : [el("p", { class: "hint" }, "No purchases yet. ", el("a", { href: "browse.html" }, "Browse listings"), ".")]));
}

if (user) render();
