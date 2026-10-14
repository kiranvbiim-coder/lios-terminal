import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * PROFILE_CATALOG (server/marketData.ts) is a ~180-symbol
 * hand-curated fallback for quote/fundamentals display when a live provider
 * has nothing -- a legitimate, currently load-bearing display fallback, not
 * identity. New global-market features must consume canonical identities
 * (companies/companyListings/companyIdentifiers via globalInstrumentMaster)
 * instead. This test keeps that boundary from eroding silently: none of the
 * canonical identity/market-master modules may import marketData.ts or
 * reference PROFILE_CATALOG, in either direction.
 */
const CANONICAL_IDENTITY_MODULES = [
  "shared/globalInstrumentMaster.ts",
  "server/globalInstrumentMasterStore.ts",
  "shared/globalMarketMaster.ts",
  "server/globalMarketMasterStore.ts",
  "shared/instrumentSearchIndex.ts",
  "server/instrumentSearchIndexStore.ts",
  "server/legacyTickerCatalog.ts",
  // Provider-listing ingestion also feeds the canonical universe, so the
  // same boundary applies.
  "server/providerIngestedCatalog.ts",
  "server/instrumentUniverseIngestion.ts",
];

test("canonical identity/market-master modules never depend on the legacy PROFILE_CATALOG fallback", () => {
  const root = path.resolve(process.cwd());
  const violations: string[] = [];

  for (const relativePath of CANONICAL_IDENTITY_MODULES) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    if (/PROFILE_CATALOG/.test(source)) violations.push(`${relativePath} references PROFILE_CATALOG`);
    if (/from\s+["'].*marketData["']/.test(source)) violations.push(`${relativePath} imports from marketData.ts`);
  }

  assert.deepEqual(violations, []);
});
