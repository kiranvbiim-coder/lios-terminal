/**
 * Verification seed for the multi-domain architecture: grants Demo Capital
 * Partners access to the Economics & Public Policy domain and publishes one
 * domain-tagged research note, so the domain switcher has something real to
 * switch to. Safe to re-run.
 *
 * Usage: tsx script/seed_economics_demo.ts
 */
import { eq } from "drizzle-orm";
import { initDb } from "../server/db";
import { organizations, users, domains, organizationDomains, publishedContent } from "../shared/schema";

async function main() {
  const db = await initDb();
  console.log("");

  const [org] = await db.select().from(organizations).where(eq(organizations.slug, "demo-capital")).limit(1);
  if (!org) { console.error("demo-capital org not found -- run seed_demo_client.ts first."); process.exit(1); }

  const [econDomain] = await db.select().from(domains).where(eq(domains.slug, "economics_policy")).limit(1);
  if (!econDomain) { console.error("economics_policy domain not found -- run seed_domains.ts first."); process.exit(1); }

  const existing = await db.select().from(organizationDomains)
    .where(eq(organizationDomains.organizationId, org.id));
  const hasEcon = existing.some((r) => r.domainId === econDomain.id);
  if (!hasEcon) {
    await db.insert(organizationDomains).values({ organizationId: org.id, domainId: econDomain.id });
    console.log(`Granted Economics & Public Policy access to ${org.name}.`);
  } else {
    console.log(`${org.name} already has Economics & Public Policy access.`);
  }

  const [author] = await db.select().from(users).where(eq(users.role, "internal_admin")).limit(1);
  if (!author) { console.error("no internal_admin found."); process.exit(1); }

  const existingEconContent = await db.select().from(publishedContent).where(eq(publishedContent.domainId, econDomain.id));
  if (!existingEconContent.length) {
    const [note] = await db.insert(publishedContent).values({
      authorUserId: author.id,
      domainId: econDomain.id,
      title: "Fed Policy Outlook: Rate Path Into Year-End",
      body: "Markets are pricing a measured pace of policy moves through year-end. We continue to watch core inflation prints and labor market data as the key swing factors for the next decision.",
      contentType: "brief",
      visibility: "all_clients",
      isAiGenerated: false,
      status: "published",
      publishedAt: new Date(),
    }).returning();
    console.log(`Published (Economics, all clients): "${note.title}"`);
  } else {
    console.log("Economics research already seeded, skipping.");
  }

  console.log("");
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Economics demo seeding failed:", err);
  process.exit(1);
});
