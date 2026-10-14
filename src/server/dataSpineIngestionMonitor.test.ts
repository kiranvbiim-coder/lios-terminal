import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same isolation requirement as entityResolver.test.ts / financialStatementsConflictStore.test.ts.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-ingestion-monitor-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { getMonitoredSymbols, runDataSpineIngestionCycle } = await import("./dataSpineIngestionMonitor");
const { initDb, closeDb } = await import("./db");
const { eq } = await import("drizzle-orm");

test("scheduled data spine ingestion", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const db = (await import("./db")).getDb();
  const { users, organizations, portfolios, positions, watchlistItems, dashboardWatchlistItems, domains } = await import("@shared/schema");

  await t.test("getMonitoredSymbols returns nothing on a fresh, empty database", async () => {
    assert.deepEqual(await getMonitoredSymbols(), []);
  });

  await t.test("runDataSpineIngestionCycle skips the cycle when no active internal administrator is provisioned", async () => {
    const [analyst] = await db.insert(users).values({ email: "analyst@example.test", passwordHash: "x", role: "internal_analyst", name: "Analyst" }).returning();
    const [org] = await db.insert(organizations).values({ name: "Positions Org", slug: "positions-org-ingestion" }).returning();
    const [portfolio] = await db.insert(portfolios).values({ organizationId: org.id, name: "Test Portfolio" }).returning();
    await db.insert(positions).values({ portfolioId: portfolio.id, symbol: "aapl", shares: 10, avgCost: 100 });
    await db.insert(watchlistItems).values({ userId: analyst.id, symbol: "msft", name: "Microsoft Corp" });

    const result = await runDataSpineIngestionCycle();
    assert.equal(result.symbolsChecked, 0, "must not proceed to capture anything without a real system actor to attribute captures to");
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0].message, /no active internal administrator is provisioned/i);
  });

  await t.test("getMonitoredSymbols deduplicates and uppercases across positions, personal watchlist, dashboard watchlist, and alerts", async () => {
    const [dashOrg] = await db.insert(organizations).values({ name: "Test Org", slug: "test-org-ingestion" }).returning();
    const [dashDomain] = await db.insert(domains).values({ slug: "finance-ingestion-test", name: "Finance" }).returning();
    const [clientUser] = await db.insert(users).values({ email: "client@example.test", passwordHash: "x", role: "client_user", name: "Client", organizationId: dashOrg.id }).returning();
    await db.insert(dashboardWatchlistItems).values({ organizationId: dashOrg.id, domainId: dashDomain.id, symbol: "aapl", name: "Apple", addedByUserId: clientUser.id });
    const [secondAnalyst] = await db.insert(users).values({ email: "second-analyst@example.test", passwordHash: "x", role: "internal_analyst", name: "Second" }).returning();
    await db.insert(watchlistItems).values({ userId: secondAnalyst.id, symbol: "GOOGL", name: "Alphabet Inc" });

    const symbols = await getMonitoredSymbols();
    // From the previous subtest: AAPL (positions) + MSFT (watchlist).
    // From this subtest: AAPL again (dashboard watchlist, must dedup against the positions-sourced AAPL) + GOOGL.
    assert.ok(symbols.includes("AAPL"));
    assert.ok(symbols.includes("MSFT"));
    assert.ok(symbols.includes("GOOGL"));
    assert.equal(symbols.filter((s) => s === "AAPL").length, 1, "AAPL appearing in two different source tables must still be a single entry");
    assert.deepEqual(symbols, [...symbols].sort(), "results are sorted");
  });

  await t.test("runDataSpineIngestionCycle proceeds once an active internal administrator exists, and reports zero checks when no symbols are monitored", async () => {
    await db.insert(users).values({
      email: "first-run-admin@example.test",
      passwordHash: "x",
      role: "internal_admin",
      name: "First Run Admin",
    });
    // Clear every monitored-symbol source table so this assertion is about
    // the "admin exists, nothing to monitor" path specifically, isolated
    // from the rows the earlier subtests in this suite inserted.
    await db.delete(positions);
    await db.delete(watchlistItems);
    await db.delete(dashboardWatchlistItems);

    const result = await runDataSpineIngestionCycle();
    assert.equal(result.symbolsChecked, 0);
    assert.deepEqual(result.changed, []);
    assert.deepEqual(result.failures, []);
  });

  await t.test("system attribution uses an active internal administrator without relying on a well-known email", async () => {
    await db.update(users).set({ active: false }).where(eq(users.email, "first-run-admin@example.test"));
    await db.insert(users).values({
      email: "replacement-admin@example.test",
      passwordHash: "x",
      role: "internal_admin",
      name: "Replacement Admin",
      active: true,
    });

    const result = await runDataSpineIngestionCycle();
    assert.equal(result.symbolsChecked, 0);
    assert.deepEqual(result.failures, []);
  });
});
