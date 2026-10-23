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
import { renderMarkdown } from "./page-md.js";

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
  const booksOwner = await rpc("books_is_owner").catch(() => false);   // M151: Super Admin 1 only
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
      stat("Fees waived", usd(o.fees_waived_cents), { detail: owner ? `At ${pct} of sales · change the rate` : `At ${pct} of sales`, iconName: "dollar", tint: "purple", href: owner ? `#commission/${o.commission_rate}` : null }),
      stat("Founding Members", `${o.founding_used} of ${o.founding_limit}`, { detail: `${Math.max(o.founding_limit - o.founding_used, 0)} free spots left (the Founder holds an extra #0)`, iconName: "star", tint: "orange", href: "#people/founding" }),
    ),
    groupTitle("Calendar"),
    group(stat("Business Calendar", "Deadlines", { detail: "Federal and California taxes, filings, renewals", iconName: "calendar", tint: "red", href: "#calendar" }),
      owner ? stat("Shared Pages", "Write", { detail: "Pages anyone with the link can read, or private", iconName: "doc", tint: "blue", href: "#pages" }) : null),
    booksOwner ? groupTitle("Geerho Tech LLC") : null,
    booksOwner ? group(stat("Company Books", "Open", { detail: "Expenses, Stripe income, mileage, profit · Geerho, Xenpen, Klean", iconName: "dollar", tint: "green", href: "#books" })) : null,
    groupTitle("Team, categories, and settings"),
    group(
      stat("Team and Super Admins", owner ? "Manage" : "View", { detail: owner ? "Add moderators, appoint Super Admins, succession" : "Super Admins, moderators, and elections", iconName: "team", tint: "indigo", href: "#team" }),
      stat("Category requests", categories, { detail: owner ? "Propose or approve new categories" : "Propose a category · the owner approves", iconName: "tag", tint: categories > 0 && owner ? "orange" : "blue", href: "#categories" }),
      owner ? stat("Licenses by location", "Set rules", { detail: "Which professions need a license, where", iconName: "seal", tint: "teal", href: "#license-rules" }) : null,
      owner ? stat("Where it's available", "Regions", { detail: "Real estate and freelance by country and state", iconName: "house", tint: "teal", href: "#regions" }) : null,
    ),
    owner ? groupTitle("Before launch") : null,
    owner ? group(
      stat("Launch waitlist", "People", { detail: "Emails from geerho.com: who wants to know when we open, and where", iconName: "star", tint: "green", href: "#waitlist" }),
      stat("Delete beta test data", "Reset", { detail: "Keeps accounts, usernames, ID verifications, and the posts you choose", iconName: "trash", tint: "red", href: "#reset" })) : null,
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
      list.replaceChildren(rows.length ? group(...rows.map((p) => el("li", {}, el("a", { class: "row", href: `#person/${encodeURIComponent(p.id)}` },
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
    const [html, status] = await Promise.all([rpc("moderator_handbook"), rpc("moderator_handbook_status").catch(() => null)]);
    const doc = new DOMParser().parseFromString(html ?? "", "text/html");
    const title = status ? `Moderator Handbook · v${status.version}` : "Moderator Handbook";
    show(back(title), ...(status ? handbookStatus(status) : []), el("article", { class: "handbook prose" }, cleanHTML(doc.body)));
  } catch (error) {
    show(back("Moderator Handbook"), errorBox(friendlyError(error)));
  }
}

// Versions and the quiz (M137): what changed, passed or due, and the quiz (graded on the server).
function handbookStatus(status) {
  const line = status.passed ? ["You passed this version's quiz.", "good"]
    : status.is_super_admin ? ["Super Admins don't need the quiz.", "info"]
    : status.paused ? ["Your moderator tools are paused until you pass the quiz.", "bad"]
    : status.due_at ? [`Pass the quiz by ${dateOnly(status.due_at)} to keep using moderator tools.`, "warn"] : null;
  const rows = [];
  if (status.changes) rows.push(el("li", { class: "cell-pad" }, el("strong", {}, `What changed in version ${status.version}: `), status.changes));
  if (line) rows.push(el("li", { class: "cell-pad" }, el("span", { class: `status ${line[1]}` }, line[0])));
  if (status.quiz_version) rows.push(linkRow("#handbook-quiz", status.passed || status.is_super_admin ? "Practice the Quiz" : "Take the Quiz",
    `${status.pass_mark} of ${status.questions.length} right passes`));
  if (status.is_super_admin) rows.push(linkRow("#handbook-progress", "Who Has Passed", "Every moderator's quiz for this version"));
  return rows.length ? [group(...rows)] : [];
}

async function handbookQuiz() {
  show(back("Handbook Quiz", "#handbook"), loading());
  const status = await rpc("moderator_handbook_status");
  if (!status.quiz_version) { location.hash = "handbook"; return; }
  const picks = {};
  const blocks = status.questions.map((q) => el("fieldset", { class: "group plain cell-pad" },
    el("legend", {}, `Question ${q.position}`), el("p", {}, el("strong", {}, q.question)),
    ...q.choices.map((choice, i) => {
      const radio = el("input", { type: "radio", name: `q${q.position}`, value: String(i) });
      radio.addEventListener("change", () => { picks[q.position] = i; check.disabled = Object.keys(picks).length < status.questions.length; });
      return el("label", { class: "choice" }, radio, " ", choice);
    })));
  const error = errorBox(""); error.hidden = true;
  const check = el("button", { type: "button", disabled: true }, "Check My Answers");
  check.addEventListener("click", async () => {
    check.disabled = true; error.hidden = true;
    try {
      const r = await rpc("submit_moderator_quiz", { version: status.quiz_version, answers: status.questions.map((q) => picks[q.position] ?? -1) });
      const again = el("button", { type: "button" }, "Try Again");
      again.addEventListener("click", () => handbookQuiz());
      show(back("Handbook Quiz", "#handbook"),
        group(el("li", { class: "cell-pad" }, el("span", { class: `status ${r.passed ? "good" : "bad"}` },
          r.passed ? `Passed: ${r.score} of ${r.total}` : `${r.score} of ${r.total}. You need ${r.pass_mark}.`))),
        ...(r.missed.length ? [groupTitle("What to reread"), group(...r.missed.map((m) => el("li", { class: "cell-pad" },
          el("p", {}, el("strong", {}, m.question)), el("p", { class: "muted" }, m.why))))] : []),
        el("div", { class: "actions" }, r.passed ? el("a", { class: "button", href: "#handbook" }, "Done")
          : again));
    } catch (e) {
      error.textContent = friendlyError(e); error.hidden = false; check.disabled = false;
    }
  });
  show(back(`Handbook Quiz · v${status.quiz_version}`, "#handbook"), ...blocks,
    hint(`${status.pass_mark} of ${status.questions.length} right passes. Answers are checked by Geerho's server.`),
    decisionArea(error, el("div", { class: "actions" }, check)));
}

async function handbookProgress() {
  if (role !== "owner") { location.hash = "handbook"; return; }
  show(back("Who Has Passed", "#handbook"), loading());
  const rows = await rpc("moderator_handbook_progress");
  show(back("Who Has Passed", "#handbook"), group(...(rows ?? []).map((r) => el("li", { class: "cell-pad" },
    el("strong", {}, at(r.username, "moderator")), " · ",
    r.role === "owner" ? "Super Admin (exempt)" : r.passed ? `Passed ${dateOnly(r.passed_at)}`
      : r.paused ? `Paused · ${r.tries} tries` : `Due ${dateOnly(r.due_at)} · ${r.tries} tries`))));
}

// --- Launch waitlist (M146): counts by place and the CSV for launch emails (Super Admins) ----------------------------

async function waitlist() {
  if (role !== "owner") { location.hash = ""; return; }
  show(back("Launch Waitlist"), loading());
  const s = await rpc("waitlist_summary");
  const download = el("button", { type: "button" }, "Download CSV");
  const error = errorBox(""); error.hidden = true;
  download.addEventListener("click", async () => {
    download.disabled = true;
    try {
      const rows = await rpc("waitlist_export");
      const cell = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
      const lines = [["email", "city", "region", "country", "interest", "joined_at", "unsubscribe_link"].join(",")]
        .concat((rows ?? []).map((r) => [r.email, r.city, r.region, r.country, r.interest, r.joined_at,
          `https://geerho.com/waitlist.html?leave=${r.unsubscribe_token}`].map(cell).join(",")));
      const link = el("a", { href: URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })), download: "geerho-waitlist.csv" });
      document.body.append(link); link.click(); link.remove();
    } catch (e) { error.textContent = friendlyError(e); error.hidden = false; }
    download.disabled = false;
  });
  show(back("Launch Waitlist"),
    group(kv("On the list", String(s.total)), kv("Joined in the last 7 days", String(s.last_7_days)),
      kv("Want to sell", String(s.sellers)), kv("Unsubscribed", String(s.left))),
    groupTitle("Where they are"),
    s.places.length ? group(...s.places.map((p) => kv(p.place, String(p.count)))) : group(el("li", { class: "cell-pad" }, "Nobody yet")),
    hint("Each row in the CSV has the person's own unsubscribe link: put it in every email (US law, CAN-SPAM). Keep the file private and delete it after sending."),
    decisionArea(error, el("div", { class: "actions" }, download)));
}

// --- Routing ---------------------------------------------------------------------------------------------------------

// --- Owner: commission rate and deleting beta test data (same as the app's sheets) -----------------------------------

function commissionRate(current) {
  if (role !== "owner") { location.hash = ""; return; }
  const percent = el("input", { type: "number", min: "0", max: "50", step: "0.5", value: String(Math.round((Number(current) || 0.05) * 1000) / 10), "aria-label": "Commission rate in percent" });
  const error = errorBox(""); error.hidden = true;
  const save = el("button", { type: "button" }, "Save");
  act(save, error, "", async () => {
    const value = Number(percent.value);
    if (!(value >= 0 && value <= 50)) throw new Error("Choose a rate between 0% and 50%.");
    await rpc("set_commission_rate", { rate: Math.round(value * 10) / 1000 });
  });
  show(back("Commission Rate"),
    group(el("li", { class: "cell-pad" }, el("label", { class: "inline-field" }, percent, " %"))),
    hint("Used to show the fees Geerho is waiving. Nobody is charged until payments are added and the Terms are updated."),
    decisionArea(error, el("div", { class: "actions" }, save)));
}

