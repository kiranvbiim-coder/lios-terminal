import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import test from "node:test";
import {
  financeDatabaseCatalogPath,
  financeDatabaseManifestPath,
  financeDatabaseCatalogStatus,
  financeDatabaseCountryCode,
  loadFinanceDatabaseRows,
  loadFinanceDatabaseCatalog,
  resetFinanceDatabaseCatalogCache,
} from "./financeDatabaseCatalog";

test("user-root catalog preserves distinct exchange rows, FIGI/ISIN and delisted state", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-financedatabase-loader-"));
  const previous = process.env.LIOS_DATA_ROOT;
  process.env.LIOS_DATA_ROOT = dir;
  t.after(() => {
    resetFinanceDatabaseCatalogCache();
    if (previous === undefined) delete process.env.LIOS_DATA_ROOT;
    else process.env.LIOS_DATA_ROOT = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  resetFinanceDatabaseCatalogCache();
  assert.deepEqual(loadFinanceDatabaseCatalog(), []);
  const destination = financeDatabaseCatalogPath();
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify([
    { symbol: "DUP", name: "Example", exchange: "NMS", mic: "XNAS", isin: "US0378331005", figi: "BBG000B9XRY4", provider: "financedatabase", assetClass: "equities", active: true },
    { symbol: "DUP", name: "Example", exchange: "NYQ", mic: "XNYS", provider: "financedatabase", assetClass: "equities", active: false },
    { symbol: "FILE CREATION TIME: 12345", name: "metadata", provider: "financedatabase" },
  ]));
  resetFinanceDatabaseCatalogCache();
  const results = loadFinanceDatabaseCatalog();
  assert.equal(results.length, 2);
  assert.deepEqual(results.map(v => v.exchange), ["NMS", "NYQ"]);
  assert.equal(results[0].canonical, false);
  assert.equal(results[0].entityId, null);
  assert.equal(results[0].identifiers.some(x => x.type === "isin" && x.value === "US0378331005"), true);
  assert.equal(results[0].identifiers.some(x => x.type === "figi"), true);
  assert.equal(results[1].lifecycleStatus, "delisted");
});

test("country mapping uses ICU region registry without inventing ticker geography", () => {
  assert.equal(financeDatabaseCountryCode("United States"), "US");
  assert.equal(financeDatabaseCountryCode("Netherlands"), "NL");
  assert.equal(financeDatabaseCountryCode("Czech Republic"), "CZ");
  assert.equal(financeDatabaseCountryCode("Martian Interplanetary Exchange"), null);
});

test("catalog manifest integrity and accepted count fail closed", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-financedatabase-integrity-"));
  const old = process.env.LIOS_DATA_ROOT;
  process.env.LIOS_DATA_ROOT = dir;
  t.after(() => {
    resetFinanceDatabaseCatalogCache();
    if (old === undefined) delete process.env.LIOS_DATA_ROOT;
    else process.env.LIOS_DATA_ROOT = old;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const data = JSON.stringify([
    { provider: "financedatabase", assetClass: "equities", symbol: "HELLO", name: "First", active: true },
  ]);
  const catalog = financeDatabaseCatalogPath();
  const manifest = financeDatabaseManifestPath();
  fs.mkdirSync(path.dirname(catalog), { recursive: true });
  fs.writeFileSync(catalog, data);
  fs.writeFileSync(manifest, JSON.stringify({
    provider: "JerBouma/FinanceDatabase", upstreamCommit: "test-only",
    importedAt: "2026-10-26T00:00:00Z", categories: ["equities"], accepted: 1,
    byCategory: { equities: 1 }, files: [],
    catalogSha256: crypto.createHash("sha256").update(data).digest("hex"),
  }));
  resetFinanceDatabaseCatalogCache();
  assert.equal(loadFinanceDatabaseRows().length, 1);
  assert.equal(financeDatabaseCatalogStatus().imported, true);
  assert.equal(financeDatabaseCatalogStatus().searchCount, 1);
  fs.appendFileSync(catalog, " ");
  resetFinanceDatabaseCatalogCache();
  assert.deepEqual(loadFinanceDatabaseRows(), []);
  assert.equal(financeDatabaseCatalogStatus().imported, false);
});
