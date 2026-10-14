// Feature your listing (M73): pick one of your live listings and 3, 7, or 30 days; pay once with Stripe on geerho.com.
import { el, money } from "./site.js";
import { currentUser, friendlyError, supabase } from "./auth.js";

const status = document.getElementById("featured-status");
const mine = document.getElementById("featured-mine");
const params = new URLSearchParams(location.search);
if (params.get("status") === "paid") status.textContent = "Thank you! Your listing is featured. It can take a minute to appear.";
if (params.get("status") === "cancelled") status.textContent = "No payment was made.";

const user = await currentUser();
if (!user) {
  mine.append(el("p", {}, el("a", { href: "account.html?next=featured.html" }, "Sign in"), " to feature your listings."));
} else {
  const [{ data: options }, { data: listings }, { data: features }] = await Promise.all([
    supabase.from("featured_options").select("id, days, usd_cents, php_cents").order("position"),
    supabase.from("listings").select("id, title, currency, status").eq("seller_id", user.id).eq("status", "active").order("created_at", { ascending: false }),
    supabase.from("listing_features").select("listing_id, ends_at, status").eq("status", "active"),
  ]);
  if (!listings?.length) mine.append(el("p", {}, "You don't have any live listings yet. Post one in the Geerho app first."));
  for (const listing of listings ?? []) {
    const until = (features ?? []).filter((f) => f.listing_id === listing.id && new Date(f.ends_at) > new Date())
      .map((f) => new Date(f.ends_at)).sort((a, b) => b - a)[0];
    const peso = (listing.currency ?? "").trim() === "PHP";
    const row = el("div", { class: "featured-row" }, ...(options ?? []).map((option) => {
      const button = el("button", { type: "button", class: "secondary" },
        `${option.days} days · ${money(peso ? option.php_cents : option.usd_cents, peso ? "PHP" : "USD")}`);
      button.addEventListener("click", async () => {
        status.textContent = "Opening secure checkout…";
        const { data, error } = await supabase.functions.invoke("payments", { body: { action: "feature", listing_id: listing.id, option: option.id } });
        if (error || !data?.url) {
          let message = "We couldn't open checkout. Please try again.";
          try { message = (await error?.context?.json())?.error || message; } catch { /* keep default */ }
          status.textContent = friendlyError({ message });
          return;
        }
        location.href = data.url;
      });
      return button;
    }));
    mine.append(el("div", { class: "panel" },
      el("h2", {}, listing.title),
      el("p", { class: "meta" }, until ? `Featured until ${until.toLocaleDateString(undefined, { month: "long", day: "numeric" })}. Add more days:` : "Not featured. Choose how long:"),
      row));
  }
}
