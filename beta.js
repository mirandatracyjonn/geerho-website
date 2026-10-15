// Beta Testing on geerho.com (M90, TJ 2026-10-14): invited testers see their role cards and check off each task as
// Done, Problem, or Blocked (time-stamped; Problem opens a Geerho Support ticket with screenshots). Super Admins see
// every tester and check-off, confirm or reopen each one, add testers, and assign roles. Signed-in members only.
import { el } from "./site.js";
import { currentUser, friendlyError, signInURL, supabase } from "./auth.js";
import { icon, rowIcon } from "./icons.js";
import { avatar } from "./profile.js";

const main = document.getElementById("beta");
const when = (iso) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const STATUS = { done: ["Done", "good"], problem: ["Problem", "bad"], blocked: ["Blocked", "warn"] };
const PLATFORM = { iphone: "iPhone", android: "Android", web: "Web" };
const guessPlatform = () => (/iPhone|iPad/.test(navigator.userAgent) ? "iphone" : /Android/.test(navigator.userAgent) ? "android" : "web");
let state = { tab: new URLSearchParams(location.search).get("tab") === "admin" ? "admin" : "tasks", filter: "review" };

// --- Small helpers -------------------------------------------------------------------------------------------------

function richParagraphs(text) {
  const box = el("div", { class: "beta-guide-body" });
  let list = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) { list = null; continue; }
    const bullet = line.match(/^(?:[-*]|\d+\.)\s+(.*)$/);
    if (line.startsWith("|")) {
      if (/^\|[\s:|-]+\|$/.test(line)) continue;
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      let table = box.lastElementChild?.tagName === "TABLE" ? box.lastElementChild : null;
      if (!table) { table = el("table", { class: "beta-table" }); box.append(table); }
      table.append(el("tr", {}, cells.map((c) => el(table.rows.length ? "td" : "th", {}, strong(c)))));
      continue;
    }
    if (bullet) {
      if (!list) { list = el(/^\d/.test(line) ? "ol" : "ul"); box.append(list); }
      list.append(el("li", {}, strong(bullet[1])));
    } else {
      list = null;
      const last = box.lastElementChild;
      if (last?.tagName === "P" && !raw.startsWith(" ") && last.dataset.open) last.append(" ", ...strong(line));
      else { const p = el("p", { "data-open": "1" }, strong(line)); box.append(p); }
    }
  }
  return box;
}
function strong(text) {
  return text.split(/(\*\*[^*]+\*\*)/).map((part) => (part.startsWith("**") ? el("strong", {}, part.slice(2, -2)) : part));
}

function statusChip(latest) {
  if (!latest) return el("span", { class: "beta-chip" }, "Not started");
  const [label, tone] = STATUS[latest.status];
  return el("span", { class: `beta-chip ${tone}` }, `${label} · ${when(latest.submitted_at)}`);
}
function reviewLine(latest) {
  if (!latest?.review) return latest && latest.status ? el("small", { class: "form-hint" }, "Waiting for a Super Admin to confirm") : null;
  return el("small", { class: `state ${latest.review === "confirmed" ? "good" : "bad"}` },
    `${latest.review === "confirmed" ? "Confirmed" : "Reopened"} ${when(latest.reviewed_at)}${latest.review_note ? ` · “${latest.review_note}”` : ""}`);
}

// --- Check off a task ----------------------------------------------------------------------------------------------

