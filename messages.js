// Messages page: your chats, messages, reactions, and reporting, refreshed every few seconds.
import { currentUser, friendlyError, signInURL, supabase } from "./auth.js";
import { el, money, photoURL } from "./site.js";
import { selection } from "./select-delete.js";
import { confirmDialog } from "./ui-dialog.js";
import { translateButton } from "./translate.js";

const MESSAGE_COLUMNS = "id, conversation_id, sender_id, body, created_at, read_at, is_system, deleted_at, media_path, media_kind, media_width, media_height, media_seconds, media_name, media_bytes, latitude, longitude, place_name";
const CHAT_BUCKET = "chat-media";
const MAX_BYTES = 50 * 1024 * 1024;           // same limit as the app
const REACTIONS = ["❤️", "👍", "👎", "😂", "😮", "😢", "😡"];
let reactionsByMessage = new Map();           // message id → [{ user_id, emoji }]
const REFRESH_MS = 8000;
const REPORT_REASONS = {
  scam_or_fraud: "Scam or fraud",
  harassment: "Harassment or threats",
  discrimination: "Discrimination",
  offensive_content: "Offensive content",
  spam: "Spam",
  prohibited_item: "Prohibited item",
  counterfeit: "Counterfeit or stolen",
  hidden_fees: "Hidden fees or price not shown",
  other: "Something else",
};

const status = document.getElementById("status");
const inbox = document.getElementById("inbox");
const list = document.getElementById("conversation-list");
const thread = document.getElementById("thread");
// M149: swipe left (phones) deletes; long press or Select picks several; Delete all (from your view only).
const FOR_ME = "They're removed from your view only. The other person keeps theirs.";
const listBar = el("div", { class: "select-bar" });
list.before(listBar);
const listPicker = selection({ bar: listBar, what: "chats", confirmText: FOR_ME, remove: async (ids) => {
  const { error } = await supabase.rpc("delete_conversations_for_me", { ids: ids ?? conversations.map((c) => c.id) });
  if (error) { alert(friendlyError(error)); return; }
  if (ids === null || ids.includes(openId)) { openId = null; history.replaceState(null, "", "messages.html"); loadThread(true); }
  loadConversations();
} });
let threadPicker = null;

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
    return listPicker.attach(el("li", { "data-swipe": "" },
      el("a", { href: `?c=${c.id}`, class: unread ? "unread" : null, "aria-current": c.id === openId ? "true" : null, "data-id": c.id },
        c.listing_cover_path ? el("img", { src: photoURL(c.listing_cover_path), alt: "", loading: "lazy" }) : el("span", { class: "thumb-empty" }),
        el("span", { class: "conversation-text" },
          el("strong", {}, nameOf(c)),
          el("span", { class: "card-meta" }, c.listing_title ?? "Listing removed"),
          c.last_message_body && el("span", { class: "preview" }, `${unread ? `${c.unread_count} new · ` : ""}${c.last_message_body}`),
        ),
      ),
    ), c.id);
  }));
  listPicker.paint();
  // Geerho Support threads first, like the app's Inbox.
  const { data: tickets } = await supabase.rpc("support_tickets_list", { staff_view: false, only_status: null });
  const open = (tickets ?? []).filter((t) => !t.deleted_at);
  const deleted = (tickets ?? []).filter((t) => t.deleted_at);
  // Delete a support thread from your Inbox; it waits in Recently Deleted for 7 days (a new reply brings it back), M39.
  const ticketAction = (t, label, rpcName) => {
    const b = el("button", { type: "button", class: "link-button ticket-action" }, label);
    b.addEventListener("click", async (event) => {
      event.preventDefault();
      if (rpcName === "delete_support_ticket" && !(await confirmDialog("Delete this conversation?", "It moves to Recently Deleted for 7 days. A new reply from Geerho Support brings it back.", "Delete", { danger: true }))) return;
      const { error } = await supabase.rpc(rpcName, { ticket: t.id });
      if (error) { alert(friendlyError(error)); return; }
      loadConversations();
    });
    return b;
  };
  if (open.length || deleted.length) {
    list.prepend(el("li", { class: "inbox-section" }, "Geerho Support"),
      ...open.map((t) => el("li", { class: "ticket-row" }, el("a", { href: `contact.html?t=${t.id}`, class: t.unread ? "unread" : null },
        el("span", { class: "thumb-empty support-mark" }, el("img", { src: "logo-mark.png", alt: "" })),
        el("span", { class: "conversation-text" }, el("strong", {}, "Geerho Support"),
          el("span", { class: "card-meta" }, [t.reference, t.subject_title].filter(Boolean).join(" · ")),
          t.last_message ? el("span", { class: "preview" }, `${t.unread ? "New reply · " : ""}${t.last_message}`) : null)),
        ticketAction(t, "Delete", "delete_support_ticket"))),
      ...(deleted.length ? [el("li", {}, el("details", { class: "recently-deleted" }, el("summary", {}, `Recently Deleted (${deleted.length})`),
        el("ul", { class: "plain" }, ...deleted.map((t) => el("li", { class: "ticket-row" },
          el("span", { class: "conversation-text" }, el("strong", {}, [t.reference, t.subject_title].filter(Boolean).join(" · ") || "Geerho Support"),
            el("span", { class: "card-meta" }, `Deleted ${new Date(t.deleted_at).toLocaleDateString()}`)),
          ticketAction(t, "Restore", "restore_support_ticket"))))))] : []),
      el("li", { class: "inbox-section" }, "Messages"));
  }
  if (!conversations.length) {
    list.append(el("li", { class: "status-line" }, "No messages yet. When you message a seller, or someone messages you about your listing, it shows up here."));
  }
}

