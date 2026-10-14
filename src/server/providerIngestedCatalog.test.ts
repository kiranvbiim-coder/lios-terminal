import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { afterEach, beforeEach } from "node:test";
import {
  loadProviderIngestedCatalog,
  resetProviderIngestedCatalogCache,
} from "./providerIngestedCatalog";

// Synthetic identity fixtures only: these are not market data or real coverage evidence.
const fixtureRows = [
  { symbol: "SYNTH_SEC", name: "Synthetic SEC fixture", provider: "sec_edgar", providerId: "synthetic-cik", exchange: "SYNTH_EXCHANGE", countryCode: "us" },
  { symbol: "SYNTH_NASDAQ", name: "Synthetic NASDAQ fixture", provider: "nasdaq_trader", providerId: "synthetic-listing" },
  { symbol: "SYNTH_COIN", name: "Synthetic coin fixture", provider: "coingecko", providerId: "synthetic-coin", active: false },
];
const electronProcess = process as NodeJS.Process & { resourcesPath?: string };
let root: string;
let file: string;
let previousResourcesPath: string | undefined;
let previousEnvironmentPath: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-synthetic-provider-catalog-"));
  const directory = path.join(root, "server", "data");
  fs.mkdirSync(directory, { recursive: true });
  file = path.join(directory, "provider_ingested_universe.json");
  previousResourcesPath = electronProcess.resourcesPath;
  previousEnvironmentPath = process.env.ELECTRON_RESOURCES_PATH;
  delete electronProcess.resourcesPath;
  process.env.ELECTRON_RESOURCES_PATH = root;
  resetProviderIngestedCatalogCache();
});

afterEach(() => {
  resetProviderIngestedCatalogCache();
  if (previousResourcesPath === undefined) delete electronProcess.resourcesPath;
  else electronProcess.resourcesPath = previousResourcesPath;
  if (previousEnvironmentPath === undefined) delete process.env.ELECTRON_RESOURCES_PATH;
  else process.env.ELECTRON_RESOURCES_PATH = previousEnvironmentPath;
  fs.rmSync(root, { recursive: true, force: true });
});

test("absent user-provisioned provider data produces no fabricated candidates", () => {
  assert.deepEqual(loadProviderIngestedCatalog(), []);
  assert.deepEqual(loadProviderIngestedCatalog(), []);
});

test("synthetic user-owned provider records retain provisional identity and originating provider", () => {
  fs.writeFileSync(file, JSON.stringify(fixtureRows));
  const candidates = loadProviderIngestedCatalog();
  assert.deepEqual(candidates.map((candidate) => candidate.symbol), fixtureRows.map((row) => row.symbol));
  for (const row of fixtureRows) {
    const candidate = candidates.find((value) => value.symbol === row.symbol)!;
    assert.equal(candidate.canonical, false);
    assert.equal(candidate.entityId, null);
    assert.equal(candidate.listingId, null);
    assert.equal(candidate.isPrimaryListing, false);
    assert.equal(candidate.source, row.provider);
    assert.equal(candidate.lifecycleStatus, row.active === false ? "delisted" : "active");
    assert.deepEqual(candidate.identifiers, [
      { type: "ticker", value: row.symbol, provider: row.provider },
      { type: "provider_id", value: row.providerId, provider: row.provider },
    ]);
  }
});

test("cached observations remain stable until reset rereads user-owned content", () => {
  fs.writeFileSync(file, JSON.stringify(fixtureRows));
  const original = loadProviderIngestedCatalog();
  const replacement = [{ symbol: "SYNTH_REPLACEMENT", name: "Synthetic replacement", provider: "sec_edgar", providerId: "synthetic-replacement" }];
  fs.writeFileSync(file, JSON.stringify(replacement));
  assert.deepEqual(loadProviderIngestedCatalog(), original);
  resetProviderIngestedCatalogCache();
  assert.deepEqual(loadProviderIngestedCatalog().map((candidate) => candidate.symbol), ["SYNTH_REPLACEMENT"]);
});

test("a reset discovers newly supplied data after an absent-data read", () => {
  assert.deepEqual(loadProviderIngestedCatalog(), []);
  fs.writeFileSync(file, JSON.stringify(fixtureRows));
  resetProviderIngestedCatalogCache();
  assert.deepEqual(loadProviderIngestedCatalog().map((candidate) => candidate.source), fixtureRows.map((row) => row.provider));
});