const POST_TYPES = [["for_sale", "Items for sale"], ["auction", "Auctions"], ["tool_rental", "Tools and equipment for rent"],
  ["home_rent", "Homes for rent"], ["home_sale", "Homes for sale"], ["service", "Services"], ["job", "Jobs"]];

/** Recursively deletes every file in a storage bucket except `keeping` (folders come back without an id). */
async function purgeFiles(bucket, keeping, folder = "") {
  const api = supabase.storage.from(bucket);
  const { data: items } = await api.list(folder, { limit: 1000 });
  let removed = 0;
  const files = [];
  for (const item of items ?? []) {
    const path = folder ? `${folder}/${item.name}` : item.name;
    if (!item.id) removed += await purgeFiles(bucket, keeping, path);
    else if (!keeping.has(path)) files.push(path);
  }
  for (let i = 0; i < files.length; i += 100) {
    const chunk = files.slice(i, i + 100);
    const { error } = await api.remove(chunk);
    if (!error) removed += chunk.length;
  }
  return removed;
}

async function resetTestData() {
  if (role !== "owner") { location.hash = ""; return; }
  show(back("Delete Beta Test Data"), loading());
  const candidates = (await rpc("admin_reset_candidates").catch(() => [])) ?? [];
  const keepTypes = new Set();
  const keepPosts = new Set();
  const keeps = (c) => keepTypes.has(c.post_type) || keepPosts.has(c.id);
  const keptLabel = el("p", { class: "group-title" });
  const updateKept = () => { keptLabel.textContent = `Keep posts (${candidates.filter(keeps).length} of ${candidates.length})`; };

  const typeRows = POST_TYPES.map(([type, title]) => {
    const n = candidates.filter((c) => c.post_type === type).length;
    const box = el("input", { type: "checkbox", disabled: n === 0 });
    box.addEventListener("change", () => { if (box.checked) keepTypes.add(type); else keepTypes.delete(type); updateKept(); });
    return el("li", { class: "cell-pad" }, el("label", { class: "check-row" }, box, ` ${title} (${n})`));
  });
  const postRows = candidates.map((c) => {
    const box = el("input", { type: "checkbox" });
    box.addEventListener("change", () => { if (box.checked) keepPosts.add(c.id); else keepPosts.delete(c.id); updateKept(); });
    const what = POST_TYPES.find(([t]) => t === c.post_type)?.[1] ?? c.post_type;
    return el("li", { class: "cell-pad" }, el("label", { class: "check-row" }, box,
      el("span", { class: "row-stack" }, el("span", { class: "row-title" }, c.title),
        el("span", { class: "hint" }, `${what} · ${at(c.seller_username)} · ${c.status}${c.reference ? ` · ${c.reference}` : ""}`))));
  });
  const details = el("details", {}, el("summary", {}, "Choose individual posts"), group(...postRows));
  updateKept();

  const confirm = el("input", { type: "text", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", placeholder: "Type DELETE", "aria-label": "Type DELETE to confirm" });
  const run = el("button", { type: "button", class: "danger-button", disabled: true }, "Delete Test Data");
  confirm.addEventListener("input", () => { run.disabled = confirm.value.trim() !== "DELETE"; });
  const status = el("p", { class: "status-line", role: "status" });
  const error = errorBox(""); error.hidden = true;
  run.addEventListener("click", async () => {
    if (!(await confirmDialog("Delete all beta test data?", "This can't be undone. Do this only before launch, while all data is test data.", "Delete", { danger: true }))) return;
    error.hidden = true;
    root.querySelectorAll("button, input").forEach((b) => { b.disabled = true; });
    try {
      status.textContent = "Deleting test data…";
      const counts = await rpc("admin_reset_test_data", { confirmation: "DELETE", keep_types: [...keepTypes].sort(), keep_listings: [...keepPosts].sort() });
      status.textContent = "Removing uploaded photos and attachments…";
      let files = await purgeFiles("support-attachments", new Set()) + await purgeFiles("rental-photos", new Set());
      const kept = await rpc("admin_kept_photo_paths").catch(() => null);
      if (kept) files += await purgeFiles("listing-photos", new Set(kept));
      const rows = Object.entries(counts ?? {}).sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => kv(k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), String(v)));
      show(back("Delete Beta Test Data"),
        el("p", { class: "status good", role: "status" }, "Test data deleted"),
        group(...rows, kv("Photos and attachments", String(files))),
        hint(`Accounts, usernames, profile photos, ID verifications, Founding Member numbers, and moderators were kept${(counts?.listings_kept ?? 0) > 0 ? ", along with the posts you chose and their photos." : "."}`));
    } catch (e) {
      status.textContent = "";
      error.textContent = friendlyError(e); error.hidden = false;
      root.querySelectorAll("button, input").forEach((b) => { b.disabled = false; });
      run.disabled = confirm.value.trim() !== "DELETE";
    }
  });

  show(back("Delete Beta Test Data"),
    keptLabel, group(...typeRows), details,
    hint("Kept posts stay live with their photos, so you don't have to post them again at launch. Their messages, offers, bids, and favorites are still cleared, auctions start over with no bids, and live posts get a fresh 60 days. Sold posts are always deleted."),
    groupTitle("Will be deleted"),
    group(...["All other listings and their photos, and every sold post", "Purchase requests, sales, and reviews", "Auction bids and reserves",
      "Rentals and their condition photos", "All conversations and messages", "Support requests and attachments", "Reports, favorites, watches, and blocks"]
      .map((t) => el("li", { class: "cell-pad" }, t))),
    groupTitle("Will be kept"),
    group(...["Every account, username, and profile photo", "ID verifications (they cost money)", "Founding Member numbers and fee plans", "Moderators and settings"]
      .map((t) => el("li", { class: "cell-pad" }, t))),
    groupTitle("Confirm"),
    decisionArea(confirm, hint("This can't be undone. Do this only before launch, while all data is test data."), status, error, el("div", { class: "actions" }, run)));
}

// --- Category requests (any moderator proposes; the owner approves) -----------------------------------------------

const CATEGORY_TARGETS = [["item", "Items for sale", "e.g. Camping gear"], ["rental", "Homes for rent or lease", "e.g. Studio, Bedspace"],
  ["property_sale", "Homes for sale", "e.g. Townhouse, Farm"], ["profession", "Kind of work (services and jobs)", "e.g. Pool cleaning"]];
const FIELDS = [["real_estate", "Real estate"], ["trades", "Trades"], ["home_services", "Home services"],
  ["professional", "Professional services"], ["health_and_care", "Health and care"], ["creative", "Creative"],
  ["tech", "Tech"], ["education", "Lessons and tutoring"], ["other", "Other"]];
const targetName = (t) => CATEGORY_TARGETS.find(([id]) => id === t)?.[1] ?? t;
const fieldName = (f) => FIELDS.find(([id]) => id === f)?.[1] ?? f;

function proposalRow(p, href) {
  const state = p.status === "approved" ? el("span", { class: "state good" }, "Approved")
    : p.status === "rejected" ? el("span", { class: "state bad" }, "Not approved")
    : el("span", { class: "state warn" }, role === "owner" ? "Tap to decide" : "Waiting");
  const lines = el("span", { class: "row-stack" },
    el("span", { class: "row-title" }, p.name),
    el("span", { class: "hint" }, targetName(p.target) + (p.field ? ` · ${fieldName(p.field)}` : "") + (p.license_required ? " · needs a license" : "")),
    p.note ? el("span", { class: "hint" }, `“${p.note}”`) : null,
    el("span", { class: "hint" }, `Proposed by ${at(p.proposer_username)}${p.reviewer_username ? ` · decided by ${at(p.reviewer_username)}` : ""}`),
    p.status === "rejected" && p.review_note ? el("span", { class: "state bad" }, p.review_note) : null);
  return el("li", {}, href ? el("a", { class: "row", href }, lines, state, icon("chevronRight", "chev")) : el("div", { class: "row" }, lines, state));
}

async function categoryRequests() {
  show(back("Category Requests"), loading());
  const all = (await rpc("category_proposals_list")) ?? [];
  cache.proposals = all;
  const pending = all.filter((p) => p.status === "pending");
  const decided = all.filter((p) => p.status !== "pending");
  show(back("Category Requests"),
    hint(role === "owner" ? "Moderators propose new categories. They appear in the app as soon as you approve them."
      : "Propose a new category. It appears in the app once the owner approves it."),
    group(linkRow("#propose", "Propose a Category")),
    groupTitle(`Waiting for the owner (${pending.length})`),
    pending.length ? group(...pending.map((p) => proposalRow(p, role === "owner" ? `#category/${p.id}` : null))) : group(el("li", { class: "cell-pad" }, "Nothing waiting")),
    decided.length ? groupTitle("Decided") : null,
    decided.length ? group(...decided.map((p) => proposalRow(p, null))) : null);
}

function proposeCategory() {
  const target = el("select", { "aria-label": "Type" }, ...CATEGORY_TARGETS.map(([id, title]) => el("option", { value: id }, title)));
  const name = el("input", { type: "text", maxlength: "60", placeholder: `Name (${CATEGORY_TARGETS[0][2]})`, "aria-label": "Name" });
  const field = el("select", { "aria-label": "Field" }, ...FIELDS.map(([id, title]) => el("option", { value: id, selected: id === "home_services" }, title)));
  const license = el("input", { type: "checkbox" });
  const professionOnly = el("div", { hidden: true }, el("label", {}, "Field", field),
    el("label", { class: "check-row" }, license, " Needs a license"),
    hint("If it needs a license, only freelancers with an approved license for it can offer it or respond to jobs for it."));
  target.addEventListener("change", () => {
    name.placeholder = `Name (${CATEGORY_TARGETS.find(([id]) => id === target.value)[2]})`;
    professionOnly.hidden = target.value !== "profession";
  });
  const note = el("textarea", { rows: "3", maxlength: "500", placeholder: "e.g. Several sellers asked for this", "aria-label": "Why" });
  const send = el("button", { type: "button" }, "Send");
  const error = errorBox(""); error.hidden = true;
  act(send, error, "categories", async () => {
    if (!name.value.trim()) throw new Error("Enter a name.");
    const isProfession = target.value === "profession";
    await rpc("propose_category", { target: target.value, name: name.value.trim(), field: isProfession ? field.value : null,
      license_required: isProfession && license.checked, note: note.value.trim() || null });
  });
  show(back("Propose a Category", "#categories"),
    decisionArea(el("label", {}, "Type", target), name, professionOnly, el("label", {}, "Why (optional)", note), error, el("div", { class: "actions" }, send)));
}

