// Download page: shows why the visitor was sent to get the app (a transaction ID) and the TestFlight / App Store links.
import { APP_STORE_URL, TESTFLIGHT_URL, el } from "./site.js";

const reference = new URLSearchParams(location.search).get("for");
if (reference && /^[A-Z]-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(reference)) {
  document.getElementById("reason").textContent =
    `To buy, bid, or rent listing ${reference}, use the Geerho app. Every member verifies their identity, so you always know who you're dealing with.`;
}

const links = document.getElementById("links");
if (APP_STORE_URL) links.append(el("a", { class: "button", href: APP_STORE_URL }, "Download on the App Store"));
if (TESTFLIGHT_URL) links.append(el("a", { class: APP_STORE_URL ? "button secondary" : "button", href: TESTFLIGHT_URL }, "iPhone beta (TestFlight)"));
// Both platforms at the top (2026-10-24 audit): Android goes to its install steps below.
links.append(el("a", { class: "button secondary", href: "#android" }, "Android beta (by invite)"));
if (APP_STORE_URL || TESTFLIGHT_URL) {
  document.getElementById("availability").textContent = APP_STORE_URL
    ? "Geerho is free on the App Store for iPhone. Android beta by invite."
    : "Geerho is in beta: iPhone through Apple's free TestFlight app, Android by invite.";
}

// Android phones (the app's Update button sends them here): say how Android testers update, first (TJ, 2026-10-19:
// "it goes to the website which only have ios join the testflight").
if (/Android/i.test(navigator.userAgent)) {
  document.querySelector("h1").textContent = "Get Geerho for Android";
  document.getElementById("availability").textContent =
    "Geerho's Android beta comes through Google's free Firebase App Tester app. Open App Tester, tap Geerho, then Download or Update.";
  links.replaceChildren(el("a", { class: "button", href: "#android" }, "How to install or update on Android"));
}
