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

// Must match the database's username rules (supabase/migrations/*_m1_marketplace_foundation.sql).
const RESERVED = new Set(["admin", "administrator", "geerho", "help", "moderator", "mod", "official",
  "root", "security", "staff", "support", "system", "team", "xenpen"]);

function usernameProblem(name) {
  if (name.length < 3) return "Use at least 3 characters.";
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
      return fail(saveError.code === "23505" ? "That username is taken. Try another." : friendlyError(saveError));
    }
    if (next) location.replace(next);
    else render();
  });
}

// --- Verification -------------------------------------------------------------------------------------------

const VERIFICATION_TEXT = {
  unverified: "Verify your identity to message, buy, sell, bid, and rent on Geerho. You'll need a government ID and a camera for a quick selfie. Our partner Didit checks it; Geerho never sees your ID images and keeps only your legal name, date of birth, the address on your ID (private to you), and a scrambled code that makes sure each person has one account.",
  in_progress: "Your verification has started but isn't finished. If you closed the window, you can start again.",
  in_review: "Thanks! Your verification is being reviewed. This usually takes a few minutes.",
  verified: "You're verified. You have the blue Verified badge on Geerho.",
  declined: "Your verification wasn't approved. You can try again if you have attempts left, or contact support.",
  duplicate: "Your ID is already verified on another Geerho account. Each person can have one account, so sign in with that one. We sent you a message in Geerho Support saying which account and how to sign in.",
  expired: "Your verification session expired. You can start a new one.",
};

async function renderVerification(profile) {
  const panel = document.getElementById("verification");
  const state = profile.verified_at ? { status: "verified", attempts: 0 } : await verificationState();
  const left = Math.max(0, 3 - (state.attempts ?? 0));
  if (state.decline_reason === "duplicate_account") {
    panel.replaceChildren(el("p", {}, VERIFICATION_TEXT.duplicate),
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
      panel.append(el("p", { class: "hint" }, `Founding Sellers: ${spots} of 300 spots left for the first members to verify.`));
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
        options: { redirectTo: new URL("account.html", location.href).href, scopes: provider === "github" ? "read:user user:email" : undefined },
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
  if (!user) return show("signedOut");

  let profile;
  try {
    profile = await myProfile(user.id);
  } catch (problem) {
    status.textContent = `We couldn't load your account: ${friendlyError(problem)}`;
    return;
  }
  if (!wired) {
    setupUsername(user);
    setupDelete(user);
    wired = true;
  }
  if (!profile.username) return show("username");
  if (next) return location.replace(next);

  document.getElementById("greeting").textContent = `Hi, @${profile.username}`;
  document.getElementById("signed-in-as").textContent = `Signed in as ${user.email ?? "a Geerho member"}.`;
  if (params.get("verification") === "done") {
    const notice = document.getElementById("notice");
    notice.textContent = "Thanks for verifying. We'll update your status here as soon as Didit sends the result.";
    notice.hidden = false;
  }
  show("signedIn");
  await renderVerification(profile);
  await renderSignInMethods();
}

// Sign-in redirects land here with a one-time code; the library swaps it for a session first.
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_IN") render();
});
render();
