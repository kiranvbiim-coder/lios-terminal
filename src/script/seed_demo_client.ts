/**
 * Phase 3 verification seed: creates one demo client organization with a
 * client_admin login, a portfolio, watchlist items, alerts, and a few
 * pieces of published content (including one AI-generated item, to verify
 * the kill switch actually hides it from the dashboard). Safe to re-run --
 * skips anything that already exists by slug/email.
 *
 * Usage: tsx script/seed_demo_client.ts
 */
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { initDb } from "../server/db";
import {
  organizations, users, portfolios, positions, dashboardWatchlistItems,
  clientAlerts, publishedContent, contentOrganizationLinks,
} from "../shared/schema";

function generatePassword(): string {
  return crypto.randomBytes(9).toString("base64url");
}

async function main() {
  const db = await initDb();
  console.log("");

  const [author] = await db.select().from(users).where(eq(users.role, "internal_admin")).limit(1);
  if (!author) {
    console.error("No owner account exists yet. Complete the one-time LiOS Home or desktop first-owner setup before seeding demo data.");
    process.exit(1);
  }

  let [org] = await db.select().from(organizations).where(eq(organizations.slug, "demo-capital")).limit(1);
  if (!org) {
    [org] = await db.insert(organizations).values({ name: "Demo Capital Partners", slug: "demo-capital" }).returning();
    console.log(`Created organization: ${org.name} (id ${org.id})`);
  } else {
    console.log(`Organization already exists: ${org.name} (id ${org.id})`);
  }

  const clientEmail = "client@democapital.com";
  const existingUser = await db.select().from(users).where(eq(users.email, clientEmail)).limit(1);
  if (!existingUser.length) {
    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, 12);
    await db.insert(users).values({
      email: clientEmail, passwordHash, role: "client_admin", organizationId: org.id, name: "Alex Rivera",
    });
    console.log(`Created client_admin: ${clientEmail}`);
    console.log(`  Password: ${password}`);
    console.log(`  (log in at /dashboard -- change this after first login)`);
  } else {
    console.log(`Client user already exists: ${clientEmail}`);
  }

  let [portfolio] = await db.select().from(portfolios).where(eq(portfolios.organizationId, org.id)).limit(1);
  if (!portfolio) {
    [portfolio] = await db.insert(portfolios).values({ organizationId: org.id, name: "Core Holdings" }).returning();
    await db.insert(positions).values([
      { portfolioId: portfolio.id, symbol: "AAPL", shares: 500, avgCost: 210.5 },
      { portfolioId: portfolio.id, symbol: "MSFT", shares: 200, avgCost: 340.0 },
      { portfolioId: portfolio.id, symbol: "GS", shares: 50, avgCost: 620.0 },
    ]);
    console.log("Created portfolio: Core Holdings (AAPL, MSFT, GS)");
  } else {
    console.log("Portfolio already exists, skipping.");
  }

  const existingWatchlist = await db.select().from(dashboardWatchlistItems).where(eq(dashboardWatchlistItems.organizationId, org.id));
  if (!existingWatchlist.length) {
    await db.insert(dashboardWatchlistItems).values([
      { organizationId: org.id, symbol: "NVDA", name: "NVIDIA Corp.", addedByUserId: author.id },
      { organizationId: org.id, symbol: "TSLA", name: "Tesla Inc.", addedByUserId: author.id },
    ]);
    console.log("Added watchlist items: NVDA, TSLA");
  } else {
    console.log("Watchlist already seeded, skipping.");
  }

  const existingAlerts = await db.select().from(clientAlerts).where(eq(clientAlerts.organizationId, org.id));
  if (!existingAlerts.length) {
    await db.insert(clientAlerts).values([
      { organizationId: org.id, symbol: "AAPL", condition: "above", price: 350, createdByUserId: author.id },
    ]);
    console.log("Added alert: AAPL above $350");
  } else {
    console.log("Alerts already seeded, skipping.");
  }

  const existingContent = await db.select().from(publishedContent).where(eq(publishedContent.authorUserId, author.id));
  if (!existingContent.length) {
    const [note1] = await db.insert(publishedContent).values({
      authorUserId: author.id,
      title: "Q3 Market Outlook: Resilient Earnings, Cautious Positioning",
      body: "Broad market earnings have held up better than consensus expected heading into Q3, though breadth remains narrow. We continue to favor quality large-caps with pricing power over speculative small-caps in this environment. Full sector breakdown available on request.",
      contentType: "brief",
      visibility: "all_clients",
      isAiGenerated: false,
      status: "published",
      publishedAt: new Date(),
    }).returning();
    console.log(`Published (all clients): "${note1.title}"`);

    const [note2] = await db.insert(publishedContent).values({
      authorUserId: author.id,
      title: "Demo Capital: Position Review",
      body: "Your current allocation to AAPL and MSFT remains within target bands. GS position has appreciated meaningfully since entry -- worth a rebalancing conversation at your convenience.",
      contentType: "note",
      visibility: "specific_orgs",
      isAiGenerated: false,
      status: "published",
      publishedAt: new Date(),
    }).returning();
    await db.insert(contentOrganizationLinks).values({ contentId: note2.id, organizationId: org.id });
    console.log(`Published (Demo Capital only): "${note2.title}"`);

    const [aiNote] = await db.insert(publishedContent).values({
      authorUserId: author.id,
      title: "AI Signal: Elevated Options Volume in Semiconductors",
      body: "Automated screening flagged unusual call volume across semiconductor names in the past 48 hours. This is a systematic signal, not investment advice -- reviewed but not independently verified by an analyst.",
      contentType: "trade_idea",
      visibility: "all_clients",
      isAiGenerated: true,
      status: "published",
      publishedAt: new Date(),
    }).returning();
    console.log(`Published (AI-generated, all clients): "${aiNote.title}"`);
  } else {
    console.log("Published content already seeded, skipping.");
  }

  console.log("");
  console.log("Done. Visit http://localhost:5052/dashboard to log in as the client.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
