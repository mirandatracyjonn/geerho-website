// Posting on geerho.com (website parity phase 3, 2026-10-14): the same form as the app's Post tab, field for field
// (iOS ListingEditorView / PropertyEditorView / FreelanceEditor; Android PostModel.kt): photos, title, category or
// kind of work, condition, price and the type's own fields, description, delivery, and the area. It writes the same
// rows the apps write (listings, listing_photos, property_addresses, set_auction_reserve), so the database checks
// everything the same way: verification, price rules, plan limits, licenses, and where each kind is available.
// Also edits an existing listing (post.html?edit=<id>, from Profile → My Listings → Edit).
import { el, money, photoURL } from "./site.js";
import { friendlyError, supabase } from "./auth.js";
import { icon, rowIcon } from "./icons.js";

export const TYPES = {
  item: { title: "Sell an item", kind: "item", format: "fixed", icon: "tag", tint: "orange" },
  auction: { title: "Start an auction", kind: "item", format: "auction", icon: "hammer", tint: "purple" },
  tool: { title: "Rent out a tool or equipment", kind: "item", format: "rental", icon: "wrench", tint: "green" },
  home_rent: { title: "Rent out a home", kind: "rental", format: "fixed", icon: "key", tint: "teal" },
  home_sale: { title: "Sell a home", kind: "property_sale", format: "fixed", icon: "house", tint: "teal" },
  service: { title: "Offer a service", kind: "service", format: "fixed", icon: "briefcase", tint: "indigo" },
  job: { title: "Post a job", kind: "job", format: "fixed", icon: "megaphone", tint: "indigo" },
};
const CONDITIONS = [["new", "New"], ["like_new", "Like new"], ["good", "Good"], ["fair", "Fair"], ["for_parts", "For parts"]];
const ROLES = [["owner", "Owner"], ["agent", "Agent or broker"], ["property_manager", "Property manager"]];
const CARRIERS = {
  US: [["usps", "USPS"], ["ups", "UPS"], ["fedex", "FedEx"], ["dhl", "DHL"]],
  PH: [["lbc", "LBC Express"], ["jnt", "J&T Express"], ["ninjavan", "Ninja Van"], ["flash", "Flash Express"], ["lalamove", "Lalamove (same-day)"], ["phlpost", "PHLPost"], ["dhl", "DHL"]],
};
const MAX_PHOTOS = 10;
const EDIT_COLUMNS = "id, kind, listing_format, status, category_id, title, description, price_cents, currency, city, region, country, "
  + "condition, offers_pickup, offers_shipping, shipping_carriers, shipping_fee_cents, auction_duration_days, buy_now_cents, bid_count, "
  + "weekly_rate_cents, deposit_cents, max_rental_days, late_fee_cents, lending_radius_miles, lender_terms_accepted_at, lister_role, "
  + "bedrooms, bathrooms, floor_area_sqm, security_deposit_cents, lease_months, property_terms_accepted_at, profession, rate_type, "
  + "remote_ok, travel_radius_km, years_experience, listing_photos(storage_path, position, width, height)";

// --- Elite teams (M46): a team member's new posts belong to the Elite; the server records who posted them. -------------

let teamCache;
/** The Elite team I'm on (active, and its owner still has Elite), like the app's TeamStore.activeTeam. */
export async function activeTeam() {
  if (teamCache === undefined) {
    const { data } = await supabase.rpc("my_teams");
    const t = (data ?? []).find((m) => m.status === "active" && m.is_elite);
    teamCache = t ? { eliteId: t.elite_id, name: t.display_name && t.username ? `${t.display_name} (@${t.username})` : t.display_name || `@${t.username}` } : null;
  }
  return teamCache;
}
export function postsForTeam() {
  try { return localStorage.getItem("geerho.team.postsForTeam") !== "0"; } catch { return true; }
}
export function setPostsForTeam(on) {
  try { localStorage.setItem("geerho.team.postsForTeam", on ? "1" : "0"); } catch { /* private browsing */ }
}

