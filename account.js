import { currentUser, friendlyError, myProfile, safeNext, signInWith, supabase, verificationState } from "./auth.js";
import { APPLE_WEB_SIGN_IN, el } from "./site.js";

// Shown only once Sign in with Apple for the web is configured in Supabase.
if (APPLE_WEB_SIGN_IN) document.querySelector('button[data-provider="apple"]').hidden = false;

const params = new URLSearchParams(location.search);
const next = safeNext(params.get("next"));
const status = document.getElementById("status");
const sections = {
  signedOut: document.getElementById("signed-out"),
  username: document.getElementById("choose-username"),
  signedIn: document.getElementById("signed-in"),
};

function show(name) {
  status.hidden = true;
  for (const [key, section] of Object.entries(sections)) section.hidden = key !== name;
}

// Must match the database's username rules (m1 + m60: 2–30 characters since 2026-10-13).
const RESERVED = new Set(["admin", "administrator", "geerho", "help", "moderator", "mod", "official",
  "root", "security", "staff", "support", "system", "team", "xenpen"]);

function usernameProblem(name) {
  if (name.length < 2) return "Use at least 2 characters.";
  if (name.length > 30) return "Use 30 characters or fewer.";
  if (!/^[a-z0-9_]+$/.test(name)) return "Use only letters, numbers, and underscores.";
  if (RESERVED.has(name)) return "That username is reserved.";
  return null;
}

// --- Signed out ---------------------------------------------------------------------------------------------

for (const button of document.querySelectorAll("button.provider")) {
  button.addEventListener("click", async () => {
    const error = document.getElementById("sign-in-error");
    error.hidden = true;
    try {
      await signInWith(button.dataset.provider, next);
    } catch (problem) {
      error.textContent = `We couldn't start sign-in: ${friendlyError(problem)}`;
      error.hidden = false;
    }
  });
}

// --- Username -----------------------------------------------------------------------------------------------

function setupUsername(user) {
  const form = document.getElementById("username-form");
  const input = document.getElementById("username");
  const error = document.getElementById("username-error");
  const fail = (message) => {
    error.textContent = message;
    error.hidden = false;
    input.setAttribute("aria-invalid", "true");
    input.focus();
  };
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    input.removeAttribute("aria-invalid");
    const name = input.value.trim().toLowerCase().replace(/^@/, "");
    const problem = usernameProblem(name);
    if (problem) return fail(problem);
    const button = form.querySelector("button");
    button.disabled = true;
    const { error: saveError } = await supabase.from("profiles").update({ username: name }).eq("id", user.id);
    button.disabled = false;
    if (saveError) {
      return fail(usernameError(saveError));
    }
    if (next) location.replace(next);
    else render();
  });
}

function usernameError(saveError) {
  if (saveError.code === "23505") {
    return /recently used/.test(saveError.message ?? "") ? saveError.message : "That username is taken. Try another.";
  }
  return friendlyError(saveError);
}

// Changing your username (M60): once every N days; your old one is held for you for N days.
async function renderUsernameChange(user, profile) {
  const form = document.getElementById("change-username-form");
  const input = document.getElementById("new-username");
  const error = document.getElementById("new-username-error");
  const hint = document.getElementById("new-username-hint");
  input.value = profile.username;
  const { data: status } = await supabase.rpc("my_username_status");
  const days = status?.change_days ?? 30;
  const nextAt = status?.next_change_at ? new Date(status.next_change_at) : null;
  const waiting = nextAt && nextAt > new Date();
  input.disabled = waiting;
  form.querySelector("button").disabled = waiting;
  hint.textContent = waiting
    ? `You can change your username again on ${nextAt.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}.`
    : `You can change your username once every ${days} days. Your old one is held for you for ${days} days.`;
  if (form.dataset.wired) return;
  form.dataset.wired = "1";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    input.removeAttribute("aria-invalid");
    const fail = (message) => { error.textContent = message; error.hidden = false; input.setAttribute("aria-invalid", "true"); input.focus(); };
    const name = input.value.trim().toLowerCase().replace(/^@/, "");
    if (name === profile.username) return fail("This is your current username.");
    const problem = usernameProblem(name);
    if (problem) return fail(problem);
    const button = form.querySelector("button");
    button.disabled = true;
    const { error: saveError } = await supabase.from("profiles").update({ username: name }).eq("id", user.id);
    button.disabled = false;
    if (saveError) return fail(usernameError(saveError));
    render();
  });
}