function checkOffDialog(task, status, me) {
  return new Promise((resolve) => {
    const platform = el("select", { "aria-label": "Platform" }, Object.entries(PLATFORM).map(([v, n]) => el("option", { value: v, selected: v === guessPlatform() }, n)));
    const build = el("input", { type: "text", maxlength: 40, placeholder: "Build (Settings shows it, e.g. 65)", "aria-label": "Build" });
    const note = el("textarea", { maxlength: 2000, rows: 4, placeholder: status === "done" ? "Anything to add? (optional)"
      : status === "problem" ? "What did you do, what did you expect, and what happened?" : "What are you waiting for?" });
    const files = el("input", { type: "file", accept: "image/*", multiple: true, "aria-label": "Screenshots" });
    const error = el("p", { class: "status bad", hidden: true });
    const ok = el("button", { type: "button", class: status === "problem" ? "danger-button" : "" }, status === "done" ? "Mark Done" : status === "problem" ? "Report Problem" : "Mark Blocked");
    const cancel = el("button", { type: "button", class: "secondary" }, "Cancel");
    const dialog = el("dialog", { class: "g-dialog beta-dialog" },
      el("h2", {}, STATUS[status][0]), el("p", { class: "form-hint" }, task.step),
      el("div", { class: "two-dates" }, el("label", {}, el("span", { class: "form-label" }, "Platform"), platform), el("label", {}, el("span", { class: "form-label" }, "Build"), build)),
      el("label", { class: "form-label" }, status === "done" ? "Note" : "What happened"), note,
      status === "problem" ? [el("label", { class: "form-label" }, "Screenshots (optional)"), files,
        el("p", { class: "form-hint" }, "This also opens a Geerho Support ticket, where Support replies and asks you to re-test after the fix.")] : null,
      error, el("div", { class: "g-dialog-actions" }, cancel, ok));
    document.body.append(dialog);
    const close = (value) => { dialog.close(); dialog.remove(); resolve(value); };
    cancel.addEventListener("click", () => close(false));
    ok.addEventListener("click", async () => {
      error.hidden = true;
      ok.disabled = true;
      try {
        let ticket = null;
        if (status === "problem") {
          if (note.value.trim().length < 5) throw new Error("Say what happened (a few words at least).");
          const attachments = [];
          for (const [i, file] of [...(files.files ?? [])].slice(0, 10).entries()) {
            const path = `${me.id}/${crypto.randomUUID()}/${i}.${(file.name.split(".").pop() || "jpg").toLowerCase()}`;
            const { error: e } = await supabase.storage.from("support-attachments").upload(path, file, { contentType: file.type });
            if (e) throw new Error(`“${file.name}” couldn't be uploaded.`);
            attachments.push({ kind: "image", path, name: file.name });
          }
          const body = `Beta test · Task ${task.id}: ${task.step}\nExpected: ${task.expected}\n\n${note.value.trim()}\n\nPlatform: ${PLATFORM[platform.value]}${build.value.trim() ? ` · Build ${build.value.trim()}` : ""}`;
          const { data: ticketId, error: e } = await supabase.rpc("open_support_ticket", { reason: "bug", body, subject_kind: null, subject_id: null, attachments });
          if (e) throw e;
          ticket = ticketId;
        }
        const { error: e } = await supabase.rpc("beta_submit", { task: task.id, status, note: note.value.trim() || null, platform: platform.value,
          build: build.value.trim() || null, ticket });
        if (e) throw e;
        close(true);
      } catch (problem) {
        ok.disabled = false;
        error.textContent = problem.code ? friendlyError(problem) : problem.message;
        error.hidden = false;
      }
    });
    dialog.showModal();
  });
}

// --- Tester view ---------------------------------------------------------------------------------------------------

function roleCard(role, me, reload) {
  const done = role.tasks.filter((t) => t.latest?.status === "done").length;
  const confirmed = role.tasks.filter((t) => t.latest?.status === "done" && t.latest.review === "confirmed").length;
  const card = el("details", { class: "beta-role", open: role.mine || undefined },
    el("summary", {}, el("span", { class: "beta-role-title" }, el("strong", {}, `Role ${role.code} · ${role.title}`),
      el("small", {}, [role.platforms, role.days ? `Days ${role.days}` : null].filter(Boolean).join(" · "))),
      el("span", { class: "beta-progress", "aria-label": `${done} of ${role.tasks.length} done` }, `${done}/${role.tasks.length}`)),
    el("div", { class: "beta-bar" }, el("div", { style: `width:${Math.round((done / role.tasks.length) * 100)}%` })),
    confirmed ? el("small", { class: "form-hint" }, `${confirmed} confirmed by a Super Admin`) : null,
    el("ol", { class: "beta-tasks" }, role.tasks.map((t) => {
      const buttons = ["done", "problem", "blocked"].map((s) => {
        const b = el("button", { type: "button", class: s === "done" ? "" : "secondary" }, STATUS[s][0]);
        b.addEventListener("click", async () => { if (await checkOffDialog(t, s, me)) reload(); });
        return b;
      });
      return el("li", { class: `beta-task ${t.latest?.status ?? ""}` },
        el("div", { class: "beta-task-text" }, el("strong", {}, t.step), t.expected ? el("small", {}, `Should happen: ${t.expected}`) : null),
        el("div", { class: "beta-task-state" }, statusChip(t.latest), reviewLine(t.latest),
          t.latest?.note ? el("small", { class: "form-hint" }, `Your note: ${t.latest.note}`) : null,
          t.latest?.ticket_id ? el("a", { href: `contact.html?t=${t.latest.ticket_id}`, class: "form-hint" }, "Open the support ticket") : null),
        el("div", { class: "actions beta-actions" }, buttons));
    })));
  return card;
}

// --- Super Admin view ----------------------------------------------------------------------------------------------

