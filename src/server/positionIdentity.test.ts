import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-position-identity-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const { companies, securities, companyListings, organizations, portfolios, positions } = await import("@shared/schema");
const { resolvePositionIdentity, toCanonicalIdentity } = await import("./positionIdentity");

test("position identity resolves listings and leaves unknown tickers unresolved", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const db = getDb();
  const [company] = await db.insert(companies).values({ symbol: "PIDT", name: "Position Identity Test" }).returning();
  const [security] = await db.insert(securities).values({ companyId: company.id, name: "Position Identity Common", assetClass: "equity" }).returning();
  const [listing] = await db.insert(companyListings).values({
    companyId: company.id,
    securityId: security.id,
    symbol: "PIDT",
    exchange: "XNAS",
    mic: "XNAS",
    isPrimary: true,
  }).returning();
  const [org] = await db.insert(organizations).values({ name: "Position Identity Org", slug: "position-identity-org" }).returning();
  const [portfolio] = await db.insert(portfolios).values({ organizationId: org.id, name: "Core" }).returning();

  const resolved = await resolvePositionIdentity(db, "pidt");
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.listingId, listing.id);
  assert.equal(resolved.securityId, security.id);

  const unresolved = await resolvePositionIdentity(db, "NOTALISTING");
  assert.equal(unresolved.resolved, false);
  assert.equal(unresolved.listingId, null);
  assert.equal(toCanonicalIdentity(resolved).listingId, `lios:listing:${listing.id}`);
  assert.equal(toCanonicalIdentity(unresolved).listingId, null);

  const [row] = await db.insert(positions).values({
    portfolioId: portfolio.id,
    symbol: resolved.symbol,
    listingId: resolved.listingId,
    securityId: resolved.securityId,
    shares: 10,
    avgCost: 12,
  }).returning();
  assert.equal(row.listingId, listing.id);
  assert.equal(row.symbol, "PIDT");
});
