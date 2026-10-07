import { currentUser, friendlyError, supabase } from "./auth.js";
import { el } from "./site.js";

const BUCKET = "support-attachments";
const MAX_FILES = 10;
const MAX_BYTES = 15 * 1024 * 1024;
const REASONS = {
  general: "General question",
  account: "Account or sign-in",
  verification: "Identity verification",
  buying: "Problem with something I bought",
  selling: "Problem with something I sold",
  rental: "Rental problem",
  shipping: "Shipping, tracking, or delivery",
  payment: "Payment or refund",
  safety: "Safety concern or scam",
  report_user: "Report a person",
  bug: "Problem with the website or app",
  feedback: "Feedback or idea",
  privacy: "Privacy request (access, delete, correct)",
  legal: "Legal or copyright notice",
};
const STATUS_TEXT = { open: "Waiting for Geerho Support", answered: "Support replied", closed: "Closed" };

const params = new URLSearchParams(location.search);
const when = (iso) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

/** Uploads chosen files into the member's own folder and describes every attachment for the server. */
async function upload(userId, files, link) {
  const batch = crypto.randomUUID();
  const attachments = [];
  for (const [index, file] of files.entries()) {
    const ext = file.type === "application/pdf" ? "pdf" : (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${userId}/${batch}/${index}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
    if (error) throw new Error(`“${file.name}” couldn't be uploaded. Check your connection and try again.`);
    attachments.push({ kind: file.type === "application/pdf" ? "file" : "image", path, name: file.name });
  }
  if (link) attachments.push({ kind: "link", url: link });
  return attachments;
}

function checkFiles(files) {
  if (files.length > MAX_FILES) return `Attach up to ${MAX_FILES} files.`;
  const tooBig = files.find((file) => file.size > MAX_BYTES);
  if (tooBig) return `“${tooBig.name}” is larger than 15 MB.`;
  const wrongType = files.find((file) => !/^(image\/(jpeg|png|webp|heic)|application\/pdf)$/.test(file.type));
  if (wrongType) return `“${wrongType.name}” isn't a photo or PDF.`;
  return null;
}

function cleanLink(value) {
  const text = value.trim();
  if (!text) return { link: null };
  try {
    const url = new URL(text);
    if (url.protocol === "https:" || url.protocol === "http:") return { link: url.href };
  } catch {
    // Fall through.
  }
  return { error: "Enter a full web link that starts with https://" };
}

// --- New request --------------------------------------------------------------------------------------------

async function setupForm(user) {
  const reason = document.getElementById("reason");
  for (const [value, label] of Object.entries(REASONS)) reason.append(new Option(label, value));
  if (REASONS[params.get("reason")]) reason.value = params.get("reason");

  const subject = document.getElementById("subject");
  const { data: transactions } = await supabase.rpc("my_transactions");
  for (const t of transactions ?? []) {
    const label = { listing: "Listing", order: "Purchase request", sale: "Sale" }[t.kind] ?? t.kind;
    subject.append(new Option(`${t.reference} · ${label} · ${t.title}`, `${t.kind}:${t.id}`));
  }
  const wanted = params.get("ref");
  if (wanted) {
    const match = (transactions ?? []).find((t) => t.reference === wanted);
    if (match) subject.value = `${match.kind}:${match.id}`;
  }

  const form = document.getElementById("ticket-form");
  const error = document.getElementById("ticket-error");
  const bodyError = document.getElementById("body-error");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    bodyError.hidden = true;
    const body = document.getElementById("body").value.trim();
    if (!body) {
      bodyError.textContent = "Tell us what happened.";
      bodyError.hidden = false;
      document.getElementById("body").focus();
      return;
    }
    const files = [...document.getElementById("files").files];
    const fileProblem = checkFiles(files);
    const { link, error: linkProblem } = cleanLink(document.getElementById("link").value);
    if (fileProblem || linkProblem) {
      error.textContent = fileProblem ?? linkProblem;
      error.hidden = false;
      return;
    }
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const attachments = await upload(user.id, files, link);
      const [kind, id] = subject.value ? subject.value.split(":") : [null, null];
      const { data: ticketId, error: problem } = await supabase.rpc("open_support_ticket", {
        reason: reason.value, body, subject_kind: kind, subject_id: id, attachments,
      });
      if (problem) throw problem;
      location.replace(`contact.html?t=${ticketId}`);
    } catch (problem) {
      button.disabled = false;
      error.textContent = friendlyError(problem);
      error.hidden = false;
    }
  });
}

// --- Requests and replies -----------------------------------------------------------------------------------