async function reviewCategory(id) {
  if (role !== "owner") { location.hash = "categories"; return; }
  if (!cache.proposals?.some((p) => p.id === id)) cache.proposals = (await rpc("category_proposals_list").catch(() => [])) ?? [];
  const p = cache.proposals.find((x) => x.id === id && x.status === "pending");
  if (!p) { show(back("Category Request", "#categories"), empty("tag", "Already decided", "This request isn't waiting anymore.")); return; }
  const note = noteBox();
  const approve = el("button", { type: "button" }, "Approve and Add to the App");
  const reject = el("button", { type: "button", class: "danger-button" }, "Don't Approve");
  needsNote(note, reject);
  const error = errorBox(""); error.hidden = true;
  const decide = (yes) => () => rpc("review_category_proposal", { proposal: id, approve: yes, note: note.value.trim() || null });
  act(approve, error, "categories", decide(true));
  act(reject, error, "categories", decide(false));
  show(back(p.name, "#categories"),
    group(kv("Type", targetName(p.target)), p.field ? kv("Field", fieldName(p.field)) : null,
      p.target === "profession" ? kv("Needs a license", p.license_required ? "Yes" : "No") : null,
      kv("Proposed by", at(p.proposer_username)), kv("When", dateTime(p.created_at))),
    p.note ? group(el("li", { class: "cell-pad" }, `“${p.note}”`)) : null,
    groupTitle("Note to the moderator"),
    decisionArea(note, error, el("div", { class: "actions" }, approve, reject)));
}

// --- Team and Super Admins (same rules as the app: seats 1–3, succession, elections) ------------------------------

const personName = (p) => p.username ? `@${p.username}` : (p.display_name ?? "Member");
const cleanUsername = (text) => (text ?? "").trim().replace(/^@+/, "").replace(/\s+/g, "");
const ACTIVITY = { approve: "approved a listing", suspend: "suspended someone", unsuspend: "lifted a suspension",
  add_owner: "added an owner", add_moderator: "added a moderator", remove_moderator: "removed a moderator" };
function activitySummary(e) {
  const who = e.moderator_username ? `@${e.moderator_username}` : "A moderator";
  const what = e.action === "remove" ? `removed a ${e.target_type}`
    : e.action === "dismiss" ? (e.target_type === "user" ? "dismissed reports about someone" : "dismissed a message report")
    : ACTIVITY[e.action] ?? `${e.action.replace(/_/g, " ")} (${e.target_type})`;
  return `${who} ${what}`;
}

async function team() {
  show(back("Team and Super Admins"), loading());
  const [t, activity] = await Promise.all([rpc("moderation_team_overview"), rpc("moderation_activity").catch(() => [])]);
  const isSA = t.my_seat != null;
  const isSA1 = t.my_seat === 1;
  const openSeats = [1, 2, 3].filter((seat) => !(t.super_admins ?? []).some((p) => p.seat === seat));
  const notice = el("p", { class: "status good", role: "status", hidden: true });
  const error = errorBox(""); error.hidden = true;
  // Runs an action, then reloads the page with a message (or shows the database's reason).
  const doIt = async (button, message, operation) => {
    error.hidden = true;
    button.disabled = true;
    try {
      const result = await operation();
      await team();
      const msg = typeof message === "function" ? message(result) : message;
      if (msg) { const n = root.querySelector(".status.good"); if (n) { n.textContent = msg; n.hidden = false; } }
    } catch (e) {
      if (e === CANCELLED) { button.disabled = false; return; }
      error.textContent = friendlyError(e); error.hidden = false; button.disabled = false;
    }
  };
  const sections = [notice, error];

  if (t.retirement) {
    const r = t.retirement;
    const buttons = [];
    if (isSA && !r.confirmed_by_me && (t.super_admins ?? []).some((p) => p.seat === t.my_seat && p.user_id !== r.retiree_id)) {
      const b = el("button", { type: "button" }, "Confirm Retirement");
      b.addEventListener("click", () => doIt(b, "Confirmed.", () => rpc("confirm_retirement", { request: r.id })));
      buttons.push(b);
    }
    if (isSA) {
      const b = el("button", { type: "button", class: "danger-button" }, "Cancel Retirement");
      b.addEventListener("click", () => doIt(b, "Retirement cancelled.", () => rpc("cancel_retirement", { request: r.id })));
      buttons.push(b);
    }
    sections.push(groupTitle("Retirement waiting for confirmation"),
      decisionArea(el("strong", {}, `@${r.retiree_username ?? "a Super Admin"} ${r.reason === "passed_away" ? "passed away" : "stepped down"}`),
        el("p", {}, `Confirmed by ${r.confirmations} of ${r.needed} surviving Super Admins.`), buttons.length ? el("div", { class: "actions" }, ...buttons) : null));
  }

  if (t.election) {
    const e = t.election;
    const tie = e.status === "tie";
    const candidates = tie && e.tied ? (t.moderators ?? []).filter((m) => e.tied.includes(m.user_id)) : (t.moderators ?? []);
    const rows = candidates.map((c) => {
      const extras = [];
      if (e.my_vote === c.user_id) extras.push(el("span", { class: "state good" }, "Your vote"));
      if (isSA) extras.push(el("span", { class: "hint" }, `${e.tally?.[c.user_id] ?? 0} votes`));
      if (tie && isSA1) {
        const b = el("button", { type: "button" }, "Break Tie");
        b.addEventListener("click", () => doIt(b, `${personName(c)} is the new Super Admin ${e.seat}.`, () => rpc("break_super_admin_tie", { candidate: c.user_id })));
        extras.push(b);
      } else if (!tie && !isSA && role) {
        const b = el("button", { type: "button", class: "secondary", disabled: e.my_vote === c.user_id }, e.my_vote === c.user_id ? "Voted" : "Vote");
        b.addEventListener("click", () => doIt(b, `Your vote for ${personName(c)} is in.`, () => rpc("vote_for_super_admin", { candidate: c.user_id })));
        extras.push(b);
      }
      return el("li", { class: "cell-pad team-row" }, el("span", {}, personName(c)), ...extras);
    });
    const parts = [el("strong", {}, `Electing Super Admin ${e.seat}`), el("p", {}, e.reason),
      el("p", { class: "hint" }, `${e.votes_cast} of ${e.voters} moderators voted · closes ${dateOnly(e.closes_at)}`)];
    if (isSA && !tie) {
      const b = el("button", { type: "button" }, "Close Election and Count Votes");
      b.addEventListener("click", () => doIt(b, (result) => result === "tie" ? "It's a tie. Super Admin 1 breaks it."
        : result === "no_votes" ? "No votes yet; the election stays open." : `The new Super Admin ${e.seat} is seated.`, () => rpc("close_super_admin_election")));
      parts.push(el("div", { class: "actions" }, b));
    }
    sections.push(groupTitle(tie ? "Election tied: Super Admin 1 decides" : "Super Admin election"), decisionArea(...parts),
      group(...rows), hint(isSA ? "Super Admins don't vote. Close the election after 7 days or once every moderator has voted." : "1 vote per moderator. You can change your vote until the election closes."));
  }

  // Super Admins (seats 1–3)
  const saRows = [1, 2, 3].map((seat) => {
    const p = (t.super_admins ?? []).find((x) => x.seat === seat);
    const badge = el("span", { class: `seat-badge${seat === 1 ? " gold" : ""}`, "aria-label": `Seat ${seat}` }, String(seat));
    if (!p) return el("li", { class: "cell-pad team-row" }, badge, el("span", { class: "hint" }, "Empty"));
    const extras = [];
    if (p.seat === t.my_seat) extras.push(el("span", { class: "hint" }, "You"));
    if (isSA && p.seat !== t.my_seat && !t.retirement) {
      const b = el("button", { type: "button", class: "danger-button" }, "Retire");
      b.addEventListener("click", () => {
        // Same choice as the app: passed away or stepped down; every other surviving Super Admin then confirms.
        const passed = el("button", { type: "button", class: "danger-button" }, "They passed away");
        const stepped = el("button", { type: "button" }, "They stepped down");
        const cancel = el("button", { type: "button", class: "secondary" }, "Cancel");
        const choice = decisionArea(el("strong", {}, `Retire ${personName(p)}?`),
          el("p", { class: "hint" }, "Every other surviving Super Admin must confirm. Then everyone below moves up a seat and the moderators elect someone for the empty seat."),
          el("div", { class: "actions" }, passed, stepped, cancel));
        const start = (reason) => doIt(b, "Retirement started. The other Super Admins need to confirm.", () => rpc("start_retirement", { target: p.user_id, reason, note: null }));
        passed.addEventListener("click", () => start("passed_away"));
        stepped.addEventListener("click", () => start("stepped_down"));
        cancel.addEventListener("click", () => choice.remove());
        b.closest("ul").after(choice);
      });
      extras.push(b);
    }
    return el("li", { class: "cell-pad team-row" }, badge, el("span", { class: "row-title" }, personName(p)), ...extras);
  });
  sections.push(groupTitle("Super Admins"), group(...saRows));
  if (isSA1 && openSeats.length && !t.election) {
    const name = el("input", { type: "text", placeholder: "username to appoint", autocapitalize: "none", autocomplete: "off", spellcheck: "false", "aria-label": "Username to appoint" });
    const b = el("button", { type: "button", disabled: true }, `Appoint Super Admin ${openSeats[0]}`);
    name.addEventListener("input", () => { b.disabled = cleanUsername(name.value).length < 2; });
    b.addEventListener("click", () => doIt(b, `@${cleanUsername(name.value)} is now a Super Admin.`, () => rpc("appoint_super_admin", { target_username: cleanUsername(name.value) })));
    sections.push(decisionArea(name, el("div", { class: "actions" }, b)),
      hint("As Super Admin 1, you can appoint a verified member to an empty seat. They can manage moderators and, with the other Super Admins, keep Geerho running."));
  }

  // Moderators
  const modRows = (t.moderators ?? []).map((m) => {
    const extras = [];
    if (isSA) {
      const b = el("button", { type: "button", class: "secondary" }, "Remove");
      b.addEventListener("click", async () => {
        if (!(await confirmDialog(`Remove ${personName(m)}?`, "They'll no longer be able to moderate.", "Remove from Team", { danger: true }))) return;
        doIt(b, `${personName(m)} was removed.`, () => rpc("remove_moderator", { target: m.user_id }));
      });
      extras.push(b);
    }
    return el("li", { class: "cell-pad team-row" }, el("a", { href: `member.html?id=${encodeURIComponent(m.user_id)}` }, personName(m)), ...extras);
  });
  sections.push(groupTitle(`Moderators (${(t.moderators ?? []).length})`), modRows.length ? group(...modRows) : group(el("li", { class: "cell-pad hint" }, "No moderators yet")));
  if (isSA) {
    const name = el("input", { type: "text", placeholder: "username to add", autocapitalize: "none", autocomplete: "off", spellcheck: "false", "aria-label": "Username to add as a moderator" });
    const b = el("button", { type: "button", disabled: true }, "Add Moderator");
    name.addEventListener("input", () => { b.disabled = cleanUsername(name.value).length < 2; });
    b.addEventListener("click", () => doIt(b, `@${cleanUsername(name.value)} is now a moderator.`, () => rpc("add_moderator", { target_username: cleanUsername(name.value), new_role: "moderator" })));
    sections.push(decisionArea(name, el("div", { class: "actions" }, b)), hint("Moderators review reports, licenses, addresses, and level transfers."));
  }

  sections.push(groupTitle("How succession works"),
    hint("Super Admins hold seats 1, 2, and 3. Only Super Admin 1 appoints a Super Admin directly. If a Super Admin passes away or steps down, a surviving Super Admin starts their retirement and every other surviving Super Admin confirms it. Everyone below moves up a seat, and the moderators elect someone for the empty seat: 1 vote per regular moderator; Super Admins don't vote, except Super Admin 1 to break a tie."));
  if ((activity ?? []).length) {
    sections.push(groupTitle("Recent moderation activity"),
      group(...activity.slice(0, 30).map((e) => el("li", { class: "cell-pad" },
        el("span", { class: "row-stack" }, el("span", {}, activitySummary(e)), e.note ? el("span", { class: "hint" }, `“${e.note}”`) : null,
          el("span", { class: "hint" }, dateTime(e.created_at)))))));
  }
  show(back("Team and Super Admins"), ...sections);
}

