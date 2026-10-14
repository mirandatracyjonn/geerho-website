// The Post tab on geerho.com, the same chooser as the app's (SellTabView): Buy and sell · Real estate · Freelance.
// Each choice opens the same form as the app (post-form.js); post.html?edit=<id> edits one of my listings.
import { el } from "./site.js";
import { currentUser, signInURL, supabase } from "./auth.js";
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
  const params = new URLSearchParams(location.search);
  const chosen = params.get("type"), editId = params.get("edit");
  if (chosen || editId) {
    const { postForm, TYPES } = await import("./post-form.js");
    if (TYPES[chosen]) document.title = `${TYPES[chosen].title} · Geerho`;
    if (editId) document.title = "Edit Listing · Geerho";
    await postForm(main, chosen, { editId, me: user });
    return;
  }
  const banner = await teamBanner();
  main.replaceChildren(...[
    el("h1", { class: "large-title" }, "Post"),
    el("h2", { class: "post-question" }, "What would you like to post?"),
    banner,
    ...CHOICES.flatMap(([section, list]) => [
      el("p", { class: "group-title" }, section),
      el("div", { class: "post-cards" }, list.map(([key, title, subtitle, iconName, tint]) =>
        el("a", { class: "post-card", href: `post.html?type=${key}` }, rowIcon(iconName, tint),
          el("span", { class: "row-title" }, el("strong", {}, title), el("small", {}, subtitle)), icon("chevronRight", "chev")))),
    ]),
    el("p", { class: "group-footer", style: "margin-top:8px" }, "Everyone who posts on Geerho verifies their identity first.")].filter(Boolean));
}

/** On an Elite's team: "Post for <name>" like the app (TeamPostingBanner). On by default; remembered in this browser. */
async function teamBanner() {
  const { activeTeam, postsForTeam, setPostsForTeam } = await import("./post-form.js");
  const team = await activeTeam();
  if (!team) return null;
  const input = el("input", { type: "checkbox", checked: postsForTeam(), class: "switch", "aria-label": `Post for ${team.name}` });
  const sub = el("small", {}, postsForTeam() ? "Your new posts are their listings; buyers pay them." : "Your new posts are your own.");
  input.addEventListener("change", () => {
    setPostsForTeam(input.checked);
    sub.textContent = input.checked ? "Your new posts are their listings; buyers pay them." : "Your new posts are your own.";
  });
  return el("label", { class: "post-card team-banner" }, rowIcon("team", "indigo"),
    el("span", { class: "row-title" }, el("strong", {}, `Post for ${team.name}`), sub), input);
}

render();
