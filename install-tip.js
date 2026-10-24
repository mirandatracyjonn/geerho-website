// "Add Geerho to your Home Screen" (TJ, 2026-10-24, from the Gemini audit): while the apps are in beta, phones can
// keep geerho.com on the Home Screen like an app (manifest.webmanifest). Shown on phones only, not when it's already
// opened from the Home Screen, from the second page view, and not again for 60 days after "Not now".
const KEY = "geerho.installTip";
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode: just don't remember */ } };

const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const phone = matchMedia("(max-width: 899px)").matches && matchMedia("(pointer: coarse)").matches;
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const state = read();
state.views = (state.views ?? 0) + 1;
write(state);
const snoozed = state.dismissedAt && Date.now() - state.dismissedAt < 60 * 24 * 3600 * 1000;

let installEvent = null;
window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); installEvent = event; show(); });
window.addEventListener("appinstalled", () => { document.querySelector(".install-tip")?.remove(); write({ ...read(), installed: true }); });

function show() {
  if (standalone || !phone || snoozed || state.installed || state.views < 2 || document.querySelector(".install-tip")) return;
  if (!ios && !installEvent) return;   // Android shows it once Chrome says it can install
  const bar = document.createElement("div");
  bar.className = "install-tip";
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Add Geerho to your Home Screen");
  const text = document.createElement("p");
  text.innerHTML = ios
    ? "<strong>Add Geerho to your Home Screen.</strong> Tap Share <span aria-hidden=\"true\">⬆︎</span>, then <em>Add to Home Screen</em>."
    : "<strong>Add Geerho to your Home Screen</strong> and open it like an app.";
  const actions = document.createElement("div");
  if (installEvent) {
    const add = document.createElement("button");
    add.type = "button"; add.className = "button"; add.textContent = "Add";
    add.addEventListener("click", async () => {
      installEvent.prompt();
      const { outcome } = await installEvent.userChoice.catch(() => ({ outcome: "dismissed" }));
      installEvent = null;
      if (outcome === "accepted") write({ ...read(), installed: true });
      bar.remove();
    });
    actions.append(add);
  }
  const later = document.createElement("button");
  later.type = "button"; later.className = "button secondary"; later.textContent = "Not now";
  later.addEventListener("click", () => { write({ ...read(), dismissedAt: Date.now() }); bar.remove(); });
  actions.append(later);
  bar.append(text, actions);
  document.body.append(bar);
}
if (ios) setTimeout(show, 1500);
