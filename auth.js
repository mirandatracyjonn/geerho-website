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
    options: { redirectTo, scopes: provider === "github" ? "read:user user:email" : undefined },
  });
  if (error) throw error;
}

/** Plain-language versions of database errors (the database's own messages are already written for people). */
export function friendlyError(error) {
  const message = error?.message ?? "";
  if (/fetch|network/i.test(message)) return "We couldn't reach Geerho. Check your connection and try again.";
  return message || "Something went wrong. Please try again.";
}

/** Swaps the header's "Sign in" link for "Account" (and shows Messages) when someone is signed in. */
async function updateHeader() {
  const link = document.querySelector(".site-header a[data-account]");
  if (!link) return;
  const user = await currentUser();
  if (!user) return;
  link.textContent = "Account";
  if (!document.querySelector(".site-header a[href='messages.html']")) {
    const messages = el("a", { href: "messages.html" }, "Messages");
    if (location.pathname.endsWith("messages.html")) messages.setAttribute("aria-current", "page");
    link.before(messages);
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