function messageBubble(message) {
  const mine = message.sender_id === me.id;
  // Sent by Geerho (tour confirmed, rental request, ...): a centered event card, not a person's bubble.
  if (message.is_system) {
    return el("li", { class: "system-card", "data-id": message.id },
      el("span", { class: "card-meta" }, `Geerho · sent on ${mine ? "your" : "their"} behalf · ${when(message.created_at)}`),
      el("p", {}, message.body),
    );
  }
  if (message.deleted_at) {
    return el("li", { class: mine ? "bubble mine deleted" : "bubble deleted", "data-id": message.id },
      el("p", {}, "This message was deleted"), el("span", { class: "card-meta" }, when(message.created_at)));
  }
  // Delete for Me (anyone's message) or Delete for Everyone (your own), like the app's message menu (M50).
  const item = el("li", { class: `${mine ? "bubble mine" : "bubble"}${message.media_kind === "sticker" ? " sticker" : ""}`, "data-id": message.id },
    message.media_kind ? mediaView(message) : null,
    message.body ? el("p", {}, message.body) : null,
    el("span", { class: "card-meta" }, when(message.created_at)),
    reactionBar(message));
  const remove = async (forEveryone) => {
    const ok = await confirmDialog(forEveryone ? "Delete for everyone?" : "Delete for you?",
      forEveryone
        ? "It's removed from this chat for both of you and shows as \"This message was deleted.\" To keep the community safe, Geerho keeps a private copy that only moderators can see."
        : "It's removed from your view only. The other person can still see it.",
      forEveryone ? "Delete for Everyone" : "Delete for Me", { danger: true });
    if (!ok) return;
    const { error } = await supabase.rpc("delete_message", { message: message.id, for_everyone: forEveryone });
    if (error) { alert(friendlyError(error)); return; }
    if (forEveryone) item.replaceWith(messageBubble({ ...message, deleted_at: new Date().toISOString() }));
    else item.remove();
  };
  const menu = el("span", { class: "bubble-actions" },
    el("button", { type: "button", class: "link-button" }, "Delete for Me"),
    mine ? el("button", { type: "button", class: "link-button" }, "Delete for Everyone") : null);
  const [forMe, forAll] = menu.querySelectorAll("button");
  // Translate (2026-10-19, translate.js): shows the translation under the message.
  if (message.body) menu.append(translateButton(message.body, item.querySelector("p")));
  forMe.addEventListener("click", () => remove(false));
  forAll?.addEventListener("click", () => remove(true));
  item.append(menu);
  return item;
}

/** A photo, video, voice message, file, sticker, or location in a chat (files open through 1-hour signed links). */
function mediaView(message) {
  if (message.media_kind === "location") {
    const where = message.place_name || `${Number(message.latitude).toFixed(5)}, ${Number(message.longitude).toFixed(5)}`;
    return el("a", { class: "chat-location", href: `https://maps.google.com/?q=${message.latitude},${message.longitude}`, target: "_blank", rel: "noopener" }, `📍 ${where}`);
  }
  const holder = el("div", { class: "chat-media" }, el("span", { class: "card-meta" }, "Loading…"));
  supabase.storage.from(CHAT_BUCKET).createSignedUrl(message.media_path, 3600).then(({ data }) => {
    const url = data?.signedUrl;
    if (!url) { holder.replaceChildren(el("span", { class: "card-meta" }, "This file isn't available.")); return; }
    const kind = message.media_kind;
    holder.replaceChildren(kind === "image" || kind === "sticker" ? el("a", { href: url, target: "_blank", rel: "noopener" }, el("img", { src: url, alt: kind === "sticker" ? "Sticker" : "Photo", loading: "lazy" }))
      : kind === "video" ? el("video", { src: url, controls: true, playsinline: true, preload: "metadata" })
      : kind === "audio" ? el("audio", { src: url, controls: true, preload: "metadata" })
      : el("a", { href: url, target: "_blank", rel: "noopener", download: message.media_name || "" }, `📄 ${message.media_name || "File"}${message.media_bytes ? ` · ${Math.max(1, Math.round(message.media_bytes / 1024))} KB` : ""}`));
  });
  return holder;
}

