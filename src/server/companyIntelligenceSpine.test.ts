import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { eq } from "drizzle-orm";
import { companyListings, securities } from "@shared/schema";
import type { CompanySnapshotDependencies } from "./companyIntelligenceSpine";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-company-spine-identity-"));
process.env.LIMURIA_DATA_DIR = dataDir;
delete process.env.DATABASE_URL;
const { initDb, closeDb, getDb } = await import("./db");
const { upsertCompany, upsertEntity } = await import("./companyStore");
const { buildCompanySnapshot } = await import("./companyIntelligenceSpine");
const { registerCompanyIntelligenceRoutes } = await import("./companyIntelligenceRoutes");

test("company snapshot resolves real identity before provider retrieval and through HTTP", async (t) => {
  await initDb();
  t.after(async () => { await closeDb(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const calls: Array<{ kind: string; input: unknown }> = [];
  const providers: Partial<CompanySnapshotDependencies> = {
    getQuotes: async (symbols) => { calls.push({ kind: "quote", input: symbols }); return []; },
    resolveFinancialStatements: async (symbol) => { calls.push({ kind: "financials", input: symbol }); return null; },
    getCompanyFilings: async (input) => { calls.push({ kind: "filings", input }); return []; },
    getInsiderTransactions: async (input) => { calls.push({ kind: "insiders", input }); return []; },
  };
  const noMarket = (snapshot: Awaited<ReturnType<typeof buildCompanySnapshot>>) => {
    assert.equal(snapshot.quote, null);
    assert.equal(snapshot.financials, null);
  };

  await t.test("unknown names register no provider work", async () => {
    calls.length = 0;
    const snapshot = await buildCompanySnapshot("Unknown A2 Fixture Company", providers);
    assert.equal(snapshot.resolutionStatus, "unresolved");
    assert.equal(snapshot.entity, null);
    noMarket(snapshot);
    assert.equal(snapshot.filings, null);
    assert.equal(snapshot.insiders, null);
    assert.deepEqual(snapshot.subsystemFailures, []);
    assert.deepEqual(calls, []);
  });
  await t.test("ambiguity is retained and never selects a provider symbol", async () => {
    await upsertCompany({ symbol: "ATLASA", name: "Atlas Systems", exchange: "NASDAQ" });
    await upsertCompany({ symbol: "ATLASB", name: "Atlas Systems", exchange: "LSE" });
    calls.length = 0;
    const snapshot = await buildCompanySnapshot("Atlas Systems", providers);
    assert.equal(snapshot.resolutionStatus, "ambiguous");
    assert.ok(snapshot.entity && "ambiguous" in snapshot.entity);
    assert.equal(snapshot.entity.candidates.length, 2);
    noMarket(snapshot);
    assert.deepEqual(calls, []);
  });
  await t.test("no-listing entities never use their name as a ticker", async () => {
    const id = await upsertEntity({ name: "Northwind Private Research Ltd" });
    calls.length = 0;
    const snapshot = await buildCompanySnapshot("Northwind Private Research Ltd", providers);
    assert.equal(snapshot.resolutionStatus, "resolved");
    assert.ok(snapshot.entity && !("ambiguous" in snapshot.entity));
    assert.equal(snapshot.entity.id, id);
    assert.equal(snapshot.entity.symbol, null);
    noMarket(snapshot);
    assert.deepEqual(calls, []);
  });
  await t.test("a CIK-only company invokes only SEC work under its existing entity", async () => {
    const id = await upsertEntity({ name: "CIK Only Private Research LLC", cik: "0007654321" });
    calls.length = 0;
    const snapshot = await buildCompanySnapshot("CIK:0007654321", providers);
    assert.equal(snapshot.resolutionStatus, "resolved");
    noMarket(snapshot);
    assert.deepEqual(calls, [
      { kind: "filings", input: { entityId: id, cik: "0007654321", name: "CIK Only Private Research LLC", symbol: null } },
      { kind: "insiders", input: { entityId: id, cik: "0007654321", name: "CIK Only Private Research LLC", symbol: null } },
    ]);
    const db = getDb();
    assert.equal((await db.select().from(companyListings).where(eq(companyListings.companyId, id))).length, 0);
    assert.equal((await db.select().from(securities).where(eq(securities.companyId, id))).length, 0);
  });
  await t.test("a company name uses its resolved listing symbol, never the raw name", async () => {
    await upsertCompany({ symbol: "MSFT", name: "Microsoft Corporation", exchange: "NASDAQ" });
    calls.length = 0;
    const snapshot = await buildCompanySnapshot("Microsoft Corporation", providers);
    assert.equal(snapshot.resolutionStatus, "resolved");
    assert.deepEqual(calls, [
      { kind: "quote", input: ["MSFT"] }, { kind: "financials", input: "MSFT" },
      { kind: "filings", input: "MSFT" }, { kind: "insiders", input: "MSFT" },
    ]);
  });
  await t.test("exchange-qualified selection uses that listing, not the issuer display symbol", async () => {
    calls.length = 0;
    const snapshot = await buildCompanySnapshot("ATLASB@LSE", providers);
    assert.equal(snapshot.resolutionStatus, "resolved");
    assert.deepEqual(calls.find((call) => call.kind === "quote")?.input, ["ATLASB"]);
  });
  await t.test("provider failures remain isolated from successful filing results", async () => {
    const snapshot = await buildCompanySnapshot("MSFT", {
      ...providers,
      getQuotes: async () => { throw new Error("quote provider unavailable"); },
      getCompanyFilings: async () => [{ formType: "10-K", filedDate: "2026-01-01", accessionNumber: "fixture-1", filingUrl: "https://example.test/fixture" }],
    });
    assert.equal(snapshot.resolutionStatus, "resolved");
    assert.equal(snapshot.quote, null);
    assert.equal(snapshot.filings?.length, 1);
    assert.deepEqual(snapshot.subsystemFailures, [{ subsystem: "quote", message: "quote provider unavailable" }]);
  });
  await t.test("failed identity lookup cannot start any provider work", async () => {
    calls.length = 0;
    const snapshot = await buildCompanySnapshot("MSFT", { ...providers, resolveEntity: async () => { throw new Error("identity store unavailable"); } });
    assert.equal(snapshot.resolutionStatus, "failed");
    assert.deepEqual(snapshot.subsystemFailures, [{ subsystem: "entity", message: "identity store unavailable" }]);
    assert.deepEqual(calls, []);
  });
  await t.test("real GET exposes unknown/ambiguous states and accepts bounded long legal names", async () => {
    const longName = "Northwind International Private Research And Development Holdings Limited";
    const id = await upsertEntity({ name: longName });
    const app = express();
    registerCompanyIntelligenceRoutes(app, providers);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    try {
      calls.length = 0;
      const base = `http://127.0.0.1:${address.port}/api/company-spine/`;
      for (const [query, state] of [["Unknown A2 Fixture", "unresolved"], ["Atlas Systems", "ambiguous"], [longName, "resolved"]]) {
        const response = await fetch(base + encodeURIComponent(query));
        assert.equal(response.status, 200);
        const snapshot = await response.json();
        assert.equal(snapshot.resolutionStatus, state);
        assert.equal(snapshot.quote, null);
        if (query === longName) assert.equal(snapshot.entity.id, id);
      }
      assert.deepEqual(calls, []);
      assert.equal((await fetch(base + "x".repeat(241))).status, 400);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