// --- Owner: licenses by location and where real estate / freelance are available -----------------------------------

const US_STATES = [["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"],
  ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"],
  ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"],
  ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"],
  ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"], ["PR", "Puerto Rico"], ["GU", "Guam"], ["VI", "U.S. Virgin Islands"]];
/** Every country (ISO code → name), by name. */
const COUNTRIES = (() => {
  const list = [];
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    const name = (() => { try { return regionNames.of(code); } catch { return null; } })();
    if (name && name !== code && !/unknown/i.test(name)) list.push([code, name]);
  }
  return list.sort((x, y) => x[1].localeCompare(y[1]));
})();
const stateName = (code) => US_STATES.find(([c]) => c === code)?.[1] ?? code;
const placeName = (country, subdivision) => country ? (subdivision ? `${stateName(subdivision)}, ${countryName(country)}` : countryName(country)) : "Everywhere";

async function licenseRules() {
  if (role !== "owner") { location.hash = ""; return; }
  show(back("Licenses by Location"), loading());
  const [{ data: professions, error: e1 }, { data: rules, error: e2 }] = await Promise.all([
    supabase.from("professions").select().order("position"),
    supabase.from("profession_license_rules").select("profession, country, subdivision, license_required, note")]);
  if (e1 || e2) throw (e1 || e2);
  cache.professions = professions ?? [];
  const sections = [hint("Choose a kind of work to set whether it needs a license, everywhere or in a country or state. The most specific rule wins: state, then country, then everywhere.")];
  for (const [field, title] of FIELDS) {
    const here = (professions ?? []).filter((p) => p.field === field);
    if (!here.length) continue;
    sections.push(groupTitle(title), group(...here.map((p) => {
      const local = (rules ?? []).filter((r) => r.profession === p.slug).length;
      return linkRow(`#license-rule/${encodeURIComponent(p.slug)}`, p.name,
        `${p.license_required ? "Needs a license" : "No license needed"}${local ? ` · ${local} local ${local === 1 ? "rule" : "rules"}` : ""}`);
    })));
  }
  show(back("Licenses by Location"), ...sections);
}

async function licenseRule(slug) {
  if (role !== "owner") { location.hash = ""; return; }
  show(back("License Rule", "#license-rules"), loading());
  const [{ data: profession }, { data: rules }] = await Promise.all([
    supabase.from("professions").select().eq("slug", slug).maybeSingle(),
    supabase.from("profession_license_rules").select("profession, country, subdivision, license_required, note").eq("profession", slug)]);
  if (!profession) { show(back("License Rule", "#license-rules"), empty("seal", "Not found", "This kind of work doesn't exist anymore.")); return; }
  const error = errorBox(""); error.hidden = true;
  const save = async (params) => {
    error.hidden = true;
    try { await rpc("set_license_rule", { profession: slug, note: null, ...params }); await licenseRule(slug); }
    catch (e) { error.textContent = friendlyError(e); error.hidden = false; }
  };
  const everywhere = el("input", { type: "checkbox", checked: profession.license_required });
  everywhere.addEventListener("change", () => save({ country: null, subdivision: null, required: everywhere.checked }));
  const sorted = (rules ?? []).sort((a, b) => placeName(a.country, a.subdivision).localeCompare(placeName(b.country, b.subdivision)));
  const ruleRows = sorted.map((r) => {
    const remove = el("button", { type: "button", class: "secondary" }, "Remove");
    remove.addEventListener("click", () => save({ country: r.country, subdivision: r.subdivision, required: null }));
    return el("li", { class: "cell-pad team-row" }, el("span", { class: "row-stack" },
      el("span", { class: "row-title" }, placeName(r.country, r.subdivision)),
      el("span", { class: r.license_required ? "state warn" : "state good" }, r.license_required ? "License needed" : "No license needed"),
      r.note ? el("span", { class: "hint" }, r.note) : null), remove);
  });
  const country = el("select", { "aria-label": "Country" }, ...COUNTRIES.map(([c, n]) => el("option", { value: c, selected: c === "US" }, n)));
  const state = el("select", { "aria-label": "State" });
  const fillStates = () => {
    state.replaceChildren(el("option", { value: "" }, "Whole country"), ...(country.value === "US" ? US_STATES.map(([c, n]) => el("option", { value: c }, n)) : []));
    state.hidden = country.value !== "US";
  };
  country.addEventListener("change", fillStates); fillStates();
  const required = el("select", { "aria-label": "License" }, el("option", { value: "true" }, "Needed"), el("option", { value: "false" }, "Not needed"));
  const note = el("textarea", { rows: "2", maxlength: "500", placeholder: "Note (optional), e.g. the law or agency", "aria-label": "Note" });
  const add = el("button", { type: "button" }, "Save Rule");
  add.addEventListener("click", () => save({ country: country.value, subdivision: state.value || null, required: required.value === "true", note: note.value.trim() || null }));
  show(back(profession.name, "#license-rules"),
    groupTitle("Everywhere (default)"),
    group(el("li", { class: "cell-pad" }, el("label", { class: "check-row" }, everywhere, " Needs a license"))),
    hint("Used wherever there's no rule below."),
    groupTitle("Rules by place"),
    ruleRows.length ? group(...ruleRows) : group(el("li", { class: "cell-pad hint" }, "No local rules yet")),
    groupTitle("Add or change a rule"),
    decisionArea(el("label", {}, "Country", country), state, el("label", {}, "License", required), note, error, el("div", { class: "actions" }, add)));
}

async function featureRegions(feature, country) {
  if (role !== "owner") { location.hash = ""; return; }
  show(back("Where It's Available"), loading());
  const { data, error: loadError } = await supabase.from("feature_regions").select("feature, country, subdivision");
  if (loadError) throw loadError;
  const regions = (data ?? []).filter((r) => r.feature === feature);
  const has = (c, subdivision) => regions.some((r) => r.country === c && (r.subdivision ?? "") === subdivision);
  const statesOn = (c) => regions.filter((r) => r.country === c && r.subdivision).map((r) => r.subdivision);
  const summary = (c) => has(c, "") ? "Whole country" : statesOn(c).length ? `${statesOn(c).length} on` : "Off";
  const featureName = feature === "property" ? "real estate" : "freelance";
  const error = errorBox(""); error.hidden = true;
  // M153: one call replaces a country's rows. [] = off, [""] = whole country, else exactly those states.
  const setCountry = async (c, subdivisions, box) => {
    error.hidden = true; if (box) box.disabled = true;
    try { await rpc("set_feature_country", { feature, country: c, subdivisions }); await featureRegions(feature, country); }
    catch (e) { error.textContent = friendlyError(e); error.hidden = false; if (box) { box.checked = !box.checked; box.disabled = false; } }
  };
  const toggle = (title, onNow, change) => {
    const box = el("input", { type: "checkbox", checked: onNow });
    box.addEventListener("change", () => change(box));
    return el("li", { class: "cell-pad" }, el("label", { class: "check-row" }, box, ` ${title}`));
  };

  if (country) {
    // One country's states. With the whole country on, turning a state off keeps every other state on.
    const all = US_STATES.map(([c]) => c);
    const setState = (code, box) => {
      const chosen = new Set(has(country, "") ? all : statesOn(country));
      if (box.checked) chosen.add(code); else chosen.delete(code);
      setCountry(country, chosen.size === all.length ? [""] : [...chosen], box);
    };
    const allButton = el("button", { type: "button", class: "link-button" }, "All");
    allButton.addEventListener("click", () => setCountry(country, [""]));
    const noneButton = el("button", { type: "button", class: "link-button" }, "None");
    noneButton.addEventListener("click", () => setCountry(country, []));
    show(back(countryName(country), `#regions/${feature}`), error,
      group(toggle(`All of ${countryName(country)}`, has(country, ""), (box) => setCountry(country, box.checked ? [""] : [], box))),
      hint("When this is on, every state is included. Turn a state off below to choose states one by one."),
      groupTitle("States"), el("p", { class: "hint" }, allButton, " · ", noneButton),
      group(...US_STATES.map(([c, n]) => toggle(n, has(country, "") || has(country, c), (box) => setState(c, box)))));
    return;
  }

  const switcher = el("div", { class: "segmented", role: "group", "aria-label": "Feature" },
    ...[["property", "Real estate"], ["freelance", "Freelance"]].map(([id, title]) => {
      const b = el("button", { type: "button", "aria-pressed": String(id === feature) }, title);
      b.addEventListener("click", () => { location.hash = `regions/${id}`; });
      return b;
    }));
  // On now: one row per country; uncheck to turn it off (asks first); the US opens its states.
  const onNowRow = (c) => {
    const li = el("li", { class: "cell-pad" });
    const box = el("input", { type: "checkbox", checked: true, "aria-label": `Turn off ${countryName(c)}` });
    const render = () => {
      const states = c === "US" ? el("a", { href: `#regions/${feature}/${c}` }, `${summary(c)} ›`) : null;
      li.replaceChildren(el("label", { class: "check-row" }, box, ` ${countryName(c)}`), states ? " · " : "", states ?? "");
    };
    box.addEventListener("change", () => {
      const yes = el("button", { type: "button", class: "danger-button" }, "Turn Off");
      const no = el("button", { type: "button", class: "secondary" }, "Cancel");
      yes.addEventListener("click", () => setCountry(c, [], null));
      no.addEventListener("click", () => { box.checked = true; render(); });
      li.replaceChildren(`Turn off ${featureName} in ${countryName(c)}? New listings can't be posted there; listings already up stay up. `, yes, " ", no);
    });
    render();
    return li;
  };
  const onNow = [...new Set(regions.map((r) => r.country))].sort((a, b) => countryName(a).localeCompare(countryName(b)));
  const search = el("input", { type: "search", placeholder: "Search countries", "aria-label": "Search countries" });
  const list = group(...COUNTRIES.map(([code, name]) => code === "US"
    ? el("li", { class: "cell-pad" }, el("a", { href: `#regions/${feature}/US` }, `${name} · ${summary("US")} ›`))
    : toggle(name, has(code, ""), (box) => setCountry(code, box.checked ? [""] : [], box))));
  list.querySelectorAll(":scope > li").forEach((li, i) => { li.dataset.name = COUNTRIES[i][1].toLowerCase(); });
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    list.querySelectorAll(":scope > li").forEach((li) => { li.hidden = q && !li.dataset.name.includes(q); });
  });
  show(back("Where It's Available"), switcher,
    hint(feature === "property" ? "Where people may list homes for rent and for sale." : "Where people may offer services and post jobs."),
    error,
    groupTitle("On now"),
    onNow.length ? group(...onNow.map(onNowRow)) : group(el("li", { class: "cell-pad hint" }, "Nowhere yet")),
    hint("Uncheck a country to turn it off. Open United States to choose its states."),
    groupTitle("Countries"),
    decisionArea(search), list);
}

