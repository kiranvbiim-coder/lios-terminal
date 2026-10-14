import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// db.ts reads LIMURIA_DATA_DIR into a module-level const the instant it's
// first imported -- including transitively through a static
// `import { resolveEntity } from "./entityResolver"` at this file's own
// top level, which would freeze PGLITE_DIR at this project's real
// data/pgdata (colliding with the actual dev server's live PGlite
// ownership) before this file's own body ever runs. Every import that
// touches ./db is therefore deferred until after the env override below is
// in place.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-entity-resolver-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { parseEntityQuery, resolveEntity } = await import("./entityResolver");
const { initDb, closeDb } = await import("./db");
const { upsertCompany, upsertEntity } = await import("./companyStore");

test("parseEntityQuery resolves identifier prefixes", () => {
  assert.deepEqual(parseEntityQuery("cik: 0000320193"), { raw: "CIK: 0000320193", identifierType: "cik", identifier: "0000320193" });
  assert.deepEqual(parseEntityQuery("isin=us0378331005"), { raw: "ISIN=US0378331005", identifierType: "isin", identifier: "US0378331005" });
});

test("parseEntityQuery scopes exchange-qualified tickers", () => {
  assert.deepEqual(parseEntityQuery("aapl@nasdaq"), { raw: "AAPL@NASDAQ", symbol: "AAPL", exchange: "NASDAQ" });
  assert.deepEqual(parseEntityQuery("reliance.ns"), { raw: "RELIANCE.NS", symbol: "RELIANCE.NS" });
});

// resolveEntity() is a live-DB read path (companies/companyListings/
// companyIdentifiers) with exactly one caller in production (GET
// /api/finance/entities/resolve) and, until now, zero test coverage of its
// actual query logic -- only the string parser above was tested. This runs
// real migrations against an isolated PGlite instance (the same
// LIMURIA_DATA_DIR override db.ts's own module docstring documents for
// test isolation) and exercises resolveEntity/upsertCompany against that
// live database -- not a mock.
test("resolveEntity against a live database", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await t.test("returns null for an empty query", async () => {
    assert.equal(await resolveEntity("   "), null);
  });

  await t.test("returns null when nothing matches", async () => {
    assert.equal(await resolveEntity("NOSUCHTICKER"), null);
  });

  await t.test("resolves a single unambiguous symbol match", async () => {
    await upsertCompany({ symbol: "AAPL", name: "Apple Inc.", cik: "0000320193", exchange: "NASDAQ", source: "test" });
    const result = await resolveEntity("AAPL");
    assert.ok(result && !("ambiguous" in result));
    assert.equal((result as { symbol: string }).symbol, "AAPL");
    assert.equal((result as { matched: { kind: string } }).matched.kind, "listing");
  });

  await t.test("resolves by CIK identifier prefix", async () => {
    const result = await resolveEntity("CIK:0000320193");
    assert.ok(result && !("ambiguous" in result));
    assert.equal((result as { symbol: string }).symbol, "AAPL");
    assert.equal((result as { matched: { kind: string; type: string } }).matched.kind, "identifier");
    assert.equal((result as { matched: { type: string } }).matched.type, "cik");
  });

  await t.test("resolves by a provider-sourced identifier (a vendor's own internal id, distinct from the ticker)", async () => {
    await upsertCompany({
      symbol: "BTC-COINGECKO-TEST",
      name: "Bitcoin",
      exchange: "CRYPTO",
      assetClass: "crypto",
      source: "coingecko",
      identifiers: [{ type: "provider", value: "bitcoin", primary: true }],
    });
    const result = await resolveEntity("PROVIDER:bitcoin");
    assert.ok(result && !("ambiguous" in result));
    assert.equal((result as { symbol: string }).symbol, "BTC-COINGECKO-TEST");
    assert.equal((result as { matched: { type: string } }).matched.type, "provider");
  });

  await t.test("scopes an exchange-qualified query to the matching listing", async () => {
    await upsertCompany({ symbol: "RELIANCE.NS", name: "Reliance Industries", exchange: "NSE", source: "test" });
    const result = await resolveEntity("RELIANCE.NS@NSE");
    assert.ok(result && !("ambiguous" in result));
    assert.equal((result as { symbol: string }).symbol, "RELIANCE.NS");
  });

  await t.test("reports ambiguity when the same symbol is listed on two different exchanges", async () => {
    await upsertCompany({ symbol: "DUALTEST", name: "Dual Listed Co", exchange: "NYSE", source: "test-a" });
    await upsertCompany({ symbol: "DUALTEST", name: "Dual Listed Co", exchange: "LSE", source: "test-b" });
    const result = await resolveEntity("DUALTEST");
    assert.ok(result && "ambiguous" in result && result.ambiguous);
    assert.equal(result.candidates.length, 2);
    assert.deepEqual(new Set(result.candidates.map((c) => c.exchange)), new Set(["NYSE", "LSE"]));
  });

  await t.test("upsertCompany updates rather than duplicates on a second call for the same symbol", async () => {
    const firstId = await upsertCompany({ symbol: "MSFT", name: "Microsoft Corp", exchange: "NASDAQ", sector: "Technology", source: "test" });
    const secondId = await upsertCompany({ symbol: "MSFT", name: "Microsoft Corporation", exchange: "NASDAQ", sector: "Technology", source: "test" });
    assert.equal(firstId, secondId, "re-upserting the same symbol must update the existing row, not create a new one");
    const result = await resolveEntity("MSFT");
    assert.ok(result && !("ambiguous" in result));
    assert.equal((result as { name: string }).name, "Microsoft Corporation", "the second upsert's name should win");
  });

  await t.test("equal legal names surface canonical ambiguity instead of the first row", async () => {
    await upsertCompany({ symbol: "ATLASA", name: "Atlas Systems", exchange: "NASDAQ" });
    await upsertCompany({ symbol: "ATLASB", name: "Atlas Systems", exchange: "LSE" });
    const result = await resolveEntity("Atlas Systems");
    assert.ok(result && "ambiguous" in result && result.ambiguous);
    assert.deepEqual(new Set(result.candidates.map((candidate) => candidate.symbol)), new Set(["ATLASA", "ATLASB"]));
  });

  await t.test("a no-ticker name and CIK resolve the existing entity without a listing", async () => {
    const id = await upsertEntity({ name: "Northwind Private Research Ltd", cik: "0007654321" });
    for (const query of ["Northwind Private Research Ltd", "CIK:0007654321"]) {
      const result = await resolveEntity(query);
      assert.ok(result && !("ambiguous" in result));
      assert.equal(result.id, id);
      assert.equal(result.symbol, null);
      assert.equal(result.listing, undefined);
    }
  });

  await t.test("name wildcard characters are literal, never an arbitrary prefix match", async () => {
    assert.equal(await resolveEntity("%"), null);
    assert.equal(await resolveEntity("_"), null);
  });
});
