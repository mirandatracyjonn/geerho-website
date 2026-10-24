// Home page: loads the latest active listings.
import { featuredCards, listingCard, searchListings } from "./site.js";

featuredCards().then((cards) => {
  if (!cards.length) return;
  document.getElementById("featured").append(...cards);
  document.getElementById("featured-section").hidden = false;
});

// The search's "Everything" choice is left out of the link (browse.html?q=… instead of …&format=).
document.querySelector(".hero-search")?.addEventListener("submit", (e) => {
  const f = e.target.elements.format;
  if (f && !f.value) f.removeAttribute("name");
});

const list = document.getElementById("latest");
const status = document.getElementById("latest-status");

// One retry after a short pause (a brief network or database hiccup shouldn't leave the home page empty), and a
// listing that can't be drawn is skipped instead of hiding the whole feed (2026-10-24).
async function latest() {
  try { return await searchListings({ sort: "newest", page_size: 8 }); }
  catch { await new Promise((r) => setTimeout(r, 1500)); return searchListings({ sort: "newest", page_size: 8 }); }
}

try {
  const listings = await latest();
  const cards = listings.map((l) => { try { return listingCard(l); } catch { return null; } }).filter(Boolean);
  list.append(...cards);
  status.textContent = cards.length ? "" : "No listings yet. Be the first to sell on Geerho.";
  status.hidden = cards.length > 0;
} catch {
  status.textContent = "We couldn't load listings right now. Please try again later.";
}
