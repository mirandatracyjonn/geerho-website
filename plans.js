import { currentUser, friendlyError, supabase } from "./auth.js";

const status = document.getElementById("plan-status");
const manageRow = document.getElementById("manage-row");
const params = new URLSearchParams(location.search);

if (params.get("status") === "subscribed") status.textContent = "Thank you! Your plan is active. It can take a minute to show in the app.";
if (params.get("status") === "cancelled") status.textContent = "No changes were made.";

async function go(action, body = {}) {
  const user = await currentUser();
  if (!user) {
    location.href = `account.html?next=${encodeURIComponent("plans.html")}`;
    return;
  }
  status.textContent = "Opening secure checkout…";
  const { data, error } = await supabase.functions.invoke("payments", { body: { action, ...body } });
  if (error || !data?.url) {
    let message = "We couldn't open checkout. Please try again.";
    try { message = (await error?.context?.json())?.error || message; } catch { /* keep default */ }
    status.textContent = friendlyError ? friendlyError({ message }) : message;
    return;
  }
  location.href = data.url;
}

for (const button of document.querySelectorAll("[data-subscribe]")) {
  button.addEventListener("click", () => go("subscribe", { plan: button.dataset.subscribe }));
}
document.getElementById("manage").addEventListener("click", () => go("manage_plan"));

// Founding Members (M75): their discount is applied automatically at checkout.
const { data: founder } = await supabase.rpc("founder_pricing");
if (founder?.me_founder) {
  const note = document.createElement("p");
  note.className = "status good";
  note.textContent = `Founding Member #${founder.my_number}: ${founder.first_year_pct}% off any plan for your first year, then ${founder.after_pct}%. It's applied at checkout.`;
  status.before(note);
}

// Signed in: show the current plan.
const user = await currentUser();
if (user) {
  const { data } = await supabase.rpc("my_plan");
  if (data) {
    const plan = data.plan;
    if (plan !== "free") {
      manageRow.hidden = false;
      const card = document.querySelector(`[data-plan="${plan}"]`);
      card?.classList.add("current");
      const button = card?.querySelector("button");
      if (button) { button.textContent = "Your plan"; button.disabled = true; }
      if (!status.textContent) {
        const renews = data.current_period_end ? new Date(data.current_period_end).toLocaleDateString() : null;
        status.textContent = `You're on ${plan[0].toUpperCase() + plan.slice(1)}` +
          (renews ? (data.cancel_at_period_end ? `, active until ${renews}.` : `, renewing ${renews}.`) : ".");
      }
    } else if (!status.textContent) {
      status.textContent = `You're on the free plan: ${data.posts_today} of 1 new post used today.`;
    }
    // The weekly unlimited posting day (M107).
    if (data.unlimited_today && data.unlimited_day) {
      status.textContent = `It's Unlimited ${data.unlimited_day}: post as much as you like today. Today's posts don't count toward your limits.`;
    }
  }
}
