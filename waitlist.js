// The launch waitlist (M146): "Tell me when Geerho opens". Renders the form into #waitlist-form (home page and
// waitlist.html), and handles the unsubscribe link (waitlist.html?leave=<token>).
import { el } from "./site.js";
import { friendlyError, supabase } from "./auth.js";

function form(container) {
  const source = container.dataset.source || (location.pathname.endsWith("waitlist.html") ? "waitlist" : "home");
  const email = el("input", { type: "email", required: true, autocomplete: "email", placeholder: "you@example.com", "aria-label": "Email" });
  const city = el("input", { type: "text", autocomplete: "address-level2", placeholder: "City (e.g. Lemoore)", "aria-label": "City" });
  const region = el("input", { type: "text", autocomplete: "address-level1", placeholder: "State or province", "aria-label": "State or province", maxlength: "40" });
  const country = el("select", { "aria-label": "Country", autocomplete: "country" },
    el("option", { value: "US" }, "United States"), el("option", { value: "PH" }, "Philippines"));
  const interest = el("select", { "aria-label": "I want to" },
    el("option", { value: "both" }, "Buy and sell"), el("option", { value: "buy" }, "Buy"), el("option", { value: "sell" }, "Sell"));
  const consent = el("input", { type: "checkbox", id: `wl-consent-${source}`, required: true });
  // Hidden from people (and screen readers); bots fill it in.
  const trap = el("input", { type: "text", name: "website", tabindex: "-1", autocomplete: "off", "aria-hidden": "true", class: "wl-trap" });
  const status = el("p", { class: "status", role: "status" });
  const submit = el("button", { type: "submit" }, "Tell Me");
  const node = el("form", { class: "waitlist-form", novalidate: true },
    el("div", { class: "wl-row" }, email, interest),
    el("div", { class: "wl-row" }, city, region),
    el("div", { class: "wl-row" }, country),
    el("label", { class: "wl-consent", for: consent.id }, consent,
      " Email me when Geerho opens near me and about the launch. I can unsubscribe any time."),
    trap, el("div", { class: "actions" }, submit), status);
  node.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.className = "status";
    if (!email.value.trim()) { status.textContent = "Enter your email."; status.classList.add("bad"); return; }
    if (!consent.checked) { status.textContent = "Tick the box so we can email you."; status.classList.add("bad"); return; }
    submit.disabled = true;
    const { data, error } = await supabase.rpc("join_waitlist", {
      email: email.value, interest: interest.value, consent: true, city: city.value || null, region: region.value || null,
      country: country.value, source, website: trap.value || null,
    });
    submit.disabled = false;
    if (error) { status.textContent = friendlyError(error); status.classList.add("bad"); return; }
    node.replaceChildren(el("p", { class: "status good" }, data === "already"
      ? "You're already on the list. We'll email you when Geerho opens near you."
      : "You're on the list! We'll email you when Geerho opens near you."));
  });
  container.replaceChildren(node);
}

async function leave(token) {
  const main = document.getElementById("main");
  const { data, error } = await supabase.rpc("leave_waitlist", { token });
  main.replaceChildren(el("h1", {}, "Unsubscribe"),
    el("p", { class: `status ${error || !data ? "bad" : "good"}` },
      error ? friendlyError(error) : data ? "You're unsubscribed, and we deleted your email from the list." : "That link isn't on our list (maybe you already unsubscribed)."),
    el("p", {}, el("a", { href: "index.html" }, "Back to Geerho")));
}

const token = new URLSearchParams(location.search).get("leave");
if (token && /^[0-9a-f-]{36}$/i.test(token)) leave(token);
else for (const container of document.querySelectorAll("#waitlist-form")) form(container);
