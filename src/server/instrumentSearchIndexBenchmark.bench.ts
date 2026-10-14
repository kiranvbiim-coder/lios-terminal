import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { buildInstrumentSearchIndex, searchInstrumentIndexLocal, type InstrumentSearchIndex } from "@shared/instrumentSearchIndex";
import { loadLegacyTickerCatalog } from "./legacyTickerCatalog";
import { loadProviderIngestedCatalog } from "./providerIngestedCatalog";

/**
 * Explicit real-data performance benchmark, excluded from source test discovery.
 * Requires user-provisioned, lawfully entitled catalogs via ELECTRON_RESOURCES_PATH
 * (<root>/server/data/tickers.json and provider_ingested_universe.json).
 * LIOS_REAL_DATA_BENCHMARK_ENTITLED=1 is the user's rights attestation, not a
 * redistribution grant. No bundled private data or synthetic filler is supplied.
 * Missing prerequisites fail; source CI does not run or certify this benchmark.
 */
function loadRealBenchmarkUniverse() {
  assert.equal(
    process.env.LIOS_REAL_DATA_BENCHMARK_ENTITLED, "1",
    "NOT_RUN: attest local catalog-use entitlement with LIOS_REAL_DATA_BENCHMARK_ENTITLED=1 before running this real-data benchmark",
  );
  assert.ok(
    process.env.ELECTRON_RESOURCES_PATH,
    "NOT_RUN: set ELECTRON_RESOURCES_PATH to the user-provisioned catalog root; public source contains no real-universe dataset",
  );
  const universe = [...loadLegacyTickerCatalog(), ...loadProviderIngestedCatalog()];
  assert.ok(
    universe.length >= 80_000,
    `NOT_RUN: expected an entitled real universe of at least 80k, got ${universe.length}; synthetic substitution is prohibited`,
  );
  return universe;
}
function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function timeQuery(index: InstrumentSearchIndex, query: string): number {
  const start = performance.now();
  searchInstrumentIndexLocal(index, query, { limit: 20 });
  return performance.now() - start;
}

test("instrument search index: cold build + warm query p95 against an entitled real universe", () => {
  const universe = loadRealBenchmarkUniverse();

  const coldBuildStart = performance.now();
  const index = buildInstrumentSearchIndex(universe);
  const coldBuildMs = performance.now() - coldBuildStart;
  console.log(`  [benchmark] cold index build over ${universe.length} candidates: ${coldBuildMs.toFixed(1)}ms`);

  // A representative query mix: common short prefixes (worst case for
  // bucket size at PREFIX_LENGTH=3), full tickers, and company-name
  // substrings, all drawn from symbols/names that genuinely exist in the
  // real universe (not invented strings that would trivially miss every
  // bucket).
  const sampleSymbols = universe.slice(0, 500).map((c) => c.symbol)
    .filter((symbol): symbol is string => typeof symbol === "string" && symbol.length > 0);
  const queries = [
    "A", "AA", "AAP", "MS", "GOO", "TSL", "COIN", "BTC", "ETH", "USD",
    "APPLE", "MICROSOFT", "BANK", "FUND", "GROUP", "HOLDINGS", "INC", "CORP",
    ...sampleSymbols.slice(0, 60),
  ];

  // Warm run: build once, discard the first pass over each query (JIT
  // warmup), then measure.
  for (const q of queries) timeQuery(index, q);

  const timings: number[] = [];
  for (let round = 0; round < 3; round++) {
    for (const q of queries) timings.push(timeQuery(index, q));
  }
  timings.sort((a, b) => a - b);

  const p50 = percentile(timings, 50);
  const p95 = percentile(timings, 95);
  const p99 = percentile(timings, 99);
  console.log(`  [benchmark] warm query latency over ${timings.length} searches: p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms p99=${p99.toFixed(2)}ms`);

  // Target SLO: p95 < 300ms for the local index.
  assert.ok(p95 < 300, `p95 query latency ${p95.toFixed(2)}ms exceeds the 300ms SLO`);
});

test("instrument search index: a single cold-start build (server boot) also stays well under the SLO", () => {
  // Distinct from the warm-query test above: this measures the one-time
  // per-process cost instrumentSearchIndexStore.ts's loadCommonInstrumentSearchIndex
  // pays once at first use, not per-query.
  const universe = loadRealBenchmarkUniverse();
  const start = performance.now();
  buildInstrumentSearchIndex(universe);
  const elapsed = performance.now() - start;
  console.log(`  [benchmark] single cold build (process-boot cost) over ${universe.length} candidates: ${elapsed.toFixed(1)}ms`);
  assert.ok(elapsed < 3000, `cold index build took ${elapsed.toFixed(1)}ms -- unexpectedly slow for a one-time process-boot cost`);
});
