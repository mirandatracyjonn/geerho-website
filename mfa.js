// Two-step verification and passkeys on geerho.com (M98, TJ 2026-10-15), the same as the apps:
//   • Settings → Security: turn on two-step verification (scan a QR code with Google Authenticator, Microsoft
//     Authenticator, 1Password…, enter the 6-digit code, save 10 recovery codes), turn it off, add a passkey (Face ID,
//     Touch ID, Windows Hello, or a fingerprint) as the second step, or remove one.
//   • After signing in: if the account has a second step, ask for it before anything else (or a recovery code).
// Supabase Auth keeps the factors; recovery codes are hashed in the database (mfa-recover Edge Function uses them).
import { el } from "./site.js";
import { friendlyError, supabase } from "./auth.js";

const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";   // no 0/o, 1/l/i

function recoveryCodes() {
  return Array.from({ length: 10 }, () => {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

const passkeysSupported = () => typeof window.PublicKeyCredential === "function" && !!supabase.auth.mfa.webauthn;

async function factors() {
  const { data } = await supabase.auth.mfa.listFactors();
  const all = (data?.all ?? []).filter((f) => f.status === "verified");
  return { totp: all.filter((f) => f.factor_type === "totp"), passkeys: all.filter((f) => f.factor_type === "webauthn") };
}

/** Signed in but the second step is still owed (aal1 now, aal2 possible). */
export async function needsSecondStep() {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel === "aal1" && data?.nextLevel === "aal2";
}

function modal(title, ...content) {
  const dialog = el("dialog", { class: "g-dialog mfa-dialog" }, el("h2", {}, title), ...content.flat().filter(Boolean));
  document.body.append(dialog);
  dialog.addEventListener("cancel", (e) => e.preventDefault());   // the second step can't be skipped with Esc
  dialog.showModal();
  return dialog;
}

function codeInput() {
  return el("input", { type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, pattern: "[0-9]*",
    placeholder: "123456", class: "mfa-code", "aria-label": "6-digit code" });
}

/** The second step after signing in. Resolves when passed (the page then reloads with the stronger session). */
export async function secondStepDialog() {
  const { totp, passkeys } = await factors();
  const error = el("p", { class: "status bad", role: "alert", hidden: true });
  const fail = (text) => { error.textContent = text; error.hidden = false; };
  const parts = [el("p", {}, "Your account has two-step verification. Confirm it's you to continue.")];
  let dialog;
  if (totp.length) {
    const input = codeInput();
    const go = el("button", { type: "button" }, "Continue");
    const submit = async () => {
      error.hidden = true;
      go.disabled = true;
      const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId: totp[0].id, code: input.value.trim() });
      go.disabled = false;
      if (e) return fail("That code didn't work. Check your authenticator app and try the newest code.");
      location.reload();
    };
    input.addEventListener("input", () => { if (/^\d{6}$/.test(input.value.trim())) submit(); });
    go.addEventListener("click", submit);
    parts.push(el("label", { class: "form-label" }, "Code from your authenticator app"), input, go);
  }
  if (passkeys.length && passkeysSupported()) {
    const use = el("button", { type: "button", class: totp.length ? "secondary" : "" }, "Use a Passkey (Face ID, Touch ID, Windows Hello)");
    use.addEventListener("click", async () => {
      error.hidden = true;
      const { error: e } = await supabase.auth.mfa.webauthn.authenticate({ factorId: passkeys[0].id });
      if (e) return fail("The passkey didn't work. Try again, or use your authenticator app or a recovery code.");
      location.reload();
    });
    parts.push(use);
  }
  const recover = el("button", { type: "button", class: "link-button" }, "Use a recovery code");
  recover.addEventListener("click", () => { dialog.close(); dialog.remove(); recoveryDialog(); });
  const signOut = el("button", { type: "button", class: "link-button" }, "Sign out");
  signOut.addEventListener("click", async () => { await supabase.auth.signOut({ scope: "local" }); location.replace("index.html"); });
  dialog = modal("Two-step verification", parts, error, el("div", { class: "mfa-links" }, recover, signOut));
}

function recoveryDialog() {
  const input = el("input", { type: "text", autocomplete: "off", autocapitalize: "none", spellcheck: "false", placeholder: "abcde-fghjk", "aria-label": "Recovery code" });
  const error = el("p", { class: "status bad", role: "alert", hidden: true });
  const go = el("button", { type: "button" }, "Use Recovery Code");
  const back = el("button", { type: "button", class: "link-button" }, "Back");
  const dialog = modal("Use a recovery code",
    el("p", {}, "Enter one of the recovery codes you saved when you turned on two-step verification. It removes your authenticator so you can sign in, then set it up again."),
    input, go, error, el("div", { class: "mfa-links" }, back));
  back.addEventListener("click", () => { dialog.close(); dialog.remove(); secondStepDialog(); });
  go.addEventListener("click", async () => {
    error.hidden = true;
    go.disabled = true;
    const { data, error: e } = await supabase.functions.invoke("mfa-recover", { body: { action: "recover", code: input.value } });
    go.disabled = false;
    if (e || !data?.ok) {
      const reason = await e?.context?.json?.().then((b) => b?.error).catch(() => null);
      error.textContent = reason ?? "That didn't work. Check the code and try again.";
      error.hidden = false;
      return;
    }
    await supabase.auth.refreshSession();
    location.replace("account.html#settings");
  });
}

// --- Settings → Security ----------------------------------------------------------------------------------------

export async function renderSecurity(cell) {
  const { totp, passkeys } = await factors();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const { data: left } = await supabase.rpc("mfa_recovery_codes_left");
  const { data: staff } = await supabase.rpc("staff_mfa_status");
  const error = el("p", { class: "status bad", role: "alert", hidden: true });
  const fail = (e) => { error.textContent = typeof e === "string" ? e : friendlyError(e); error.hidden = false; };
  const on = totp.length > 0;
  const rows = [
    el("strong", {}, "Two-Step Verification"),
    el("p", { class: "hint" }, on
      ? `On. Signing in asks for a code from your authenticator app.${typeof left === "number" ? ` ${left} recovery ${left === 1 ? "code" : "codes"} left.` : ""}`
      : "Add a second step when you sign in: a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, and others)."),
  ];
  if (staff?.is_staff && !on) rows.push(el("p", { class: "status warn-text" }, staff.required
    ? "Moderator and Super Admin tools need two-step verification. Turn it on to use them."
    : "As Geerho staff, please turn on two-step verification."));
  const actions = el("div", { class: "actions" });
  if (!on) {
    const start = el("button", { type: "button" }, "Turn On");
    start.addEventListener("click", () => enroll(cell).catch(fail));
    actions.append(start);
  } else {
    const off = el("button", { type: "button", class: "secondary" }, "Turn Off");
    off.addEventListener("click", async () => {
      const { confirmDialog } = await import("./ui-dialog.js");
      if (!(await confirmDialog("Turn off two-step verification?", "Signing in will need only your Apple, Google, or GitHub account. Your recovery codes stop working.", "Turn Off", { danger: true }))) return;
      if (aal?.currentLevel !== "aal2") return fail("Sign out and back in with your code first, then turn it off.");
      for (const f of totp) {
        const { error: e } = await supabase.auth.mfa.unenroll({ factorId: f.id });
        if (e) return fail(e);
      }
      await supabase.rpc("mfa_turned_off");
      renderSecurity(cell);
    });
    const codes = el("button", { type: "button", class: "secondary" }, "New Recovery Codes");
    codes.addEventListener("click", async () => {
      if (aal?.currentLevel !== "aal2") return fail("Sign out and back in with your code first.");
      await showRecoveryCodes(cell);
    });
    actions.append(codes, off);
  }
  rows.push(actions);

  if (passkeysSupported()) {
    rows.push(el("strong", { class: "mfa-sub" }, "Passkeys"),
      el("p", { class: "hint" }, "Confirm it's you with Face ID, Touch ID, Windows Hello, or a fingerprint instead of typing a code."));
    for (const p of passkeys) {
      const remove = el("button", { type: "button", class: "secondary" }, "Remove");
      remove.addEventListener("click", async () => {
        if (aal?.currentLevel !== "aal2") return fail("Sign out and back in with your second step first.");
        const { error: e } = await supabase.auth.mfa.unenroll({ factorId: p.id });
        if (e) return fail(e);
        renderSecurity(cell);
      });
      rows.push(el("div", { class: "mfa-row" }, el("span", {}, p.friendly_name || "Passkey"), remove));
    }
    const add = el("button", { type: "button", class: "secondary" }, "Add a Passkey");
    add.addEventListener("click", async () => {
      error.hidden = true;
      if ((on || passkeys.length) && aal?.currentLevel !== "aal2") return fail("Sign out and back in with your second step first.");
      const name = `${/Mac|iPhone|iPad/.test(navigator.userAgent) ? "Apple device" : /Windows/.test(navigator.userAgent) ? "Windows" : /Android/.test(navigator.userAgent) ? "Android" : "This device"} · ${new Date().toLocaleDateString()}`;
      const { error: e } = await supabase.auth.mfa.webauthn.register({ friendlyName: name });
      if (e) return fail(/not enabled|disabled|webauthn/i.test(e.message ?? "") ? "Passkeys aren't available yet. Use an authenticator app for now." : e);
      if (!on && !(await supabase.rpc("mfa_recovery_codes_left")).data) await showRecoveryCodes(cell);
      else renderSecurity(cell);
    });
    rows.push(el("div", { class: "actions" }, add));
  }
  rows.push(error);
  cell.replaceChildren(...rows);
}

async function enroll(cell) {
  // Clear any half-finished setup first (Supabase keeps unverified factors).
  const { data: list } = await supabase.auth.mfa.listFactors();
  for (const f of (list?.all ?? []).filter((x) => x.status !== "verified" && x.factor_type === "totp")) await supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toLocaleDateString()}` });
  if (error) throw error;
  const input = codeInput();
  const err = el("p", { class: "status bad", role: "alert", hidden: true });
  const verify = el("button", { type: "button" }, "Verify and Turn On");
  const cancel = el("button", { type: "button", class: "secondary" }, "Cancel");
  const img = el("img", { src: data.totp.qr_code, alt: "QR code for your authenticator app", width: 200, height: 200, class: "mfa-qr" });
  cell.replaceChildren(
    el("strong", {}, "Turn on two-step verification"),
    el("ol", { class: "mfa-steps" },
      el("li", {}, "Open your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) and add an account."),
      el("li", {}, "Scan this QR code. On this phone? Copy the setup key below into the app instead."),
      el("li", {}, "Enter the 6-digit code the app shows.")),
    img,
    el("p", { class: "hint" }, "Setup key: ", el("code", { class: "mfa-secret" }, data.totp.secret)),
    input, el("div", { class: "actions" }, verify, cancel), err);
  cancel.addEventListener("click", async () => { await supabase.auth.mfa.unenroll({ factorId: data.id }); renderSecurity(cell); });
  verify.addEventListener("click", async () => {
    err.hidden = true;
    verify.disabled = true;
    const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId: data.id, code: input.value.trim() });
    verify.disabled = false;
    if (e) { err.textContent = "That code didn't work. Enter the newest code from the app."; err.hidden = false; return; }
    await showRecoveryCodes(cell);
  });
}

async function showRecoveryCodes(cell) {
  const codes = recoveryCodes();
  const { error } = await supabase.rpc("mfa_save_recovery_codes", { codes });
  if (error) { cell.append(el("p", { class: "status bad" }, friendlyError(error))); return; }
  const copy = el("button", { type: "button", class: "secondary" }, "Copy");
  copy.addEventListener("click", async () => { await navigator.clipboard?.writeText(codes.join("\n")).catch(() => {}); copy.textContent = "Copied"; });
  const download = el("a", { class: "button secondary", download: "geerho-recovery-codes.txt",
    href: URL.createObjectURL(new Blob([`Geerho recovery codes (each works once)\n\n${codes.join("\n")}\n`], { type: "text/plain" })) }, "Download");
  const done = el("button", { type: "button" }, "I Saved Them");
  done.addEventListener("click", () => renderSecurity(cell));
  cell.replaceChildren(
    el("strong", {}, "Two-step verification is on"),
    el("p", {}, "Save these recovery codes somewhere safe, like a password manager. Each works once, if you lose your phone. This is the only time they're shown."),
    el("ol", { class: "mfa-recovery" }, codes.map((c) => el("li", {}, el("code", {}, c)))),
    el("div", { class: "actions" }, copy, download, done));
}
