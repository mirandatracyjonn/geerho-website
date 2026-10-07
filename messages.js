import { currentUser, friendlyError, signInURL, supabase } from "./auth.js";
import { el, money, photoURL } from "./site.js";

const MESSAGE_COLUMNS = "id, conversation_id, sender_id, body, created_at, read_at";
const REFRESH_MS = 8000;
const REPORT_REASONS = {
  scam_or_fraud: "Scam or fraud",
  harassment: "Harassment or threats",
  discrimination: "Discrimination",
  offensive_content: "Offensive content",
  spam: "Spam",
  prohibited_item: "Prohibited item",
  counterfeit: "Counterfeit or stolen",
  other: "Something else",
};

const status = document.getElementById("status");
const inbox = document.getElementById("inbox");
const list = document.getElementById("conversation-list");
const thread = document.getElementById("thread");

let me = null;
let conversations = [];
let openId = new URLSearchParams(location.search).get("c");
let shownMessageIds = new Set();

const when = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const nameOf = (c) => c.other_display_name || (c.other_username ? `@${c.other_username}` : "Deleted account");

async function loadConversations() {
  const { data, error } = await supabase.rpc("my_conversations");
  if (error) throw error;
  conversations = data ?? [];
  list.replaceChildren(...conversations.map((c) => {
    const unread = c.unread_count > 0;
    return el("li", {},
      el("a", { href: `?c=${c.id}`, class: unread ? "unread" : null, "aria-current": c.id === openId ? "true" : null, "data-id": c.id },
        c.listing_cover_path ? el("img", { src: photoURL(c.listing_cover_path), alt: "", loading: "lazy" }) : el("span", { class: "thumb-empty" }),
        el("span", { class: "conversation-text" },
          el("strong", {}, nameOf(c)),
          el("span", { class: "card-meta" }, c.listing_title ?? "Listing removed"),
          c.last_message_body && el("span", { class: "preview" }, `${unread ? `${c.unread_count} new · ` : ""}${c.last_message_body}`),
        ),
      ),
    );
  }));
  if (!conversations.length) {
    list.replaceChildren(el("li", { class: "status-line" }, "No conversations yet. Open a listing and choose “Message the seller.”"));
  }
}

function messageBubble(message) {
  const mine = message.sender_id === me.id;
  return el("li", { class: mine ? "bubble mine" : "bubble", "data-id": message.id },
    el("p", {}, message.body),
    el("span", { class: "card-meta" }, when(message.created_at)),
  );
}

async function loadThread(initial) {
  const conversation = conversations.find((c) => c.id === openId);
  if (!conversation) {
    thread.replaceChildren(el("p", { class: "status-line" }, openId ? "This conversation isn't available." : "Choose a conversation."));
    return;
  }
  const { data, error } = await supabase.from("messages").select(MESSAGE_COLUMNS)
    .eq("conversation_id", openId).order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  const messages = (data ?? []).reverse();

  if (initial) {
    shownMessageIds = new Set();
    const price = conversation.listing_price_cents != null ? money(conversation.listing_price_cents, conversation.listing_currency ?? "USD") : null;
    const header = el("div", { class: "thread-head" },
      el("div", {},
        el("a", { href: "messages.html", class: "thread-back" }, "← All messages"),
        el("h2", {}, nameOf(conversation)),
        el("p", { class: "card-meta" },
          conversation.listing_id
            ? el("a", { href: `listing.html?id=${conversation.listing_id}` }, conversation.listing_title)
            : "Listing removed",
          price ? ` · ${price}` : "",
          conversation.i_am_seller ? " · You're the seller" : ""),
      ),
      safetyMenu(conversation),
    );
    const messagesList = el("ol", { class: "bubbles", id: "bubbles" });
    thread.replaceChildren(header, messagesList, composer());
  }
  const bubbles = document.getElementById("bubbles");
  const fresh = messages.filter((m) => !shownMessageIds.has(m.id));
  for (const message of fresh) {
    shownMessageIds.add(message.id);
    bubbles.append(messageBubble(message));
  }
  if (fresh.length) bubbles.scrollTop = bubbles.scrollHeight;
  if (!messages.length && initial) bubbles.append(el("li", { class: "status-line" }, "Say hello. Ask about the item, or arrange a time and a public place to meet."));
  if (fresh.some((m) => m.sender_id !== me.id) || (initial && conversation.unread_count > 0)) {
    await supabase.rpc("mark_conversation_read", { conversation: openId });
  }
}