// --- One member, for moderators (the app's Moderator Tools card) ------------------------------------------------

const PEOPLE_REASONS = ["Scam or fraud", "Harassment or hate", "Fake account or impersonation", "Prohibited item", "Repeated rule violations", "Other"];
const USERNAME_REASONS = ["Offensive content", "Harassment or hate", "Fake account or impersonation", "Other"];

/** The app's ModerationActionSheet: a reason, a note for the log, and an optional message to the member. */
function actionForm({ title, explanation, reasons, actionTitle, template, perform, danger = true }) {
  const reason = el("select", { "aria-label": "Reason" }, ...reasons.map((r) => el("option", { value: r }, r)));
  const note = el("textarea", { rows: "2", maxlength: "500", placeholder: "Details for the moderation log (optional)", "aria-label": "Details" });
  const tell = el("input", { type: "checkbox", checked: true });
  const message = el("textarea", { rows: "5", maxlength: "5000", "aria-label": "Message" });
  const fill = () => { message.value = template(reason.value, note.value.trim()); };
  reason.addEventListener("change", fill); note.addEventListener("input", fill); fill();
  tell.addEventListener("change", () => { message.hidden = !tell.checked; });
  const go = el("button", { type: "button", class: danger ? "danger-button" : "" }, actionTitle);
  const error = errorBox(""); error.hidden = true;
  return { form: decisionArea(el("strong", {}, title), el("p", { class: "hint" }, explanation), el("label", {}, "Reason", reason), note,
    hint("Other moderators see this in the activity log."), el("label", { class: "check-row" }, tell, " Tell them why (recommended)"), message,
    hint("Sent from Geerho Support to their Inbox, where they can reply or appeal."), error, el("div", { class: "actions" }, go)),
    go, error, run: () => perform(reason.value, note.value.trim(), tell.checked ? message.value.trim() : null) };
}

async function person(id) {
  show(back("Member", "#people"), loading());
  const p = await rpc("admin_person", { target: id });
  if (!p) { show(back("Member", "#people"), empty("team", "Not found", "This account doesn't exist anymore.")); return; }
  const name = p.username ? `@${p.username}` : "this member";
  const notice = el("p", { class: "status good", role: "status", hidden: true });
  const area = el("div");
  const reload = async (message) => { await person(id); if (message) { const n = root.querySelector(".status.good"); n.textContent = message; n.hidden = false; } };
  const open = (form) => { area.replaceChildren(form); form.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const staffMessage = (body) => rpc("staff_open_ticket", { target: id, reason: "account", body, subject_kind: null, subject_id: null });

  const buttons = [];
  if (p.suspended) {
    const b = el("button", { type: "button" }, "Unsuspend");
    b.addEventListener("click", async () => {
      if (!(await confirmDialog(`Unsuspend ${name}?`, "They'll be able to list, buy, and message again.", "Unsuspend"))) return;
      try { await rpc("moderate_user", { target: id, decision: "unsuspend", note: null }); await reload("Suspension lifted."); }
      catch (e) { alertBox(b, friendlyError(e)); }
    });
    buttons.push(b);
  } else if (!p.is_moderator) {
    const b = el("button", { type: "button", class: "danger-button" }, "Suspend");
    b.addEventListener("click", () => {
      const f = actionForm({ title: `Suspend ${name}`, actionTitle: "Suspend Account", reasons: PEOPLE_REASONS,
        explanation: "They won't be able to publish listings, buy, or message anyone. They can still contact Geerho Support to appeal.",
        template: (r, n) => `Your Geerho account has been suspended for: ${r}.${n ? ` ${n}` : ""}\n\nWhile suspended, you can't publish listings, buy, or send messages. If you think this is a mistake, reply here and a moderator will review it.`,
        perform: async (r, n, m) => { await rpc("moderate_user", { target: id, decision: "suspend", note: [r, n].filter(Boolean).join(": ") }); if (m) await staffMessage(m); } });
      f.go.addEventListener("click", async () => { f.error.hidden = true; f.go.disabled = true;
        try { await f.run(); await reload(`${name} was suspended.`); } catch (e) { f.error.textContent = friendlyError(e); f.error.hidden = false; f.go.disabled = false; } });
      open(f.form);
    });
    buttons.push(b);
  }
  if (!p.is_moderator) {
    const b = el("button", { type: "button", class: "secondary" }, "Rename Username");
    b.addEventListener("click", () => {
      const f = actionForm({ title: `Rename ${name}`, actionTitle: "Rename", reasons: USERNAME_REASONS,
        explanation: `Their username becomes a neutral one like @member_12345, and ${name} can't be used again by anyone. They can choose a new username right away.`,
        template: (r, n) => `We changed your username because it broke the Community Guidelines (${r}).${n ? ` ${n}` : ""}\n\nPlease choose a new one in Profile → Edit Profile → Username; you don't have to wait. If you think this is a mistake, reply here.`,
        perform: async (r, n, m) => { await rpc("moderator_rename_username", { member: id, reason: [r, n].filter(Boolean).join(": ") }); if (m) await staffMessage(m); } });
      f.go.addEventListener("click", async () => { f.error.hidden = true; f.go.disabled = true;
        try { await f.run(); await reload("Username changed."); } catch (e) { f.error.textContent = friendlyError(e); f.error.hidden = false; f.go.disabled = false; } });
      open(f.form);
    });
    buttons.push(b);
  }
  const msg = el("button", { type: "button", class: "secondary" }, "Message as Geerho Support");
  msg.addEventListener("click", () => {
    const topic = el("select", { "aria-label": "Topic" }, ...Object.entries(REASONS).map(([k, v]) => el("option", { value: k, selected: k === "account" }, v)));
    const body = el("textarea", { rows: "5", maxlength: "5000", placeholder: "Message", "aria-label": "Message" });
    const send = el("button", { type: "button" }, "Send");
    const error = errorBox(""); error.hidden = true;
    send.addEventListener("click", async () => {
      if (body.value.trim().length < 10) { error.textContent = "Please write at least 10 characters."; error.hidden = false; return; }
      send.disabled = true;
      try { await rpc("staff_open_ticket", { target: id, reason: topic.value, body: body.value.trim(), subject_kind: null, subject_id: null }); await reload("Message sent to their Inbox."); }
      catch (e) { error.textContent = friendlyError(e); error.hidden = false; send.disabled = false; }
    });
    open(decisionArea(el("strong", {}, `Message to ${name}`), el("label", {}, "Topic", topic), body,
      hint("It arrives in their Inbox from Geerho Support. They can reply there."), error, el("div", { class: "actions" }, send)));
  });
  buttons.push(msg);
  if (role === "owner") {
    const b = el("button", { type: "button", class: "secondary" }, "Remove Two-Step Verification");
    b.addEventListener("click", () => {
      const why = el("textarea", { rows: "2", maxlength: "500", placeholder: "Why (for the log)", "aria-label": "Why" });
      const go = el("button", { type: "button", class: "danger-button" }, "Remove");
      const error = errorBox(""); error.hidden = true;
      go.addEventListener("click", async () => {
        if (!why.value.trim()) { error.textContent = "Say why, for the log."; error.hidden = false; return; }
        go.disabled = true;
        const { data, error: e } = await supabase.functions.invoke("mfa-recover", { body: { action: "admin_remove", member: id, note: why.value.trim() } });
        if (e || data?.error) { error.textContent = data?.error ?? friendlyError(e); error.hidden = false; go.disabled = false; return; }
        await reload("Two-step verification removed. They were notified.");
      });
      open(decisionArea(el("strong", {}, "Remove two-step verification?"),
        el("p", { class: "hint" }, "Only after an account recovery proved it's them (a lost phone and no recovery codes). They'll be notified, and it's logged."),
        why, error, el("div", { class: "actions" }, go)));
    });
    buttons.push(b);
  }

  show(back(name, "#people"), notice,
    group(kv("Username", p.username ? `@${p.username}` : "—"), kv("ID verified", p.verified ? "Yes" : "No"),
      kv("Status", p.suspended ? `Suspended${p.suspended_at ? ` since ${dateOnly(p.suspended_at)}` : ""}` : "Active"),
      p.is_moderator ? kv("Role", "Moderator") : null,
      p.founding_number ? kv("Founding Member", `#${p.founding_number}`) : null,
      kv("Joined", dateOnly(p.created_at)), kv("Last active", p.last_active_at ? relative(p.last_active_at) : "—")),
    group(kv("Listings", `${p.live_listings} live · ${p.removed_listings} removed · ${p.sold_count} sold · ${p.bought_count} bought`),
      kv("Reports and support", `${p.open_reports} open ${p.open_reports === 1 ? "report" : "reports"} · ${p.tickets_count} support ${p.tickets_count === 1 ? "request" : "requests"}`)),
    group(linkRow(`member.html?id=${encodeURIComponent(id)}`, "View Public Profile")),
    groupTitle("Moderator tools"),
    el("div", { class: "actions wrap-actions" }, ...buttons), area);
}

// --- Business Calendar (M152): deadlines for Geerho Tech LLC; staff see it, Super Admins mark done -------------------
const CAL_CATEGORIES = { tax_federal: ["Federal tax", "blue"], tax_state: ["California tax", "orange"], filing: ["Filing", "purple"], renewal: ["Renewal", "teal"], other: ["Other", "gray"] };
let calShowDone = false;
// --- Shared Pages (M157): Super Admins write; anyone with the link reads unless private ----------------------------

const pageURL = (token) => `${location.origin}/page.html?p=${token}`;

async function sharedPages(id) {
  if (role !== "owner") { location.hash = ""; return; }
  show(back("Shared Pages"), loading());
  const pages = await rpc("shared_pages_list");
  if (id) return pageEditor(id === "new" ? null : pages.find((p) => p.id === id));
  const add = el("button", { type: "button", class: "button" }, "New Page");
  add.addEventListener("click", () => { location.hash = "pages/new"; });
  show(back("Shared Pages"),
    hint("Write a page and share its link. Anyone with the link can read it, signed in or not, unless you tick Private; then only Super Admins can open it. Pages aren't listed or searchable anywhere."),
    el("div", { class: "btn-row" }, add),
    pages.length ? group(...pages.map((p) => el("li", {}, el("a", { class: "item-row", href: `#pages/${p.id}` },
      el("span", { class: "row-title" }, el("strong", {}, p.title),
        el("small", {}, `${p.is_private ? "Private" : "Anyone with the link"} · updated ${dateOnly(p.updated_at)}`)))))) : hint("No pages yet."));
}

function pageEditor(page) {
  const title = el("input", { id: "page-title", maxlength: "160", placeholder: "Title", value: page?.title ?? "", "aria-label": "Title" });
  const body = el("textarea", { id: "page-body", placeholder: "# Heading\nText…\n- [ ] A checklist item\n  A note under it", "aria-label": "Page text (Markdown)" });
  body.value = page?.body ?? "";
  const priv = el("input", { type: "checkbox", id: "page-private", checked: Boolean(page?.is_private) });
  const preview = el("div", { class: "shared-page" });
  const refresh = () => preview.replaceChildren(el("h1", {}, title.value || "Untitled"), renderMarkdown(body.value));
  title.addEventListener("input", refresh); body.addEventListener("input", refresh); refresh();
  const err = el("p", { class: "status bad", role: "alert", hidden: true });
  const linkLine = el("p", { class: "hint" });
  const showLink = (token) => {
    if (!token) return linkLine.replaceChildren("Save to get the link.");
    const url = pageURL(token);
    const copy = el("button", { type: "button", class: "link-button" }, "Copy link");
    copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(url); copy.textContent = "Copied"; } catch { copy.textContent = "Select the link to copy it"; } });
    linkLine.replaceChildren(el("a", { href: url, target: "_blank", rel: "noopener" }, url), " ", copy);
  };
  showLink(page?.token);
  const save = el("button", { type: "button", class: "button" }, "Save");
  save.addEventListener("click", async () => {
    err.hidden = true; save.disabled = true;
    try {
      const token = await rpc("save_shared_page", { page: page?.id ?? null, title: title.value.trim(), body: body.value, is_private: priv.checked });
      if (!page) { const list = await rpc("shared_pages_list"); location.hash = `pages/${list.find((p) => p.token === token)?.id ?? ""}`; return; }
      page = { ...page, token }; showLink(token); save.textContent = "Saved"; setTimeout(() => { save.textContent = "Save"; }, 1500);
    } catch (e) { err.textContent = friendlyError(e); err.hidden = false; }
    save.disabled = false;
  });
  const remove = page ? el("button", { type: "button", class: "danger-button" }, "Delete Page") : null;
  remove?.addEventListener("click", async () => {
    if (!(await confirmDialog("Delete this page?", "The link stops working for everyone.", "Delete", { danger: true }))) return;
    try { await rpc("delete_shared_page", { page: page.id }); location.hash = "pages"; } catch (e) { err.textContent = friendlyError(e); err.hidden = false; }
  });
  show(back(page ? "Edit Page" : "New Page", "#pages"),
    el("div", { class: "form-stack page-editor" }, title, body,
      el("label", { class: "check-row", for: "page-private" }, priv, " Private (only Super Admins can open the link)"),
      el("div", { class: "btn-row" }, save, remove), err, linkLine),
    hint("Markdown: # heading, **bold**, *italic*, [text](https://…), - list, 1. list, - [ ] checklist (an indented line under an item adds a note), > quote, --- line."),
    groupTitle("Preview"), preview);
}