/** "12.50" → 1250; blank or invalid → null. */
const cents = (text) => {
  const t = String(text ?? "").replace(/,/g, "").trim();
  if (!t || !/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
};
const amount = (c) => (c == null ? "" : String(c / 100).replace(/\.0+$/, ""));

// --- Small form pieces (grouped like the app's Form sections) ------------------------------------------------------

function section(title, ...rows) {
  return [title ? el("p", { class: "group-title" }, title) : null,
    el("div", { class: "group form-group" }, rows.flat().filter(Boolean))];
}
function field(label, input, hint = null) {
  return el("label", { class: "form-row" }, el("span", { class: "form-label" }, label), input, hint ? el("small", { class: "form-hint" }, hint) : null);
}
function textInput(value, attrs = {}) { return el("input", { type: "text", value: value ?? "", ...attrs }); }
function moneyInput(value, currency) {
  return el("span", { class: "money-input" }, el("span", { "aria-hidden": "true" }, currency === "PHP" ? "₱" : "$"),
    el("input", { type: "text", inputmode: "decimal", value: amount(value), placeholder: "0" }));
}
function moneyValue(wrapper) { return wrapper.querySelector("input").value; }
function select(options, value, placeholder) {
  return el("select", {}, placeholder ? el("option", { value: "" }, placeholder) : null,
    options.map(([v, label]) => el("option", { value: v, selected: String(v) === String(value ?? "") }, label)));
}
function chips(options, value, name) {
  return el("div", { class: "chip-row", role: "radiogroup", "data-name": name }, options.map(([v, label]) =>
    el("label", { class: "chip" }, el("input", { type: "radio", name, value: v, checked: v === value }), el("span", {}, label))));
}
function chipValue(row) { return row.querySelector("input:checked")?.value ?? null; }
function check(label, checked) {
  const input = el("input", { type: "checkbox", checked });
  return { row: el("label", { class: "check-row" }, input, el("span", {}, label)), input };
}

/** Bold and bullets, like the app's description editor (the website shows **bold**, *italic*, and - lists). */
function descriptionEditor(value) {
  const area = el("textarea", { maxlength: 5000, rows: 6, placeholder: "Describe it: size, age, what's included, any flaws…" });
  area.value = value ?? "";
  const wrap = (before, after = before) => {
    const { selectionStart: a, selectionEnd: b, value: v } = area;
    area.value = v.slice(0, a) + before + v.slice(a, b) + after + v.slice(b);
    area.focus();
    area.setSelectionRange(a + before.length, b + before.length);
  };
  const bullet = () => {
    const { selectionStart: a, value: v } = area;
    const start = v.lastIndexOf("\n", a - 1) + 1;
    area.value = v.slice(0, start) + "- " + v.slice(start);
    area.focus();
    area.setSelectionRange(a + 2, a + 2);
  };
  const b = el("button", { type: "button", class: "secondary tool-button", "aria-label": "Bold" }, el("strong", {}, "B"));
  const i = el("button", { type: "button", class: "secondary tool-button", "aria-label": "Italic" }, el("em", {}, "I"));
  const l = el("button", { type: "button", class: "secondary tool-button", "aria-label": "Bulleted list" }, "• List");
  b.addEventListener("click", () => wrap("**"));
  i.addEventListener("click", () => wrap("*"));
  l.addEventListener("click", bullet);
  return { node: el("div", { class: "description-editor" }, el("div", { class: "tool-row" }, b, i, l), area), area };
}

// --- Photos -------------------------------------------------------------------------------------------------------

/** Resizes to at most 1600 px on the long side as a JPEG (like the apps); this also drops the photo's location data. */
async function prepare(file, crop = null) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  if (crop) {
    // The square the member chose (fractions of the image): listing photos are square (TJ 2026-10-14).
    const side = Math.max(1, Math.round(crop.side * bitmap.width));
    const out = Math.min(side, 1600);
    canvas.width = canvas.height = out;
    canvas.getContext("2d").drawImage(bitmap, Math.round(crop.left * bitmap.width), Math.round(crop.top * bitmap.height), side, side, 0, 0, out, out);
  } else {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  }
  const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("photo"))), "image/jpeg", 0.8));
  return { blob, width: canvas.width, height: canvas.height };
}

/** The square crop (same as the apps' SquareCropView): the photo fills a square, centered; drag to move, zoom with the
 *  slider, a pinch, or the mouse wheel; Use Photo. Resolves { spec: {left, top, side} as fractions, preview } or null. */
