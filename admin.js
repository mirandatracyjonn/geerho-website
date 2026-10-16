// Admin Dashboard on geerho.com (TJ 2026-10-16: "build it if it will not violate my security, keep in mind our github
// is public for website"). Copied from the iPhone app (the gold standard): the same tabs (Overview · Support · People ·
// Listings · Sales), the same review queues, wording, and buttons, using the same database functions as the apps.
//
// Security: this file is public and holds no secrets. It only draws what the database returns. Every list and every
// decision goes through database functions that check, on the server, that the signed-in person is a moderator or a
// Super Admin (private.is_moderator / private.is_owner) and, when Require for Staff is on, that they signed in with
// two-step verification. Private files (licenses, proofs of address, recovery documents, support attachments) open
// through 10-minute signed links that storage gives only to staff. Member text is always set as text, never as HTML.
import { el, money, photoURL } from "./site.js";
import { currentUser, friendlyError, signInURL, supabase } from "./auth.js";
import { icon, rowIcon, verifiedBadge } from "./icons.js";
import { screenHead } from "./profile.js";
import { confirmDialog } from "./ui-dialog.js";

const TIKTOK_HANDLE = "aceallen82";
const MAX_LEVEL = 50;
const root = document.getElementById("admin");
let role = null;          // "owner" (Super Admin) or "moderator"
let cache = {};           // the last list loaded for each queue, so a detail screen can open from it

// --- Small building blocks ---------------------------------------------------------------------------------------

const dateTime = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const dateOnly = (iso) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { dateStyle: "medium" });
const usd = (cents) => money(Number(cents ?? 0), "USD").replace(/^Free$/, "$0");
const at = (name, fallback = "unknown") => `@${name ?? fallback}`;
const regionNames = new Intl.DisplayNames(undefined, { type: "region" });
const countryName = (code) => { try { return regionNames.of(code) ?? code; } catch { return code; } };

function relative(iso) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (seconds < 60) return "just now";
  if (seconds < 3600) return format.format(-Math.round(seconds / 60), "minute");
  if (seconds < 86400) return format.format(-Math.round(seconds / 3600), "hour");
  if (seconds < 86400 * 30) return format.format(-Math.round(seconds / 86400), "day");
  return dateOnly(iso);
}

function show(...children) {
  root.replaceChildren(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  window.scrollTo(0, 0);
}

const back = (title, href = "#") => screenHead(title, { back: href, backLabel: href === "#" ? "Admin" : "Back" });
const groupTitle = (text) => el("p", { class: "group-title" }, text);
const group = (...items) => el("ul", { class: "group plain" }, ...items);
const hint = (text) => el("p", { class: "group-footer" }, text);
const loading = () => el("p", { class: "status-line", role: "status" }, "Loading…");
const errorBox = (message) => el("p", { class: "status bad", role: "alert" }, message);

/** Label on the left, value on the right (SwiftUI's LabeledContent). */
function kv(label, value) {
  return el("li", { class: "kv" }, el("span", { class: "kv-label" }, label), el("span", { class: "kv-value" }, value ?? "—"));
}

function empty(iconName, title, text) {
  return el("div", { class: "empty" }, icon(iconName), el("strong", {}, title), text ? el("p", {}, text) : null);
}

/** A stat card from the app's dashboard: colored icon, title, big value, detail, and a chevron when it opens something. */
function stat(title, value, { detail = null, iconName, tint, href = null } = {}) {
  const content = [
    rowIcon(iconName, tint),
    el("span", { class: "stat-text" },
      el("span", { class: "stat-title" }, title),
      el("span", { class: "stat-value" }, String(value)),
      detail ? el("span", { class: "stat-detail" }, detail) : null),
  ];
  if (href) content.push(icon("chevronRight", "chev"));
  return el("li", {}, href ? el("a", { class: "row stat", href }, ...content) : el("div", { class: "row stat" }, ...content));
}

function linkRow(href, title, detail = null, extra = null) {
  return el("li", {}, el("a", { class: "row", href },
    el("span", { class: "row-stack" }, el("span", { class: "row-title" }, title), detail ? el("span", { class: "hint" }, detail) : null),
    extra, icon("chevronRight", "chev")));
}

/** A required-when-not-approving note box. */
function noteBox(placeholder = "Required when not approving") {
  return el("textarea", { rows: "3", maxlength: "1000", placeholder, "aria-label": "Note to the member" });
}

const CANCELLED = new Error("Cancelled");

/** Runs a decision; shows the database's message if it's refused, or goes back to the list when it works. */
function act(button, errorSpot, backTo, operation) {
  button.addEventListener("click", async () => {
    errorSpot.hidden = true;
    const buttons = root.querySelectorAll("button");
    buttons.forEach((b) => { b.disabled = true; });
    try {
      await operation();
      location.hash = backTo;
    } catch (error) {
      if (error !== CANCELLED) {
        errorSpot.textContent = friendlyError(error);
        errorSpot.hidden = false;
      }
      buttons.forEach((b) => { b.disabled = false; });
      // Keep buttons that need a note disabled until there is one.
      root.querySelectorAll("textarea").forEach((t) => t.dispatchEvent(new Event("input")));
    }
  });
}

async function rpc(name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  return data;
}

/** Opens a private file in a new tab through a 10-minute signed link (only staff get one). */
function fileButton(label, bucket, path) {
  const button = el("button", { type: "button", class: "row" }, icon("doc", "row-lead"), el("span", { class: "row-title" }, label));
  button.addEventListener("click", async () => {
    const tab = window.open("", "_blank");
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 600);
    if (error || !data?.signedUrl) {
      tab?.close();
      alertBox(button, "This file couldn't be opened. It may have been deleted.");
      return;
    }
    if (tab) { tab.opener = null; tab.location = data.signedUrl; } else location.href = data.signedUrl;
  });
  return el("li", {}, button);
}

function alertBox(near, message) {
  const box = errorBox(message);
  near.closest("ul")?.after(box);
  setTimeout(() => box.remove(), 6000);
}

function decisionArea(...children) {
  return el("div", { class: "decision" }, ...children);
}

function needsNote(note, button) {
  const update = () => { button.disabled = !note.value.trim(); };
  note.addEventListener("input", update);
  update();
}

// --- Tabs: Overview · Support · People · Listings · Sales ---------------------------------------------------------

const TABS = [["", "Overview"], ["support", "Support"], ["people", "People"], ["listings", "Listings"], ["sales", "Sales"]];

function tabs(current) {
  return el("div", { class: "segmented", role: "group", "aria-label": "Section" },
    ...TABS.map(([hash, title]) => {
      const button = el("button", { type: "button", "aria-pressed": String(hash === current) }, title);
      button.addEventListener("click", () => { location.hash = hash; });
      return button;
    }));
}

function tabPage(current, ...content) {
  show(el("h1", { class: "admin-title" }, "Admin"), tabs(current), ...content);
}

async function count(name, filter = () => true) {
  try { return ((await rpc(name)) ?? []).filter(filter).length; } catch { return 0; }
}

