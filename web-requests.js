// Renting a tool, requesting a home tour, requesting a quote, and responding to a job on geerho.com (2026-10-14),
// the same flows and wording as the apps (iOS RentalViews / PropertyViews / FreelanceViews; Android Rentals.kt and
// Requests.kt), using the same database functions: rental_eligibility, rental_booked_dates, request_rental (then the
// payments "checkout" with rental_id), request_tour, request_quote, respond_to_job.
import { el, money } from "./site.js";
import { currentUser, friendlyError, signInURL, supabase } from "./auth.js";

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";
const dayText = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const isoDay = (date) => date.toLocaleDateString("en-CA");   // YYYY-MM-DD in the visitor's time zone

function panel(...children) { return el("div", { class: "panel web-request" }, ...children.flat().filter(Boolean)); }
function sent(title, message) {
  return panel(el("p", { class: "status good" }, el("strong", {}, title)), el("p", {}, message),
    el("a", { class: "button secondary", href: "messages.html" }, "Open Inbox"));
}

/** Signed in and verified, or a panel that says what to do (like the apps). */
async function gate(listing, action) {
  const user = await currentUser();
  if (!user) return { block: panel(el("a", { class: "button", href: signInURL() }, `Sign in to ${action}`)) };
  if (user.id === listing.seller_id) return { block: null };
  return { user };
}
function verifyHint(problem) {
  return /verif/i.test(problem?.message ?? "")
    ? el("span", {}, "Verify your identity first. ", el("a", { href: "account.html#verify" }, "Verify now"), ".")
    : friendlyError(problem);
}

// --- Rent a tool --------------------------------------------------------------------------------------------------

/** Mirrors private.rental_rent: full weeks at the weekly rate, leftover days daily (never more than another week). */
function rent(days, daily, weekly) {
  if (!weekly) return days * daily;
  const weeks = Math.floor(days / 7), leftover = days % 7;
  return Math.min(days * daily, weeks * weekly + Math.min(leftover * daily, weekly));
}

