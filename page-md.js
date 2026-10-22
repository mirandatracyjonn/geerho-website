// Shared Pages (M157): a small, safe Markdown reader. It builds DOM nodes (never innerHTML), so a page can't run code.
// Supports # headings, paragraphs, **bold**, *italic*, `code`, [links](https://…), - lists, 1. lists, - [ ] checklists
// (ticks are saved in this browser only), > quotes, --- rules, and indented lines that continue a list item.
import { el } from "./site.js";

export function inline(text) {
  const out = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\))/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2]) out.push(el("strong", {}, m[2]));
    else if (m[3]) out.push(el("em", {}, m[3]));
    else if (m[4]) out.push(el("code", {}, m[4]));
    else out.push(el("a", { href: m[6], rel: "noopener nofollow", target: m[6].startsWith("mailto:") ? null : "_blank" }, m[5]));
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Renders `markdown`; `storeKey` (e.g. the page token) keeps this reader's checklist ticks in localStorage. */
export function renderMarkdown(markdown, storeKey = null) {
  let ticks = {};
  try { if (storeKey) ticks = JSON.parse(localStorage.getItem(`page-ticks:${storeKey}`) || "{}"); } catch { ticks = {}; }
  const save = () => { try { if (storeKey) localStorage.setItem(`page-ticks:${storeKey}`, JSON.stringify(ticks)); } catch {} };
  const root = el("div", { class: "page-body" });
  let list = null, item = null, para = null, taskIndex = 0;
  const end = () => { list = null; item = null; para = null; };
  for (const raw of markdown.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { para = null; if (!item) list = null; continue; }
    const indented = /^\s{2,}\S/.test(line) && item;
    const t = line.trim();
    let m;
    if (indented) { item.append(el("p", { class: "page-why" }, ...inline(t))); continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(t))) { end(); root.append(el(`h${m[1].length + 1}`, {}, ...inline(m[2]))); continue; }
    if (/^-{3,}$/.test(t)) { end(); root.append(el("hr")); continue; }
    if ((m = /^>\s?(.*)$/.exec(t))) { end(); root.append(el("blockquote", {}, ...inline(m[1]))); continue; }
    if ((m = /^[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(t))) {
      if (!list || list.tagName !== "UL" || !list.classList.contains("page-tasks")) { list = el("ul", { class: "page-tasks" }); root.append(list); }
      const n = taskIndex++;
      const box = el("input", { type: "checkbox", id: `task-${n}`, checked: storeKey ? Boolean(ticks[n]) : m[1] !== " " });
      if (storeKey) box.addEventListener("change", () => { ticks[n] = box.checked; save(); box.closest("li").classList.toggle("done", box.checked); });
      else box.disabled = true;
      item = el("li", { class: box.checked ? "done" : null }, el("label", { for: `task-${n}` }, box, el("span", {}, ...inline(m[2]))));
      list.append(item); para = null; continue;
    }
    if ((m = /^[-*]\s+(.*)$/.exec(t))) {
      if (!list || list.tagName !== "UL" || list.classList.contains("page-tasks")) { list = el("ul"); root.append(list); }
      item = el("li", {}, ...inline(m[1])); list.append(item); para = null; continue;
    }
    if ((m = /^\d+[.)]\s+(.*)$/.exec(t))) {
      if (!list || list.tagName !== "OL") { list = el("ol"); root.append(list); }
      item = el("li", {}, ...inline(m[1])); list.append(item); para = null; continue;
    }
    item = null; list = null;
    if (para) para.append(" ", ...inline(t)); else { para = el("p", {}, ...inline(t)); root.append(para); }
  }
  return root;
}