async function overview() {
  tabPage("", loading());
  const [o, reportsList, licenses, addresses, payments, transfers, recoveries, overdue, categories] = await Promise.all([
    rpc("admin_overview").catch((error) => ({ error })),
    rpc("moderation_queue").catch(() => []),
    count("license_review_queue"),
    count("address_review_queue"),
    count("payments_review_queue"),
    count("level_transfer_queue", (t) => t.status === "pending"),
    count("recovery_queue"),
    rpc("admin_overdue_rentals").catch(() => []),
    count("category_proposals_list", (p) => p.status === "pending"),
  ]);
  if (o?.error) {
    tabPage("", empty("info", "Couldn't load the dashboard", friendlyError(o.error)));
    return;
  }
  cache.overdue = overdue ?? [];
  const owner = role === "owner";
  const pct = `${Math.round(Number(o.commission_rate) * 1000) / 10}%`;
  const longest = Math.max(0, ...(overdue ?? []).map((r) => r.days_late));
  tabPage("",
    groupTitle("Needs attention"),
    group(
      stat("Open support requests", o.tickets_open, { detail: o.tickets_unread > 0 ? `${o.tickets_unread} unread` : null, iconName: "help", tint: o.tickets_unread > 0 ? "orange" : "blue", href: "#support" }),
      stat("Open reports", o.reports_open, { detail: o.listings_review > 0 ? `${o.listings_review} ${o.listings_review === 1 ? "listing" : "listings"} hidden for review` : `${(reportsList ?? []).length} in the review queue`, iconName: "megaphone", tint: o.reports_open > 0 ? "red" : "blue", href: "#reports" }),
      stat("Licenses to review", licenses, { detail: "Real estate and licensed professionals", iconName: "seal", tint: licenses > 0 ? "orange" : "blue", href: "#licenses" }),
      stat("Addresses to review", addresses, { detail: "Members who moved, with proof of address", iconName: "house", tint: addresses > 0 ? "orange" : "blue", href: "#addresses" }),
      stat("Payments on hold", payments, { detail: "Problems reported by buyers, and bank disputes", iconName: "lock", tint: payments > 0 ? "red" : "blue", href: "#payments" }),
      stat("TikTok level transfers", transfers, { detail: `Match the code sent to @${TIKTOK_HANDLE} on TikTok`, iconName: "star", tint: transfers > 0 ? "orange" : "blue", href: "#transfers" }),
      stat("Account recovery", recoveries, { detail: "Members who lost access: ID, address, video call", iconName: "key", tint: recoveries > 0 ? "orange" : "blue", href: "#recovery" }),
      overdue?.length ? stat("Overdue rentals", overdue.length, { detail: `Longest ${longest} days late`, iconName: "calendar", tint: "red", href: "#overdue" }) : null,
    ),
    groupTitle("People"),
    group(
      stat("Accounts", o.users_total, { detail: `${o.users_verified} verified · ${o.new_7d} new this week`, iconName: "team", tint: "indigo", href: "#people" }),
      stat("Active", `${o.active_24h} today`, { detail: `${o.active_7d} in the last 7 days`, iconName: "heart", tint: "pink", href: "#people/active" }),
      stat("Sellers", o.sellers, { detail: "People who have published a listing", iconName: "tag", tint: "teal", href: "#people/sellers" }),
      stat("Buyers", o.buyers, { detail: "People who have bought something", iconName: "bag", tint: "green", href: "#people/buyers" }),
    ),
    groupTitle("Marketplace"),
    group(
      stat("Live listings", o.listings_live, { detail: `${o.orders_open} purchase requests waiting`, iconName: "tag", tint: "orange", href: "#listings" }),
      stat("Sales", o.sales_total, { detail: `${o.sales_30d} in the last 30 days`, iconName: "bag", tint: "green", href: "#sales" }),
      stat("Sales volume", usd(o.gmv_cents), { detail: `${usd(o.gmv_30d_cents)} in the last 30 days`, iconName: "trend", tint: "green", href: "#sales" }),
    ),
    groupTitle("Fees and commission"),
    group(
      stat("Commission earned", usd(o.commission_earned_cents), { detail: "Geerho isn't charging fees yet", iconName: "dollar", tint: "gray" }),
      stat("Fees waived", usd(o.fees_waived_cents), { detail: `At ${pct} of sales`, iconName: "dollar", tint: "purple" }),
      stat("Founding Members", `${o.founding_used} of ${o.founding_limit}`, { detail: `${Math.max(o.founding_limit - o.founding_used, 0)} free spots left · ${o.lifetime_free} owners free for life`, iconName: "star", tint: "orange", href: "#people/founding" }),
    ),
    groupTitle("Team, categories, and settings"),
    group(
      stat("Team and Super Admins", owner ? "Manage" : "View", { detail: owner ? "Add moderators, appoint Super Admins, succession" : "Super Admins, moderators, and elections", iconName: "team", tint: "indigo" }),
      stat("Category requests", categories, { detail: owner ? "Propose or approve new categories" : "Propose a category · the owner approves", iconName: "tag", tint: categories > 0 && owner ? "orange" : "blue" }),
    ),
    hint("Team, categories, licenses by location, where real estate and freelance are available, the commission rate, and deleting beta test data are in the Geerho app for now (Settings → Moderation → Admin Dashboard)."),
    groupTitle("Moderators"),
    group(linkRow("#handbook", "Moderator Handbook", "How to review each queue, step by step")),
  );
}

// --- Support ------------------------------------------------------------------------------------------------------

const SUPPORT_FILTERS = [["open", "Open"], ["answered", "Answered"], ["closed", "Closed"], ["all", "All"]];
const REASONS = {
  general: "General question", account: "Account or sign-in", verification: "Identity verification",
  buying: "Problem with something I bought", selling: "Problem with something I sold", rental: "Rental problem",
  shipping: "Shipping, tracking, or delivery", payment: "Payment or refund", safety: "Safety concern or scam",
  report_user: "Report a person", bug: "Problem with the website or app", feedback: "Feedback or idea",
  privacy: "Privacy request (access, delete, correct)", legal: "Legal or copyright notice",
};

async function support(filter = "open") {
  const picker = el("div", { class: "segmented", role: "group", "aria-label": "Show" },
    ...SUPPORT_FILTERS.map(([value, title]) => {
      const button = el("button", { type: "button", "aria-pressed": String(value === filter) }, title);
      button.addEventListener("click", () => { location.hash = value === "open" ? "support" : `support/${value}`; });
      return button;
    }));
  tabPage("support", picker, loading());
  let tickets;
  try {
    tickets = await rpc("support_tickets_list", { staff_view: true, only_status: filter === "all" ? null : filter });
  } catch (error) {
    tabPage("support", picker, errorBox(friendlyError(error)));
    return;
  }
  cache.tickets = tickets ?? [];
  if (!cache.tickets.length) {
    tabPage("support", picker, empty("help", `No ${filter === "all" ? "" : `${filter} `}requests`, "Support requests from the app and website show up here."));
    return;
  }
  tabPage("support", picker, group(...cache.tickets.map((t) => linkRow(`#ticket/${t.id}`,
    `${t.reference} · ${REASONS[t.reason] ?? t.reason}`,
    `${t.display_name || at(t.username, "deleted")} · ${t.last_message ? `${t.from_staff ? "You: " : ""}${t.last_message.slice(0, 90)}` : ""} · ${relative(t.last_message_at ?? t.created_at)}`,
    t.unread ? el("span", { class: "row-badge", "aria-label": "Unread" }, "New") : null))));
}