export async function rentPanel(listing) {
  const { user, block } = await gate(listing, "rent");
  if (!user) return block;
  const { data: mine } = await supabase.from("rental_bookings").select("id, status").eq("listing_id", listing.id).eq("renter_id", user.id)
    .in("status", ["requested", "accepted", "picked_up"]).limit(1);
  if (mine?.length) {
    return panel(el("p", { class: "status warn-text" }, mine[0].status === "requested" ? "You requested this rental · the owner has 24 hours to answer"
      : "You're renting this. See Profile → Rentals."), el("a", { class: "button secondary", href: "account.html#rentals" }, "My Rentals"));
  }

  const c = listing.currency;
  const daily = listing.price_cents, weekly = listing.weekly_rate_cents, deposit = listing.deposit_cents ?? 0;
  const lateFee = listing.late_fee_cents ?? daily, maxDays = listing.max_rental_days ?? 30;
  const box = el("div", { class: "web-request-body" });
  const status = el("p", { class: "form-hint", role: "status" });
  let place = null;

  // Step 1: where you are (tool rentals are local pickup only).
  const where = el("button", { type: "button" }, "Use My Location");
  const city = el("input", { type: "text", placeholder: "City or ZIP / postal code", "aria-label": "City or ZIP code" });
  const find = el("button", { type: "button", class: "secondary" }, "Find");
  const checkArea = async (latitude, longitude, label) => {
    const { data } = await supabase.rpc("rental_eligibility", { listing: listing.id, near_latitude: latitude, near_longitude: longitude });
    const e = data?.[0];
    const unit = (miles) => (listing.country === "PH" ? `${Math.round(miles * 1.609)} km` : `${miles} ${miles === 1 ? "mile" : "miles"}`);
    if (e && !e.allowed) { status.textContent = `${unit(e.distance_miles)} away · owner lends within ${unit(e.radius_miles)}`; return; }
    place = { latitude, longitude };
    status.textContent = e ? `${unit(e.distance_miles)} away${label ? ` from ${label}` : ""} · owner lends within ${unit(e.radius_miles)}` : "";
    showForm();
  };
  where.addEventListener("click", () => {
    status.textContent = "Finding your area…";
    navigator.geolocation?.getCurrentPosition(
      (p) => checkArea(Math.round(p.coords.latitude * 1000) / 1000, Math.round(p.coords.longitude * 1000) / 1000, null),
      () => { status.textContent = "Allow location, or type a city or ZIP code."; }, { timeout: 15000, maximumAge: 600000 });
  });
  find.addEventListener("click", async () => {
    if (city.value.trim().length < 2) return;
    status.textContent = "Finding the area…";
    const { data, error } = await supabase.functions.invoke("geocode", { body: { query: city.value.trim() } });
    if (error || !data?.latitude) { status.textContent = "We couldn't find that place. Try the city and state, or a ZIP code."; return; }
    checkArea(data.latitude, data.longitude, [data.city, data.region].filter(Boolean).join(", "));
  });
  box.append(el("p", { class: "hint" }, "Tool rentals are local pickup only. Share your approximate location so we can check the owner's lending area."),
    el("div", { class: "area-actions" }, where), el("div", { class: "area-search" }, city, find), status);

  async function showForm() {
    const [{ data: booked }, { data: cards }] = await Promise.all([
      supabase.rpc("rental_booked_dates", { listing: listing.id }),
      supabase.rpc("accepts_card_payments", { seller: listing.seller_id }),
    ]);
    const today = new Date();
    const tomorrow = new Date(Date.now() + 86400000);
    const from = el("input", { type: "date", min: isoDay(today), value: isoDay(today), "aria-label": "Pickup" });
    const to = el("input", { type: "date", min: isoDay(today), value: isoDay(tomorrow), "aria-label": "Return" });
    const summary = el("div", { class: "rent-summary" });
    const problemLine = el("p", { class: "status bad", hidden: true });
    const note = el("textarea", { maxlength: 500, rows: 2, placeholder: "What's it for? When can you pick it up?" });
    const agree = el("input", { type: "checkbox" });
    const agreeText = el("span", {});
    const send = el("button", { type: "button", class: "post-primary" }, "Request to Rent");
    const error = el("p", { class: "status bad", role: "alert", hidden: true });
    const update = () => {
      const a = new Date(`${from.value}T12:00:00`), b = new Date(`${to.value}T12:00:00`);
      const days = Math.round((b - a) / 86400000) + 1;
      const conflict = (booked ?? []).find((r) => !(to.value < r.start_date || from.value > r.end_date));
      const problem = !from.value || !to.value ? "Choose the pickup and return dates."
        : days < 1 ? "The return date must be on or after the pickup date."
        : days > maxDays ? `This item can be rented for up to ${maxDays} days.`
        : conflict ? `Booked ${dayText(conflict.start_date)} – ${dayText(conflict.end_date)}. Choose other dates.` : null;
      problemLine.textContent = problem ?? "";
      problemLine.hidden = !problem;
      const total = days > 0 ? rent(days, daily, weekly) : 0;
      summary.replaceChildren(
        el("div", {}, el("span", {}, `${Math.max(days, 0)} ${days === 1 ? "day" : "days"}`), el("strong", {}, money(total, c))),
        deposit ? el("div", {}, el("span", {}, "Refundable deposit"), el("strong", {}, money(deposit, c))) : null,
        el("div", {}, el("span", {}, "Late fee"), el("strong", {}, `${money(lateFee, c)} / day`)),
        weekly && days >= 7 ? el("small", { class: "form-hint" }, `Weekly rate applied: ${money(weekly, c)} per 7 days.`) : null);
      const coverDays = lateFee > 0 ? Math.ceil(deposit / lateFee) : 0;
      agreeText.textContent = `I'm 18 or older, know how to use this safely, and will return it on time in the same condition. If I'm late, ${money(lateFee, c)} a day is charged or taken from my ${money(deposit, c)} deposit. If late fees reach the deposit (after ${coverDays} ${coverDays === 1 ? "day" : "days"}), I keep the item as a purchase and the owner keeps the deposit; if I bring it back later, the owner may refuse it unless I pay what I owe. The details on this listing are the terms of our deal and I'll honor them. I use the item at my own risk; Geerho isn't a party to this rental and isn't responsible for any accident, injury, or damage (Terms section 7).`;
      send.disabled = !!problem;
    };
    from.addEventListener("change", () => { if (to.value < from.value) to.value = from.value; to.min = from.value; update(); });
    to.addEventListener("change", update);
    send.addEventListener("click", async () => {
      error.hidden = true;
      if (!agree.checked) { error.textContent = "Accept the rental terms to continue."; error.hidden = false; return; }
      send.disabled = true;
      send.textContent = "Sending…";
      const { data: bookingId, error: problem } = await supabase.rpc("request_rental", {
        listing: listing.id, start_date: from.value, end_date: to.value, ...(note.value.trim() ? { note: note.value.trim() } : {}),
        accept_terms: true, near_latitude: place.latitude, near_longitude: place.longitude, time_zone: timeZone(),
      });
      if (problem) {
        send.disabled = false;
        send.textContent = "Request to Rent";
        error.replaceChildren(verifyHint(problem));
        error.hidden = false;
        return;
      }
      if (cards) {
        const { data: session } = await supabase.functions.invoke("payments", { body: { action: "checkout", rental_id: bookingId, from: "web" } });
        if (session?.url) { location.href = session.url; return; }
      }
      box.replaceWith(sent("Request sent", "The owner has 24 hours to accept. You'll see their answer in your Inbox and in Profile → Rentals."));
    });
    box.replaceChildren(
      el("p", { class: "form-hint" }, status.textContent),
      el("div", { class: "two-dates" }, el("label", {}, el("span", { class: "form-label" }, "Pickup"), from), el("label", {}, el("span", { class: "form-label" }, "Return"), to)),
      problemLine,
      (booked ?? []).length ? el("p", { class: "form-hint" }, "Already booked: " + booked.map((r) => `${dayText(r.start_date)}–${dayText(r.end_date)}`).join(", ")) : null,
      summary,
      el("label", { class: "form-label" }, "Message to the owner (optional)"), note,
      el("label", { class: "check-row" }, agree, agreeText),
      el("p", { class: "form-hint" }, cards
        ? (c === "PHP" ? "Pay securely with GCash, Maya, a card, or QR Ph through PayMongo: rent plus the refundable deposit. If the owner doesn't accept, you're refunded in full."
          : "Pay securely by card with Stripe: rent plus the refundable deposit. You're charged only if the owner accepts.")
          + " Geerho pays the owner the rent at pickup and returns your deposit after the return, minus any late fees."
        : "Geerho doesn't collect rent or hold deposits for this owner. Pay the owner as you agree, never with gift cards or wire transfers."),
      send, error);
    update();
  }
  return panel(el("h3", { class: "request-title" }, "Request to Rent"), box);
}

