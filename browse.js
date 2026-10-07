import { getCategories, listingCard, searchListings } from "./site.js";

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
      format: ["home_rent", "home_sale"].includes(form.elements.format.value) ? null : (form.elements.format.value || null),
      kind: { home_rent: "rental", home_sale: "property_sale" }[form.elements.format.value] ?? null,
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
