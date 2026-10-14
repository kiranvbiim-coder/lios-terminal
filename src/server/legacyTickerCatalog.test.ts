import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { afterEach, beforeEach } from "node:test";
import {
  LEGACY_CATALOG_PROVIDER,
  loadLegacyTickerCatalog,
  resetLegacyTickerCatalogCache,
} from "./legacyTickerCatalog";

// Synthetic identity fixtures only; no copied directory or real coverage claims.
const fixtureRows = [
  { symbol: "SYNTH_ALPHA", name: "Synthetic alpha fixture", exchange: "SYNTH_EXCHANGE", region: "us" },
  { symbol: "SYNTH_BETA", name: "Synthetic beta fixture", exchange: "SYNTH_OTHER", region: "in" },
];
const electronProcess = process as NodeJS.Process & { resourcesPath?: string };
let root: string;
let file: string;
let previousResourcesPath: string | undefined;
let previousEnvironmentPath: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-synthetic-legacy-catalog-"));
  const directory = path.join(root, "server", "data");
  fs.mkdirSync(directory, { recursive: true });
  file = path.join(directory, "tickers.json");
  previousResourcesPath = electronProcess.resourcesPath;
  previousEnvironmentPath = process.env.ELECTRON_RESOURCES_PATH;
  delete electronProcess.resourcesPath;
  process.env.ELECTRON_RESOURCES_PATH = root;
  resetLegacyTickerCatalogCache();
});

afterEach(() => {
  resetLegacyTickerCatalogCache();
  if (previousResourcesPath === undefined) delete electronProcess.resourcesPath;
  else electronProcess.resourcesPath = previousResourcesPath;
  if (previousEnvironmentPath === undefined) delete process.env.ELECTRON_RESOURCES_PATH;
  else process.env.ELECTRON_RESOURCES_PATH = previousEnvironmentPath;
  fs.rmSync(root, { recursive: true, force: true });
});

test("absent user-provisioned legacy data produces no fabricated candidates", () => {
  assert.deepEqual(loadLegacyTickerCatalog(), []);
  assert.deepEqual(loadLegacyTickerCatalog(), []);
});

test("synthetic user-owned legacy records remain non-canonical with intact provider ticker identity", () => {
  fs.writeFileSync(file, JSON.stringify(fixtureRows));
  const candidates = loadLegacyTickerCatalog();
  assert.deepEqual(candidates.map((candidate) => candidate.symbol), fixtureRows.map((row) => row.symbol));
  for (const row of fixtureRows) {
    const candidate = candidates.find((value) => value.symbol === row.symbol)!;
    assert.equal(candidate.name, row.name);
    assert.equal(candidate.exchange, row.exchange);
    assert.equal(candidate.countryCode, row.region.toUpperCase());
    assert.equal(candidate.canonical, false);
    assert.equal(candidate.entityId, null);
    assert.equal(candidate.listingId, null);
    assert.equal(candidate.isPrimaryListing, false);
    assert.equal(candidate.lifecycleStatus, "active");
    assert.equal(candidate.source, LEGACY_CATALOG_PROVIDER);
    assert.deepEqual(candidate.identifiers, [{ type: "ticker", value: row.symbol, provider: LEGACY_CATALOG_PROVIDER }]);
  }
});

test("cached observations remain stable until reset rereads user-owned content", () => {
  fs.writeFileSync(file, JSON.stringify(fixtureRows));
  const original = loadLegacyTickerCatalog();
  fs.writeFileSync(file, JSON.stringify([{ symbol: "SYNTH_REPLACEMENT", name: "Synthetic replacement", exchange: "SYNTH_EXCHANGE" }]));
  assert.deepEqual(loadLegacyTickerCatalog(), original);
  resetLegacyTickerCatalogCache();
  assert.deepEqual(loadLegacyTickerCatalog().map((candidate) => candidate.symbol), ["SYNTH_REPLACEMENT"]);
});

test("a reset discovers newly supplied data after an absent-data read", () => {
  assert.deepEqual(loadLegacyTickerCatalog(), []);
  fs.writeFileSync(file, JSON.stringify(fixtureRows));
  resetLegacyTickerCatalogCache();
  assert.deepEqual(loadLegacyTickerCatalog().map((candidate) => candidate.symbol), fixtureRows.map((row) => row.symbol));
});