export function cropDialog(file, position, total) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = el("img", { src: url, alt: "Photo to crop", draggable: "false" });
    const frame = el("div", { class: "crop-frame" }, img, el("div", { class: "crop-grid", "aria-hidden": "true" }));
    const zoomInput = el("input", { type: "range", min: "1", max: "4", step: "0.01", value: "1", "aria-label": "Zoom" });
    const use = el("button", { type: "button" }, "Use Photo");
    const cancel = el("button", { type: "button", class: "secondary" }, "Cancel");
    const dialog = el("dialog", { class: "g-dialog crop-dialog", "aria-label": "Crop photo" },
      el("h2", {}, total > 1 ? `Photo ${position} of ${total}` : "Crop Photo"), frame,
      el("p", { class: "form-hint" }, "Drag to center your item. Zoom to fill the square."), zoomInput,
      el("div", { class: "g-dialog-actions" }, cancel, use));
    document.body.append(dialog);
    let w = 1, h = 1, side = 1, zoom = 1, ox = 0, oy = 0;
    const fill = () => side / Math.min(w, h);
    const clamp = () => {
      const s = fill() * zoom, maxX = Math.max((w * s - side) / 2, 0), maxY = Math.max((h * s - side) / 2, 0);
      ox = Math.min(Math.max(ox, -maxX), maxX); oy = Math.min(Math.max(oy, -maxY), maxY);
    };
    const draw = () => {
      const s = fill() * zoom;
      img.style.width = `${w * s}px`; img.style.height = `${h * s}px`;
      img.style.transform = `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px))`;
    };
    img.addEventListener("load", () => {
      w = img.naturalWidth; h = img.naturalHeight; side = frame.clientWidth; clamp(); draw();
    });
    const pointers = new Map();
    let pinchStart = 0, zoomStart = 1;
    frame.addEventListener("pointerdown", (e) => { frame.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchStart = Math.hypot(a.x - b.x, a.y - b.y); zoomStart = zoom; } });
    frame.addEventListener("pointermove", (e) => {
      const last = pointers.get(e.pointerId);
      if (!last) return;
      if (pointers.size === 2) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...pointers.values()];
        zoom = Math.min(Math.max(zoomStart * Math.hypot(a.x - b.x, a.y - b.y) / (pinchStart || 1), 1), 4);
        zoomInput.value = zoom;
      } else {
        ox += e.clientX - last.x; oy += e.clientY - last.y;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      clamp(); draw();
    });
    const up = (e) => pointers.delete(e.pointerId);
    frame.addEventListener("pointerup", up);
    frame.addEventListener("pointercancel", up);
    frame.addEventListener("wheel", (e) => { e.preventDefault(); zoom = Math.min(Math.max(zoom * (e.deltaY < 0 ? 1.08 : 0.92), 1), 4); zoomInput.value = zoom; clamp(); draw(); }, { passive: false });
    zoomInput.addEventListener("input", () => { zoom = Number(zoomInput.value); clamp(); draw(); });
    const finish = (result) => { dialog.close(); dialog.remove(); if (!result) URL.revokeObjectURL(url); resolve(result); };
    cancel.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(null); });
    use.addEventListener("click", async () => {
      const s = fill() * zoom, length = side / s;
      const cx = w / 2 - ox / s, cy = h / 2 - oy / s;
      const spec = { left: (cx - length / 2) / w, top: (cy - length / 2) / h, side: length / w };
      // A small square preview for the photo strip.
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 300;
      canvas.getContext("2d").drawImage(img, cx - length / 2, cy - length / 2, length, length, 0, 0, 300, 300);
      finish({ spec, preview: canvas.toDataURL("image/jpeg", 0.85) });
    });
    dialog.showModal();
  });
}

function photoPicker(state, onChange) {
  const grid = el("div", { class: "photo-grid" });
  const input = el("input", { type: "file", accept: "image/*", multiple: true, class: "sr-only", id: "post-photos" });
  input.addEventListener("change", async () => {
    const files = [...(input.files ?? [])].slice(0, MAX_PHOTOS - state.photos.length);
    input.value = "";
    // Each new photo: a square crop, centered; drag to move, zoom; Use Photo (like the apps).
    for (const [index, file] of files.entries()) {
      const crop = await cropDialog(file, index + 1, files.length);
      if (!crop) break;
      state.photos.push({ file, url: crop.preview, crop: crop.spec });
      draw();
    }
    onChange();
  });
  function draw() {
    grid.replaceChildren(
      ...state.photos.map((p, index) => {
        const remove = el("button", { type: "button", class: "photo-remove", "aria-label": `Remove photo ${index + 1}` }, icon("x"));
        remove.addEventListener("click", () => { state.photos.splice(index, 1); draw(); onChange(); });
        const cover = el("button", { type: "button", class: "photo-cover", "aria-label": index ? `Make photo ${index + 1} the cover` : "Cover photo" }, index ? "Make Cover" : "Cover");
        cover.addEventListener("click", () => { if (!index) return; state.photos.unshift(...state.photos.splice(index, 1)); draw(); onChange(); });
        return el("div", { class: "photo-tile" }, el("img", { src: p.url, alt: `Photo ${index + 1}` }), remove, cover);
      }),
      state.photos.length < MAX_PHOTOS ? el("label", { for: "post-photos", class: "photo-add" }, icon("post"), el("span", {}, `${state.photos.length}/${MAX_PHOTOS}`)) : null,
      input);
  }
  draw();
  return grid;
}

// --- The area (items, tools, services, jobs: "Use My Location" or a city; homes: their address) ----------------------

async function lookUp(body) {
  const { data, error } = await supabase.functions.invoke("geocode", { body });
  if (error) {
    const reason = await error.context?.json?.().then((b) => b?.error).catch(() => null);
    throw new Error(reason ?? "We couldn't look up that place right now. Please try again.");
  }
  return data;
}

