// Go live from the website with your own YouTube, Facebook, Twitch, or Amazon IVS stream (the app's "Go Live with an
// External App", M69). Streaming from the phone's camera stays in the app: a browser can't push a stream to these
// platforms. Same database functions as the app: save_live_source, start_live_show, end_live_show.
import { el } from "./site.js";
import { currentUser, friendlyError, supabase } from "./auth.js";

const box = document.getElementById("web-live");
const PLATFORMS = [["youtube", "YouTube Live", "youtube.com/channel/UC…"], ["facebook", "Facebook Live", "facebook.com/yourpage"],
  ["twitch", "Twitch", "twitch.tv/yourname"], ["ivs", "Amazon IVS", "Playback URL (…m3u8)"]];

async function render() {
  const user = await currentUser();
  if (!user) {
    box.replaceChildren(el("div", { class: "panel" }, el("h2", {}, "Go live from geerho.com"),
      el("p", {}, "Already streaming with OBS, Larix, or another app? Sign in to start your Geerho live show here."),
      el("a", { class: "button", href: `account.html?next=${encodeURIComponent("go-live.html")}` }, "Sign In")));
    return;
  }
  const [{ data: shows }, { data: source }, { data: listings }] = await Promise.all([
    supabase.rpc("live_now", { max_rows: 100 }),
    supabase.rpc("my_live_source"),
    supabase.from("listings").select("id, title").eq("seller_id", user.id).eq("status", "active").order("created_at", { ascending: false }).limit(100)]);
  const mine = (shows ?? []).find((s) => s.host_id === user.id);
  const problem = el("p", { class: "status bad", role: "alert", hidden: true });
  const fail = (e) => { problem.textContent = typeof e === "string" ? e : friendlyError(e); problem.hidden = false; };

  if (mine) {
    const end = el("button", { type: "button", class: "danger-button" }, "End Show");
    end.addEventListener("click", async () => {
      end.disabled = true;
      const { error } = await supabase.rpc("end_live_show");
      if (error) { fail(error); end.disabled = false; return; }
      render();
    });
    box.replaceChildren(el("div", { class: "panel" }, el("h2", {}, "You're live"), el("p", {}, mine.title),
      el("div", { class: "actions" }, el("a", { class: "button", href: `live.html?show=${mine.id}` }, "Open Your Show"), end), problem));
    return;
  }

  const platform = el("select", { "aria-label": "Platform" }, ...PLATFORMS.map(([v, t]) => el("option", { value: v, selected: v === source?.provider }, t)));
  const channel = el("input", { type: "url", value: source?.watch_url || source?.playback_url || "", "aria-label": "Channel link" });
  const hintFor = () => { channel.placeholder = PLATFORMS.find(([v]) => v === platform.value)[2]; videoRow.hidden = platform.value !== "facebook"; };
  const video = el("input", { type: "url", placeholder: "facebook.com/…/videos/…", "aria-label": "Live video link for this show" });
  const videoRow = el("label", {}, "Live video link for this show (Facebook makes a new one each time)", video);
  platform.addEventListener("change", hintFor);
  const saveChannel = el("button", { type: "button", class: "secondary" }, "Save Channel");
  saveChannel.addEventListener("click", async () => {
    problem.hidden = true;
    const { error } = await supabase.rpc("save_live_source", { provider: platform.value, url: channel.value.trim() });
    if (error) return fail(error);
    saveChannel.textContent = "Saved ✓";
  });
  const title = el("input", { type: "text", maxlength: "80", placeholder: "Show title, e.g. Sneaker drop", "aria-label": "Show title" });
  const picks = (listings ?? []).map((l) => {
    const c = el("input", { type: "checkbox", value: l.id });
    return el("label", { class: "check-row" }, c, ` ${l.title}`);
  });
  const go = el("button", { type: "button" }, "Go Live with an External App");
  go.addEventListener("click", async () => {
    problem.hidden = true;
    const chosen = [...box.querySelectorAll(".live-picks input:checked")].map((c) => c.value);
    if (!title.value.trim()) return fail("Name your show.");
    if (chosen.length > 12) return fail("Feature up to 12 listings.");
    go.disabled = true;
    const { data: id, error } = await supabase.rpc("start_live_show", { title: title.value.trim(), listings: chosen, watch_url: platform.value === "facebook" ? video.value.trim() || null : null });
    if (error) { fail(error); go.disabled = false; return; }
    location.href = `live.html?show=${id}`;
  });
  hintFor();
  box.replaceChildren(el("div", { class: "panel" },
    el("h2", {}, "Go live from geerho.com"),
    el("p", {}, "Start streaming in OBS, Larix, or your platform's app first, then start your Geerho show here. Your followers get a notification. You need to be ID-verified."),
    el("label", {}, "Platform", platform), el("label", {}, "Channel link", channel), el("div", { class: "actions" }, saveChannel),
    el("label", {}, "Show title", title), videoRow,
    picks.length ? el("fieldset", { class: "live-picks" }, el("legend", {}, "What are you selling? (up to 12)"), ...picks) : el("p", { class: "hint" }, "Tip: post listings first so buyers can check out during your show."),
    problem, el("div", { class: "actions" }, go),
    el("p", { class: "hint" }, "Streaming from your phone's camera? Use the Geerho app: Profile → Go Live.")));
}

render();
