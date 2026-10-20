// M149 (TJ, 2026-10-20), like the apps: swipe left (phones) deletes one; a long press, or Select, picks several;
// Delete all clears the list. Used by Notifications and Messages (chats and the inbox list).
import { el } from "./site.js";

/**
 * One list's selection. `bar` is where Select / Delete all (or Cancel / Delete) go; `remove(ids | null)` deletes
 * (null = all). Rows are attached as they're drawn (`attach(node, id)`), so a list that redraws keeps its selection.
 */
export function selection({ bar, what, remove, confirmText }) {
  let selecting = false;
  const chosen = new Set();
  const rows = new Map();

  const paint = () => {
    for (const [id, r] of rows) {
      if (!r.node.isConnected) { rows.delete(id); continue; }
      r.node.classList.toggle("is-selected", chosen.has(id));
      r.node.classList.toggle("is-selecting", selecting);
      r.box.hidden = !selecting;
      r.box.checked = chosen.has(id);
    }
    if (selecting) {
      const cancel = el("button", { type: "button", class: "button secondary" }, "Cancel");
      const del = el("button", { type: "button", class: "button danger-button" }, `Delete (${chosen.size})`);
      del.disabled = chosen.size === 0;
      cancel.addEventListener("click", () => { selecting = false; chosen.clear(); paint(); });
      del.addEventListener("click", async () => { const ids = [...chosen]; selecting = false; chosen.clear(); paint(); await remove(ids); });
      bar.replaceChildren(cancel, el("span", { class: "card-meta" }, `${chosen.size} selected`), del);
    } else if ([...rows.values()].some((r) => r.node.isConnected)) {
      const pick = el("button", { type: "button", class: "button secondary" }, "Select");
      const all = el("button", { type: "button", class: "button secondary danger-text" }, "Delete all");
      pick.addEventListener("click", () => { selecting = true; paint(); });
      all.addEventListener("click", async () => {
        if (window.confirm(`Delete all ${what}? ${confirmText}`)) await remove(null);
      });
      bar.replaceChildren(pick, all);
    } else bar.replaceChildren();
  };

  const toggle = (id) => {
    if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
    if (!chosen.size) selecting = false;
    paint();
  };

  const attach = (node, id) => {
    const box = el("input", { type: "checkbox", class: "select-box", "aria-label": "Select" });
    box.hidden = true;
    node.prepend(box);
    rows.set(id, { node, box });
    let x0 = null, timer = null, longPressed = false;
    node.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      x0 = e.clientX; longPressed = false;
      timer = setTimeout(() => { longPressed = true; selecting = true; chosen.add(id); paint(); }, 550);
    });
    node.addEventListener("pointermove", (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0;
      if (Math.abs(dx) > 10) clearTimeout(timer);
      if (!selecting && e.pointerType !== "mouse" && dx < 0) node.style.transform = `translateX(${Math.max(dx, -120)}px)`;
    });
    const reset = () => { clearTimeout(timer); x0 = null; node.style.transform = ""; };
    node.addEventListener("pointerup", async (e) => {
      const dx = x0 === null ? 0 : e.clientX - x0;
      reset();
      if (!selecting && e.pointerType !== "mouse" && dx < -90) await remove([id]);
    });
    node.addEventListener("pointercancel", reset);
    node.addEventListener("click", (e) => {
      if (longPressed) { e.preventDefault(); e.stopPropagation(); longPressed = false; return; }
      if (selecting) { e.preventDefault(); e.stopPropagation(); toggle(id); }
    }, true);
    paint();
    return node;
  };

  return { attach, paint, reset: () => { selecting = false; chosen.clear(); rows.clear(); paint(); } };
}
