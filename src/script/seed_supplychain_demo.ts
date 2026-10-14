/**
 * Verification seed for the Operations & Supply Chain Logistics domain:
 * flips it from placeholder to active, grants Demo Capital Partners access,
 * and publishes one domain-tagged research note, so the domain picker and
 * switcher have something real to show. Safe to re-run.
 *
 * Usage: tsx script/seed_supplychain_demo.ts
 */
import { eq } from "drizzle-orm";
import { initDb } from "../server/db";
import { organizations, users, domains, organizationDomains, publishedContent } from "../shared/schema";

async function main() {
  const db = await initDb();
  console.log("");

  const [scDomain] = await db.select().from(domains).where(eq(domains.slug, "supply_chain")).limit(1);
  if (!scDomain) { console.error("supply_chain domain not found -- run seed_domains.ts first."); process.exit(1); }

  if (!scDomain.active) {
    await db.update(domains).set({ active: true }).where(eq(domains.id, scDomain.id));
    console.log("Activated Operations & Supply Chain Logistics domain.");
  } else {
    console.log("Operations & Supply Chain Logistics domain already active.");
  }

  const [org] = await db.select().from(organizations).where(eq(organizations.slug, "demo-capital")).limit(1);
  if (!org) { console.error("demo-capital org not found -- run seed_demo_client.ts first."); process.exit(1); }

  const existing = await db.select().from(organizationDomains)
    .where(eq(organizationDomains.organizationId, org.id));
  const hasSupplyChain = existing.some((r) => r.domainId === scDomain.id);
  if (!hasSupplyChain) {
    await db.insert(organizationDomains).values({ organizationId: org.id, domainId: scDomain.id });
    console.log(`Granted Operations & Supply Chain Logistics access to ${org.name}.`);
  } else {
    console.log(`${org.name} already has Operations & Supply Chain Logistics access.`);
  }

  const [author] = await db.select().from(users).where(eq(users.role, "internal_admin")).limit(1);
  if (!author) { console.error("no internal_admin found."); process.exit(1); }

  const existingScContent = await db.select().from(publishedContent).where(eq(publishedContent.domainId, scDomain.id));
  if (!existingScContent.length) {
    const [note] = await db.insert(publishedContent).values({
      authorUserId: author.id,
      domainId: scDomain.id,
      title: "Freight Demand Pulse: Inventory Rebuild Watch",
      body: "Rail intermodal traffic and durable goods orders are the two series we're watching most closely this quarter as a signal for whether shippers are rebuilding inventory or still working through excess stock.",
      contentType: "brief",
      visibility: "all_clients",
      isAiGenerated: false,
      status: "published",
      publishedAt: new Date(),
    }).returning();
    console.log(`Published (Supply Chain, all clients): "${note.title}"`);
  } else {
    console.log("Supply chain research already seeded, skipping.");
  }

  console.log("");
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Supply chain demo seeding failed:", err);
  process.exit(1);
});
