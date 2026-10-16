// Profile on geerho.com, drawn like the iPhone app's Profile tab (TJ 2026-10-14: "ios is our gold standard"):
// the verify card, the brand-gradient header with Edit Profile, Followers · Following · Contacts and Invite, then the
// same rows in the same order. Each row opens its screen here (account.html#bids, #purchases, …), with a
// "‹ Profile" back link, like the app's navigation. Settings is the gear, Edit Profile the header button.
import { el } from "./site.js";
import { friendlyError, supabase } from "./auth.js";
import { icon, rowIcon, verifiedBadge } from "./icons.js";

let me = null;
let myProfileRow = null;
let rerenderAccount = () => {};

/** The rows, top to bottom, exactly as in the app (ProfileTabView). [route or href, title, icon, tint]. */
const MAIN_ROWS = [
  ["listings", "My Listings", "tag", "orange"],
  ["go-live.html", "Go Live", "live", "red"],
  ["getpaid", "Get Paid", "dollar", "green"],
  ["plans.html", "Plan", "plan", "purple"],
  ["team", "Team", "team", "indigo"],
  ["requests", "Purchase Requests", "cart", "green"],
  ["bids", "My Bids", "hammer", "purple"],
  ["watching", "Watching", "eye", "indigo"],
  ["rentals", "Rentals", "wrench", "teal"],
  ["tours", "Home Tours", "calendar", "teal"],
  ["jobs", "Jobs and Quotes", "briefcase", "indigo"],
  ["purchases", "Purchases", "bag", "blue"],
  ["sales", "Sales", "trend", "teal"],
  ["favorites", "Favorites", "heart", "pink"],
];
const MORE_ROWS = [
  ["licenses", "Professional Licenses", "seal", "green"],
  ["milestone", "Milestone Level", "star", "indigo"],
  ["address", "Home Address", "house", "brown"],
  ["public", "View Public Profile", "person", "indigo"],
];