/** Emoji reactions under a message (the app's set); tap one of yours again to remove it. */
function reactionBar(message) {
  const bar = el("div", { class: "reactions" });
  const draw = () => {
    const rows = reactionsByMessage.get(message.id) ?? [];
    const counts = new Map();
    for (const r of rows) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
    const mineEmoji = rows.find((r) => r.user_id === me.id)?.emoji ?? null;
    const chips = [...counts].map(([emoji, n]) => el("span", { class: `reaction${emoji === mineEmoji ? " mine" : ""}` }, `${emoji}${n > 1 ? ` ${n}` : ""}`));
    const add = el("button", { type: "button", class: "link-button react-add", "aria-label": "React" }, "＋");
    const picker = el("span", { class: "react-picker", hidden: true }, ...REACTIONS.map((emoji) => {
      const b = el("button", { type: "button", class: "react-choice", "aria-label": `React ${emoji}` }, emoji);
      b.addEventListener("click", async () => {
        const remove = emoji === mineEmoji;
        const { error } = remove
          ? await supabase.from("message_reactions").delete().eq("message_id", message.id).eq("user_id", me.id)
          : await supabase.from("message_reactions").upsert({ message_id: message.id, emoji }, { onConflict: "message_id,user_id" });
        if (error) return;
        const others = (reactionsByMessage.get(message.id) ?? []).filter((r) => r.user_id !== me.id);
        reactionsByMessage.set(message.id, remove ? others : [...others, { user_id: me.id, emoji }]);
        draw();
      });
      return b;
    }));
    add.addEventListener("click", () => { picker.hidden = !picker.hidden; });
    bar.replaceChildren(...chips, add, picker);
  };
  draw();
  bar.redraw = draw;
  return bar;
}

async function loadReactions() {
  const { data } = await supabase.from("message_reactions").select("message_id, user_id, emoji").eq("conversation_id", openId);
  reactionsByMessage = new Map();
  for (const r of data ?? []) reactionsByMessage.set(r.message_id, [...(reactionsByMessage.get(r.message_id) ?? []), r]);
  document.querySelectorAll("#bubbles .reactions").forEach((bar) => bar.redraw?.());
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
    const bar = el("div", { class: "select-bar" });
    const conversationId = openId;
    threadPicker = selection({ bar, what: "messages", confirmText: FOR_ME, remove: async (ids) => {
      const { error } = await supabase.rpc("delete_messages_for_me", { conversation: conversationId, ids });
      if (error) { alert(friendlyError(error)); return; }
      for (const li of [...document.querySelectorAll("#bubbles > li[data-id]")]) {
        if (ids === null || ids.includes(li.dataset.id)) { shownMessageIds.delete(li.dataset.id); li.remove(); }
      }
      threadPicker.paint();
      loadConversations();
    } });
    const lastReal = [...messages].reverse().find((m) => !m.is_system);
    const replies = lastReal && lastReal.sender_id !== me.id && (lastReal.body ?? "").trim() ? basicReplies(lastReal.body, conversation.i_am_seller) : [];
    thread.replaceChildren(header, bar, messagesList, composer(replies));
  }
  if (initial) await loadReactions(); else loadReactions();
  const bubbles = document.getElementById("bubbles");
  const fresh = messages.filter((m) => !shownMessageIds.has(m.id));
  for (const message of fresh) {
    shownMessageIds.add(message.id);
    const node = messageBubble(message);
    if (!message.is_system) { node.setAttribute("data-swipe", ""); threadPicker?.attach(node, message.id); }
    bubbles.append(node);
  }
  if (fresh.length) bubbles.scrollTop = bubbles.scrollHeight;
  if (!messages.length && initial) bubbles.append(el("li", { class: "status-line" }, "Say hello. Ask about the item, or arrange a time and a public place to meet."));
  if (fresh.some((m) => m.sender_id !== me.id) || (initial && conversation.unread_count > 0)) {
    await supabase.rpc("mark_conversation_read", { conversation: openId });
  }
}

