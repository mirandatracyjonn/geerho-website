// Shared Pages (M157): geerho.com/page.html?p=<token>. Anyone with the link reads it unless it's private
// (then only Super Admins, signed in). Not listed or indexed anywhere.
import { el } from "./site.js";
import { supabase } from "./auth.js";
import { renderMarkdown } from "./page-md.js";

const main = document.getElementById("page");
const token = new URLSearchParams(location.search).get("p") ?? "";

async function load() {
  if (!/^[0-9a-f]{32}$/.test(token)) return show("This link isn't complete", "Check that you copied the whole link.");
  const { data, error } = await supabase.rpc("shared_page", { token });
  if (error) return show("We couldn't open this page", "Please try again in a moment.");
  if (!data) return show("This page isn't available", "It may be private or deleted. If you're a Geerho Super Admin, sign in and open the link again.");
  document.title = `${data.title} · Geerho`;
  const updated = new Date(data.updated_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  main.replaceChildren(
    el("p", { class: "page-meta" }, data.is_private ? "Private · " : "", `Updated ${updated}`),
    el("h1", {}, data.title),
    renderMarkdown(data.body, token),
    el("p", { class: "page-meta" }, "Ticks you make stay in this browser only."));
}

function show(title, text) {
  main.replaceChildren(el("h1", {}, title), el("p", { class: "lead" }, text));
}

load();
supabase.auth.onAuthStateChange((event) => { if (event === "SIGNED_IN") load(); });