/** Avatar image, or initials on the brand gradient when there's no photo. */
export function avatar(url, name, size = 44) {
  if (url) return el("img", { class: "avatar", src: url, alt: "", width: size, height: size, style: `width:${size}px;height:${size}px` });
  const initials = (name || "?").replace(/^@/, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return el("span", { class: "avatar initials", "aria-hidden": "true", style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px` }, initials);
}

/** The star before a member's name: gold for Geerho Super Admins (M93), silver for verified
 *  beta testers (M90). One star at most; gold wins. */
export function memberStar(p) {
  if (p?.staff_badge_at) return el("span", { class: "member-star gold", title: "Geerho Super Admin", "aria-label": "Geerho Super Admin" }, "★");
  if (p?.beta_badge_at && p.verified_at) return el("span", { class: "member-star silver", title: "Geerho Beta Tester", "aria-label": "Beta Tester" }, "★");
  return null;
}
export const betaStar = memberStar;

/** A grouped-list row: colored icon, title, optional badge or value, chevron. */
export function navRow(target, title, iconName, tint, { badge = null, value = null } = {}) {
  const href = target.includes(".html") ? target : `#${target}`;
  return el("li", {}, el("a", { class: "row", href },
    rowIcon(iconName, tint),
    el("span", { class: "row-title" }, title),
    badge ? el("span", { class: "row-badge", "aria-label": `${badge} waiting` }, String(badge)) : null,
    value ? el("span", { class: "row-value" }, value) : null,
    icon("chevronRight", "chev")));
}

/** "‹ Profile" back link and a centered title, like a pushed screen in the app. */
export function screenHead(title, { back = "#", backLabel = "Profile", action = null } = {}) {
  return el("div", { class: "screen-head" },
    el("a", { class: "back", href: back }, icon("chevronLeft"), backLabel),
    el("h1", {}, title),
    action ? el("div", { class: "head-action" }, action) : null);
}

/** Settings → Moderation, like the app's: only for moderators and Super Admins. */
async function showModeration() {
  const { data: role } = await supabase.rpc("my_moderation_role");
  const box = document.getElementById("moderation-group");
  if (!box || !role) return;
  document.getElementById("moderation-title").textContent = role === "owner" ? "Moderation · Super Admin" : "Moderation";
  box.hidden = false;
  const { data: queue } = await supabase.rpc("moderation_queue");
  document.getElementById("review-count").textContent = queue?.length ? String(queue.length) : "";
}

async function counts(userId) {
  const now = new Date().toISOString();
  const [orders, rentals, tours, jobs, bids] = await Promise.all([
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("seller_id", userId).eq("status", "requested").gt("respond_by", now),
    supabase.from("rental_bookings").select("id", { count: "exact", head: true }).eq("owner_id", userId).eq("status", "requested"),
    supabase.from("tour_requests").select("id", { count: "exact", head: true }).eq("owner_id", userId).eq("status", "requested"),
    supabase.rpc("my_job_responses"),
    supabase.rpc("my_bids"),
  ]);
  const jobsWaiting = (jobs.data ?? []).filter((j) => j.poster_id === userId && j.status === "sent").length;
  return {
    requests: (orders.count ?? 0) + (rentals.count ?? 0) + (tours.count ?? 0) + jobsWaiting,
    bids: (bids.data ?? []).filter((b) => b.needs_checkout || b.my_status === "outbid").length,
  };
}

async function renderHub() {
  const hub = document.getElementById("profile-hub");
  const p = myProfileRow;
  const [{ data: rating }, { data: follows }, { data: fee }, verification] = await Promise.all([
    supabase.rpc("rating_summary", { target: p.id }),
    supabase.rpc("follow_summary", { member: p.id }),
    supabase.rpc("my_fee_status"),
    p.verified_at ? Promise.resolve({ data: [{ status: "verified" }] }) : supabase.from("identity_verifications").select("status").limit(1),
  ]);
  const r = Array.isArray(rating) ? rating[0] : rating;
  const f = fee?.[0];
  const badge = f?.founder ? "Founder" : f?.plan === "lifetime" ? "Owner · No fees for life" : f?.plan === "founding" ? `Founding Member #${f.founding_number ?? 0} · No commission` : null;
  const settings = el("a", { class: "icon-button", href: "#settings", "aria-label": "Settings" }, icon("gear"));

  const verified = verification.data?.[0]?.status === "verified";
  const card = el("div", { class: "profile-card" },
    el("div", { class: "who" },
      avatar(p.avatar_url, p.display_name || p.username, 72),
      el("div", {},
        el("span", { class: "name" }, memberStar(p), p.display_name || p.username, p.verified_at ? verifiedBadge(20) : null),
        el("p", { class: "handle" }, `@${p.username}`),
        p.milestone_level ? el("span", { class: "pill on-brand" }, `Level ${p.milestone_level}`) : null,
        el("span", { class: "pill white" }, r?.total
          ? [icon("star", "icon star-fill"), ` ${Number(r.average).toFixed(1)} (${r.total})`]
          : [icon("star"), " No reviews yet"]),
        p.city ? el("p", { class: "city" }, icon("pin"), p.city) : null)),
    badge ? el("span", { class: "pill on-brand" }, `★ ${badge}`) : null,
    p.bio ? el("p", { class: "bio" }, p.bio) : null,
    el("a", { class: "edit", href: "#edit" }, icon("pencil"), "Edit Profile"));

  const invite = el("button", { type: "button", class: "row link-row" }, rowIcon("invite", "accent"), el("span", { class: "row-title" }, "Invite to Geerho"));
  invite.addEventListener("click", () => inviteFriends(p.username, invite));
  const followGroup = el("ul", { class: "group" },
    follows ? el("li", { class: "plain" }, el("div", { class: "follow-bar" },
      ...[["followers", "Followers"], ["following", "Following"], ["contacts", "Contacts"]].map(([key, label]) =>
        el("a", { href: `#follows-${key}` }, el("strong", {}, String(follows[key] ?? 0)), el("span", {}, label))))) : null,
    el("li", { class: "plain" }, invite));

  const main = el("ul", { class: "group" }, MAIN_ROWS.map(([target, title, i, tint]) => navRow(target, title, i, tint)));
  const more = el("ul", { class: "group" }, MORE_ROWS.map(([target, title, i, tint]) =>
    navRow(target, title, i, tint, { value: target === "milestone" && p.milestone_level ? `Level ${p.milestone_level}` : null })));
  // Beta Testing (M90): only for invited testers and Super Admins.
  supabase.rpc("am_beta_member").then(({ data: isTester }) => {
    if (isTester) more.prepend(navRow("beta.html", "Beta Testing", "seal", "gray"));
  });

  hub.replaceChildren(...[
    el("div", { class: "title-row" }, el("h1", { class: "large-title" }, "Profile"), settings),
    verified ? null : el("a", { class: "verify-card", href: "#verify" }, icon("seal"),
      el("span", {}, el("strong", {}, "Verify your identity"), "Verify your identity to sell and message on Geerho.")),
    card, followGroup, main, more].filter(Boolean));

  // Badges, like the app (Purchase Requests waiting, My Bids needing attention).
  counts(p.id).then((c) => {
    const add = (route, n) => {
      if (!n) return;
      const link = main.querySelector(`a[href="#${route}"]`);
      link?.querySelector(".chev").before(el("span", { class: "row-badge", "aria-label": `${n} need attention` }, String(n)));
    };
    add("requests", c.requests);
    add("bids", c.bids);
  }).catch(() => {});
}

async function inviteFriends(username, button) {
  const text = "Hello,\n\nI'd like to invite you to join Geerho, a new online marketplace built on trust. Every member verifies their identity, "
    + "so it's one person, one account, which helps keep scammers out.\n\nWhether you want to buy and sell, browse real estate, rent tools, "
    + "or find jobs, nearby or remote, you can do it with peace of mind. We'd love to have you in our verified community."
    + (username ? `\n\nOnce you're in, follow me: @${username}` : "")
    + "\n\nTip: Geerho is in beta on Apple's TestFlight app. Open the link in Safari (not inside another app), install "
    + "TestFlight if asked, then tap Accept and Install. No code is needed."
    + "\n\nOn Android or a computer? Go to https://geerho.com/download.html"
    + "\n\niPhone: download it and check it out here: https://testflight.apple.com/join/VskGx1Jk";
  if (navigator.share) {
    try { await navigator.share({ title: "Join Geerho, the verified online marketplace", text }); } catch { /* closed */ }
    return;
  }
  await navigator.clipboard?.writeText(text).catch(() => {});
  const title = button.querySelector(".row-title");
  title.textContent = "Invitation copied. Paste it in a message.";
  setTimeout(() => { title.textContent = "Invite to Geerho"; }, 3000);
}

// --- Edit Profile -------------------------------------------------------------------------------------------

async function renderEdit() {
  const p = myProfileRow;
  const cell = document.getElementById("photo-cell");
  const file = el("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/heic", class: "sr-only", id: "pf-photo" });
  const status = el("p", { class: "status", role: "status" });
  cell.replaceChildren(el("div", { class: "who", style: "display:flex;gap:16px;align-items:center" },
    avatar(p.avatar_url, p.display_name || p.username, 80),
    el("div", {}, el("label", { for: "pf-photo", class: "button secondary", style: "cursor:pointer" }, "Change Photo"), file, status)));
  file.addEventListener("change", async () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    if (chosen.size > 10 * 1024 * 1024) { status.textContent = "Choose a photo smaller than 10 MB."; return; }
    status.textContent = "Uploading…";
    try {
      const jpeg = await squareJPEG(chosen);
      const path = `${me.id}/avatar-${crypto.randomUUID()}.jpg`;
      const bucket = supabase.storage.from("avatars");
      const { error } = await bucket.upload(path, jpeg, { contentType: "image/jpeg" });
      if (error) throw error;
      const url = bucket.getPublicUrl(path).data.publicUrl;
      const { error: saveError } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", me.id);
      if (saveError) throw saveError;
      const old = p.avatar_url?.split("/storage/v1/object/public/avatars/")[1];
      if (old) await bucket.remove([old]).catch(() => {});
      myProfileRow.avatar_url = url;
      status.textContent = "Photo updated.";
      renderEdit();
    } catch (problem) {
      status.textContent = "We couldn't upload your photo. Please try again.";
      console.warn(problem);
    }
  });

  const name = document.getElementById("pf-name");
  const bio = document.getElementById("pf-bio");
  const city = document.getElementById("pf-city");
  const count = document.getElementById("pf-bio-count");
  name.value = p.display_name ?? "";
  bio.value = p.bio ?? "";
  city.value = p.city ?? "";
  const showCount = () => { count.textContent = `${bio.value.length}/300`; };
  showCount();
  bio.oninput = showCount;
  const form = document.getElementById("profile-form");
  form.onsubmit = async (event) => {
    event.preventDefault();
    const out = document.getElementById("pf-status");
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    const changes = { display_name: name.value.trim() || null, bio: bio.value.trim() || null, city: city.value.trim() || null };
    const { error } = await supabase.from("profiles").update(changes).eq("id", me.id);
    button.disabled = false;
    out.className = error ? "status bad" : "status good";
    out.textContent = error ? friendlyError(error) : "Saved.";
    if (!error) Object.assign(myProfileRow, changes);
  };
}

/** Center-crops to a square and shrinks to 600 px, like the app does before uploading a profile photo. */
async function squareJPEG(file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(600, side);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.getContext("2d").drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("photo"))), "image/jpeg", 0.85));
}