// M172 batch (2026-10-23): tap-to-fill reply suggestions when the other person wrote last; the same ready-made list as
// the apps (which also use on-device AI when the phone has it). Tapping one only fills the box.
function basicReplies(last, iAmSeller) {
  const t = String(last).toLowerCase();
  const has = (...w) => w.some((x) => t.includes(x));
  if (has("available", "still have", "still for sale", "is this sold"))
    return iAmSeller ? ["Yes, it's still available!", "Sorry, it's sold.", "Yes! When would you like to pick it up?"] : ["Great, I'll take it!", "Can I see it today?", "Thanks for letting me know."];
  if (has("lowest", "best price", "discount", "negotiable", "last price", "offer"))
    return iAmSeller ? ["The price is firm, sorry.", "Make me an offer in the app.", "I can go a little lower. What's your offer?"] : ["Would you take a bit less?", "I'll make an offer in the app.", "OK, that works for me."];
  if (has("where", "meet", "pick up", "pickup", "location")) return ["Can we meet somewhere public?", "What time works for you?", "I can ship it too."];
  if (has("when", "what time", "today", "tomorrow")) return ["Today works for me.", "Tomorrow works for me.", "What time is good for you?"];
  if (has("ship", "shipping", "deliver"))
    return iAmSeller ? ["Yes, I can ship it.", "Shipping is shown on the listing.", "Pickup only, sorry."] : ["Please ship it.", "How much is shipping?", "I'll pick it up instead."];
  if (has("thank", "salamat")) return ["You're welcome!", "Thanks to you too!", "Anytime!"];
  if (has("?")) return ["Yes.", "No, sorry.", "Let me check and get back to you."];
  return ["OK!", "Thanks!", "Sounds good."];
}

function composer(replies = []) {
  const textarea = el("textarea", { id: "message-body", rows: "3", maxlength: "4000", "aria-label": "Message", placeholder: "Write a message" });
  const error = el("p", { class: "status bad", role: "alert", hidden: true });
  const fileInput = el("input", { type: "file", class: "sr-only", id: "chat-file", accept: "image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip" });
  const attach = el("label", { class: "button secondary composer-tool", for: "chat-file", title: "Send a photo, video, voice message, or file" }, "📎 Attach");
  const locate = el("button", { type: "button", class: "secondary composer-tool", title: "Share your location" }, "📍 Location");
  const chips = el("div", { class: "reply-chips", role: "group", "aria-label": "Suggested replies", hidden: replies.length === 0 },
    ...replies.map((r) => { const b = el("button", { type: "button", class: "secondary" }, r); b.addEventListener("click", () => { textarea.value = r; textarea.focus(); chips.hidden = true; }); return b; }));
  textarea.addEventListener("input", () => { chips.hidden = textarea.value.length > 0 || replies.length === 0; });
  const form = el("form", { class: "composer" }, chips, textarea, el("div", { class: "composer-tools" }, attach, fileInput, locate), el("button", { type: "submit" }, "Send"), error);
  const showError = (problem) => {
    error.textContent = /verif/i.test(problem?.message ?? "") ? "Verify your identity to send messages. Go to Profile → Settings → Identity Verification to start." : (typeof problem === "string" ? problem : friendlyError(problem));
    error.hidden = false;
  };
  const appendSent = (data) => {
    shownMessageIds.add(data.id);
    const bubbles = document.getElementById("bubbles");
    bubbles.querySelector(".status-line")?.remove();
    bubbles.append(messageBubble(data));
    bubbles.scrollTop = bubbles.scrollHeight;
    loadConversations();
  };
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    error.hidden = true;
    if (file.size > MAX_BYTES) return showError("That file is too big to send (50 MB at most).");
    const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "file";
    const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
    const path = `${me.id}/${openId}/${crypto.randomUUID()}.${ext}`;
    attach.classList.add("busy");
    const { error: upError } = await supabase.storage.from(CHAT_BUCKET).upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (upError) { attach.classList.remove("busy"); return showError(upError); }
    const { data, error: insertError } = await supabase.from("messages").insert({ conversation_id: openId, body: textarea.value.trim(), media_path: path,
      media_kind: kind, media_name: kind === "file" ? file.name.slice(0, 200) : null, media_bytes: file.size }).select(MESSAGE_COLUMNS).single();
    attach.classList.remove("busy");
    if (insertError) { await supabase.storage.from(CHAT_BUCKET).remove([path]); return showError(insertError); }
    textarea.value = "";
    appendSent(data);
  });
  locate.addEventListener("click", () => {
    error.hidden = true;
    if (!navigator.geolocation) return showError("This browser can't share your location.");
    locate.disabled = true;
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { data, error: insertError } = await supabase.from("messages").insert({ conversation_id: openId, body: "", media_kind: "location",
        latitude: pos.coords.latitude, longitude: pos.coords.longitude, place_name: null }).select(MESSAGE_COLUMNS).single();
      locate.disabled = false;
      if (insertError) return showError(insertError);
      appendSent(data);
    }, () => { locate.disabled = false; showError("Location wasn't shared. Allow location access for geerho.com and try again."); }, { enableHighAccuracy: true, timeout: 15000 });
  });
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
        ? "Verify your identity to send messages. Go to Profile → Settings → Identity Verification to start."
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