function areaPicker(state, onChange) {
  const label = el("p", { class: "area-label" });
  const status = el("p", { class: "form-hint", role: "status" });
  const city = textInput("", { placeholder: "City or ZIP / postal code", autocomplete: "postal-code" });
  const show = () => {
    label.replaceChildren(icon("pin"), state.place ? [state.place.city, state.place.region].filter(Boolean).join(", ") || state.place.country
      : state.keptArea ?? "No area yet");
  };
  const mine = el("button", { type: "button", class: "secondary" }, "Use My Location");
  mine.addEventListener("click", () => {
    if (!navigator.geolocation) { status.textContent = "This browser can't share its location. Type a city or ZIP code instead."; return; }
    status.textContent = "Finding your area…";
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        state.place = await lookUp({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        status.textContent = "";
        show();
        onChange();
      } catch (problem) { status.textContent = problem.message; }
    }, () => { status.textContent = "Allow location to set the area, or type a city or ZIP code. Only the approximate area (about 1 km) is shown."; },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  });
  const find = el("button", { type: "button", class: "secondary" }, "Find");
  const search = async () => {
    if (city.value.trim().length < 2) return;
    status.textContent = "Finding the area…";
    try {
      state.place = await lookUp({ query: city.value.trim() });
      status.textContent = "";
      show();
      onChange();
    } catch (problem) { status.textContent = problem.message; }
  };
  find.addEventListener("click", search);
  city.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } });
  show();
  return [el("div", { class: "form-row" }, label, el("div", { class: "area-actions" }, mine), el("div", { class: "area-search" }, city, find), status,
    el("small", { class: "form-hint" }, "People see only the approximate area, never your address."))];
}

// --- The form -----------------------------------------------------------------------------------------------------