async function renderTicketList() {
  const list = document.getElementById("ticket-list");
  const { data, error } = await supabase.rpc("support_tickets_list", { staff_view: false, only_status: null });
  if (error) {
    list.replaceChildren(el("li", { class: "status bad" }, friendlyError(error)));
    return data;
  }
  list.replaceChildren(...(data ?? []).map((ticket) => el("li", {},
    el("a", { href: `contact.html?t=${ticket.id}`, class: ticket.unread ? "unread" : null },
      el("strong", {}, `${ticket.reference} · ${REASONS[ticket.reason] ?? ticket.reason}`),
      el("span", { class: "card-meta" }, ` ${STATUS_TEXT[ticket.status] ?? ticket.status}${ticket.unread ? " · New reply" : ""}`),
    ),
  )));
  if (!data?.length) list.replaceChildren(el("li", { class: "status-line" }, "No support requests yet."));
  return data;
}

async function attachmentLink(attachment) {
  if (attachment.kind === "link" && attachment.url) {
    return el("a", { href: attachment.url, rel: "noopener noreferrer", target: "_blank" }, attachment.url);
  }
  if (!attachment.path) return null;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(attachment.path, 3600);
  const label = attachment.name || (attachment.kind === "audio" ? "Voice recording" : attachment.kind === "image" ? "Photo" : "File");
  return data?.signedUrl ? el("a", { href: data.signedUrl, rel: "noopener noreferrer", target: "_blank" }, label) : el("span", {}, label);
}

async function renderTicket(ticketId, tickets) {
  const view = document.getElementById("ticket-view");
  const ticket = (tickets ?? []).find((t) => t.id === ticketId);
  if (!ticket) return;
  const { data: messages, error } = await supabase.rpc("support_ticket_thread", { ticket: ticketId });
  if (error) {
    view.replaceChildren(el("p", { class: "status bad" }, friendlyError(error)));
    view.hidden = false;
    return;
  }
  const items = [];
  for (const message of messages ?? []) {
    const links = (await Promise.all((message.attachments ?? []).map(attachmentLink))).filter(Boolean);
    items.push(el("li", { class: message.from_staff ? "bubble" : "bubble mine" },
      el("span", { class: "card-meta" }, `${message.from_staff ? "Geerho Support" : "You"} · ${when(message.created_at)}`),
      el("p", {}, message.body),
      links.length ? el("ul", { class: "attachments" }, links.map((link) => el("li", {}, link))) : null,
    ));
  }
  view.replaceChildren(
    el("p", { class: "back" }, el("a", { href: "contact.html" }, "← New request")),
    el("h2", {}, `${ticket.reference} · ${REASONS[ticket.reason] ?? ticket.reason}`),
    el("p", { class: "meta" }, STATUS_TEXT[ticket.status] ?? ticket.status,
      ticket.subject_reference ? ` · About ${ticket.subject_reference}` : ""),
    el("ol", { class: "bubbles support-thread" }, items),
    ticket.status === "closed"
      ? el("p", { class: "hint" }, "This request is closed. Start a new request if you need more help.")
      : replyForm(ticketId),
  );
  view.hidden = false;
  document.getElementById("ticket-start").hidden = true;
  if (ticket.unread) await supabase.rpc("mark_support_ticket_read", { ticket: ticketId });
}

function replyForm(ticketId) {
  const textarea = el("textarea", { id: "reply-body", rows: "4", maxlength: "5000", "aria-label": "Your reply" });
  const files = el("input", { type: "file", id: "reply-files", multiple: true, accept: "image/jpeg,image/png,image/webp,image/heic,application/pdf", "aria-label": "Attach photos or PDFs" });
  const error = el("p", { class: "status bad", role: "alert", hidden: true });
  const form = el("form", { class: "composer stacked" },
    el("label", { for: "reply-body" }, "Reply"), textarea, files, el("button", { type: "submit" }, "Send reply"), error);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    const body = textarea.value.trim();
    const chosen = [...files.files];
    if (!body) {
      error.textContent = "Write a reply first.";
      error.hidden = false;
      return;
    }
    const problem = checkFiles(chosen);
    if (problem) {
      error.textContent = problem;
      error.hidden = false;
      return;
    }
    form.querySelector("button").disabled = true;
    try {
      const user = await currentUser();
      const attachments = await upload(user.id, chosen, null);
      const { error: replyError } = await supabase.rpc("reply_to_support_ticket", { ticket: ticketId, body, attachments });
      if (replyError) throw replyError;
      location.reload();
    } catch (failure) {
      form.querySelector("button").disabled = false;
      error.textContent = friendlyError(failure);
      error.hidden = false;
    }
  });
  return form;
}

async function start() {
  const user = await currentUser();
  if (!user) {
    const next = `contact.html${location.search}`;
    document.getElementById("support-sign-in").href = `account.html?next=${encodeURIComponent(next)}`;
    document.getElementById("support-signed-out").hidden = false;
    return;
  }
  document.getElementById("support-signed-in").hidden = false;
  const tickets = await renderTicketList();
  if (params.get("t")) await renderTicket(params.get("t"), tickets);
  await setupForm(user);
}

start();