// --- Account recovery (M61) --------------------------------------------------------------------------------
// From a new sign-in (no username yet): ask moderators to recover an account; then follow the request.

const RECOVERY_BUCKET = "recovery-documents";
const OPEN_RECOVERY = ["submitted", "call_scheduled", "call_done"];
const when = (iso) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

let startingOver = false;

async function renderRecovery(user) {
  const status = document.getElementById("recovery-status");
  const form = document.getElementById("recovery-form");
  const { data: request } = await supabase.rpc("my_recovery_request");
  const showStatus = request && !startingOver && (OPEN_RECOVERY.includes(request.status) || ["rejected", "blocked"].includes(request.status));
  form.hidden = showStatus;
  status.hidden = !showStatus;
  if (showStatus) {
    if (!OPEN_RECOVERY.includes(request.status)) {
      const safeNote = String(request.note ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
      status.innerHTML = `<p class="status bad">✕ ${request.status === "blocked" ? "Stopped" : "Not approved"}${safeNote ? `: ${safeNote}` : ""}</p>`
        + `<button type="button" class="secondary" id="recovery-again">Start a new request</button>`
        + `<p class="hint">Your documents were deleted. If you start again, you'll need to send them again.</p>`;
      document.getElementById("recovery-again").addEventListener("click", () => { startingOver = true; renderRecovery(user); });
      return;
    }
    const step = (text, done) => `<li>${done ? "✓" : "○"} ${text}</li>`;
    const safe = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    status.innerHTML = `<p><strong>Request for @${safe(request.username)}</strong>, sent ${when(request.created_at)}.</p><ul class="link-list">`
      + step("Documents sent", true)
      + step(request.call_at ? `Video call on WhatsApp: ${when(request.call_at)}` : "A moderator checks your documents and schedules a WhatsApp video call", request.status !== "submitted")
      + step("Video call: sign your name three times on blank paper while the moderator watches", request.status === "call_done")
      + step(`A Super Admin finishes, no earlier than ${when(request.ready_at)}`, false) + "</ul>"
      + (OPEN_RECOVERY.includes(request.status)
        ? `<p class="hint">Keep WhatsApp handy. When it's done, sign in the same way you did today and you'll be in your account.</p><button type="button" class="secondary" id="recovery-cancel">Cancel request</button>`
        : "");
    document.getElementById("recovery-cancel")?.addEventListener("click", async () => {
      const { confirmDialog } = await import("./ui-dialog.js");
      if (!(await confirmDialog("Cancel your recovery request?", "Your documents are deleted.", "Cancel Request", { danger: true }))) return;
      const { data: documents, error } = await supabase.rpc("cancel_account_recovery");
      if (!error && documents?.length) await supabase.storage.from(RECOVERY_BUCKET).remove(documents.map((d) => d.path));
      renderRecovery(user);
    });
    return;
  }
  if (form.dataset.wired) return;
  form.dataset.wired = "1";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.getElementById("recovery-error");
    const fail = (message) => { error.textContent = message; error.hidden = false; };
    error.hidden = true;
    const ids = [...document.getElementById("rec-id").files];
    const proofs = [...document.getElementById("rec-proofs").files];
    if (ids.length < 1 || ids.length > 2) return fail("Add one or two photos of your ID (front, and back if needed).");
    if (proofs.length < 2 || proofs.length > 3) return fail("Add two proofs of address.");
    if ([...ids, ...proofs].some((file) => file.size > 15 * 1024 * 1024)) return fail("Each file must be smaller than 15 MB.");
    const button = form.querySelector("button");
    button.disabled = true;
    const uploaded = [];
    try {
      for (const [kind, files] of [["government_id", ids], ["proof_of_address", proofs]]) {
        for (const file of files) {
          const extension = file.type === "application/pdf" ? "pdf" : (file.type.split("/")[1] || "jpg");
          const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
          const { error: uploadError } = await supabase.storage.from(RECOVERY_BUCKET).upload(path, file, { contentType: file.type });
          if (uploadError) throw new Error(`“${file.name}” couldn't be uploaded. Check your connection and try again.`);
          uploaded.push({ path, kind });
        }
      }
      const { error: requestError } = await supabase.rpc("request_account_recovery", {
        username: document.getElementById("rec-username").value.trim().toLowerCase().replace(/^@/, ""),
        legal_name: document.getElementById("rec-name").value.trim(),
        date_of_birth: document.getElementById("rec-birth").value,
        whatsapp: document.getElementById("rec-phone").value,
        what_happened: document.getElementById("rec-what").value.trim(),
        documents: uploaded,
      });
      if (requestError) throw requestError;
      startingOver = false;
      renderRecovery(user);
    } catch (problem) {
      if (uploaded.length) await supabase.storage.from(RECOVERY_BUCKET).remove(uploaded.map((d) => d.path));
      fail(problem.message ? problem.message : friendlyError(problem));
    } finally {
      button.disabled = false;
    }
  });
}