// --- Request a home tour ------------------------------------------------------------------------------------------

export async function tourPanel(listing) {
  const { user, block } = await gate(listing, "request a tour");
  if (!user) return block;
  const { data: open } = await supabase.from("tour_requests").select("status, confirmed_time").eq("listing_id", listing.id).eq("requester_id", user.id)
    .in("status", ["requested", "confirmed"]).limit(1);
  if (open?.length) {
    const t = open[0];
    return panel(el("p", { class: t.status === "confirmed" ? "status good" : "status" }, t.status === "confirmed"
      ? `Tour confirmed for ${new Date(t.confirmed_time).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
      : "Tour requested · waiting for the lister"), el("a", { class: "button secondary", href: "account.html#tours" }, "Home Tours"));
  }
  const pad = (n) => String(n).padStart(2, "0");
  const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
  const option = (days) => { const d = new Date(Date.now() + days * 86400000); d.setHours(17, 0, 0, 0); return el("input", { type: "datetime-local", value: local(d), min: local(new Date()), step: 900 }); };
  const times = el("div", { class: "tour-times" }, option(1));
  const add = el("button", { type: "button", class: "secondary" }, "+ Add Another Time");
  add.addEventListener("click", () => {
    times.append(option(times.children.length + 1));
    if (times.children.length >= 3) add.hidden = true;
  });
  const note = el("textarea", { maxlength: 1000, rows: 2, placeholder: "Questions or anything the lister should know" });
  const send = el("button", { type: "button", class: "post-primary" }, "Request a Tour");
  const error = el("p", { class: "status bad", role: "alert", hidden: true });
  const body = el("div", { class: "web-request-body" },
    el("span", { class: "form-label" }, "Times that work for you"), times, add,
    el("p", { class: "form-hint" }, `Times are in your time zone (${timeZone().replace(/_/g, " ")}). The lister confirms one, or suggests another in the chat.`),
    el("label", { class: "form-label" }, "Note (optional)"), note,
    el("p", { class: "form-hint" }, `Never send money, deposits, or financial details before you've seen the home and confirmed the lister is authorized to ${listing.kind === "rental" ? "rent" : "sell"} it.`),
    send, error);
  send.addEventListener("click", async () => {
    error.hidden = true;
    const options = [...times.querySelectorAll("input")].map((i) => i.value).filter(Boolean).map((v) => new Date(v));
    if (!options.length || options.some((d) => d < new Date())) { error.textContent = "Choose times in the future."; error.hidden = false; return; }
    send.disabled = true;
    const { error: problem } = await supabase.rpc("request_tour", { listing: listing.id, options: options.map((d) => d.toISOString()),
      ...(note.value.trim() ? { note: note.value.trim() } : {}), time_zone: timeZone() });
    send.disabled = false;
    if (problem) { error.replaceChildren(verifyHint(problem)); error.hidden = false; return; }
    body.replaceWith(sent("Tour requested", "The lister confirms one of your times, or suggests another, in your Inbox. Follow it in Profile → Home Tours."));
  });
  return panel(el("h3", { class: "request-title" }, "Request a Tour"), body);
}

// --- Request a quote (services) and respond to a job --------------------------------------------------------------

export async function quotePanel(listing) {
  const { user, block } = await gate(listing, "request a quote");
  if (!user) return block;
  const details = el("textarea", { maxlength: 2000, rows: 4, placeholder: "What do you need done? Include size, timing, and anything special." });
  const date = el("input", { type: "date", min: isoDay(new Date()), "aria-label": "Preferred date (optional)" });
  const send = el("button", { type: "button", class: "post-primary" }, "Request a Quote");
  const error = el("p", { class: "status bad", role: "alert", hidden: true });
  const body = el("div", { class: "web-request-body" },
    el("label", { class: "form-label" }, "The job"), details,
    el("label", { class: "form-label" }, "Preferred date (optional)"), date,
    el("p", { class: "form-hint" }, `Your request is sent to ${listing.title} in a conversation, where they'll reply with a price and availability.`),
    send, error);
  send.addEventListener("click", async () => {
    error.hidden = true;
    if (details.value.trim().length < 10) { error.textContent = "Describe the job (at least 10 characters)."; error.hidden = false; return; }
    send.disabled = true;
    const { error: problem } = await supabase.rpc("request_quote", { listing: listing.id, details: details.value.trim(), ...(date.value ? { preferred_date: date.value } : {}) });
    send.disabled = false;
    if (problem) { error.replaceChildren(verifyHint(problem)); error.hidden = false; return; }
    body.replaceWith(sent("Request sent", "They'll reply in your Inbox with a price and availability."));
  });
  return panel(el("h3", { class: "request-title" }, "Request a Quote"), body);
}

export async function respondPanel(listing) {
  const { user, block } = await gate(listing, "respond");
  if (!user) return block;
  const message = el("textarea", { maxlength: 2000, rows: 4, placeholder: "Why you're a good fit, when you're available, and any questions" });
  const withPrice = el("input", { type: "checkbox" });
  const type = el("div", { class: "chip-row", hidden: true },
    ...[["fixed", "For the job"], ["hourly", "Per hour"]].map(([v, label], i) => el("label", { class: "chip" }, el("input", { type: "radio", name: "quote-type", value: v, checked: i === 0 }), el("span", {}, label))));
  const amount = el("input", { type: "text", inputmode: "decimal", placeholder: `Amount (${listing.currency})`, hidden: true });
  withPrice.addEventListener("change", () => { type.hidden = amount.hidden = !withPrice.checked; });
  const send = el("button", { type: "button", class: "post-primary" }, "Respond to Job");
  const error = el("p", { class: "status bad", role: "alert", hidden: true });
  const body = el("div", { class: "web-request-body" },
    el("label", { class: "form-label" }, "Your response"), message,
    el("label", { class: "check-row" }, withPrice, el("span", {}, "Include a price")), type, amount,
    el("p", { class: "form-hint" }, "Your response goes to the poster in a conversation. Payment is arranged between you."),
    send, error);
  send.addEventListener("click", async () => {
    error.hidden = true;
    if (message.value.trim().length < 10) { error.textContent = "Write a short response (at least 10 characters)."; error.hidden = false; return; }
    const cents = withPrice.checked ? Math.round(Number(amount.value.replace(/,/g, "")) * 100) : null;
    if (withPrice.checked && !(cents >= 1)) { error.textContent = "Enter the amount, or uncheck Include a price."; error.hidden = false; return; }
    send.disabled = true;
    const { error: problem } = await supabase.rpc("respond_to_job", { job: listing.id, message: message.value.trim(),
      ...(cents ? { quote_cents: cents, quote_type: type.querySelector("input:checked").value } : {}) });
    send.disabled = false;
    if (problem) {
      error.replaceChildren(/licen/i.test(problem.message) ? el("span", {}, "Licensed professionals only. ", el("a", { href: "account.html#licenses" }, "Add your license"), " and respond once a moderator approves it.") : verifyHint(problem));
      error.hidden = false;
      return;
    }
    body.replaceWith(sent("Response sent", "The poster sees it in your conversation. Follow it in Profile → Jobs and Quotes."));
  });
  return panel(el("h3", { class: "request-title" }, "Respond to Job"), body);
}
