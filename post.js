// The Post tab on geerho.com, the same chooser as the app's (SellTabView): Buy and sell · Real estate · Freelance.
// Posting from the website comes next (website parity phase 3); until then each choice explains how to post it in the
// app and opens the download page, so the website and the apps look and read the same.
import { el } from "./site.js";
import { currentUser, signInURL } from "./auth.js";
import { icon, rowIcon } from "./icons.js";

const CHOICES = [
  ["Buy and sell", [
    ["item", "Sell an item", "New or used, with pickup or shipping", "tag", "orange"],
    ["auction", "Start an auction", "Let buyers bid, with an optional Buy It Now", "hammer", "purple"],
    ["tool", "Rent out a tool or equipment", "Lend by the day to people nearby", "wrench", "green"],
  ]],
  ["Real estate", [
    ["home_rent", "Rent out a home", "Apartment, house, condo, or room, rented monthly", "key", "teal"],
    ["home_sale", "Sell a home", "House, condo, land, or commercial property", "house", "teal"],
  ]],
  ["Freelance", [
    ["service", "Offer a service", "Get hired for what you do: cleaning, repairs, photos, lessons…", "briefcase", "indigo"],
    ["job", "Post a job", "Need something done? Get responses from local pros", "megaphone", "indigo"],
  ]],
];

const main = document.getElementById("post");

async function render() {
  const user = await currentUser();
  if (!user) {
    main.replaceChildren(el("h1", { class: "large-title" }, "Post"),
      el("div", { class: "empty" }, icon("post"), el("strong", {}, "Sign in to post"),
        el("p", {}, "Create an account to sell, rent out, offer services, or post jobs for people nearby."),
        el("a", { class: "button", href: signInURL("post.html") }, "Sign In")));
    return;
  }
  const chosen = new URLSearchParams(location.search).get("type");
  const pick = CHOICES.flatMap(([, list]) => list).find(([key]) => key === chosen);
  if (pick) {
    const [, title, subtitle, iconName, tint] = pick;
    main.replaceChildren(
      el("div", { class: "screen-head" }, el("a", { class: "back", href: "post.html" }, icon("chevronLeft"), "Post"), el("h1", {}, title)),
      el("ul", { class: "group plain" }, el("li", { class: "cell-pad" },
        el("div", { class: "item-row", style: "padding:0" }, rowIcon(iconName, tint), el("span", { class: "row-title" }, el("strong", {}, title), el("small", {}, subtitle))),
        el("p", {}, "Posting from geerho.com is coming soon. For now, post it in the Geerho app: tap ", el("strong", {}, "Post"), ", then ", el("strong", {}, title), ". It shows here on the website the moment it's live."),
        el("p", { class: "actions" }, el("a", { class: "button", href: "download.html" }, "Get the App"), el("a", { class: "button secondary", href: "account.html#listings" }, "My Listings")))),
      el("p", { class: "group-footer" }, "Everyone who posts on Geerho verifies their identity first."));
    document.title = `${title} · Geerho`;
    return;
  }
  main.replaceChildren(
    el("h1", { class: "large-title" }, "Post"),
    el("h2", { class: "post-question" }, "What would you like to post?"),
    ...CHOICES.flatMap(([section, list]) => [
      el("p", { class: "group-title" }, section),
      el("div", { class: "post-cards" }, list.map(([key, title, subtitle, iconName, tint]) =>
        el("a", { class: "post-card", href: `post.html?type=${key}` }, rowIcon(iconName, tint),
          el("span", { class: "row-title" }, el("strong", {}, title), el("small", {}, subtitle)), icon("chevronRight", "chev")))),
    ]),
    el("p", { class: "group-footer", style: "margin-top:8px" }, "Everyone who posts on Geerho verifies their identity first."));
}

render();