// Signed in to an account someone is asking to recover: "This wasn't me".
async function renderRecoveryAlert() {
  const panel = document.getElementById("recovery-alert");
  const { data: open } = await supabase.rpc("recovery_requests_for_me");
  if (!open?.length) { panel.hidden = true; return; }
  panel.hidden = false;
  panel.innerHTML = `<h2>Someone asked to recover your account</h2><p>On ${when(open[0].created_at)}, someone asked Geerho moderators to recover this account. If that was you, there's nothing to do. If not, stop it now.</p><button type="button" class="secondary" id="recovery-object">This wasn't me</button>`;
  document.getElementById("recovery-object").addEventListener("click", async () => {
    for (const request of open) await supabase.rpc("object_to_recovery", { request: request.id });
    panel.innerHTML = `<p class="status good">Stopped. Your account stays as it is.</p>`;
  });
}

// --- "I already have a Geerho account" ---------------------------------------------------------------------
// A brand-new account (no username yet) can remove itself so the person signs in to the account they already have.

function setupExistingAccount(user) {
  const button = document.getElementById("existing-account");
  const error = document.getElementById("existing-error");
  if ((user.email ?? "").endsWith("privaterelay.appleid.com")) document.getElementById("hidden-email-note").hidden = false;
  button.addEventListener("click", async () => {
    error.hidden = true;
    // Two taps (no browser dialogs): the first asks, the second does it.
    if (!button.dataset.confirm) {
      button.dataset.confirm = "1";
      button.textContent = "Tap again to remove this new account";
      return;
    }
    button.disabled = true;
    const { error: problem } = await supabase.rpc("delete_account");
    if (problem) {
      button.disabled = false;
      error.textContent = `We couldn't remove this account: ${friendlyError(problem)}`;
      error.hidden = false;
      return;
    }
    await supabase.auth.signOut({ scope: "local" });
    location.replace("account.html?existing=1");
  });
}

// --- Verification -------------------------------------------------------------------------------------------

const VERIFICATION_TEXT = {
  unverified: "Verify your identity to message, buy, sell, bid, and rent on Geerho. You'll need a government ID and a camera for a quick selfie. Our partner Didit checks it; Geerho never sees your ID images and keeps only your legal name, date of birth, the address on your ID (private to you), and a scrambled code that makes sure each person has one account.",
  in_progress: "Your verification has started but isn't finished. If you closed the window, you can start again.",
  in_review: "Thanks! Your verification is being reviewed. This usually takes a few minutes.",
  verified: "You're verified. You have the blue Verified badge on Geerho.",
  declined: "Your verification wasn't approved. You can try again if you have attempts left, or contact support.",
  under18: "Geerho is for adults 18 and older. Your ID shows you're under 18, so we couldn't verify your account. You can keep browsing, but buying, selling, and messaging are for adults only. If your birth date was read incorrectly, contact Geerho Support.",
  duplicate: "Your ID is already verified on another Geerho account. Each person can have one account, so sign in with that one. We sent you a message in Geerho Support saying which account and how to sign in.",
  expired: "Your verification session expired. You can start a new one.",
};

