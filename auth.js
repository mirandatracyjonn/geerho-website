// Signed-in features on the website: the same Supabase project, accounts, and database rules as the iPhone app.
// Everything a member can do here goes through the same checks as the app (row-level security and the
// database functions), so a web user can never do more than an app user.

import { SUPABASE_KEY, SUPABASE_URL, el } from "./site.js";

// vendor/supabase-js-2.117.2.js (copied from npm and checked against its published checksum) sets window.supabase.
// It's served from geerho.com, so no third-party server can change the code that handles sign-in.
const { createClient } = window.supabase;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export async function currentUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

export async function myProfile(userId) {
  const { data, error } = await supabase.from("profiles")
    .select("id, username, display_name, avatar_url, verified_at")
    .eq("id", userId).single();
  if (error) throw error;
  return data;
}

/** "unverified" | "in_progress" | "in_review" | "verified" | "declined" | "expired", plus attempts used. */
export async function verificationState() {
  const { data } = await supabase.from("identity_verifications").select("status, attempts, decline_reason").limit(1);
  return data?.[0] ?? { status: "unverified", attempts: 0 };
}

/** Sends the visitor to sign in, then back to this page. */
export function signInURL(next = location.pathname.split("/").pop() + location.search) {
  return `account.html?next=${encodeURIComponent(next || "index.html")}`;
}

/** Only same-site page names are accepted as a return address. */
export function safeNext(value) {
  return value && /^[a-z-]+\.html(\?[^#]*)?$/.test(value) ? value : null;
}

export async function signInWith(provider, next) {
  const redirectTo = new URL(`account.html${next ? `?next=${encodeURIComponent(next)}` : ""}`, location.href).href;
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      scopes: provider === "github" ? "read:user user:email" : undefined,
      // Ask which Google account every time, like the apps (people with more than one account).
      queryParams: provider === "google" ? { prompt: "select_account" } : undefined,
    },
  });
  if (error) throw error;
}

/** Plain-language versions of database errors (the database's own messages are already written for people). */
export function friendlyError(error) {
  const message = error?.message ?? "";
  if (/fetch|network/i.test(message)) return "We couldn't reach Geerho. Check your connection and try again.";
  return message || "Something went wrong. Please try again.";
}

/** Badges on the header, like the app's: the bell's unread count and the Inbox tab's unread chats and support replies. */
async function updateHeader() {
  if (!(await currentUser())) return;
  const bell = document.querySelector(".site-header .bell");
  const inbox = document.querySelector('.site-header .tab-bar a[data-tab="inbox"]');
  const [{ data: count }, { data: chats }, { data: tickets }] = await Promise.all([
    supabase.rpc("unread_notification_count"),
    supabase.rpc("my_conversations"),
    supabase.rpc("support_tickets_list", { staff_view: false, only_status: null }),
  ]);
  if (bell && count > 0 && !location.pathname.endsWith("notifications.html")) {
    bell.append(el("span", { class: "count" }, count > 99 ? "99+" : String(count)));
    bell.setAttribute("aria-label", `Notifications, ${count} new`);
  }
  const unread = (chats ?? []).reduce((sum, c) => sum + (c.unread_count ?? 0), 0) + (tickets ?? []).filter((t) => t.unread).length;
  if (inbox && unread > 0) {
    inbox.append(el("span", { class: "badge" }, unread > 99 ? "99+" : String(unread)));
    inbox.setAttribute("aria-label", `Inbox, ${unread} unread`);
  }
}

// Signed-in pages must never be shown inside another site's frame (clickjacking).
if (window.top !== window.self) window.top.location.replace(window.self.location.href);

updateHeader();

// Header menu: close it when tapping outside, pressing Escape, or choosing a page.
const menu = document.querySelector(".site-header details.menu");
if (menu) {
  document.addEventListener("click", (event) => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.open) {
      menu.open = false;
      menu.querySelector("summary").focus();
    }
  });
  menu.addEventListener("click", (event) => {
    if (event.target.closest("nav a")) menu.open = false;
  });
}

// Back to top: appears after scrolling down; glides up smoothly (about 0.7 s, eased), or jumps for reduced motion.
const toTop = document.createElement("button");
toTop.type = "button";
toTop.className = "to-top";
toTop.setAttribute("aria-label", "Back to top");
const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", width: "22", height: "22", "aria-hidden": "true", focusable: "false" })) arrow.setAttribute(key, value);
const arrowPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
for (const [key, value] of Object.entries({ d: "M12 19V5M5 12l7-7 7 7", fill: "none", stroke: "currentColor", "stroke-width": "2.5", "stroke-linecap": "round", "stroke-linejoin": "round" })) arrowPath.setAttribute(key, value);
arrow.append(arrowPath);
toTop.append(arrow);
document.body.append(toTop);
const showToTop = () => toTop.classList.toggle("shown", window.scrollY > 600);
window.addEventListener("scroll", showToTop, { passive: true });
showToTop();
toTop.addEventListener("click", () => {
  const start = window.scrollY;
  if (start === 0) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    window.scrollTo(0, 0);
  } else {
    const duration = Math.min(900, Math.max(500, start / 6)); // longer pages take a little longer, within 0.5–0.9 s
    const began = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // ease in-out
    const step = (now) => {
      const t = Math.min(1, (now - began) / duration);
      window.scrollTo(0, Math.round(start * (1 - ease(t))));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // Keyboard users continue from the top of the page.
  document.querySelector(".site-header .brand")?.focus({ preventScroll: true });
});
