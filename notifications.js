import { currentUser, friendlyError, signInURL, supabase } from "./auth.js";
import { el } from "./site.js";

// Your notifications (M51): automatic events, Geerho Support replies, team changes, followers, reviews, watch
// alerts, and license decisions. Opening one marks it read; Mark All Read clears the rest.

const status = document.getElementById("status");
const list = document.getElementById("list");
const markAll = document.getElementById("mark-all");

const ICONS = { support: "🛟", team: "👥", follow: "➕", review: "⭐", watch: "👁", license: "✅", outbid: "🔨" };

function linkFor(item) {
  switch (item.target) {
    case "conversation": return `messages.html?c=${encodeURIComponent(item.target_id)}`;
    case "listing": return `listing.html?id=${encodeURIComponent(item.target_id)}`;
    case "support": return "contact.html";
    default: return null; // team, profiles, licenses, and watching are in the app
  }
}

function when(iso) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (seconds < 60) return "just now";
  if (seconds < 3600) return format.format(-Math.round(seconds / 60), "minute");
  if (seconds < 86400) return format.format(-Math.round(seconds / 3600), "hour");
  if (seconds < 86400 * 7) return format.format(-Math.round(seconds / 86400), "day");
  return new Date(iso).toLocaleDateString();
}

function row(item) {
  const href = linkFor(item);
  const content = [
    el("span", { class: `icon kind-${item.kind}`, "aria-hidden": "true" }, ICONS[item.kind] ?? "🔔"),
    el("div", { class: "text" },
      el("div", { class: "top" }, el("strong", {}, item.title), el("time", { datetime: item.created_at }, when(item.created_at))),
      item.body ? el("p", {}, item.body) : null),
    item.read_at ? null : el("span", { class: "unread", "aria-label": "Unread" }),
  ];
  const li = el("li", { class: item.read_at ? "" : "is-unread" }, href ? el("a", { href }, ...content) : el("div", {}, ...content));
  // Opening (or tapping) a notification marks it read, like the app.
  if (!item.read_at) {
    li.firstElementChild.addEventListener("click", async (event) => {
      const link = event.currentTarget.getAttribute("href");
      if (link) event.preventDefault();
      await markRead(item.id, li);
      if (link) location.href = link;
    });
  }
  return li;
}

async function markRead(id, li) {
  await supabase.rpc("mark_notifications_read", { ids: [id] });
  li.classList.remove("is-unread");
  li.querySelector(".unread")?.remove();
  const remaining = list.querySelectorAll(".is-unread").length;
  markAll.hidden = remaining === 0;
  const count = document.querySelector(".site-header .bell .count");
  if (count) {
    if (remaining === 0) count.remove();
    else count.textContent = remaining > 99 ? "99+" : String(remaining);
  }
}

async function load() {
  const user = await currentUser();
  if (!user) {
    location.replace(signInURL("notifications.html"));
    return;
  }
  const { data, error } = await supabase.rpc("my_notifications", { max_rows: 100 });
  if (error) {
    status.textContent = friendlyError(error);
    return;
  }
  list.replaceChildren(...data.map(row));
  list.hidden = data.length === 0;
  status.textContent = data.length === 0
    ? "No notifications yet. Updates about your purchases, sales, rentals, tours, jobs, team, followers, reviews, and watched items show up here."
    : "";
  status.hidden = data.length > 0;
  markAll.hidden = !data.some((item) => !item.read_at);
}

markAll.addEventListener("click", async () => {
  await supabase.rpc("mark_notifications_read");
  for (const item of list.querySelectorAll(".is-unread")) {
    item.classList.remove("is-unread");
    item.querySelector(".unread")?.remove();
  }
  markAll.hidden = true;
  document.querySelector(".site-header .bell .count")?.remove();
});

load();