async function renderVerification(profile) {
  const panel = document.getElementById("verification");
  const state = profile.verified_at ? { status: "verified", attempts: 0 } : await verificationState();
  const left = Math.max(0, 3 - (state.attempts ?? 0));
  if (state.decline_reason === "duplicate_account" || state.decline_reason === "under_18") {
    panel.replaceChildren(el("p", {}, state.decline_reason === "under_18" ? VERIFICATION_TEXT.under18 : VERIFICATION_TEXT.duplicate),
      el("p", {}, el("a", { href: "contact.html?reason=verification" }, "Open Geerho Support")));
    return;
  }
  panel.replaceChildren(el("p", {}, VERIFICATION_TEXT[state.status] ?? VERIFICATION_TEXT.unverified));
  if (state.status === "verified") return;

  if (["unverified", "in_progress", "declined", "expired"].includes(state.status)) {
    if (left === 0) {
      panel.append(el("p", {}, "You've used all your verification attempts. ",
        el("a", { href: "contact.html?reason=verification" }, "Contact support"), " and we'll help."));
      return;
    }
    const button = el("button", { type: "button" }, "Verify my identity");
    const error = el("p", { class: "status bad", role: "alert", hidden: true });
    button.addEventListener("click", async () => {
      button.disabled = true;
      error.hidden = true;
      const { data, error: problem } = await supabase.functions.invoke("start-verification", { body: { platform: "web" } });
      if (!problem && data?.url) {
        location.assign(data.url);
        return;
      }
      button.disabled = false;
      const code = problem?.context?.status;
      const reason = await problem?.context?.json?.().then((body) => body?.error).catch(() => null);
      error.textContent = reason === "duplicate_account" ? VERIFICATION_TEXT.duplicate
        : reason === "under_18" ? VERIFICATION_TEXT.under18
        : code === 409 ? "You're already verified."
        : code === 429 ? "You've used all your verification attempts. Contact support and we'll help."
        : "We couldn't start verification. Please try again in a moment.";
      error.hidden = false;
    });
    panel.append(el("p", { class: "hint" }, `${left} ${left === 1 ? "attempt" : "attempts"} left.`), button, error);
  }

  try {
    const { data: spots } = await supabase.rpc("founding_spots_left");
    if (typeof spots === "number" && spots > 0) {
      panel.append(el("p", { class: "hint" }, `Verification is free. Founding Members: ${spots} of 300 spots left for the first members to verify (no commission, and 25% off plans the first year, then 10%).`));
    }
  } catch {
    // Optional.
  }
}

// --- Sign-in methods ---------------------------------------------------------------------------------------

const PROVIDER_NAMES = { apple: "Apple", google: "Google", github: "GitHub" };

/** Supabase's linking errors, in plain words. */
function linkProblem(message) {
  if (/already|exists/i.test(message)) {
    return "That account already has its own Geerho account. Sign in with it, delete that account, then link it here. Or contact Support and we'll help.";
  }
  if (/manual linking/i.test(message)) return "Linking sign-in methods isn't turned on yet. Please try again later.";
  return `We couldn't link it: ${message}`;
}

async function renderSignInMethods() {
  const list = document.getElementById("linked-methods");
  const buttons = document.getElementById("link-buttons");
  const error = document.getElementById("link-error");
  const fail = (message) => { error.textContent = message; error.hidden = false; };
  // Coming back from a provider that refused to link.
  const returned = new URLSearchParams(location.hash.slice(1)).get("error_description") ?? params.get("error_description");
  if (returned) fail(linkProblem(returned));

  const { data, error: problem } = await supabase.auth.getUserIdentities();
  if (problem) return fail(friendlyError(problem));
  const identities = (data?.identities ?? []).filter((identity) => PROVIDER_NAMES[identity.provider]);
  list.replaceChildren(...identities.map((identity) => {
    const item = el("li", {}, el("strong", {}, PROVIDER_NAMES[identity.provider]),
      identity.identity_data?.email ? ` · ${identity.identity_data.email}` : "");
    if (identities.length > 1) {
      const remove = el("button", { type: "button", class: "secondary" }, "Remove");
      remove.addEventListener("click", async () => {
        if (!confirmRemoval(remove)) return;
        const { error: unlinkError } = await supabase.auth.unlinkIdentity(identity);
        if (unlinkError) return fail(friendlyError(unlinkError));
        renderSignInMethods();
      });
      item.append(" ", remove);
    }
    return item;
  }));

  const missing = Object.keys(PROVIDER_NAMES)
    .filter((provider) => !identities.some((identity) => identity.provider === provider))
    .filter((provider) => provider !== "apple" || APPLE_WEB_SIGN_IN);
  buttons.replaceChildren(...missing.map((provider) => {
    const button = el("button", { type: "button", class: "secondary" }, `Link ${PROVIDER_NAMES[provider]}`);
    button.addEventListener("click", async () => {
      error.hidden = true;
      const { error: linkError } = await supabase.auth.linkIdentity({
        provider,
        options: { redirectTo: new URL("account.html#settings", location.href).href, scopes: provider === "github" ? "read:user user:email" : undefined },
      });
      if (linkError) fail(linkProblem(linkError.message));
    });
    return button;
  }));
}

