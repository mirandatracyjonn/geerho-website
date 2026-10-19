// The User Handbook (M68): the same articles as the apps, from public.help_articles. Searchable, with links per article.
import { el } from "./site.js";
import { supabase } from "./auth.js";

const SKIP = new Set(["how", "do", "i", "a", "an", "the", "to", "my", "can", "is", "what"]);
const input = document.getElementById("help-q");
const results = document.getElementById("help-results");
const status = document.getElementById("help-status");
let articles = [];

// Same scoring as the apps: every word must appear; title counts most, then keywords, then the text.
function score(article, query) {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !SKIP.has(w));
  if (!words.length) return 1;
  const title = article.title.toLowerCase(), keywords = article.keywords.toLowerCase(), body = article.body.toLowerCase();
  let total = 0;
  for (const w of words) {
    const points = (title.includes(w) ? 5 : 0) + (keywords.includes(w) ? 4 : 0) + (body.includes(w) ? 1 : 0);
    if (!points) return 0;
    total += points;
  }
  return total;
}

function article(a, open) {
  return el("details", { class: "help-article", id: a.slug, open },
    el("summary", {}, a.title),
    ...a.body.split("\n").filter((line) => line.trim()).map((line) => el("p", {}, line)));
}

function render() {
  const query = input.value.trim();
  if (query) {
    const found = articles.map((a) => [a, score(a, query)]).filter(([, s]) => s > 0).sort((x, y) => y[1] - x[1]).map(([a]) => a);
    status.textContent = found.length ? `${found.length} ${found.length === 1 ? "answer" : "answers"}` : `No results for “${query}”. Try other words, or contact Support.`;
    results.replaceChildren(...found.map((a, i) => article(a, i === 0)));
    return;
  }
  status.textContent = "";
  const sections = new Map();
  for (const a of articles) {
    if (!sections.has(a.section)) sections.set(a.section, []);
    sections.get(a.section).push(a);
  }
  results.replaceChildren(...[...sections.entries()].map(([section, list]) =>
    el("section", {}, el("h2", {}, section), ...list.map((a) => article(a, location.hash === `#${a.slug}`)))));
}

const { data, error } = await supabase.from("help_articles").select("slug, section, section_position, position, title, body, keywords")
  .order("section_position").order("position");
if (error) status.textContent = "Couldn't load the handbook. Check your connection and try again.";
articles = data ?? [];
input.value = new URLSearchParams(location.search).get("q") ?? "";
render();
// A link to one article (help.html#how-does-reputation-work-on-geerho): it opens above; bring it into view.
if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ block: "start" });
input.addEventListener("input", render);
document.getElementById("help-form").addEventListener("submit", (event) => event.preventDefault());
