import { featuredCards, getCategories, listingCard, searchListings } from "./site.js";

featuredCards().then((cards) => {
  if (!cards.length) return;
  document.getElementById("featured").append(...cards);
  document.getElementById("featured-strip").hidden = false;
});

const PAGE_SIZE = 24;
const form = document.getElementById("filters");
const results = document.getElementById("results");
const status = document.getElementById("status");
const more = document.getElementById("more");
const categorySelect = document.getElementById("category");

let query = {};
let last = null;

// Filters live in the address bar, so a search can be bookmarked or shared.
function readURL() {
  const params = new URLSearchParams(location.search);
  for (const name of ["q", "format", "category", "sort"]) {
    if (params.has(name)) form.elements[name].value = params.get(name);
  }
}

function writeURL() {
  const params = new URLSearchParams();
  for (const name of ["q", "format", "category", "sort"]) {
    const value = form.elements[name].value;
    if (value && !(name === "sort" && value === "newest")) params.set(name, value);
  }
  const search = params.toString();
  history.replaceState(null, "", search ? `?${search}` : location.pathname);
}

async function load(reset) {
  if (reset) {
    query = {
      search_text: form.elements.q.value.trim() || null,
      format: ["home_rent", "home_sale", "services", "jobs"].includes(form.elements.format.value) ? null : (form.elements.format.value || null),
      kind: { home_rent: "rental", home_sale: "property_sale", services: "service", jobs: "job" }[form.elements.format.value] ?? null,
      category: form.elements.category.value ? Number(form.elements.category.value) : null,
      sort: form.elements.sort.value,
      page_size: PAGE_SIZE,
    };
    last = null;
    results.replaceChildren();
  }
  status.textContent = "Loading…";
  more.hidden = true;
  try {
    const page = await searchListings(last ? { ...query, after_sort_key: last.sort_key, after_id: last.id } : query);
    results.append(...page.map(listingCard));
    if (page.length) last = page[page.length - 1];
    const shown = results.children.length;
    status.textContent = shown
      ? `${shown} ${shown === 1 ? "listing" : "listings"}${page.length === PAGE_SIZE ? " so far" : ""}`
      : "No listings match. Try a different search or type.";
    more.hidden = page.length < PAGE_SIZE;
  } catch {
    status.textContent = "We couldn't load listings right now. Please try again later.";
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  writeURL();
  load(true);
});
for (const name of ["format", "category", "sort"]) {
  form.elements[name].addEventListener("change", () => form.requestSubmit());
}
more.addEventListener("click", () => load(false));

readURL();
try {
  const categories = await getCategories();
  const selected = new URLSearchParams(location.search).get("category");
  for (const category of categories.filter((c) => c.parent_id === null)) {
    categorySelect.append(new Option(category.name, category.id, false, String(category.id) === selected));
  }
} catch {
  // The search still works without the category list.
}
load(true);

// Listings | People, like the app's Search tab. People search needs a signed-in member (same rule as the app).
const scopeBar = document.getElementById("scope");
const peopleForm = document.getElementById("people-form");
const peopleList = document.getElementById("people");
const featuredStrip = document.getElementById("featured-strip");
const listingParts = [form, status, results, more.parentElement];
let featuredShown = false;

function setScope(scope) {
  const people = scope === "people";
  for (const b of scopeBar.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.scope === scope));
  if (people) featuredShown = !featuredStrip.hidden;
  for (const part of listingParts) part.hidden = people;
  featuredStrip.hidden = people || !featuredShown;
  peopleForm.hidden = !people;
  peopleList.hidden = !people;
  if (people) document.getElementById("pq").focus();
}
scopeBar.addEventListener("click", (event) => { const b = event.target.closest("button"); if (b) setScope(b.dataset.scope); });

let peopleTimer = null;
peopleForm.addEventListener("submit", (event) => event.preventDefault());
document.getElementById("pq").addEventListener("input", (event) => {
  clearTimeout(peopleTimer);
  peopleTimer = setTimeout(() => searchPeople(event.target.value.trim()), 250);
});

async function searchPeople(text) {
  const { el } = await import("./site.js");
  const { currentUser, signInURL, supabase } = await import("./auth.js");
  if (!(await currentUser())) {
    peopleList.replaceChildren(el("li", { class: "cell-pad" }, el("a", { href: signInURL("browse.html") }, "Sign in"), " to search for people."));
    return;
  }
  if (text.replace(/^@/, "").length < 2) { peopleList.replaceChildren(); return; }
  const { avatar } = await import("./profile.js");
  const { icon } = await import("./icons.js");
  const { data } = await supabase.rpc("search_members", { search_text: text, max_rows: 30 });
  peopleList.replaceChildren(...((data ?? []).length ? data.map((p) => el("li", {}, el("a", { class: "item-row", href: `member.html?id=${p.id}` },
    avatar(p.avatar_url, p.display_name || p.username, 44),
    el("span", { class: "row-title" }, el("strong", {}, p.display_name || `@${p.username}`), el("small", {}, `@${p.username}`)),
    icon("chevronRight", "chev")))) : [el("li", { class: "cell-pad" }, "No members match.")]));
}