async function adminView(container, page, me, reload) {
  const { data: o, error } = await supabase.rpc("beta_admin_overview");
  if (error) { container.replaceChildren(el("p", { class: "status bad" }, friendlyError(error))); return; }
  const roles = page.roles;

  // Testers
  const add = el("input", { type: "text", placeholder: "@username", "aria-label": "Username to add", autocapitalize: "none", spellcheck: "false" });
  const addButton = el("button", { type: "button" }, "Add Tester");
  const addError = el("p", { class: "status bad", hidden: true });
  addButton.addEventListener("click", async () => {
    addError.hidden = true;
    const { error: e } = await supabase.rpc("beta_add_tester", { username: add.value.trim() });
    if (e) { addError.textContent = friendlyError(e); addError.hidden = false; return; }
    reload();
  });
  const testers = el("div", { class: "beta-testers" }, (o.testers ?? []).map((t) => {
    const pct = t.tasks ? Math.round((t.done / t.tasks) * 100) : 0;
    const chips = el("div", { class: "chip-row" }, roles.map((r) => {
      const input = el("input", { type: "checkbox", checked: t.roles.includes(r.code) });
      input.addEventListener("change", async () => {
        const { error: e } = await supabase.rpc("beta_assign", { member: t.user_id, role: r.code, assigned: input.checked });
        if (e) { input.checked = !input.checked; alertBox(friendlyError(e)); }
      });
      return el("label", { class: "chip small", title: r.title }, input, el("span", {}, r.code));
    }));
    const remove = el("button", { type: "button", class: "secondary" }, "Remove");
    remove.addEventListener("click", async () => {
      const { confirmDialog } = await import("./ui-dialog.js");
      if (!(await confirmDialog(`Remove @${t.username}?`, "They lose access to Beta Testing and the Beta Tester star. Their check-offs stay.", "Remove", { danger: true }))) return;
      await supabase.rpc("beta_remove_tester", { member: t.user_id });
      reload();
    });
    return el("div", { class: "beta-tester" },
      el("div", { class: "item-row" }, avatar(t.avatar_url, t.display_name || t.username, 44),
        el("span", { class: "row-title" }, el("strong", {}, `${t.display_name || "@" + t.username}`),
          el("small", {}, `@${t.username}${t.verified ? " · Verified" : " · Not verified yet"} · ${t.done}/${t.tasks} done${t.open_problems ? ` · ${t.open_problems} open problems` : ""}`
            + (t.last_activity ? ` · last ${when(t.last_activity)}` : ""))),
        remove),
      el("div", { class: "beta-bar" }, el("div", { style: `width:${pct}%` })),
      el("small", { class: "form-hint" }, "Roles:"), chips);
  }));

  // Check-offs to review
  const filterBar = el("div", { class: "segmented" }, [["review", "Needs Review"], ["problems", "Problems"], ["all", "All"]].map(([v, label]) => {
    const b = el("button", { type: "button", "aria-pressed": String(state.filter === v) }, label);
    b.addEventListener("click", () => { state.filter = v; reload(); });
    return b;
  }));
  const results = (o.results ?? []).filter((r) => (state.filter === "review" ? !r.review : state.filter === "problems" ? r.status !== "done" : true));
  const list = el("div", { class: "beta-results" }, results.length ? results.map((r) => {
    const [label, tone] = STATUS[r.status];
    const review = async (decision) => {
      const { textDialog } = await import("./ui-dialog.js");
      const note = await textDialog(decision === "confirmed" ? "Confirm this check-off" : "Reopen this task",
        decision === "confirmed" ? "Add a note for the tester (optional)." : "Tell the tester what to do again.",
        { okLabel: decision === "confirmed" ? "Confirm" : "Reopen", min: decision === "confirmed" ? 0 : 3 });
      if (note === null) return;
      const { error: e } = await supabase.rpc("beta_review", { result: r.id, decision, note: note || null });
      if (e) return alertBox(friendlyError(e));
      reload();
    };
    const confirm = el("button", { type: "button" }, "Confirm");
    const reopen = el("button", { type: "button", class: "secondary" }, "Reopen");
    confirm.addEventListener("click", () => review("confirmed"));
    reopen.addEventListener("click", () => review("reopened"));
    return el("div", { class: "beta-result" },
      el("div", {}, el("span", { class: `beta-chip ${tone}` }, label), " ", el("strong", {}, `@${r.username}`), ` · Role ${r.role_code} · ${when(r.submitted_at)}`,
        r.platform ? ` · ${PLATFORM[r.platform]}` : "", r.build ? ` · build ${r.build}` : ""),
      el("p", { class: "beta-result-step" }, r.step),
      r.note ? el("p", { class: "form-hint" }, `“${r.note}”`) : null,
      r.ticket_id ? el("p", {}, el("a", { href: `contact.html?t=${r.ticket_id}` }, "Open the support ticket")) : null,
      r.review ? el("small", { class: `state ${r.review === "confirmed" ? "good" : "bad"}` },
        `${r.review === "confirmed" ? "Confirmed" : "Reopened"} by ${r.reviewer ?? "a Super Admin"} ${when(r.reviewed_at)}${r.review_note ? ` · “${r.review_note}”` : ""}`)
        : el("div", { class: "actions" }, confirm, reopen));
  }) : [el("p", { class: "hint" }, "Nothing here.")]);

  const exportButton = el("button", { type: "button", class: "secondary" }, "Download as CSV");
  exportButton.addEventListener("click", () => {
    const rows = [["submitted_at", "tester", "role", "task", "status", "platform", "build", "note", "review", "reviewed_at", "reviewer", "review_note"]]
      .concat((o.results ?? []).map((r) => [r.submitted_at, r.username, r.role_code, r.step, r.status, r.platform, r.build, r.note, r.review, r.reviewed_at, r.reviewer, r.review_note]));
    const csv = rows.map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = el("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `geerho-beta-results-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
  });

  container.replaceChildren(
    el("p", { class: "group-title" }, "Check-offs"), filterBar, list, el("div", { class: "actions" }, exportButton),
    el("p", { class: "group-title" }, `Testers (${(o.testers ?? []).length})`),
    el("div", { class: "group plain" }, el("div", { class: "cell-pad form-grid" }, el("div", { class: "area-search" }, add, addButton), addError,
      el("small", { class: "form-hint" }, "Testers get the silver Beta Tester star. They must verify their identity before checking off tasks."))),
    testers);
}

function alertBox(text) { import("./ui-dialog.js").then(({ confirmDialog }) => confirmDialog("Something went wrong", text, "OK")); }

// --- Page ----------------------------------------------------------------------------------------------------------

async function render() {
  const me = await currentUser();
  if (!me) {
    main.replaceChildren(el("h1", { class: "large-title" }, "Beta Testing"),
      el("div", { class: "empty" }, icon("seal"), el("strong", {}, "Sign in to Beta Testing"),
        el("p", {}, "For invited Geerho beta testers. Sign in with the account you test with."),
        el("a", { class: "button", href: signInURL("beta.html") }, "Sign In")));
    return;
  }
  const { data: page, error } = await supabase.rpc("beta_my_page");
  if (error) {
    main.replaceChildren(el("h1", { class: "large-title" }, "Beta Testing"),
      el("div", { class: "empty" }, icon("lock"), el("strong", {}, "For invited testers"), el("p", {}, friendlyError(error))));
    return;
  }
  const { data: profile } = await supabase.from("profiles").select("verified_at").eq("id", me.id).single();
  const reload = () => render();
  const tabs = page.is_admin ? el("div", { class: "segmented" }, [["tasks", "Role Cards"], ["admin", "Testers & Check-offs"]].map(([v, label]) => {
    const b = el("button", { type: "button", "aria-pressed": String(state.tab === v) }, label);
    b.addEventListener("click", () => { state.tab = v; render(); });
    return b;
  })) : null;
  const guide = el("div", {}, page.guide.map((g, i) => el("details", { class: "beta-guide", open: i === 0 || undefined },
    el("summary", {}, g.title), richParagraphs(g.body))));
  const body = el("div", {});
  main.replaceChildren(...[
    el("h1", { class: "large-title" }, "Beta Testing"),
    el("p", { class: "beta-star-line" }, el("span", { class: "beta-star", "aria-hidden": "true" }, "★"), " Thank you for testing Geerho. Your silver star shows before your name."),
    profile?.verified_at ? null : el("a", { class: "verify-card", href: "account.html#verify" }, icon("seal"),
      el("span", {}, el("strong", {}, "Verify your identity first"), "Beta testers are verified members. Verify with Didit, then check off your tasks.")),
    tabs, body,
  ].filter(Boolean));
  if (page.is_admin && state.tab === "admin") {
    body.replaceChildren(el("p", { class: "hint" }, "Loading…"));
    await adminView(body, page, me, reload);
    return;
  }
  const mine = page.roles.filter((r) => r.mine), others = page.roles.filter((r) => !r.mine);
  body.replaceChildren(...[
    el("p", { class: "group-title" }, "How it works"), guide,
    el("p", { class: "group-title" }, mine.length ? "Your roles" : "No roles yet"),
    mine.length ? null : el("p", { class: "hint" }, page.is_admin ? "Assign yourself a role under Testers & Check-offs, or use any card below." : "A Super Admin will assign your roles soon."),
    ...mine.map((r) => roleCard(r, me, reload)),
    others.length ? el("p", { class: "group-title" }, "All other roles (Super Admins)") : null,
    ...others.map((r) => roleCard(r, me, reload)),
  ].filter(Boolean));
}

render();
