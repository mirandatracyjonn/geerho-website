// In-page dialogs for geerho.com (instead of the browser's prompt/confirm pop-ups): a yes/no confirmation, a star
// review like the apps', and a short text form. Built on <dialog>, keyboard and screen-reader friendly.
import { el } from "./site.js";

function open(dialog) {
  document.body.append(dialog);
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => { resolve(dialog.returnValue === "ok" ? dialog.result ?? true : null); dialog.remove(); }, { once: true });
  });
}

function shell(title, ...content) {
  const dialog = el("dialog", { class: "g-dialog", "aria-labelledby": "g-dialog-title" });
  const form = el("form", { method: "dialog" }, el("h2", { id: "g-dialog-title" }, title), ...content);
  dialog.append(form);
  return { dialog, form };
}

function buttons(okLabel, { danger = false, disabled = false } = {}) {
  const ok = el("button", { value: "ok", class: danger ? "danger" : "", disabled });
  ok.textContent = okLabel;
  return { ok, row: el("div", { class: "g-dialog-actions" }, el("button", { value: "cancel", class: "secondary", type: "submit" }, "Cancel"), ok) };
}

/** Yes/no. Resolves true when confirmed. */
export async function confirmDialog(title, message, okLabel = "OK", { danger = false } = {}) {
  const { ok, row } = buttons(okLabel, { danger });
  const { dialog } = shell(title, el("p", {}, message), row);
  return (await open(dialog)) === true;
}

/** Stars (1–5) and an optional review. Resolves { rating, body } or null. */
export async function reviewDialog(name) {
  let rating = 0;
  const { ok, row } = buttons("Post Review", { disabled: true });
  const stars = el("div", { class: "g-stars", role: "radiogroup", "aria-label": "Rating" });
  const label = el("p", { class: "g-stars-label" }, "Tap a star");
  const words = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];
  for (let i = 1; i <= 5; i++) {
    const star = el("button", { type: "button", role: "radio", "aria-checked": "false", "aria-label": `${i} star${i > 1 ? "s" : ""}` }, "★");
    star.addEventListener("click", () => {
      rating = i;
      [...stars.children].forEach((s, n) => { s.classList.toggle("on", n < i); s.setAttribute("aria-checked", String(n + 1 === i)); });
      label.textContent = words[i];
      ok.disabled = false;
    });
    stars.append(star);
  }
  const body = el("textarea", { maxlength: 500, rows: 4, placeholder: "What went well? (optional)", "aria-label": "Your review" });
  const count = el("p", { class: "hint g-count" }, "0/500");
  body.addEventListener("input", () => { count.textContent = `${body.value.length}/500`; });
  const { dialog } = shell(`Review ${name}`, stars, label, body, count,
    el("p", { class: "hint" }, "Reviews appear once you've both reviewed each other, or after 14 days."), row);
  ok.addEventListener("click", () => { dialog.result = { rating, body: body.value.trim() }; });
  return open(dialog);
}

/** A short required text (at least `min` characters). Resolves the text or null. */
export async function textDialog(title, message, { okLabel = "Send", min = 10, placeholder = "" } = {}) {
  const { ok, row } = buttons(okLabel, { disabled: min > 0 });
  const input = el("textarea", { maxlength: 1000, rows: 4, placeholder, "aria-label": title });
  input.addEventListener("input", () => { ok.disabled = input.value.trim().length < min; });
  const { dialog } = shell(title, el("p", {}, message), input, row);
  ok.addEventListener("click", () => { dialog.result = input.value.trim(); });
  return open(dialog);
}

/** M174: sign with a mouse or finger and type a full name. Resolves { png: Blob, name } or null. */
export async function signatureDialog(title, message) {
  const { ok, row } = buttons("Sign", { disabled: true });
  const canvas = el("canvas", { width: 600, height: 220, class: "g-signature", "aria-label": "Sign here" });
  const ctx = canvas.getContext("2d");
  const reset = () => { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); drawn = false; check(); };
  let drawing = false, drawn = false;
  const name = el("input", { type: "text", maxlength: 120, autocomplete: "name", placeholder: "Your full name", "aria-label": "Your full name" });
  const check = () => { ok.disabled = !drawn || name.value.trim().length < 2; };
  const at = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height]; };
  canvas.addEventListener("pointerdown", (e) => { drawing = true; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...at(e)); });
  canvas.addEventListener("pointermove", (e) => { if (!drawing) return; ctx.lineTo(...at(e)); ctx.strokeStyle = "#000"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.stroke(); drawn = true; check(); });
  canvas.addEventListener("pointerup", () => { drawing = false; });
  name.addEventListener("input", check);
  const clear = el("button", { type: "button", class: "link-button" }, "Clear");
  clear.addEventListener("click", reset);
  const { dialog } = shell(title, el("p", {}, message), canvas, clear, name, row);
  reset();
  ok.addEventListener("click", (e) => {
    e.preventDefault();
    canvas.toBlob((png) => { dialog.result = { png, name: name.value.trim() }; dialog.close("ok"); }, "image/png");
  });
  return open(dialog);
}
