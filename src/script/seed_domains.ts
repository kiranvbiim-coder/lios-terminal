/**
 * One-time platform migration: seeds the 6 verticals and backfills every
 * pre-existing organization/content/watchlist/alert row to the finance
 * domain, since everything in the system was implicitly finance-only
 * before this concept existed. Safe to re-run -- skips domains that
 * already exist by slug, and only backfills rows that are still NULL.
 *
 * Usage: tsx script/seed_domains.ts
 */
import { eq, isNull } from "drizzle-orm";
import { initDb } from "../server/db";
import {
  domains, organizations, organizationDomains, publishedContent,
  dashboardWatchlistItems, clientAlerts,
} from "../shared/schema";

const DOMAINS = [
  { slug: "finance", name: "Finance", icon: "TrendingUp", active: true,
    description: "Markets, portfolios, equities, macro -- the original Limuria Intelligence terminal." },
  { slug: "economics_policy", name: "Economics & Public Policy", icon: "Landmark", active: true,
    description: "Macroeconomic indicators, central bank policy, and government data." },
  { slug: "supply_chain", name: "Operations & Supply Chain Logistics", icon: "Truck", active: true,
    description: "Freight rates, port congestion, supplier risk, and a real route/network/resilience engine." },
  { slug: "environment_sustainability", name: "Environment & Sustainability", icon: "Leaf", active: true,
    description: "Climate risk, emissions, ESG, and a real carbon transition risk/credit MRV engine." },
  { slug: "marketing_pr", name: "Marketing, PR & Communications", icon: "Megaphone", active: false,
    description: "Brand sentiment, media monitoring, campaign performance. Coming soon." },
  { slug: "tourism_hospitality", name: "Tourism & Hospitality", icon: "Palmtree", active: false,
    description: "Occupancy, booking trends, destination demand. Coming soon." },
];

async function main() {
  const db = await initDb();
  console.log("");

  for (const d of DOMAINS) {
    const existing = await db.select().from(domains).where(eq(domains.slug, d.slug)).limit(1);
    if (existing.length) {
      console.log(`Domain already exists: ${d.name}`);
      continue;
    }
    await db.insert(domains).values(d);
    console.log(`Created domain: ${d.name} (${d.active ? "active" : "placeholder"})`);
  }

  const [financeDomain] = await db.select().from(domains).where(eq(domains.slug, "finance")).limit(1);
  if (!financeDomain) throw new Error("finance domain missing after seed -- should be impossible");

  const backfillContent = await db.update(publishedContent)
    .set({ domainId: financeDomain.id }).where(isNull(publishedContent.domainId)).returning({ id: publishedContent.id });
  console.log(`Backfilled ${backfillContent.length} published_content rows to finance domain.`);

  const backfillWatchlist = await db.update(dashboardWatchlistItems)
    .set({ domainId: financeDomain.id }).where(isNull(dashboardWatchlistItems.domainId)).returning({ id: dashboardWatchlistItems.id });
  console.log(`Backfilled ${backfillWatchlist.length} dashboard_watchlist_items rows to finance domain.`);

  const backfillAlerts = await db.update(clientAlerts)
    .set({ domainId: financeDomain.id }).where(isNull(clientAlerts.domainId)).returning({ id: clientAlerts.id });
  console.log(`Backfilled ${backfillAlerts.length} client_alerts rows to finance domain.`);

  const allOrgs = await db.select().from(organizations);
  let grantedCount = 0;
  for (const org of allOrgs) {
    const hasFinance = await db.select().from(organizationDomains)
      .where(eq(organizationDomains.organizationId, org.id)).then((rows) => rows.some((r) => r.domainId === financeDomain.id));
    if (!hasFinance) {
      await db.insert(organizationDomains).values({ organizationId: org.id, domainId: financeDomain.id }).onConflictDoNothing();
      grantedCount++;
    }
  }
  console.log(`Granted finance domain access to ${grantedCount} organization(s) that didn't already have it.`);

  console.log("");
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Domain seeding failed:", err);
  process.exit(1);
});