// --- Navigation between Profile and its screens ----------------------------------------------------------------

async function route() {
  const name = decodeURIComponent(location.hash.slice(1));
  const hub = document.getElementById("profile-hub");
  const screen = document.getElementById("profile-screen");
  const edit = document.getElementById("edit-screen");
  const settings = document.getElementById("settings-screen");
  for (const part of [hub, screen, edit, settings]) part.hidden = true;
  window.scrollTo(0, 0);
  if (!name) {
    hub.hidden = false;
    document.title = "Profile · Geerho";
    await renderHub();
    return;
  }
  if (name === "edit") {
    edit.hidden = false;
    document.title = "Edit Profile · Geerho";
    renderEdit();
    return;
  }
  if (name === "settings" || name === "verify" || name === "security") {
    settings.hidden = false;
    document.title = "Settings · Geerho";
    const security = document.getElementById("security-cell");
    showModeration();
    import("./mfa.js").then(({ renderSecurity }) => renderSecurity(security))
      .then(() => { if (name === "security") security.scrollIntoView({ block: "start" }); });
    if (name === "verify") document.getElementById("verification").closest("li").scrollIntoView({ block: "center" });
    return;
  }
  screen.hidden = false;
  screen.replaceChildren(el("p", { class: "hint" }, "Loading…"));
  const { renderScreen } = await import("./profile-screens.js");
  await renderScreen(name, screen, { me, profile: myProfileRow }).catch((problem) => {
    screen.replaceChildren(screenHead("Profile"), el("p", { class: "status bad" }, friendlyError(problem)));
  });
}

export async function startProfile(user, profile, rerender) {
  me = user;
  rerenderAccount = rerender;
  const { data } = await supabase.from("profiles").select("id, username, display_name, avatar_url, bio, city, verified_at, milestone_level, beta_badge_at, staff_badge_at").eq("id", user.id).single();
  myProfileRow = data ?? profile;
  if (!startProfile.wired) {
    startProfile.wired = true;
    // The static Settings and Edit Profile screens get the app's chevrons and back arrow.
    for (const row of document.querySelectorAll("#settings-screen a.row")) row.append(icon("chevronRight", "chev"));
    for (const back of document.querySelectorAll("#settings-screen .back, #edit-screen .back")) back.replaceChildren(icon("chevronLeft"), "Profile");
    window.addEventListener("hashchange", route);
  }
  await route();
}
