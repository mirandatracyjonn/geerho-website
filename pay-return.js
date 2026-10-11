// Stripe Checkout and Stripe payout sign-up come back here; this hands control back to the Geerho app.
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

const target = `geerho://payments?flow=${flow}&status=${status}${payment ? `&payment=${payment}` : ""}`;
document.getElementById("open").href = target;
location.replace(target);
