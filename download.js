import { APP_STORE_URL, TESTFLIGHT_URL, el } from "./site.js";

const reference = new URLSearchParams(location.search).get("for");
if (reference && /^[A-Z]-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(reference)) {
  document.getElementById("reason").textContent =
    `To buy, bid, rent, or message about listing ${reference}, use the Geerho app. Every member verifies their identity there, so you always know who you're dealing with.`;
}

const links = document.getElementById("links");
if (APP_STORE_URL) links.append(el("a", { class: "button", href: APP_STORE_URL }, "Download on the App Store"));
if (TESTFLIGHT_URL) links.append(el("a", { class: APP_STORE_URL ? "button secondary" : "button", href: TESTFLIGHT_URL }, "Join the beta on TestFlight"));
if (APP_STORE_URL || TESTFLIGHT_URL) {
  document.getElementById("availability").textContent = APP_STORE_URL
    ? "Geerho is free on the App Store for iPhone."
    : "Geerho is in public beta. Join on your iPhone with Apple's free TestFlight app.";
}