const SUPPORT_BUCKET = "support-attachments";

async function ticket(id) {
  show(back("Support Request", "#support"), loading());
  if (!cache.tickets?.some((t) => t.id === id)) {
    cache.tickets = (await rpc("support_tickets_list", { staff_view: true, only_status: null }).catch(() => [])) ?? [];
  }
  const t = cache.tickets.find((x) => x.id === id);
  let messages;
  try {
    messages = await rpc("support_ticket_thread", { ticket: id });
  } catch (error) {
    show(back("Support Request", "#support"), errorBox(friendlyError(error)));
    return;
  }
  supabase.rpc("mark_support_ticket_read", { ticket: id }).then(() => {}, () => {});
  const error = errorBox(""); error.hidden = true;
  const body = el("textarea", { rows: "4", maxlength: "5000", placeholder: "Reply as Geerho Support", "aria-label": "Reply" });
  const send = el("button", { type: "button" }, "Send Reply");
  needsNote(body, send);
  act(send, error, `ticket/${id}`, async () => {
    await rpc("reply_to_support_ticket", { ticket: id, body: body.value.trim(), attachments: [] });
    body.value = "";
    setTimeout(route, 0);
  });
  const statusButtons = ["open", "answered", "closed"].filter((s) => s !== t?.status).map((s) => {
    const button = el("button", { type: "button", class: "secondary" }, s === "open" ? "Reopen" : s === "closed" ? "Close Request" : "Mark Answered");
    act(button, error, "support", () => rpc("set_support_ticket_status", { ticket: id, new_status: s }));
    return button;
  });
  show(back(t?.reference ?? "Support Request", "#support"),
    t ? group(
      kv("From", t.display_name ? `${t.display_name} (${at(t.username, "deleted")})` : at(t.username, "deleted")),
      kv("Reason", REASONS[t.reason] ?? t.reason),
      t.subject_reference ? kv("About", `${t.subject_reference}${t.subject_title ? ` · ${t.subject_title}` : ""}`) : null,
      kv("Status", { open: "Open", answered: "Answered", closed: "Closed" }[t.status] ?? t.status),
      t.user_id ? linkRow(`member.html?id=${encodeURIComponent(t.user_id)}`, "View Profile") : null,
    ) : null,
    el("ul", { class: "bubbles admin-thread" }, ...(messages ?? []).map((m) => el("li", { class: m.from_staff ? "bubble mine" : "bubble" },
      el("span", { class: "card-meta" }, `${m.sender_label ?? (m.from_staff ? "Geerho Support" : "Member")} · ${dateTime(m.created_at)}`),
      el("p", {}, m.body ?? ""),
      ...(m.attachments ?? []).map((a) => a.kind === "link"
        ? el("a", { href: a.url, target: "_blank", rel: "noopener noreferrer nofollow" }, a.url)
        : group(fileButton(a.name || (a.kind === "file" ? "PDF" : "Photo"), SUPPORT_BUCKET, a.path)))))),
    groupTitle("Reply"),
    el("div", { class: "decision" }, body, el("div", { class: "actions" }, send, ...statusButtons), error),
    hint("Members see replies from “Geerho Support”, not your username."));
}

// --- People, Listings, Sales -----------------------------------------------------------------------------------------

const PEOPLE_FILTERS = [["all", "Everyone"], ["sellers", "Sellers"], ["buyers", "Buyers"], ["active", "Active this week"], ["new", "New this week"], ["founding", "Fee-free"]];

function searchBox(placeholder, value, onSearch) {
  const input = el("input", { type: "search", placeholder, value: value ?? "", "aria-label": placeholder, autocomplete: "off" });
  let timer;
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => onSearch(input.value), 300); });
  return el("div", { class: "admin-search" }, input);
}