function composer() {
  const textarea = el("textarea", { id: "message-body", rows: "3", maxlength: "4000", "aria-label": "Message", placeholder: "Write a message" });
  const error = el("p", { class: "status bad", role: "alert", hidden: true });
  const form = el("form", { class: "composer" }, textarea, el("button", { type: "submit" }, "Send"), error);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = textarea.value.trim();
    if (!body) return;
    const button = form.querySelector("button");
    button.disabled = true;
    error.hidden = true;
    const { data, error: problem } = await supabase.from("messages")
      .insert({ conversation_id: openId, body }).select(MESSAGE_COLUMNS).single();
    button.disabled = false;
    if (problem) {
      error.textContent = /verif/i.test(problem.message)
        ? "Verify your identity to send messages. Go to your Account page to start."
        : friendlyError(problem);
      error.hidden = false;
      return;
    }
    textarea.value = "";
    shownMessageIds.add(data.id);
    const bubbles = document.getElementById("bubbles");
    bubbles.querySelector(".status-line")?.remove();
    bubbles.append(messageBubble(data));
    bubbles.scrollTop = bubbles.scrollHeight;
    loadConversations();
  });
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) form.requestSubmit();
  });
  return form;
}

function safetyMenu(conversation) {
  const details = el("details", { class: "safety" }, el("summary", {}, "Report or block"));
  const reason = el("select", { id: "report-reason" },
    Object.entries(REPORT_REASONS).map(([value, label]) => el("option", { value }, label)));
  const notes = el("textarea", { id: "report-details", rows: "2", maxlength: "1000", placeholder: "Anything else we should know (optional)" });
  const result = el("p", { class: "status", role: "status", hidden: true });
  const say = (text, good) => {
    result.textContent = text;
    result.className = `status ${good ? "good" : "bad"}`;
    result.hidden = false;
  };
  const report = el("button", { type: "button", class: "secondary" }, "Report this person");
  report.addEventListener("click", async () => {
    const row = { target_type: "user", reported_user_id: conversation.other_user_id, reason: reason.value };
    if (notes.value.trim()) row.details = notes.value.trim().slice(0, 1000);
    const { error } = await supabase.from("reports").insert(row);
    if (error?.code === "23505") return say("You've already reported this person. We're reviewing it.", true);
    if (error) return say(friendlyError(error), false);
    say("Thanks. We review reports within 24 hours.", true);
  });
  const block = el("button", { type: "button", class: "secondary" }, "Block this person");
  block.addEventListener("click", async () => {
    const { error } = await supabase.from("blocks").insert({ blocked_id: conversation.other_user_id });
    if (error && error.code !== "23505") return say(friendlyError(error), false);
    say("Blocked. They can't message you, and you won't see each other's listings. Unblock anytime in the app's Settings.", true);
  });
  details.append(
    el("div", { class: "safety-body" },
      el("label", { for: "report-reason" }, "Reason"), reason,
      el("label", { for: "report-details" }, "Details"), notes,
      el("div", { class: "actions" }, report, block),
      result,
    ),
  );
  return conversation.other_user_id ? details : el("span");
}

async function start() {
  me = await currentUser();
  if (!me) {
    location.replace(signInURL());
    return;
  }
  try {
    await loadConversations();
    status.hidden = true;
    inbox.hidden = false;
    if (openId) await loadThread(true);
  } catch (problem) {
    status.textContent = `We couldn't load your messages: ${friendlyError(problem)}`;
  }

  list.addEventListener("click", async (event) => {
    const link = event.target.closest("a[data-id]");
    if (!link) return;
    event.preventDefault();
    openId = link.dataset.id;
    history.replaceState(null, "", `?c=${openId}`);
    for (const other of list.querySelectorAll("a[aria-current]")) other.removeAttribute("aria-current");
    link.setAttribute("aria-current", "true");
    inbox.classList.add("show-thread");
    await loadThread(true).catch((problem) => thread.replaceChildren(el("p", { class: "status bad" }, friendlyError(problem))));
    loadConversations();
  });
  if (openId) inbox.classList.add("show-thread");

  // Keep the inbox fresh while the page is open.
  setInterval(async () => {
    if (document.hidden) return;
    try {
      await loadConversations();
      if (openId) await loadThread(false);
    } catch {
      // Try again on the next tick.
    }
  }, REFRESH_MS);
}

start();
