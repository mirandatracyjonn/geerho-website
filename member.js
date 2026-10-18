// A member's public profile on geerho.com, like the app's PublicProfileView: photo, name and Verified badge, level,
// rating, city, member since, bio, Follow and Message, Followers · Following · Contacts, licenses, listings, reviews.
import { el, listingCard } from "./site.js";
import { currentUser, friendlyError, signInURL, supabase } from "./auth.js";
import { icon, verifiedBadge } from "./icons.js";
import { avatar, memberStar } from "./profile.js";
import { textDialog } from "./ui-dialog.js";

const main = document.getElementById("member");
const status = document.getElementById("status");
const id = new URLSearchParams(location.search).get("id");

async function render() {
  if (!id) { status.textContent = "This member wasn't found."; return; }
  const me = await currentUser();
  const [{ data: p }, { data: follows }, { data: rating }, { data: licenses }, { data: listings }, { data: reviews }] = await Promise.all([
    supabase.from("profiles").select("id, username, display_name, avatar_url, bio, city, created_at, verified_at, milestone_level, beta_badge_at, staff_badge_at").eq("id", id).maybeSingle(),
    supabase.rpc("follow_summary", { member: id }),
    supabase.rpc("rating_summary", { target: id }),
    supabase.rpc("public_licenses", { person: id }),
    supabase.rpc("search_listings", { seller: id, sort: "newest", page_size: 40 }),
    supabase.from("reviews").select("id, rating, body, reply, reviewee_role, created_at, published:is_published, reviewer:profiles!reviews_reviewer_id_fkey(username, display_name, avatar_url)")
      .eq("reviewee_id", id).order("created_at", { ascending: false }).limit(50),
  ]);
  if (!p) {
    status.replaceChildren(me ? "This member wasn't found." : el("span", {}, el("a", { href: signInURL() }, "Sign in"), " to see member profiles."));
    return;
  }
  const name = p.display_name || `@${p.username}`;
  document.title = `${name} · Geerho`;
  const r = Array.isArray(rating) ? rating[0] : rating;
  const isMe = me?.id === p.id;

  const buttons = el("div", { class: "member-actions" });
  if (me && !isMe) {
    const follow = el("button", { type: "button", class: follows?.i_follow ? "secondary" : "" }, follows?.i_follow ? "Following" : "Follow");
    follow.addEventListener("click", async () => {
      follow.disabled = true;
      const { error } = await supabase.rpc(follows?.i_follow ? "unfollow" : "follow", { member: p.id });
      follow.disabled = false;
      if (error) { status.hidden = false; status.textContent = friendlyError(error); return; }
      main.replaceChildren();
      render();
    });
    const message = el("button", { type: "button", class: "secondary" }, "Message");
    message.addEventListener("click", async () => {
      message.disabled = true;
      const { data: conversation, error } = await supabase.rpc("start_direct_conversation", { member: p.id });
      if (!error) { location.href = `messages.html?c=${conversation}`; return; }
      message.disabled = false;
      status.hidden = false;
      status.textContent = /verif/i.test(error.message) ? "Verify your identity to message members (Profile → Settings → Identity Verification)." : friendlyError(error);
    });
    buttons.append(follow, message);
  } else if (isMe) {
    buttons.append(el("a", { class: "button secondary", href: "account.html#edit" }, "Edit Profile"));
  } else {
    buttons.append(el("a", { class: "button", href: signInURL() }, "Sign in to follow"));
  }

  const published = (reviews ?? []).filter((x) => x.published);
  main.append(
    el("div", { class: "profile-card" },
      el("div", { class: "who" }, avatar(p.avatar_url, name, 72),
        el("div", {},
          el("span", { class: "name" }, memberStar(p), name, p.verified_at ? verifiedBadge(20) : null),
          el("p", { class: "handle" }, `@${p.username}`),
          p.milestone_level ? el("span", { class: "pill on-brand" }, `Level ${p.milestone_level}`) : null,
          el("span", { class: "pill white" }, r?.total ? [icon("star", "icon star-fill"), ` ${Number(r.average).toFixed(1)} (${r.total})`] : [icon("star"), " No reviews yet"]),
          p.city ? el("p", { class: "city" }, icon("pin"), p.city) : null,
          el("p", { class: "city" }, `Member since ${new Date(p.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}`))),
      p.bio ? el("p", { class: "bio" }, p.bio) : null,
      follows?.follows_me && !isMe ? el("span", { class: "pill on-brand" }, "Follows you") : null),
    buttons,
    follows ? el("ul", { class: "group" }, el("li", { class: "plain" }, el("div", { class: "follow-bar" },
      ...[["followers", "Followers"], ["following", "Following"], ["contacts", "Contacts"]].map(([key, label]) =>
        el("span", {}, el("strong", {}, String(follows[key] ?? 0)), el("span", {}, label)))))) : null,
    (licenses ?? []).length ? [el("p", { class: "group-title" }, "Professional licenses"),
      el("ul", { class: "group plain" }, licenses.map((l) => el("li", { class: "cell-pad" },
        el("strong", {}, l.profession_name ?? l.profession ?? "License"), " ", el("span", { class: "state good" }, "Verified"),
        el("p", { class: "hint", style: "margin:2px 0 0" }, [l.subdivision, l.country].filter(Boolean).join(", ")))))] : null,
    el("p", { class: "group-title" }, `Listings (${(listings ?? []).length})`),
    (listings ?? []).length ? el("ul", { class: "cards" }, listings.map(listingCard)) : el("p", { class: "hint" }, "No live listings right now."),
    el("p", { class: "group-title" }, `Reviews (${published.length})`),
    published.length ? el("ul", { class: "group plain" }, published.map((x) => el("li", { class: "cell-pad" },
      el("div", { class: "item-row", style: "padding:0" }, avatar(x.reviewer?.avatar_url, x.reviewer?.display_name || x.reviewer?.username, 36),
        el("span", { class: "row-title" }, el("strong", {}, x.reviewer?.display_name || `@${x.reviewer?.username ?? "member"}`),
          el("small", {}, `${"★".repeat(x.rating)}${"☆".repeat(5 - x.rating)} · as ${x.reviewee_role === "seller" ? "seller" : x.reviewee_role ?? "member"} · ${new Date(x.created_at).toLocaleDateString()}`))),
      x.body ? el("p", { style: "margin:8px 0 0" }, x.body) : null,
      x.reply ? el("p", { class: "hint", style: "margin:6px 0 0" }, `Reply: ${x.reply}`) : null,
      isMe && !x.reply ? replyButton(x) : null))) : el("p", { class: "hint" }, "No reviews yet."),
  );
  status.hidden = true;
}

render();

/** One public reply to a review of you (same as the app). */
function replyButton(review) {
  const b = el("button", { type: "button", class: "link-button" }, "Reply");
  b.addEventListener("click", async () => {
    const text = await textDialog("Reply to this review", "Your reply shows under the review for everyone. You can reply once.", { okLabel: "Post Reply", min: 1 });
    if (!text) return;
    const { error } = await supabase.rpc("reply_to_review", { review: review.id, reply: text });
    if (error) { alert(friendlyError(error)); return; }
    b.replaceWith(el("p", { class: "hint", style: "margin:6px 0 0" }, `Reply: ${text}`));
  });
  return b;
}