const cleanSearch = (text) => (text ?? "").trim().replace(/^[@#]+/, "").replace(/[,()%*\\"]/g, "");

async function people(filter = "all") {
  let search = "";
  const chips = el("div", { class: "filter-chips", role: "group", "aria-label": "Show" },
    ...PEOPLE_FILTERS.map(([value, title]) => {
      const button = el("button", { type: "button", class: "filter-chip", "aria-pressed": String(value === filter) }, title);
      button.addEventListener("click", () => { location.hash = value === "all" ? "people" : `people/${value}`; });
      return button;
    }));
  const list = el("div", {}, loading());
  tabPage("people", chips, searchBox("Search username or name, e.g. tjm", "", (text) => { search = text; load(); }), list);
  async function load() {
    try {
      const rows = (await rpc("admin_users", { filter, search: cleanSearch(search) })) ?? [];
      list.replaceChildren(rows.length ? group(...rows.map((p) => el("li", {}, el("a", { class: "row", href: `member.html?id=${encodeURIComponent(p.id)}` },
        el("span", { class: "row-stack" },
          el("span", { class: "row-title" }, p.display_name || at(p.username, "deleted"), p.verified ? verifiedBadge(16) : null,
            p.suspended ? el("span", { class: "pill danger-pill" }, "Suspended") : null),
          p.display_name && p.username ? el("span", { class: "hint" }, at(p.username)) : null,
          el("span", { class: "hint" }, `${p.live_listings} live · ${p.sold_count} sold (${usd(p.sold_cents)}) · ${p.bought_count} bought`),
          el("span", { class: "hint" },
            p.plan === "lifetime" ? "Free for life · " : p.plan === "founding" ? `Founding #${p.founding_number ?? 0} · ` : "",
            p.last_active_at ? `Active ${relative(p.last_active_at)}` : `Joined ${dateOnly(p.created_at)}`)),
        icon("chevronRight", "chev"))))) : empty("search", "No results", search ? `Nobody matches “${search}”.` : null));
    } catch (error) {
      list.replaceChildren(errorBox(friendlyError(error)));
    }
  }
  load();
}

const LISTING_STATUS = { live: "Live", sold: "Sold", expired: "Expired", removed: "Removed", review: "Hidden for review", paused: "Paused" };

async function listings() {
  let search = "";
  const list = el("div", {}, loading());
  tabPage("listings", searchBox("Title or transaction ID, e.g. L-9RMH", "", (text) => { search = text; load(); }), list);
  async function load() {
    const query = cleanSearch(search);
    let request = supabase.from("listings").select("id,title,price_cents,currency,status,reference,listing_photos(storage_path,position)").neq("status", "draft");
    if (query) request = request.or(`title.ilike.*${query}*,reference.ilike.*${query}*`);
    const { data, error } = await request.order("updated_at", { ascending: false }).limit(100);
    if (error) { list.replaceChildren(errorBox(friendlyError(error))); return; }
    list.replaceChildren((data ?? []).length ? group(...data.map((l) => {
      const photo = [...(l.listing_photos ?? [])].sort((a, b) => a.position - b.position)[0];
      return el("li", {}, el("a", { class: "row", href: `listing.html?id=${encodeURIComponent(l.id)}` },
        photo ? el("img", { class: "thumb", src: photoURL(photo.storage_path), alt: "", width: "52", height: "52", loading: "lazy" }) : el("span", { class: "thumb" }),
        el("span", { class: "row-stack" },
          el("span", { class: "row-title" }, l.title),
          el("span", { class: "hint" }, money(l.price_cents, l.currency)),
          el("span", { class: "hint" }, `${LISTING_STATUS[l.status] ?? l.status}${l.reference ? ` · ${l.reference}` : ""}`)),
        icon("chevronRight", "chev")));
    })) : empty("search", "No results", search ? `No listings match “${search}”.` : null));
  }
  load();
}

async function sales() {
  tabPage("sales", loading());
  let rows;
  try { rows = (await rpc("admin_sales")) ?? []; } catch (error) { tabPage("sales", errorBox(friendlyError(error))); return; }
  tabPage("sales", rows.length ? group(...rows.map((s) => el("li", { class: "cell-pad" },
    el("div", { class: "split" }, el("strong", {}, s.listing_title), el("strong", {}, money(Number(s.amount_cents) + Number(s.shipping_cents ?? 0), s.currency))),
    el("p", { class: "mono" }, s.reference),
    el("p", {}, `${at(s.seller_username, "deleted")} → ${at(s.buyer_username, "off Geerho")}`),
    el("p", { class: "hint" }, `${s.delivery === "shipping" ? "Shipping" : "Pickup"} · ${s.status.charAt(0).toUpperCase()}${s.status.slice(1)} · ${dateTime(s.created_at)}`)))) : empty("bag", "No sales yet"));
}

// --- Reports (the app's Moderation review queue) -------------------------------------------------------------------

const REPORT_REASONS = {
  prohibited_item: "Prohibited item", scam_or_fraud: "Scam or fraud", counterfeit: "Counterfeit or stolen",
  harassment: "Harassment or threats", discrimination: "Discrimination", offensive_content: "Offensive content",
  spam: "Spam", hidden_fees: "Hidden fees or price not shown", other: "Something else",
};
const KINDS = [["listing", "Listings"], ["user", "People"], ["message", "Messages"], ["shipment", "Shipping"]];

function reportSummary(item) {
  const parts = [];
  if (item.review_reason === "tracking_overdue") parts.push("Tracking overdue");
  if (item.review_reason === "prohibited_terms") parts.push("Possible prohibited item");
  if (item.review_reason === "fair_housing") parts.push("Possible fair housing issue");
  if (item.report_count > 0) {
    const names = (item.reasons ?? []).map((r) => REPORT_REASONS[r]).filter(Boolean).join(", ");
    parts.push(`${item.report_count} report${item.report_count === 1 ? "" : "s"}${names ? `: ${names}` : ""}`);
  }
  return parts.join(" · ");
}

async function reports(kind = "listing") {
  show(back("Review Queue"), loading());
  let items;
  try { items = (await rpc("moderation_queue")) ?? []; } catch (error) { show(back("Review Queue"), errorBox(friendlyError(error))); return; }
  const picker = el("div", { class: "segmented", role: "group", "aria-label": "Show" },
    ...KINDS.map(([value, title]) => {
      const button = el("button", { type: "button", "aria-pressed": String(value === kind) }, `${title} (${items.filter((i) => i.target_type === value).length})`);
      button.addEventListener("click", () => { location.hash = `reports/${value}`; });
      return button;
    }));
  const these = items.filter((i) => i.target_type === kind);
  const error = errorBox(""); error.hidden = true;
  show(back("Review Queue"), picker, error,
    these.length ? group(...these.map((item) => reportRow(item, kind, error))) : empty("seal", "All clear", "Nothing in this queue needs review."));
}

function reportRow(item, kind, error) {
  const suspended = item.target_type === "user" && item.held_at;
  const buttons = [];
  const decide = (label, decision, { danger = false, confirm = null } = {}) => {
    const button = el("button", { type: "button", class: danger ? "danger-button small" : "secondary small" }, label);
    button.addEventListener("click", async () => {
      const note = null;
      if (confirm && !(await confirmDialog(confirm.title, confirm.text, label, { danger: true }))) return;
      error.hidden = true;
      button.disabled = true;
      try {
        const target = item.target_id;
        if (kind === "listing") await rpc("moderate_listing", { listing: target, decision, note });
        else if (kind === "user") await rpc("moderate_user", { target, decision, note });
        else if (kind === "message") await rpc("moderate_message", { message: target, decision, note });
        else await rpc("moderate_shipment", { sale: target, decision: decision === "suspend" ? "suspend_seller" : "resolve", note });
        route();
      } catch (e) {
        error.textContent = friendlyError(e);
        error.hidden = false;
        button.disabled = false;
        window.scrollTo(0, 0);
      }
    });
    buttons.push(button);
  };
  const who = item.subject_username ?? "user";
  if (kind === "listing") {
    decide("Approve", "approve");
    decide("Remove", "remove", { danger: true, confirm: { title: "Remove this listing?", text: "The listing is taken down permanently and the seller can't republish it." } });
  } else if (kind === "user") {
    decide("Dismiss", "dismiss");
    if (suspended) decide("Unsuspend", "unsuspend");
    else decide("Suspend", "suspend", { danger: true, confirm: { title: `Suspend @${who}?`, text: "They won't be able to publish or message, and their listings disappear from Geerho until you lift the suspension." } });
  } else if (kind === "message") {
    decide("Dismiss", "dismiss");
    decide("Remove", "remove", { danger: true, confirm: { title: "Remove this message?", text: "The message is deleted for both people." } });
  } else {
    decide("Mark Resolved", "dismiss");
    decide("Suspend Seller", "suspend", { danger: true, confirm: { title: `Suspend seller @${who}?`, text: "They won't be able to publish or message, and their listings disappear from Geerho until you lift the suspension." } });
  }
  const link = kind === "listing" ? `listing.html?id=${encodeURIComponent(item.target_id)}`
    : item.subject_user_id ? `member.html?id=${encodeURIComponent(item.subject_user_id)}` : null;
  return el("li", { class: "cell-pad report" },
    el("div", { class: "report-head" },
      kind === "listing" && item.cover_path ? el("img", { class: "thumb", src: photoURL(item.cover_path), alt: "", width: "52", height: "52", loading: "lazy" }) : null,
      el("div", {},
        item.title ? el("strong", {}, link ? el("a", { href: link, target: "_blank", rel: "noopener" }, item.title) : item.title) : null,
        item.subject_username ? el("p", { class: "hint" }, kind === "message" ? `From @${item.subject_username}` : link && !item.title ? el("a", { href: link, target: "_blank", rel: "noopener" }, `@${item.subject_username}`) : `@${item.subject_username}`) : null,
        el("p", { class: "warn-text" }, reportSummary(item)),
        suspended ? el("p", { class: "hint" }, `Suspended ${dateOnly(item.held_at)}`) : null)),
    item.details ? el("p", { class: "quote" }, item.details) : null,
    ...(item.report_notes ?? []).map((note) => el("p", { class: "hint" }, `“${note}”`)),
    el("div", { class: "actions" }, ...buttons));
}

// --- Licenses ------------------------------------------------------------------------------------------------------

const place = (country, subdivision) => subdivision ? `${subdivision}, ${countryName(country)}` : countryName(country);

async function licenses() {
  show(back("License Reviews"), loading());
  try { cache.licenses = (await rpc("license_review_queue")) ?? []; } catch (error) { show(back("License Reviews"), errorBox(friendlyError(error))); return; }
  show(back("License Reviews"), cache.licenses.length
    ? group(...cache.licenses.map((l) => linkRow(`#license/${l.id}`, `${l.profession_name} · ${place(l.country, l.subdivision)}`,
      `${l.full_name} · ${at(l.username)} · submitted ${relative(l.created_at)}`)))
    : empty("seal", "No licenses waiting"));
}

function lookupHint(l) {
  if (l.country === "US" && l.subdivision === "CA") {
    return l.field === "real_estate"
      ? "Check the number and name on the California DRE public license lookup (dre.ca.gov)."
      : "Check the issuer's public lookup, e.g. the CSLB license check (cslb.ca.gov) for contractors.";
  }
  if (l.country === "PH") return "Check the number and name on the PRC online verification of licenses (prc.gov.ph).";
  return "Check the number and name on the issuer's public license lookup.";
}

async function license(id) {
  if (!cache.licenses?.some((l) => l.id === id)) cache.licenses = (await rpc("license_review_queue").catch(() => [])) ?? [];
  const l = cache.licenses.find((x) => x.id === id);
  if (!l) { show(back("License", "#licenses"), empty("seal", "Already reviewed", "This license isn't waiting anymore.")); return; }
  const error = errorBox(""); error.hidden = true;
  const note = noteBox();
  const approve = el("button", { type: "button" }, "Approve License");
  const reject = el("button", { type: "button", class: "danger-button" }, "Don't Approve");
  needsNote(note, reject);
  const decide = (yes) => () => rpc("review_license", { license: id, approve: yes, note: note.value.trim() || null });
  act(approve, error, "licenses", decide(true));
  act(reject, error, "licenses", decide(false));
  show(back(l.profession_name, "#licenses"),
    groupTitle("Member"),
    group(kv("Username", at(l.username)), l.display_name ? kv("Profile name", l.display_name) : null,
      kv("ID verified", l.verified_at ? dateOnly(l.verified_at) : "No"),
      linkRow(`member.html?id=${encodeURIComponent(l.user_id)}`, "View Profile")),
    groupTitle("License"),
    group(kv("Profession", l.profession_name), kv("Where", place(l.country, l.subdivision)), kv("Issued by", l.issuing_body),
      kv("Number", l.license_number), kv("Name on license", l.full_name), kv("Date of birth", l.date_of_birth ? dateOnly(l.date_of_birth) : "—"),
      l.expires_on ? kv("Expires", dateOnly(l.expires_on)) : null, l.business_name ? kv("Business", l.business_name) : null),
    groupTitle("Contact"),
    group(kv("Phone", l.contact_phone), l.contact_email ? kv("Email", l.contact_email) : null),
    l.details ? groupTitle("Notes from the member") : null,
    l.details ? group(el("li", { class: "cell-pad" }, l.details)) : null,
    l.document_path ? group(fileButton("View License Photo", "license-documents", l.document_path)) : null,
    hint(lookupHint(l)),
    groupTitle("Note to the member"),
    decisionArea(note, error, el("div", { class: "actions" }, approve, reject)));
}

// --- Addresses -----------------------------------------------------------------------------------------------------

const PROOF_KINDS = {
  utility_bill: "Utility bill (power, water, internet)", bank_statement: "Bank or credit card statement",
  lease: "Lease or rental agreement", government_letter: "Letter from a government office", insurance: "Insurance policy or bill",
  tax_document: "Tax document", employer_letter: "Letter or pay slip from your employer", other: "Other official document",
};

function addressLines(a) {
  if (!a) return [];
  const street = [a.line1, a.line2].map((s) => (s ?? "").trim()).filter(Boolean).join(", ");
  const region = [a.region, a.postal_code].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
  const cityLine = [(a.city ?? "").trim(), region].filter(Boolean).join(", ");
  return [street, cityLine, a.country ? countryName(a.country) : ""].filter(Boolean);
}

async function addresses() {
  show(back("Address Reviews"), loading());
  try { cache.addresses = (await rpc("address_review_queue")) ?? []; } catch (error) { show(back("Address Reviews"), errorBox(friendlyError(error))); return; }
  show(back("Address Reviews"), cache.addresses.length
    ? group(...cache.addresses.map((a) => linkRow(`#address/${a.id}`, `${a.display_name || at(a.username)}`,
      `${a.city}, ${countryName(a.country)} · ${(a.proofs ?? []).length} documents · sent ${relative(a.created_at)}`)))
    : empty("house", "No addresses waiting"));
}

async function address(id) {
  if (!cache.addresses?.some((a) => a.id === id)) cache.addresses = (await rpc("address_review_queue").catch(() => [])) ?? [];
  const a = cache.addresses.find((x) => x.id === id);
  if (!a) { show(back("Review Address", "#addresses"), empty("house", "Already reviewed", "This address isn't waiting anymore.")); return; }
  const error = errorBox(""); error.hidden = true;
  const note = noteBox();
  const approve = el("button", { type: "button" }, "Approve Address");
  const reject = el("button", { type: "button", class: "danger-button" }, "Don't Approve");
  needsNote(note, reject);
  const decide = (yes) => () => rpc("review_address_change", { request: id, approve: yes, note: note.value.trim() || null });
  act(approve, error, "addresses", decide(true));
  act(reject, error, "addresses", decide(false));
  const current = addressLines(a.current_address);
  show(back("Review Address", "#addresses"),
    groupTitle("Member"),
    group(kv("Username", at(a.username)), kv("Name on their ID", a.legal_name ?? "Not on file"),
      kv("ID verified", a.verified_at ? dateOnly(a.verified_at) : "No")),
    groupTitle("New address"),
    group(...addressLines(a).map((line) => el("li", { class: "cell-pad" }, line))),
    current.length ? groupTitle("Address on file now") : null,
    current.length ? group(...current.map((line) => el("li", { class: "cell-pad" }, line))) : null,
    groupTitle("Proofs of address"),
    group(...(a.proofs ?? []).map((p, i) => fileButton(`${i + 1}. ${PROOF_KINDS[p.kind] ?? "Document"}`, "address-proofs", p.path))),
    hint("Approve only if each document is dated in the last 3 months, shows the name on their ID, and shows this address. The documents are deleted after you decide."),
    groupTitle("Note to the member"),
    decisionArea(note, error, el("div", { class: "actions" }, approve, reject)));
}

// --- Payments on hold ----------------------------------------------------------------------------------------------

async function payments() {
  show(back("Payments on Hold"), loading());
  try { cache.payments = (await rpc("payments_review_queue")) ?? []; } catch (error) { show(back("Payments on Hold"), errorBox(friendlyError(error))); return; }
  show(back("Payments on Hold"), cache.payments.length
    ? group(...cache.payments.map((p) => linkRow(`#payment/${p.id}`, `${p.listing_title} · ${money(p.amount_cents, p.currency)}`,
      `${at(p.buyer_username, "buyer")} bought from ${at(p.seller_username, "seller")} · ${p.dispute_status === "open" ? "Bank dispute: the bank is deciding" : (p.problem ?? "Problem reported")}`)))
    : empty("seal", "Nothing on hold", "When a buyer reports a problem or a bank opens a dispute, the payment waits here."));
}

async function payment(id) {
  if (!cache.payments?.some((p) => p.id === id)) cache.payments = (await rpc("payments_review_queue").catch(() => [])) ?? [];
  const p = cache.payments.find((x) => x.id === id);
  if (!p) { show(back("Review Payment", "#payments"), empty("seal", "Already decided", "This payment isn't on hold anymore.")); return; }
  const bank = p.dispute_status === "open";
  const error = errorBox(""); error.hidden = true;
  const note = noteBox("Note for both members (required)");
  const refund = el("button", { type: "button", class: "danger-button" }, "Refund the Buyer");
  const pay = el("button", { type: "button" }, "Pay the Seller");
  const decide = (isRefund) => async () => {
    const text = note.value.trim();
    if (text.length < 5) throw new Error("Add a short note explaining the decision.");
    const ok = await confirmDialog(isRefund ? "Refund the buyer?" : "Pay the seller?", isRefund
      ? `Refund ${money(p.amount_cents, p.currency)} to ${at(p.buyer_username, "the buyer")}.`
      : `Pay ${usd(p.seller_share_cents)} to ${at(p.seller_username, "the seller")}.`, isRefund ? "Refund" : "Pay", { danger: isRefund });
    if (!ok) throw CANCELLED;
    await rpc("resolve_payment", { payment: id, refund: isRefund, note: text });
  };
  act(refund, error, "payments", decide(true));
  act(pay, error, "payments", decide(false));
  show(back("Review Payment", "#payments"),
    groupTitle("Payment"),
    group(kv("Item", p.listing_title), kv("Buyer paid", money(p.amount_cents, p.currency)), kv("Seller would receive", money(p.seller_share_cents, p.currency)),
      p.sale_reference ? kv("Sale", p.sale_reference) : null,
      p.delivery ? kv("Delivery", p.delivery === "shipping" ? "Shipping" : "Local pickup") : null,
      p.tracking_number ? kv("Tracking", p.tracking_number) : null,
      kv("Buyer confirmed receipt", p.received_at ? "Yes" : "No")),
    groupTitle("People"),
    group(p.buyer_id ? linkRow(`member.html?id=${encodeURIComponent(p.buyer_id)}`, `Buyer ${at(p.buyer_username, "")}`) : null,
      p.seller_id ? linkRow(`member.html?id=${encodeURIComponent(p.seller_id)}`, `Seller ${at(p.seller_username, "")}`) : null),
    groupTitle("What happened"),
    group(el("li", { class: "cell-pad" }, p.problem ?? "No details.")),
    bank
      ? group(el("li", { class: "cell-pad" }, "The buyer's bank is deciding this dispute. Geerho updates it automatically when the bank decides; there's nothing to do here."))
      : [groupTitle("Decision"), decisionArea(note, error, el("div", { class: "actions" }, refund, pay)),
        hint("Check the chat, photos, and tracking first. Both members see your note. Refunds return the full amount to the buyer; if the seller was already paid, their payout is taken back.")]);
}

// --- TikTok level transfers ----------------------------------------------------------------------------------------

const withBonus = (level) => Math.min(Number(level) + 1, MAX_LEVEL);

async function transfers() {
  show(back("Level Transfers"), loading());
  try { cache.transfers = (await rpc("level_transfer_queue")) ?? []; } catch (error) { show(back("Level Transfers"), errorBox(friendlyError(error))); return; }
  const pending = cache.transfers.filter((t) => t.status === "pending");
  const decided = cache.transfers.filter((t) => t.status !== "pending");
  const row = (t) => linkRow(`#transfer/${t.id}`, `${at(t.username)} · level ${t.requested_level}`,
    `TikTok @${t.tiktok_username} · sent ${relative(t.created_at)}`,
    el("span", { class: `pill ${t.status === "approved" ? "good-pill" : t.status === "rejected" ? "danger-pill" : "warn-pill"}` },
      t.status === "approved" ? "Approved" : t.status === "rejected" ? "Not approved" : t.code));
  show(back("Level Transfers"),
    groupTitle(`Waiting (${pending.length})`),
    pending.length ? group(...pending.map(row)) : hint("No transfers waiting."),
    decided.length ? groupTitle("Decided") : null,
    decided.length ? group(...decided.map(row)) : null);
}

async function transfer(id) {
  if (!cache.transfers?.some((t) => t.id === id)) cache.transfers = (await rpc("level_transfer_queue").catch(() => [])) ?? [];
  const t = cache.transfers.find((x) => x.id === id);
  if (!t) { show(back("Level Transfer", "#transfers"), empty("star", "Not found")); return; }
  const error = errorBox(""); error.hidden = true;
  let actions = [];
  if (t.status === "pending") {
    const note = noteBox();
    const approve = el("button", { type: "button" }, `Approve Level ${withBonus(t.requested_level)}`);
    const reject = el("button", { type: "button", class: "danger-button" }, "Don't Approve");
    needsNote(note, reject);
    const decide = (yes) => () => rpc("review_level_transfer", { request: id, approve: yes, note: note.value.trim() || null });
    act(approve, error, "transfers", decide(true));
    act(reject, error, "transfers", decide(false));
    actions = [groupTitle("Note to the member"), decisionArea(note, error, el("div", { class: "actions" }, approve, reject))];
  } else if (t.status === "approved" && t.transferred_at) {
    const allow = el("button", { type: "button", class: "secondary" }, "Allow a New Transfer");
    act(allow, error, "transfers", () => rpc("allow_new_level_transfer", { member: t.user_id }));
    actions = [decisionArea(error, el("div", { class: "actions" }, allow)),
      hint("Lets the member send a new transfer, for example to correct a mistake. Their level stays until the new one is approved.")];
  } else if (t.review_note) {
    actions = [groupTitle("Note"), group(el("li", { class: "cell-pad" }, t.review_note))];
  }
  show(back("Level Transfer", "#transfers"),
    groupTitle("Member"),
    group(kv("Username", at(t.username)), kv("ID verified", t.verified_at ? dateOnly(t.verified_at) : "No"),
      kv("Geerho level now", `Level ${t.current_level ?? 0}`)),
    groupTitle("Transfer"),
    group(kv("Code", t.code), kv("From TikTok", `@${t.tiktok_username}`), kv("TikTok gifter level", String(t.requested_level)),
      kv("Becomes on Geerho", `Level ${withBonus(t.requested_level)}`),
      el("li", {}, el("a", { class: "row", href: `https://www.tiktok.com/@${encodeURIComponent(t.tiktok_username)}`, target: "_blank", rel: "noopener noreferrer" },
        el("span", { class: "row-title" }, `Open @${t.tiktok_username} on TikTok`), icon("chevronRight", "chev")))),
    hint(`Approve only if @${TIKTOK_HANDLE} received this exact code in a TikTok message from @${t.tiktok_username}, and that account's gifter level is ${t.requested_level}.`),
    ...actions);
}

// --- Account recovery ----------------------------------------------------------------------------------------------

function recoveryStatus(r) {
  switch (r.status) {
    case "submitted": return "Check the documents";
    case "call_scheduled": return `Video call ${r.call_at ? dateTime(r.call_at) : "scheduled"}`;
    case "blocked": return "Stopped by the owner · close it";
    default: return "Call done · waiting for a Super Admin";
  }
}

async function recovery() {
  show(back("Account Recovery"), loading());
  try { cache.recovery = (await rpc("recovery_queue")) ?? []; } catch (error) { show(back("Account Recovery"), errorBox(friendlyError(error))); return; }
  show(back("Account Recovery"), cache.recovery.length
    ? group(...cache.recovery.map((r) => linkRow(`#recovery/${r.id}`, `@${r.target_username}`, `${recoveryStatus(r)} · sent ${dateTime(r.created_at)}`)))
    : empty("key", "No recovery requests", "Members who lost access to their account ask for help here."));
}

/** Recovery documents are deleted once a request ends (the apps do the same). */
async function removeRecoveryDocuments(documents) {
  const paths = (documents ?? []).map((d) => d.path).filter(Boolean);
  if (paths.length) await supabase.storage.from("recovery-documents").remove(paths).catch(() => {});
}

function localInputValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function recoveryDetail(id) {
  if (!cache.recovery?.some((r) => r.id === id)) cache.recovery = (await rpc("recovery_queue").catch(() => [])) ?? [];
  const r = cache.recovery.find((x) => x.id === id);
  if (!r) { show(back("Account Recovery", "#recovery"), empty("key", "Already finished", "This request isn't open anymore.")); return; }
  const error = errorBox(""); error.hidden = true;
  const note = el("textarea", { rows: "3", maxlength: "1000", placeholder: "Note (optional)", "aria-label": "Note" });
  const noteValue = () => note.value.trim() || null;
  const phone = r.whatsapp ? r.whatsapp.replace(/\D/g, "") : "";
  let step = [];
  if (r.status === "blocked") {
    const close = el("button", { type: "button", class: "secondary" }, "Close and Delete Documents");
    act(close, error, "recovery", async () => removeRecoveryDocuments(await rpc("recovery_close", { request: id, note: noteValue() })));
    step = [groupTitle("Stopped"), group(el("li", { class: "cell-pad warn-text" }, "The account's owner tapped “This wasn't me”.")),
      decisionArea(note, error, el("div", { class: "actions" }, close)),
      hint("Someone may be trying to take this account. Look at the documents, tell a Super Admin, then close the request.")];
  } else if (r.status === "submitted") {
    const when = el("input", { type: "datetime-local", value: localInputValue(new Date(Date.now() + 86400000)), min: localInputValue(new Date()), "aria-label": "Video call" });
    const schedule = el("button", { type: "button" }, "Documents Match · Schedule Call");
    act(schedule, error, "recovery", () => {
      const callAt = new Date(when.value);
      if (Number.isNaN(callAt.getTime())) throw new Error("Choose a date and time for the video call.");
      return rpc("recovery_docs_checked", { request: id, call_at: callAt.toISOString(), note: noteValue() });
    });
    step = [groupTitle("Step 1: documents"), decisionArea(el("label", {}, "Video call", when), note, error, el("div", { class: "actions" }, schedule)),
      hint("Check that the ID is valid and not expired, and that both proofs are from the last 3 months with the same name and address as on file. Then message them on WhatsApp to agree on a time.")];
  } else if (r.status === "call_scheduled") {
    const face = el("input", { type: "checkbox", id: "rc-face" });
    const signatures = el("input", { type: "checkbox", id: "rc-sign" });
    const done = el("button", { type: "button" }, "Call Done");
    const update = () => { done.disabled = !(face.checked && signatures.checked); };
    face.addEventListener("change", update); signatures.addEventListener("change", update); update();
    act(done, error, "recovery", () => rpc("recovery_call_done", { request: id, signatures_match: true, face_matches: true, note: noteValue() }));
    step = [groupTitle(`Step 2: WhatsApp video call${r.call_at ? ` · ${dateTime(r.call_at)}` : ""}`),
      decisionArea(
        el("label", { class: "check" }, face, el("span", {}, "Their face matches the ID")),
        el("label", { class: "check" }, signatures, el("span", {}, "They signed three times on blank paper while I watched, and the signatures match the ID")),
        note, error, el("div", { class: "actions" }, done)),
      hint("Ask them to hold the ID next to their face, then sign their name three times on blank paper and show it to the camera.")];
  } else {
    const items = [r.call_by ? kv("Call by", `@${r.call_by}`) : null, kv("Can finish from", dateTime(r.ready_at))];
    let finish = null;
    if (role === "owner") {
      const removeOld = el("input", { type: "checkbox", id: "rc-remove" });
      const give = el("button", { type: "button" }, "Give Them Their Account");
      act(give, error, "recovery", async () => {
        const ok = await confirmDialog(`Give @${r.target_username} to this person?`, "Their new sign-in method moves onto the account. This can't be undone here.", "Give Account");
        if (!ok) throw CANCELLED;
        removeRecoveryDocuments(await rpc("recovery_complete", { request: id, remove_old_methods: removeOld.checked, note: noteValue() }));
      });
      finish = decisionArea(el("label", { class: "check" }, removeOld, el("span", {}, "Remove their old sign-in methods and sign out every device")), note, error, el("div", { class: "actions" }, give));
    }
    step = [groupTitle("Step 3: Super Admin"), group(...items),
      finish ?? hint("A Super Admin finishes this step."),
      hint(`Their new sign-in method moves onto @${r.target_username}, and the new empty account is removed. Turn on removal when they say their old sign-in was stolen.`)];
  }
  let rejectArea = [];
  if (r.status !== "blocked") {
    const rejectNote = el("textarea", { rows: "3", maxlength: "1000", placeholder: "Reason (required)", "aria-label": "Reason for rejecting" });
    const reject = el("button", { type: "button", class: "danger-button" }, "Reject");
    needsNote(rejectNote, reject);
    act(reject, error, "recovery", async () => removeRecoveryDocuments(await rpc("recovery_reject", { request: id, note: rejectNote.value.trim() })));
    rejectArea = [groupTitle("Reject"), decisionArea(rejectNote, el("div", { class: "actions" }, reject)), hint("Write the reason first. Their documents are deleted.")];
  }
  show(back("Account Recovery", "#recovery"),
    groupTitle("They say"),
    group(kv("Account", `@${r.target_username}`), kv("Name", r.legal_name), kv("Born", r.date_of_birth ? dateOnly(r.date_of_birth) : "—"),
      r.whatsapp ? kv("WhatsApp", r.whatsapp) : null,
      phone ? el("li", {}, el("a", { class: "row", href: `https://wa.me/${phone}`, target: "_blank", rel: "noopener noreferrer" },
        el("span", { class: "row-title" }, "Open WhatsApp"), icon("chevronRight", "chev"))) : null,
      r.what_happened ? el("li", { class: "cell-pad" }, r.what_happened) : null),
    groupTitle("What Geerho has on file"),
    group(kv("Name on verified ID", r.verified_legal_name ?? "Not on file"), kv("Date of birth", r.verified_birth ? dateOnly(r.verified_birth) : "Not on file"),
      r.verified_country ? kv("ID country", countryName(r.verified_country)) : null, kv("Home address", r.home_address ?? "Not on file")),
    hint("The name, date of birth, and address in their documents must match these."),
    groupTitle("Documents"),
    group(...(r.documents ?? []).map((d, i) => fileButton(`${i + 1}. ${d.kind === "government_id" ? "Government ID" : "Proof of address"}`, "recovery-documents", d.path))),
    ...step, ...rejectArea);
}

// --- Overdue rentals and the Moderator Handbook ----------------------------------------------------------------------

async function overdueRentals() {
  if (!cache.overdue) cache.overdue = (await rpc("admin_overdue_rentals").catch(() => [])) ?? [];
  show(back("Overdue Rentals"), cache.overdue.length ? group(...cache.overdue.map((r) => el("li", { class: "cell-pad" },
    el("div", { class: "split" }, el("strong", {}, r.listing_title), el("strong", { class: "bad-text" }, `${r.days_late} ${r.days_late === 1 ? "day" : "days"} late`)),
    el("p", {}, `Due ${dateOnly(r.end_date)} · deposit ${usd(r.deposit_cents)}`),
    el("p", { class: "hint" }, `Owner ${at(r.owner_username, "deleted")} · renter ${at(r.renter_username, "deleted")}`),
    el("p", { class: "mono" }, r.reference),
    // The listing and both members (M110), to follow up.
    el("p", { class: "overdue-links" },
      r.listing_id ? el("a", { href: `listing.html?id=${encodeURIComponent(r.listing_id)}` }, "View Listing") : null,
      r.owner_id ? el("a", { href: `member.html?id=${encodeURIComponent(r.owner_id)}` }, `Owner ${at(r.owner_username, "")}`) : null,
      r.renter_id ? el("a", { href: `member.html?id=${encodeURIComponent(r.renter_id)}` }, `Renter ${at(r.renter_username, "")}`) : null)))) : empty("calendar", "No overdue rentals"),
    cache.overdue.length ? hint("To contact the owner or renter through Geerho Support, open their profile in the app (Moderator Tools).") : null);
}

// The handbook is HTML written by Geerho (generated from the Bible into a migration); only safe tags are kept.
const HANDBOOK_TAGS = new Set(["H1", "H2", "H3", "H4", "P", "UL", "OL", "LI", "STRONG", "EM", "B", "I", "CODE", "BLOCKQUOTE", "HR", "BR", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "A"]);

function cleanHTML(node) {
  const out = document.createDocumentFragment();
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) { out.append(child.textContent); continue; }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "TEMPLATE", "HEAD", "TITLE"].includes(child.tagName)) continue;
    if (!HANDBOOK_TAGS.has(child.tagName)) { out.append(cleanHTML(child)); continue; }
    const copy = document.createElement(child.tagName);
    const href = child.tagName === "A" ? child.getAttribute("href") ?? "" : "";
    if (/^(https:|#)/.test(href)) copy.setAttribute("href", href);
    if (href.startsWith("https:")) { copy.setAttribute("target", "_blank"); copy.setAttribute("rel", "noopener noreferrer"); }
    if (child.id) copy.id = child.id;
    copy.append(cleanHTML(child));
    out.append(copy);
  }
  return out;
}