async function businessCalendar() {
  show(back("Business Calendar"), loading());
  const c = await rpc("business_calendar");
  const err = el("p", { class: "status bad", role: "alert", hidden: true });
  const run = async (fn) => { try { await fn(); businessCalendar(); } catch (e) { err.textContent = friendlyError(e); err.hidden = false; } };
  const pretty = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const monthOf = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const row = (e) => {
    const done = !!e.done_at;
    const [catTitle] = CAL_CATEGORIES[e.category] ?? ["Other"];
    const actions = [];
    if (c.can_edit) {
      const b = el("button", { type: "button", class: "link-button" }, done ? "Mark not done" : "Mark done");
      b.addEventListener("click", () => run(() => rpc("business_event_done", { event: e.id, done: !done })));
      actions.push(b);
      if (!e.auto) {
        const d = el("button", { type: "button", class: "link-button" }, "Delete");
        d.addEventListener("click", () => run(() => rpc("delete_business_event", { event: e.id })));
        actions.push(" ", d);
      }
    }
    return el("li", { class: "kv" },
      el("span", { class: "kv-label" }, el("strong", {}, `${done ? "✓ " : ""}${e.title}`), el("br"),
        el("span", { class: !done && e.due_on < c.today ? "danger-text" : "hint" }, `${pretty(e.due_on)} · ${catTitle}`),
        e.description ? el("br") : null, e.description ? el("span", { class: "hint" }, e.description) : null,
        done && e.done_by ? el("span", { class: "hint" }, ` · Done by ${e.done_by}`) : null),
      el("span", { class: "kv-value" }, ...actions));
  };
  const open = c.events.filter((e) => !e.done_at);
  const overdue = open.filter((e) => e.due_on < c.today);
  const upcoming = open.filter((e) => e.due_on >= c.today);
  const months = [...new Set(upcoming.map((e) => monthOf(e.due_on)))];
  const parts = [];
  if (overdue.length) parts.push(groupTitle("Overdue"), group(...overdue.map(row)));
  for (const m of months) parts.push(groupTitle(m), group(...upcoming.filter((e) => monthOf(e.due_on) === m).map(row)));
  if (!open.length) parts.push(hint("Nothing coming up."));
  let addForm = null;
  if (c.can_edit) {
    const title = el("input", { placeholder: "What, e.g. Renew geerho.com", maxlength: "160", "aria-label": "Event" });
    const due = el("input", { type: "date", "aria-label": "Due" });
    const cat = el("select", { "aria-label": "Kind" }, ...Object.entries(CAL_CATEGORIES).map(([k, [t]]) => el("option", { value: k }, t)));
    const note = el("input", { placeholder: "Note (optional)", maxlength: "1000", "aria-label": "Note" });
    const add = el("button", { type: "button", class: "button" }, "Add event");
    add.addEventListener("click", () => run(() => rpc("add_business_event", { title: title.value.trim(), due_on: due.value, category: cat.value, description: note.value.trim() || null })));
    addForm = [groupTitle("Add an event"), el("div", { class: "form-stack" }, title, due, cat, note, add)];
  }
  const toggle = el("button", { type: "button", class: "button secondary" }, calShowDone ? "Hide done" : "Show done");
  toggle.addEventListener("click", () => { calShowDone = !calShowDone; businessCalendar(); });
  show(back("Business Calendar"), err, ...parts, ...(addForm ?? []), el("div", { class: "btn-row" }, toggle),
    calShowDone ? [groupTitle("Done"), group(...c.events.filter((e) => e.done_at).map(row))] : [],
    hint(c.can_edit ? "Deadlines for Geerho Tech LLC are added automatically (federal and California taxes, filings, renewals). A reminder list, not tax advice: your CPA confirms which apply." : "Super Admins mark items done. Deadlines are added automatically."));
}

// --- Company Books (M151, Super Admin 1 only) ---------------------------------------------------------------------
// Geerho Tech LLC's expenses and income for Geerho, Xenpen and Klean, like the apps' Company Books screen. Every
// read and write goes through books_* functions that check Super Admin 1 on the server; receipts are in a private
// bucket only Super Admin 1 can read. Bookkeeping for the CPA, not a tax filing.

const BOOKS_CATEGORIES = { advertising: "Advertising", car: "Car and truck", contract_labor: "Contract labor", insurance: "Insurance",
  legal_professional: "Legal and professional", office: "Office expense", rent: "Rent or lease", repairs: "Repairs and maintenance",
  supplies: "Supplies", taxes_licenses: "Taxes and licenses", travel: "Travel", meals: "Meals (50% deductible)", utilities: "Utilities",
  software: "Software and subscriptions", phone_internet: "Phone and internet", bank_fees: "Bank fees", processing_fees: "Payment processing fees",
  education: "Education and training", equipment: "Equipment", other: "Other" };
