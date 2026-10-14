// Live shows (M66): watch a seller's Amazon IVS stream, see what they feature, and chat.
import { SUPABASE_URL, el, getListing, listingCard } from "./site.js";
import { currentUser, friendlyError, supabase } from "./auth.js";

const params = new URLSearchParams(location.search);
const showId = params.get("show");
const time = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const hostName = (show) => show.host_name ?? (show.host_username ? `@${show.host_username}` : "Geerho member");

async function renderNow() {
  const status = document.getElementById("now-status");
  const list = document.getElementById("shows");
  const { data, error } = await supabase.rpc("live_now");
  if (error) { status.textContent = `Couldn't load live shows: ${friendlyError(error)}`; return; }
  list.replaceChildren(...(data ?? []).map((show) => el("li", { class: "card" },
    el("a", { href: `live.html?show=${encodeURIComponent(show.id)}` },
      el("div", { class: "card-photo" },
        show.cover_path
          ? el("img", { src: `${SUPABASE_URL}/storage/v1/object/public/listing-photos/${show.cover_path}`, alt: "", loading: "lazy" })
          : el("span", { class: "no-photo" }, "Live"),
        el("span", { class: "badge live" }, "LIVE")),
      el("span", { class: "card-title" }, show.title),
      el("span", { class: "card-meta" }, `${hostName(show)} · since ${time(show.started_at)}${show.hearts ? ` · ♥ ${show.hearts}` : ""}`)))));
  status.textContent = data?.length ? "" : "Nobody is live right now. Check back soon.";
}

let chatTimer = null;

async function renderShow() {
  document.getElementById("now").hidden = true;
  document.getElementById("show").hidden = false;
  const { data, error } = await supabase.rpc("live_show", { show: showId });
  const show = data?.[0];
  if (error || !show) {
    document.getElementById("show-title").textContent = "This live show isn't available.";
    document.querySelector(".live-video").hidden = true;
    return;
  }
  document.title = `${show.title} · Live on Geerho`;
  document.getElementById("show-title").textContent = show.title;
  document.getElementById("show-host").replaceChildren(
    show.is_live ? el("span", { class: "badge live" }, "LIVE") : "", " ", hostName(show), show.host_verified ? " · ✓ Verified" : "");

  const video = document.getElementById("video");
  if (show.is_live && show.embed_url) {
    // YouTube, Facebook, and Twitch: their official embedded player (M69).
    video.hidden = true;
    const frame = document.getElementById("embed");
    frame.src = show.embed_url;
    frame.hidden = false;
  } else if (show.is_live && show.playback_url) {
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = show.playback_url;                 // Safari plays HLS itself
    } else if (window.Hls?.isSupported()) {
      const hls = new window.Hls({ lowLatencyMode: true });
      hls.loadSource(show.playback_url);
      hls.attachMedia(video);
    }
  } else {
    video.closest(".live-video").hidden = true;
    document.getElementById("show-ended").hidden = false;
  }

  if (show.is_live) setUpHearts(show);

  const featured = [];
  for (const id of show.listing_ids ?? []) {
    const listing = await getListing(id).catch(() => null);
    if (listing) {
      const photo = [...(listing.listing_photos ?? [])].sort((a, b) => a.position - b.position)[0];
      featured.push(listingCard({ ...listing, cover_path: photo?.storage_path }));
    }
  }
  document.getElementById("featured-title").hidden = featured.length === 0;
  document.getElementById("featured").replaceChildren(...featured);

  const user = await currentUser();
  document.getElementById("chat-form").hidden = !show.is_live || !user;
  document.getElementById("chat-signin").hidden = !show.is_live || !!user;
  await loadChat();
  if (show.is_live) chatTimer = setInterval(loadChat, 3000);

  document.getElementById("chat-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("chat-input");
    const errorLine = document.getElementById("chat-error");
    const body = input.value.trim();
    if (!body) return;
    const { error: sendError } = await supabase.rpc("post_live_comment", { show: showId, body });
    errorLine.hidden = !sendError;
    if (sendError) { errorLine.textContent = friendlyError(sendError); return; }
    input.value = "";
    loadChat();
  });
}

// Double-tap (double-click) hearts (M70): each one floats a heart and counts as a like; sent in batches.
function setUpHearts(show) {
  const zone = document.getElementById("heart-zone");
  const counter = document.getElementById("heart-count");
  let total = Number(show.hearts ?? 0), pending = 0;
  const label = () => { counter.textContent = `♥ ${new Intl.NumberFormat(undefined, { notation: "compact" }).format(total)}`; };
  const add = async (x, y) => {
    if (!(await currentUser())) { location.href = "account.html?next=" + encodeURIComponent(location.pathname.slice(1) + location.search); return; }
    pending += 1; total += 1; label();
    if (x !== undefined) {
      const heart = el("span", { class: "floating-heart", "aria-hidden": "true" }, "♥");
      heart.style.left = `${x}px`; heart.style.top = `${y}px`;
      zone.append(heart);
      setTimeout(() => heart.remove(), 1200);
    }
  };
  zone.hidden = false; counter.hidden = false; label();
  zone.addEventListener("dblclick", (event) => { const r = zone.getBoundingClientRect(); add(event.clientX - r.left, event.clientY - r.top); });
  counter.addEventListener("click", () => add());
  setInterval(async () => {
    if (!pending) return;
    const taps = pending; pending = 0;
    const { data } = await supabase.rpc("heart_live_show", { show: showId, taps });
    if (typeof data === "number") { total = Math.max(total, data); label(); }
  }, 1500);
}

async function loadChat() {
  const chat = document.getElementById("chat");
  const { data } = await supabase.from("live_comments")
    .select("id, body, created_at, author:profiles!live_comments_user_id_fkey(username, display_name)")
    .eq("show_id", showId).order("id", { ascending: false }).limit(80);
  const rows = (data ?? []).reverse();
  chat.replaceChildren(...(rows.length
    ? rows.map((row) => el("li", {},
        el("strong", {}, row.author?.display_name ?? (row.author?.username ? `@${row.author.username}` : "Member")), " ", row.body))
    : [el("li", { class: "hint" }, "No messages yet. Signed-in members can chat.")]));
  chat.lastElementChild?.scrollIntoView({ block: "nearest" });
}

if (showId) renderShow(); else renderNow();
addEventListener("pagehide", () => clearInterval(chatTimer));