/** Two clicks to remove: the first asks, the second does it (no browser dialogs). */
function confirmRemoval(button) {
  if (button.dataset.confirm) return true;
  button.dataset.confirm = "1";
  button.textContent = "Tap again to remove";
  return false;
}

// --- Account actions ----------------------------------------------------------------------------------------

document.getElementById("sign-out").addEventListener("click", async () => {
  await supabase.auth.signOut({ scope: "local" });
  location.replace("index.html");
});

/** Storage files don't cascade with the database, so remove the user's own uploads first (best effort). */
async function removeOwnFiles(bucket, folder) {
  const { data } = await supabase.storage.from(bucket).list(folder, { limit: 1000 });
  const files = [];
  for (const item of data ?? []) {
    const path = `${folder}/${item.name}`;
    if (item.id === null) await removeOwnFiles(bucket, path);
    else files.push(path);
  }
  for (let i = 0; i < files.length; i += 100) await supabase.storage.from(bucket).remove(files.slice(i, i + 100));
}

function setupDelete(user) {
  const form = document.getElementById("delete-form");
  const error = document.getElementById("delete-error");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    if (document.getElementById("delete-confirm").value.trim() !== "DELETE") {
      error.textContent = "Type DELETE in capital letters to confirm.";
      error.hidden = false;
      return;
    }
    form.querySelector("button").disabled = true;
    for (const bucket of ["avatars", "listing-photos", "support-attachments"]) {
      await removeOwnFiles(bucket, user.id).catch(() => {});
    }
    const { error: problem } = await supabase.rpc("delete_account");
    if (problem) {
      form.querySelector("button").disabled = false;
      error.textContent = `Your account couldn't be deleted: ${friendlyError(problem)}`;
      error.hidden = false;
      return;
    }
    await supabase.auth.signOut({ scope: "local" });
    location.replace("index.html?deleted=1");
  });
}

// --- Page ---------------------------------------------------------------------------------------------------

let wired = false;

async function render() {
  const user = await currentUser();
  if (!user) {
    if (params.get("existing") === "1") {
      const error = document.getElementById("sign-in-error");
      error.textContent = "Done. Now sign in the way you did before, then add your other sign-in under Profile → Settings → Sign-in Methods.";
      error.className = "status good";
      error.hidden = false;
    }
    return show("signedOut");
  }

  let profile;
  try {
    profile = await myProfile(user.id);
  } catch (problem) {
    status.textContent = `We couldn't load your account: ${friendlyError(problem)}`;
    return;
  }
  if (!wired) {
    setupUsername(user);
    setupExistingAccount(user);
    setupDelete(user);
    wired = true;
  }
  if (!profile.username) {
    show("username");
    return renderRecovery(user);
  }
  if (next) return location.replace(next);

  document.getElementById("signed-in-as").textContent = `Signed in as ${user.email ?? "a Geerho member"}.`;
  if (params.get("verification") === "done") {
    const notice = document.getElementById("notice");
    notice.textContent = "Thanks for verifying. We'll update your status here as soon as Didit sends the result.";
    notice.hidden = false;
  }
  show("signedIn");
  // The Profile tab and its screens, laid out like the iPhone app (profile.js).
  const { startProfile } = await import("./profile.js");
  startProfile(user, profile, render);
  await renderRecoveryAlert();
  await renderUsernameChange(user, profile);
  await renderVerification(profile);
  await renderSignInMethods();
}

// Sign-in redirects land here with a one-time code; the library swaps it for a session first.
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_IN") render();
});
render();