async function handbook() {
  show(back("Moderator Handbook"), loading());
  try {
    const html = await rpc("moderator_handbook");
    const doc = new DOMParser().parseFromString(html ?? "", "text/html");
    show(back("Moderator Handbook"), el("article", { class: "handbook prose" }, cleanHTML(doc.body)));
  } catch (error) {
    show(back("Moderator Handbook"), errorBox(friendlyError(error)));
  }
}

// --- Routing ---------------------------------------------------------------------------------------------------------

async function route() {
  const [name, arg] = location.hash.replace(/^#/, "").split("/");
  try {
    switch (name) {
      case "": return await overview();
      case "support": return await support(arg || "open");
      case "ticket": return await ticket(arg);
      case "people": return await people(arg || "all");
      case "listings": return await listings();
      case "sales": return await sales();
      case "reports": return await reports(arg || "listing");
      case "licenses": return await licenses();
      case "license": return await license(arg);
      case "addresses": return await addresses();
      case "address": return await address(arg);
      case "payments": return await payments();
      case "payment": return await payment(arg);
      case "transfers": return await transfers();
      case "transfer": return await transfer(arg);
      case "recovery": return await (arg ? recoveryDetail(arg) : recovery());
      case "overdue": return await overdueRentals();
      case "handbook": return await handbook();
      default: location.hash = "";
    }
  } catch (error) {
    show(back("Admin"), errorBox(friendlyError(error)));
  }
}

async function start() {
  const user = await currentUser();
  if (!user) { location.replace(signInURL("admin.html")); return; }
  const { data } = await supabase.rpc("my_moderation_role");
  role = data ?? null;
  if (!role) {
    show(empty("lock", "For Geerho moderators", "The Admin Dashboard is for Geerho's moderators and Super Admins."),
      el("p", { class: "center" }, el("a", { href: "account.html" }, "Back to Profile")));
    return;
  }
  // Require for Staff is on and this sign-in didn't use two-step verification: the database refuses staff tools.
  const { data: staff } = await supabase.rpc("staff_mfa_status");
  if (staff?.required && staff?.aal !== "aal2") {
    show(empty("lock", "Sign in with two-step verification", "Moderator and Super Admin tools need two-step verification. Turn it on in Settings → Security, then sign out and back in with your code."),
      el("p", { class: "center" }, el("a", { href: "account.html#security" }, "Open Settings → Security")));
    return;
  }
  window.addEventListener("hashchange", () => { route(); });
  route();
}

start();
