// Stripe Checkout and Stripe payout sign-up come back here; this hands control back to the Geerho app, or (web=1)
// stays on geerho.com for purchases made on the website.
const params = new URLSearchParams(location.search);
const flow = params.get("flow") === "connect" ? "connect" : "checkout";
const status = (params.get("status") || "").replace(/[^a-z]/g, "");
const payment = (params.get("payment") || "").replace(/[^a-f0-9-]/gi, "");

const titles = {
  "checkout:paid": "Payment authorized",
  "checkout:cancelled": "Payment cancelled",
  "connect:done": "Payout setup saved",
  "connect:retry": "Let's finish your payout setup",
};
document.getElementById("title").textContent = titles[`${flow}:${status}`] || "Returning to Geerho…";

// Paid on geerho.com (web=1): stay on the website and show where to follow the purchase.
if (params.get("web") === "1") {
  document.getElementById("message").textContent = status === "paid"
    ? "Your payment is held safely until you have the item. The seller has 24 hours to accept; you'll be notified."
    : "No payment was made. You can try again from your purchases.";
  const open = document.getElementById("open");
  open.href = "purchases.html";
  open.textContent = "See my purchases";
} else {
  const target = `geerho://payments?flow=${flow}&status=${status}${payment ? `&payment=${payment}` : ""}`;
  document.getElementById("open").href = target;
  location.replace(target);
}