export async function postForm(root, typeKey, { editId = null, me }) {
  root.replaceChildren(el("p", { class: "hint" }, "Loading…"));
  let row = null;
  if (editId) {
    const { data, error } = await supabase.from("listings").select(EDIT_COLUMNS).eq("id", editId).maybeSingle();
    if (error || !data) { root.replaceChildren(el("p", { class: "status bad" }, "This listing couldn't be opened for editing.")); return; }
    row = data;
    typeKey = Object.entries(TYPES).find(([, t]) => t.kind === row.kind && (t.kind !== "item" || t.format === row.listing_format))?.[0];
  }
  const type = TYPES[typeKey];
  if (!type) { location.replace("post.html"); return; }
  const isItem = type.kind === "item", isHome = type.kind === "rental" || type.kind === "property_sale", isFreelance = type.kind === "service" || type.kind === "job";
  const isAuction = typeKey === "auction", isTool = typeKey === "tool";

  const [{ data: categories }, { data: professions }, extra] = await Promise.all([
    supabase.from("categories").select("id, slug, name, field").eq("kind", isItem ? "item" : type.kind).order("position"),
    isFreelance ? supabase.from("professions").select("slug, name, field, license_required").order("position") : Promise.resolve({ data: [] }),
    editId ? Promise.all([
      supabase.from("property_addresses").select("street, unit").eq("listing_id", editId).maybeSingle(),
      supabase.from("auction_reserves").select("reserve_cents").eq("listing_id", editId).maybeSingle(),
    ]) : Promise.resolve([{ data: null }, { data: null }]),
  ]);
  const address = extra[0].data, reserveRow = extra[1].data;

  const state = {
    photos: [...(row?.listing_photos ?? [])].sort((a, b) => a.position - b.position)
      .map((p) => ({ stored: { path: p.storage_path, width: p.width ?? 1, height: p.height ?? 1 }, url: photoURL(p.storage_path) })),
    place: null,
    keptArea: row ? [row.city, row.region].filter(Boolean).join(", ") || row.country : null,
    savedId: row?.id ?? null,
    savedOrder: (row?.listing_photos ?? []).sort((a, b) => a.position - b.position).map((p) => p.storage_path),
  };
  const country = () => state.place?.country ?? row?.country?.trim() ?? "US";
  const currency = () => (country() === "PH" ? "PHP" : "USD");
  const metric = () => country() === "PH";
  const editingLive = row?.status === "active";
  const team = editId ? null : await activeTeam();
  const hasBids = (row?.bid_count ?? 0) > 0;

  // Fields
  const title = textInput(row?.title, { maxlength: 80, placeholder: isFreelance ? (typeKey === "job" ? "What do you need done?" : "What do you offer?") : "What is it?" });
  const category = select((categories ?? []).map((c) => [c.id, c.name]), row?.category_id, isHome ? "Choose the type of property" : "Choose a category");
  const profession = select((professions ?? []).map((p) => [p.slug, p.name]), row?.profession, "Choose the kind of work");
  const condition = chips(CONDITIONS, row?.condition ?? null, "condition");
  const price = moneyInput(row?.price_cents, row?.currency);
  const days = chips([1, 3, 5, 7, 10].map((d) => [String(d), `${d} ${d === 1 ? "day" : "days"}`]), String(row?.auction_duration_days ?? 7), "days");
  const buyNow = moneyInput(row?.buy_now_cents, row?.currency);
  const reserve = moneyInput(reserveRow?.reserve_cents, row?.currency);
  const weekly = moneyInput(row?.weekly_rate_cents, row?.currency);
  const deposit = moneyInput(row?.deposit_cents, row?.currency);
  const lateFee = moneyInput(row?.late_fee_cents, row?.currency);
  const maxDays = textInput(String(row?.max_rental_days ?? 30), { inputmode: "numeric" });
  const radius = textInput(String(row?.lending_radius_miles ?? 10), { inputmode: "numeric" });
  const lending = check("I accept the risk of lending this item, including loss, damage, and injury. The details on this listing are the terms of my deal, and I'll honor them. Geerho isn't a party to my rentals and isn't responsible for them (Terms section 7).", !!row?.lender_terms_accepted_at);
  const role = chips(ROLES, row?.lister_role ?? null, "role");
  const bedrooms = textInput(row?.bedrooms ?? "", { inputmode: "numeric" });
  const bathrooms = textInput(row?.bathrooms ?? "", { inputmode: "decimal" });
  const floor = textInput(row?.floor_area_sqm ? String(Math.round(metric() ? row.floor_area_sqm : row.floor_area_sqm * 10.7639)) : "", { inputmode: "decimal" });
  const securityDeposit = moneyInput(row?.security_deposit_cents, row?.currency);
  const lease = textInput(String(row?.lease_months ?? 12), { inputmode: "numeric" });
  const street = textInput(address?.street ?? "", { maxlength: 200, autocomplete: "street-address" });
  const unit = textInput(address?.unit ?? "", { maxlength: 100 });
  const homeCity = textInput(row ? [row.city, row.region].filter(Boolean).join(" ") : "", { autocomplete: "address-level2" });
  const propertyTerms = check(`I own this property or am authorized to ${typeKey === "home_rent" ? "rent" : "sell"} it. My listing follows fair housing laws, and I won't ask for money before someone has seen the property.`, !!row?.property_terms_accepted_at);
  const rateType = chips([["hourly", "Per hour"], ["fixed", "Fixed price"]], row?.rate_type === "fixed" ? "fixed" : "hourly", "rate");
  const remote = check(typeKey === "service" ? "I can work remotely" : "Can be done remotely", !!row?.remote_ok);
  const travel = textInput(row?.travel_radius_km ? String(metric() ? row.travel_radius_km : Math.round(row.travel_radius_km / 1.609344)) : "25", { inputmode: "numeric" });
  const years = textInput(row?.years_experience ?? "", { inputmode: "numeric" });
  const description = descriptionEditor(row?.description);
  const pickup = check("Local pickup", row ? row.offers_pickup : true);
  const shipping = check("Shipping", !!row?.offers_shipping);
  const shippingFee = moneyInput(row?.shipping_fee_cents, row?.currency);
  const carrierBox = el("div", { class: "chip-row" });
  const drawCarriers = () => {
    const chosen = new Set([...carrierBox.querySelectorAll("input:checked")].map((i) => i.value).concat(carrierBox.dataset.init ? JSON.parse(carrierBox.dataset.init) : []));
    delete carrierBox.dataset.init;
    carrierBox.replaceChildren(...CARRIERS[country() === "PH" ? "PH" : "US"].map(([v, label]) =>
      el("label", { class: "chip" }, el("input", { type: "checkbox", value: v, checked: chosen.has(v) }), el("span", {}, label))));
  };
  carrierBox.dataset.init = JSON.stringify(row?.shipping_carriers ?? []);
  drawCarriers();
  const shippingRows = el("div", { class: "nested", hidden: !shipping.input.checked },
    field("Shipping and handling (0 = free)", shippingFee), el("span", { class: "form-label" }, "Carriers"), carrierBox);
  shipping.input.addEventListener("change", () => { shippingRows.hidden = !shipping.input.checked; });
  const travelRow = field(`How far you'll travel (${metric() ? "km" : "miles"})`, travel);
  travelRow.hidden = remote.input.checked;
  remote.input.addEventListener("change", () => { travelRow.hidden = remote.input.checked; });
  const roleHint = el("small", { class: "form-hint", hidden: !row?.lister_role || row.lister_role === "owner" }, "Agents and property managers need an approved real estate license.");
  role.addEventListener("change", () => { roleHint.hidden = chipValue(role) === "owner"; });

  // Money symbols follow the area's country (₱ in the Philippines).
  const refreshCurrency = () => {
    for (const span of root.querySelectorAll(".money-input > span")) span.textContent = currency() === "PHP" ? "₱" : "$";
    drawCarriers();
  };

  const messages = el("div", { class: "status bad", role: "alert", hidden: true });
  const publishButton = el("button", { type: "button", class: "post-primary" }, editingLive ? "Save Changes" : "Publish");
  const draftButton = el("button", { type: "button", class: "secondary post-secondary", hidden: editingLive }, "Save Draft");

  root.replaceChildren(...[
    el("div", { class: "screen-head" }, el("a", { class: "back", href: editId ? "account.html#listings" : "post.html" }, icon("chevronLeft"), editId ? "My Listings" : "Post"),
      el("h1", {}, editId ? "Edit Listing" : type.title)),
    hasBids ? el("p", { class: "group-footer" }, "This auction has bids, so its price and format can't change.") : null,
    !editId && postsForTeam() && team ? el("p", { class: "group-footer" }, `Posting for ${team.name}. Buyers pay them.`) : null,
    section("Photos", el("div", { class: "form-row" }, photoPicker(state, () => {}),
      el("small", { class: "form-hint" }, isFreelance ? "Photos are optional for services and jobs." : "The first photo is the cover. Add up to 10."))),
    section("Details", field("Title", title),
      isFreelance ? field("Kind of work", profession) : field(isHome ? "Type of property" : "Category", category),
      isItem ? [el("span", { class: "form-label form-row-label" }, "Condition"), el("div", { class: "form-row" }, condition)] : null),
    isItem && typeKey === "item" ? section("Price", field("Price", price, "The full price buyers pay for the item. Free stuff must be free: enter 0.")) : null,
    isAuction ? section("Auction", field("Starting bid", price), el("div", { class: "form-row" }, el("span", { class: "form-label" }, "Length"), days),
      field("Buy It Now (optional)", buyNow, "Disappears after the first bid."),
      field("Hidden reserve (optional)", reserve, "The lowest price you'll accept. Bidders only see whether it's met.")) : null,
    isTool ? section("Rental", field("Daily rate", price), field("Weekly rate (optional)", weekly), field("Deposit", deposit, "Equal to what it would cost to replace the item."),
      field("Late fee per day", lateFee, "Usually the daily rate. It comes out of the deposit."), field("Longest rental (days)", maxDays),
      field(`How far you'll lend it (${metric() ? "km" : "miles"})`, radius)) : null,
    isHome ? section(typeKey === "home_rent" ? "Rent" : "Price", field(typeKey === "home_rent" ? "Monthly rent" : "Asking price", price),
      el("div", { class: "form-row" }, el("span", { class: "form-label" }, "You are the"), role, roleHint),
      el("div", { class: "two-col" }, field("Bedrooms", bedrooms), field("Bathrooms", bathrooms)),
      field(`Floor area (${metric() ? "m²" : "sq ft"})`, floor),
      typeKey === "home_rent" ? [field("Security deposit (optional)", securityDeposit), field("Lease length (months)", lease)] : null) : null,
    isHome ? section("Address", field("Street address", street), field("Unit (optional)", unit), field("City or postal code", homeCity),
      el("small", { class: "form-hint form-row" }, typeKey === "home_rent" ? "Renters see only the neighborhood until you confirm their tour." : "Homes for sale show their street address."),
      el("div", { class: "form-row" }, propertyTerms.row)) : null,
    isFreelance ? section(typeKey === "service" ? "Your rate" : "Budget", el("div", { class: "form-row" }, rateType),
      field(typeKey === "service" ? "Your rate" : "Budget", price, "Every post shows its full price; “by quote” isn't allowed when publishing."),
      el("div", { class: "form-row" }, remote.row), typeKey === "service" ? [travelRow, field("Years of experience (optional)", years)] : null) : null,
    section("Description", el("div", { class: "form-row" }, description.node)),
    isItem && !isTool ? section("Delivery", el("div", { class: "form-row" }, pickup.row), el("div", { class: "form-row" }, shipping.row), shippingRows) : null,
    isTool ? section("Lending", el("small", { class: "form-hint form-row" }, "Tool rentals are local pickup only. Renters outside your lending radius can see it but can't request it."),
      el("div", { class: "form-row" }, lending.row)) : null,
    !isHome ? section(typeKey === "job" ? "Where the job is" : typeKey === "service" ? "Where you work" : "Location", areaPicker(state, refreshCurrency)) : null,
    messages,
    publishButton, draftButton,
    el("p", { class: "group-footer" }, "Publishing needs a verified identity. Every post shows its full price, and plan limits apply (free: 1 new post a day)."),
  ].flat(Infinity).filter(Boolean));

  function issues(publishing) {
    const out = [];
    const p = cents(moneyValue(price));
    if (publishing && !isFreelance && !state.photos.length) out.push("Add at least one photo");
    if (title.value.trim().length < 3 || title.value.trim().length > 80) out.push("Enter a title (3 to 80 characters)");
    if (description.area.value.length > 5000) out.push("Shorten the description (5,000 characters at most)");
    if (isItem) {
      if (!category.value) out.push("Choose a category");
      if (!chipValue(condition)) out.push("Choose the condition");
      if (isAuction) {
        const bin = cents(moneyValue(buyNow)), res = cents(moneyValue(reserve));
        if (p == null || p < 1) out.push("Enter the starting bid");
        if (moneyValue(buyNow).trim() && (bin == null || p == null || bin <= p)) out.push("Buy It Now must be more than the starting bid");
        if (moneyValue(reserve).trim() && (res == null || p == null || res < p)) out.push("The reserve must be at least the starting bid");
        if (res != null && bin != null && res > bin) out.push("The reserve can't be higher than Buy It Now");
      } else if (isTool) {
        if (p == null || p < 1) out.push("Enter the daily rate");
        if ((cents(moneyValue(deposit)) ?? 0) < 1) out.push("Enter a deposit equal to what it would cost to replace the item");
        if (publishing && !lending.input.checked) out.push("Accept the lending terms");
      } else if (p == null || p < 0 || p > 100000000) out.push("Enter the full price");
      if (!isTool) {
        if (!pickup.input.checked && !shipping.input.checked) out.push("Offer pickup, shipping, or both");
        if (shipping.input.checked && !carrierBox.querySelector("input:checked")) out.push("Choose at least one carrier");
        if (shipping.input.checked && cents(moneyValue(shippingFee) || "0") == null) out.push("Enter the shipping fee, or 0 for free shipping");
      }
      if (publishing && !state.place && !state.keptArea) out.push("Set the item's location");
    } else if (isHome) {
      if (!category.value) out.push("Choose the type of property");
      if (p == null || p < 1) out.push(typeKey === "home_rent" ? "Enter the monthly rent" : "Enter the asking price");
      if (street.value.trim().length < 3) out.push("Add the street address");
      if (!chipValue(role)) out.push("Say whether you're the owner, an agent, or a property manager");
      if (publishing && !propertyTerms.input.checked) out.push("Confirm the property listing terms");
      if (publishing && !state.place && !state.keptArea) out.push("Add the city or postal code so we can find the property's area");
    } else {
      if (!profession.value) out.push("Choose the kind of work");
      if (p == null || p < 1) out.push(typeKey === "service" ? "Enter your rate (per hour or a fixed price)" : "Enter your budget (per hour or fixed)");
      if (publishing && !state.place && !state.keptArea) out.push(typeKey === "service" ? "Add where you work" : "Add where the job is");
    }
    return out;
  }

  async function save(publish) {
    messages.hidden = true;
    publishButton.disabled = draftButton.disabled = true;
    const say = (text) => { publishButton.textContent = text; };
    try {
      // Homes: the area comes from the address (the street itself stays private until a tour is confirmed).
      if (isHome && street.value.trim() && homeCity.value.trim()) {
        say("Finding the address…");
        state.place = await lookUp({ query: `${street.value.trim()}, ${homeCity.value.trim()}` })
          .catch(() => lookUp({ query: homeCity.value.trim() })).catch(() => state.place);
        refreshCurrency();
      }
      const problems = issues(publish);
      if (problems.length) throw Object.assign(new Error(problems.map((x) => `• ${x}`).join("\n")), { list: true });

      const place = state.place;
      const categoryId = isFreelance
        ? (categories ?? []).find((c) => c.field === (professions ?? []).find((x) => x.slug === profession.value)?.field)?.id ?? null
        : Number(category.value) || null;
      const listing = {
        category_id: categoryId, title: title.value.trim(), description: description.area.value.trim(),
        price_cents: cents(moneyValue(price)) ?? 0, currency: place ? (place.country === "PH" ? "PHP" : "USD") : (row?.currency ?? currency()),
        kind: type.kind, listing_format: type.format,
      };
      if (!state.savedId) listing.status = "draft";
      if (place) Object.assign(listing, {
        location: `SRID=4326;POINT(${place.longitude.toFixed(2)} ${place.latitude.toFixed(2)})`,
        city: place.city, region: place.region, postal_code: place.postal_code, country: place.country,
      });
      if (isItem) {
        const ship = shipping.input.checked && !isTool;
        Object.assign(listing, {
          condition: chipValue(condition), offers_pickup: isTool ? true : pickup.input.checked, offers_shipping: ship,
          shipping_carriers: ship ? [...carrierBox.querySelectorAll("input:checked")].map((i) => i.value) : [],
        });
        if (ship) listing.shipping_fee_cents = cents(moneyValue(shippingFee) || "0");
        if (isAuction) {
          listing.auction_duration_days = Number(chipValue(days));
          listing.buy_now_cents = cents(moneyValue(buyNow));
        }
        if (isTool) {
          const r = Number(radius.value) || 10;
          Object.assign(listing, {
            weekly_rate_cents: cents(moneyValue(weekly)), deposit_cents: cents(moneyValue(deposit)),
            max_rental_days: Number(maxDays.value) || 30, late_fee_cents: cents(moneyValue(lateFee)) ?? cents(moneyValue(price)),
            lending_radius_miles: Math.max(1, Math.round(metric() ? r / 1.609344 : r)),
          });
          if (lending.input.checked && !row?.lender_terms_accepted_at) listing.lender_terms_accepted_at = new Date().toISOString();
        }
      } else if (isHome) {
        const area = Number(floor.value);
        Object.assign(listing, {
          lister_role: chipValue(role), bedrooms: bedrooms.value ? Number(bedrooms.value) : null, bathrooms: bathrooms.value ? Number(bathrooms.value) : null,
          floor_area_sqm: area ? (metric() ? area : area / 10.7639) : null,
        });
        if (typeKey === "home_rent") Object.assign(listing, { security_deposit_cents: cents(moneyValue(securityDeposit)), lease_months: Number(lease.value) || null });
        if (propertyTerms.input.checked && !row?.property_terms_accepted_at) listing.property_terms_accepted_at = new Date().toISOString();
      } else {
        Object.assign(listing, { profession: profession.value, rate_type: chipValue(rateType), remote_ok: remote.input.checked });
        if (typeKey === "service") {
          if (!remote.input.checked) { const t = Number(travel.value) || 25; listing.travel_radius_km = Math.max(1, Math.round(metric() ? t : t * 1.609344)); }
          listing.years_experience = years.value ? Number(years.value) : null;
        }
      }

      say("Saving…");
      if (state.savedId) {
        const { error } = await supabase.from("listings").update(listing).eq("id", state.savedId);
        if (error) throw error;
      } else {
        // Posting for an Elite's team: the listing is theirs (the server records me as posted_by, M46).
        const team = postsForTeam() ? await activeTeam() : null;
        if (team) listing.seller_id = team.eliteId;
        const { data, error } = await supabase.from("listings").insert(listing).select("id").single();
        if (error) throw error;
        state.savedId = data.id;
      }
      const id = state.savedId;

      // Photos: new ones uploaded once; existing ones reused; the rows rewritten only when the order changed.
      const bucket = supabase.storage.from("listing-photos");
      for (const [index, p] of state.photos.entries()) {
        if (p.stored) continue;
        say(`Uploading photo ${index + 1} of ${state.photos.length}…`);
        const prepared = await prepare(p.file, p.crop);
        const path = `${me.id}/${id}/${crypto.randomUUID()}.jpg`;
        const { error } = await bucket.upload(path, prepared.blob, { contentType: "image/jpeg", upsert: true });
        if (error) throw new Error("A photo couldn't be uploaded. Check your connection and try again.");
        p.stored = { path, width: prepared.width, height: prepared.height };
      }
      const order = state.photos.map((p) => p.stored.path);
      if (order.join() !== state.savedOrder.join()) {
        say("Saving photos…");
        await supabase.from("listing_photos").delete().eq("listing_id", id);
        if (order.length) {
          const { error } = await supabase.from("listing_photos").insert(state.photos.map((p, position) =>
            ({ listing_id: id, storage_path: p.stored.path, position, width: p.stored.width, height: p.stored.height })));
          if (error) throw error;
        }
        const removed = state.savedOrder.filter((path) => !order.includes(path));
        if (removed.length) await bucket.remove(removed).catch(() => {});
        state.savedOrder = order;
      }
      if (isHome) {
        say("Saving the address…");
        const { error } = address || state.addressSaved
          ? await supabase.from("property_addresses").update({ street: street.value.trim(), unit: unit.value.trim() || null }).eq("listing_id", id)
          : await supabase.from("property_addresses").insert({ listing_id: id, street: street.value.trim(), ...(unit.value.trim() ? { unit: unit.value.trim() } : {}) });
        if (error) throw error;
        state.addressSaved = true;
      }
      const reserveCents = isAuction ? cents(moneyValue(reserve)) : null;
      if (reserveCents != null) {
        say("Saving the reserve…");
        const { error } = await supabase.rpc("set_auction_reserve", { listing: id, reserve_cents: reserveCents });
        if (error) throw error;
      }
      if (publish && !editingLive) {
        say("Publishing…");
        const { error } = await supabase.from("listings").update({ status: "active" }).eq("id", id);
        if (error) throw error;
      }
      if (publish) return published(root, id, listing, type);
      messages.className = "status good";
      messages.textContent = "Draft saved. Finish it anytime from Profile → My Listings → Drafts.";
      messages.hidden = false;
    } catch (problem) {
      messages.className = "status bad";
      messages.textContent = problem.list ? problem.message : (problem.message && !problem.code ? problem.message : friendlyError(problem));
      messages.hidden = false;
      messages.scrollIntoView({ block: "center", behavior: "smooth" });
    } finally {
      publishButton.disabled = draftButton.disabled = false;
      publishButton.textContent = editingLive ? "Save Changes" : "Publish";
    }
  }
  publishButton.addEventListener("click", () => save(true));
  draftButton.addEventListener("click", () => save(false));
}

/** "Your listing is live", like the app's PublishedView. */
function published(root, id, listing, type) {
  root.replaceChildren(el("div", { class: "empty published" }, rowIcon("check", "green"),
    el("strong", {}, "Your listing is live"),
    el("p", {}, `${listing.title} · ${money(listing.price_cents, listing.currency)}${type.kind === "rental" ? "/mo" : ""}`),
    el("p", { class: "hint" }, "People nearby can see it for 60 days."),
    el("p", { class: "actions" }, el("a", { class: "button", href: `listing.html?id=${id}` }, "View Listing"),
      el("a", { class: "button secondary", href: "post.html" }, "Post Another"))));
  window.scrollTo(0, 0);
}