const BOOKS_APPS = { company: "Geerho Tech LLC", geerho: "Geerho", xenpen: "Xenpen", klean: "Klean" };
const BOOKS_KINDS = { sale: "Sale", commission: "Commission", subscription: "Subscription", fee: "Fee", refund: "Refund", dispute: "Dispute",
  transfer: "Passed to seller", processing_fee: "Processing fee", payout: "Payout to bank", adjustment: "Adjustment", other: "Other" };
const booksState = { period: "month", anchor: new Date(), tab: "expenses", note: null };
const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const options = (map, selected) => Object.entries(map).map(([v, t]) => el("option", { value: v, ...(v === selected ? { selected: "" } : {}) }, t));

async function books() {
  show(back("Company Books"), loading());
  if (!(await rpc("books_is_owner").catch(() => false))) { location.hash = ""; return; }
  const st = booksState;
  const r = await rpc("books_report", { period: st.period, anchor: ymd(st.anchor) });
  const reload = () => books();
  const err = el("p", { class: "status bad", role: "alert", hidden: true });
  const fail = (e) => { err.textContent = friendlyError(e); err.hidden = false; };

  const periodSel = el("select", { "aria-label": "Period" }, ...options({ month: "Month", quarter: "Quarter", year: "Year" }, st.period));
  periodSel.addEventListener("change", () => { st.period = periodSel.value; reload(); });
  const step = (dir) => {
    const d = new Date(st.anchor);
    if (st.period === "year") d.setFullYear(d.getFullYear() + dir); else d.setMonth(d.getMonth() + (st.period === "quarter" ? 3 : 1) * dir);
    st.anchor = d; reload();
  };
  const prev = el("button", { type: "button", class: "button secondary" }, "‹ Previous");
  const next = el("button", { type: "button", class: "button secondary" }, "Next ›");
  prev.addEventListener("click", () => step(-1)); next.addEventListener("click", () => step(1));
  const sync = el("button", { type: "button", class: "button" }, "Sync with Stripe and Mercury");
  sync.addEventListener("click", async () => {
    sync.disabled = true; sync.textContent = "Syncing…";
    try {
      const { data, error } = await supabase.functions.invoke("books", { body: { action: "sync", since: `${st.anchor.getFullYear()}-01-01` } });
      if (error) throw error;
      st.note = `Stripe: ${data.imported} new of ${data.checked} (${(data.accounts ?? []).join(", ")}).` +
        (data.mercury ? ` Mercury: ${data.mercury.expenses} expenses, ${data.mercury.owner_moves} owner entries (${data.mercury.checked} checked).` : "");
      reload();
    } catch (e) { fail(e); sync.disabled = false; sync.textContent = "Sync with Stripe and Mercury"; }
  });

  const summaries = (r.currencies ?? []).map((c) => {
    const m = (v) => money(Number(v ?? 0), c.currency).replace(/^Free$/, money(0, c.currency));
    const isUsd = c.currency === "USD";
    const ded = isUsd ? Number(r.mileage.deduction_cents) + Number(r.home_office_cents) : 0;
    const profit = Number(c.net_revenue_cents) - Number(c.expenses_cents) - ded;
    return [groupTitle(c.currency), group(
      kv("Money in", m(c.money_in_cents)), kv("Refunds and disputes", `−${m(c.refunds_cents)}`),
      kv("Passed to sellers", `−${m(c.passed_to_sellers_cents)}`), kv("Payment processing fees", `−${m(c.processing_fees_cents)}`),
      kv("Net revenue", m(c.net_revenue_cents)), kv("Expenses (business share)", `−${m(c.expenses_cents)}`),
      isUsd && Number(r.mileage.deduction_cents) > 0 ? kv(`Mileage (${r.mileage.miles} mi)`, `−${m(r.mileage.deduction_cents)}`) : null,
      isUsd && Number(r.home_office_cents) > 0 ? kv("Home office (simplified)", `−${m(r.home_office_cents)}`) : null,
      kv("Profit", m(profit))),
      Number(c.payouts_cents) ? hint(`Paid out to the bank: ${m(c.payouts_cents)}`) : null];
  });

  const tabBtns = el("div", { class: "segmented" }, ...[["expenses", "Expenses"], ["income", "Income"], ["mileage", "Mileage"], ["owner", "Owner"], ["settings", "Settings"]].map(([v, t]) => {
    const b = el("button", { type: "button", "aria-pressed": String(v === st.tab) }, t);
    b.addEventListener("click", () => { st.tab = v; reload(); });
    return b;
  }));
  const del = (fn, param, id, label = "Delete") => {
    const b = el("button", { type: "button", class: "link-button" }, label);
    b.addEventListener("click", async () => { try { await rpc(fn, { [param]: id }); reload(); } catch (e) { fail(e); } });
    return b;
  };
  let body = [];
  if (st.tab === "expenses") {
    const date = el("input", { type: "date", value: ymd(new Date()), "aria-label": "Date" });
    const vendor = el("input", { placeholder: "Vendor, e.g. Apple, Supabase", maxlength: "120", "aria-label": "Vendor" });
    const cat = el("select", { "aria-label": "Category" }, ...options(BOOKS_CATEGORIES, "software"));
    const amount = el("input", { type: "number", step: "0.01", min: "0.01", placeholder: "Amount", "aria-label": "Amount" });
    const cur = el("select", { "aria-label": "Currency" }, ...options({ USD: "USD", PHP: "PHP" }, "USD"));
    const app = el("select", { "aria-label": "For" }, ...options(BOOKS_APPS, "company"));
    const pct = el("input", { type: "number", min: "1", max: "100", value: "100", "aria-label": "Business use %" });
    const note = el("input", { placeholder: "Note (optional)", maxlength: "500", "aria-label": "Note" });
    const file = el("input", { type: "file", accept: "image/jpeg,image/png,image/heic,application/pdf", "aria-label": "Receipt" });
    const save = el("button", { type: "button", class: "button" }, "Add expense");
    save.addEventListener("click", async () => {
      const cents = Math.round(parseFloat(amount.value) * 100);
      if (!(cents > 0) || !vendor.value.trim()) { fail(new Error("Enter the vendor and amount.")); return; }
      save.disabled = true;
      try {
        let path = null;
        const f = file.files?.[0];
        if (f) {
          if (f.size > 10 * 1024 * 1024) throw new Error("The receipt is over 10 MB.");
          const ext = { "image/png": "png", "image/heic": "heic", "application/pdf": "pdf" }[f.type] ?? "jpg";
          path = `${crypto.randomUUID()}.${ext}`;
          const { error } = await supabase.storage.from("books-receipts").upload(path, f, { contentType: f.type || "image/jpeg" });
          if (error) throw error;
        }
        await rpc("books_save_expense", { expense: null, spent_on: date.value, vendor: vendor.value.trim(), category: cat.value, amount_cents: cents,
          currency: cur.value, app: app.value, business_pct: Number(pct.value) || 100, note: note.value.trim() || null, receipt_path: path });
        reload();
      } catch (e) { fail(e); save.disabled = false; }
    });
    body = [groupTitle("Add an expense"), el("div", { class: "form-stack" }, date, vendor, cat, amount, cur, app,
      el("label", {}, "Business use %", pct), note, el("label", {}, "Receipt (photo or PDF, optional)", file), save),
      groupTitle(`Expenses · ${r.label}`),
      (r.expenses ?? []).length ? group(...r.expenses.map((e) => el("li", { class: "kv" },
        el("span", { class: "kv-label" }, `${e.vendor} · ${[e.spent_on, BOOKS_CATEGORIES[e.category], BOOKS_APPS[e.app], e.source === "mercury" ? "Mercury" : null, e.business_pct < 100 ? `${e.business_pct}% business` : null].filter(Boolean).join(" · ")}`,
          e.needs_review ? el("strong", { class: "warn-text" }, " · Check category (in the app)") : null),
        el("span", { class: "kv-value" }, money(Number(e.amount_cents), e.currency), " ",
          e.receipt_path ? (() => { const b = el("button", { type: "button", class: "link-button" }, "Receipt");
            b.addEventListener("click", async () => { const { data } = await supabase.storage.from("books-receipts").createSignedUrl(e.receipt_path, 300); if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener"); });
            return b; })() : null, " ", del("books_delete_expense", "expense", e.id))))) : hint("No expenses in this period.")];
  } else if (st.tab === "income") {
    const date = el("input", { type: "date", value: ymd(new Date()), "aria-label": "Date" });
    const app = el("select", { "aria-label": "App" }, ...options(BOOKS_APPS, "geerho"));
    const kind = el("select", { "aria-label": "Kind" }, ...options(BOOKS_KINDS, "sale"));
    const source = el("select", { "aria-label": "Source" }, ...options({ manual: "By hand", paymongo: "PayMongo", apple: "App Store", google: "Google Play" }, "manual"));
    const amount = el("input", { type: "number", step: "0.01", min: "0.01", placeholder: "Amount", "aria-label": "Amount" });
    const cur = el("select", { "aria-label": "Currency" }, ...options({ USD: "USD", PHP: "PHP" }, "USD"));
    const out = el("input", { type: "checkbox", "aria-label": "Money out" });
    const fee = el("input", { type: "number", step: "0.01", min: "0", placeholder: "Processing fee (optional)", "aria-label": "Fee" });
    const desc = el("input", { placeholder: "Description (optional)", maxlength: "300", "aria-label": "Description" });
    const save = el("button", { type: "button", class: "button" }, "Add income");
    save.addEventListener("click", async () => {
      const cents = Math.round(parseFloat(amount.value) * 100);
      if (!(cents > 0)) { fail(new Error("Enter an amount.")); return; }
      try {
        await rpc("books_add_income", { occurred_on: date.value, app: app.value, kind: kind.value, amount_cents: out.checked ? -cents : cents,
          currency: cur.value, description: desc.value.trim() || null, source: source.value, fee_cents: Math.round((parseFloat(fee.value) || 0) * 100) });
        reload();
      } catch (e) { fail(e); }
    });
    body = [groupTitle("Add income by hand (PayMongo, App Store, …)"), el("div", { class: "form-stack" }, date, app, kind, source, amount, cur,
      el("label", {}, out, " Money out (refund, fee, payout)"), fee, desc, save),
      groupTitle(`Income · ${r.label}`),
      (r.income ?? []).length ? group(...r.income.map((i) => el("li", { class: "kv" },
        el("span", { class: "kv-label" }, `${BOOKS_KINDS[i.kind] ?? i.kind}${i.is_test ? " (test)" : ""} · ${[i.occurred_at.slice(0, 10), BOOKS_APPS[i.app], i.source, Number(i.fee_cents) ? `fee ${money(Number(i.fee_cents), i.currency)}` : null, i.description].filter(Boolean).join(" · ")}`),
        el("span", { class: "kv-value" }, money(Number(i.amount_cents), i.currency).replace(/^Free$/, "0"), " ", del("books_delete_income", "income", i.id, "Hide"))))) : hint("No income in this period. Use Sync with Stripe.")];
  } else if (st.tab === "mileage") {
    const date = el("input", { type: "date", value: ymd(new Date()), "aria-label": "Date" });
    const miles = el("input", { type: "number", step: "0.1", min: "0.1", placeholder: "Miles", "aria-label": "Miles" });
    const purpose = el("input", { placeholder: "Purpose, e.g. Bank, laundromat supplies", maxlength: "200", "aria-label": "Purpose" });
    const from = el("input", { placeholder: "From (optional)", maxlength: "120", "aria-label": "From" });
    const to = el("input", { placeholder: "To (optional)", maxlength: "120", "aria-label": "To" });
    const save = el("button", { type: "button", class: "button" }, "Add trip");
    save.addEventListener("click", async () => {
      try {
        await rpc("books_save_trip", { trip: null, driven_on: date.value, miles: parseFloat(miles.value), purpose: purpose.value.trim(),
          from_place: from.value.trim() || null, to_place: to.value.trim() || null });
        reload();
      } catch (e) { fail(e); }
    });
    body = [groupTitle("Add a business trip"), el("div", { class: "form-stack" }, date, miles, purpose, from, to, save),
      groupTitle(`Mileage · ${r.label}`),
      (r.trips ?? []).length ? group(...r.trips.map((t) => el("li", { class: "kv" },
        el("span", { class: "kv-label" }, `${t.purpose} · ${[t.driven_on, t.from_place, t.to_place].filter(Boolean).join(" · ")}`),
        el("span", { class: "kv-value" }, `${t.miles} mi `, del("books_delete_trip", "trip", t.id))))) : hint("No trips in this period."),
      hint("Log each business drive (the IRS asks for date, miles and purpose).")];
  } else if (st.tab === "owner") {
    // M156: owner contributions and draws: the owner's own money moving, not income or expenses.
    const kind = el("select", { "aria-label": "Type" }, ...options({ contribution: "Put money in (contribution)", draw: "Take money out (draw)" }, "contribution"));
    const date = el("input", { type: "date", value: ymd(new Date()), "aria-label": "Date" });
    const amount = el("input", { type: "number", step: "0.01", min: "0.01", placeholder: "Amount", "aria-label": "Amount" });
    const currency = el("select", { "aria-label": "Currency" }, ...options({ USD: "USD", PHP: "PHP" }, "USD"));
    const method = el("select", { "aria-label": "How" }, ...options({ bank: "Bank transfer", cash: "Cash", property: "Property (e.g. apps, equipment)", other: "Other" }, "bank"));
    const note = el("input", { placeholder: "Note, e.g. Opening deposit, Wells Fargo", maxlength: "500", "aria-label": "Note" });
    const save = el("button", { type: "button", class: "button" }, "Add");
    save.addEventListener("click", async () => {
      try {
        await rpc("books_save_owner_move", { move: null, moved_on: date.value, kind: kind.value, amount_cents: Math.round(parseFloat(amount.value) * 100),
          currency: currency.value, method: method.value, note: note.value.trim() || null });
        reload();
      } catch (e) { fail(e); }
    });
    const om = (v, c) => Number(v) ? money(Number(v), c) : (c === "PHP" ? "₱0.00" : "$0.00");
    const methodName = { bank: "Bank transfer", cash: "Cash", property: "Property", other: "Other" };
    body = [groupTitle("Owner money"),
      ...(r.owner ?? []).map((o) => group(kv(`Put in (${r.label})`, om(o.contributions_cents, o.currency)),
        kv(`Taken out (${r.label})`, om(o.draws_cents, o.currency)), kv("Owner's capital to date", om(o.balance_cents, o.currency)))),
      (r.owner ?? []).length ? null : hint("Nothing recorded yet."),
      hint("Money or property you put into Geerho Tech LLC (contributions) or take out for yourself (draws). It's your own money moving, so it isn't income or an expense and doesn't change profit."),
      groupTitle("Add money in or out"), el("div", { class: "form-stack" }, kind, date, amount, currency, method, note, save),
      groupTitle(r.label),
      (r.owner_moves ?? []).length ? group(...r.owner_moves.map((m) => el("li", { class: "kv" },
        el("span", { class: "kv-label" }, `${m.kind === "draw" ? "Draw" : "Contribution"} · ${[m.moved_on, methodName[m.method], m.note].filter(Boolean).join(" · ")}`),
        el("span", { class: "kv-value" }, `${m.kind === "draw" ? "−" : "+"}${money(Number(m.amount_cents), m.currency)} `, del("books_delete_owner_move", "move", m.id))))) : hint("Nothing in this period.")];
  } else {
    const s = r.settings;
    const rate = el("input", { type: "number", min: "0", max: "500", value: s.mileage_rate_cents ?? 70, "aria-label": "Mileage rate (cents/mile)" });
    const office = el("input", { type: "number", min: "0", value: s.office_sqft ?? "", placeholder: "e.g. 120", "aria-label": "Home office (sq ft)" });
    const home = el("input", { type: "number", min: "0", value: s.home_sqft ?? "", placeholder: "e.g. 1500", "aria-label": "Whole home (sq ft)" });
    const save = el("button", { type: "button", class: "button" }, "Save settings");
    save.addEventListener("click", async () => {
      try { await rpc("books_save_settings", { mileage_rate_cents: Number(rate.value) || 70, office_sqft: office.value ? Number(office.value) : null, home_sqft: home.value ? Number(home.value) : null }); st.note = "Settings saved."; reload(); }
      catch (e) { fail(e); }
    });
    body = [groupTitle("Settings"), el("div", { class: "form-stack" }, el("label", {}, "Mileage rate (cents/mile)", rate),
      el("label", {}, "Home office (sq ft)", office), el("label", {}, "Whole home (sq ft)", home), save),
      hint("Home office uses the IRS simplified method ($5 per sq ft, up to 300 sq ft a year) and shows in the Year view. Use the IRS standard mileage rate; check with your CPA.")];
  }

  // TJ (2026-10-23): the report as a printable page; the browser's print screen also saves it as a PDF.
  const printBtn = el("button", { type: "button", class: "button secondary" }, "Print or save as PDF");
  printBtn.addEventListener("click", async () => {
    const w = window.open("", "_blank");
    try {
      const { data, error } = await supabase.functions.invoke("books", { body: { action: "print", period: st.period, anchor: ymd(st.anchor) } });
      if (error || !data?.html) throw error ?? new Error(data?.error ?? "Couldn't prepare the page.");
      w.document.open(); w.document.write(data.html); w.document.close(); w.focus(); w.print();
    } catch (e) { w?.close(); fail(e); }
  });
  const csv = el("button", { type: "button", class: "button secondary" }, "Export for your CPA (CSV spreadsheet)");
  csv.addEventListener("click", () => {
    const q = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const a = (c) => (Number(c) / 100).toFixed(2);
    const lines = ["type,date,app,category_or_kind,description,amount,fee,currency,business_pct,source"];
    for (const e of r.expenses ?? []) lines.push(["expense", e.spent_on, e.app, e.category, q(`${e.vendor}${e.note ? ` — ${e.note}` : ""}`), a(e.amount_cents), "0", e.currency, e.business_pct, e.source ?? "manual"].join(","));
    for (const i of (r.income ?? []).filter((x) => !x.is_test)) lines.push(["income", i.occurred_at.slice(0, 10), i.app, i.kind, q(i.description), a(i.amount_cents), a(i.fee_cents), i.currency, "", i.source].join(","));
    for (const t of r.trips ?? []) lines.push(["mileage", t.driven_on, "company", "car", q(t.purpose), t.miles, "0", "MI", "100", "manual"].join(","));
    for (const m of r.owner_moves ?? []) lines.push([`owner_${m.kind}`, m.moved_on, "company", m.method, q(m.note), a(m.amount_cents), "0", m.currency, "", "manual"].join(","));
    const link = el("a", { href: URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })), download: `geerho-tech-llc-books-${r.label.replaceAll(" ", "-")}.csv` });
    document.body.append(link); link.click(); link.remove();
  });

  show(back("Company Books"),
    el("div", { class: "form-stack" }, periodSel, el("div", { class: "btn-row" }, prev, el("strong", {}, r.label), next), sync,
      (r.mercury_synced_at ?? r.stripe_synced_at) ? hint(`Last synced ${dateTime(r.mercury_synced_at ?? r.stripe_synced_at)}`) : null,
      Number(r.to_review) ? el("p", { class: "warn-text" }, `${r.to_review} Mercury expense${r.to_review == 1 ? "" : "s"} to check: open it in the Geerho app, pick the category, Save. The Books remember it for that vendor.`) : null,
      st.note ? el("p", { class: "status good" }, st.note) : null, err),
    ...summaries.flat(),
    Number(r.test_rows) ? hint(`${r.test_rows} Stripe test-mode transactions aren't counted.`) : null,
    tabBtns, ...body, el("div", { class: "btn-row" }, printBtn, csv),
    hint("Bookkeeping to share with your CPA, not a tax filing. Payouts move money to the bank; they aren't income."));
  st.note = null;
}

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
      case "waitlist": return await waitlist();
      case "handbook-quiz": return await handbookQuiz();
      case "handbook-progress": return await handbookProgress();
      case "commission": return commissionRate(Number(arg));
      case "reset": return await resetTestData();
      case "team": return await team();
      case "person": return await person(arg);
      case "license-rules": return await licenseRules();
      case "license-rule": return await licenseRule(decodeURIComponent(arg ?? ""));
      case "regions": return await featureRegions(arg || "property", location.hash.split("/")[2]);
      case "categories": return await categoryRequests();
      case "books": return await books();
      case "calendar": return await businessCalendar();
      case "pages": return await sharedPages(arg);
      case "propose": return proposeCategory();
      case "category": return await reviewCategory(arg);
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
