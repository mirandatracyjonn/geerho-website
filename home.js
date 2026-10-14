// Home page: loads the latest active listings.
import { featuredCards, listingCard, searchListings } from "./site.js";

featuredCards().then((cards) => {
  if (!cards.length) return;
  document.getElementById("featured").append(...cards);
  document.getElementById("featured-section").hidden = false;
});

const list = document.getElementById("latest");
const status = document.getElementById("latest-status");

try {
  const listings = await searchListings({ sort: "newest", page_size: 8 });
  list.append(...listings.map(listingCard));
  status.textContent = listings.length ? "" : "No listings yet. Be the first to sell on Geerho.";
  status.hidden = listings.length > 0;
} catch {
  status.textContent = "We couldn't load listings right now. Please try again later.";
}
