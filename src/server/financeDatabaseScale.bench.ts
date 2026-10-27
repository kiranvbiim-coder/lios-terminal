import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { buildInstrumentSearchIndex, searchInstrumentIndexLocal } from "@shared/instrumentSearchIndex";
import { loadFinanceDatabaseCatalog, loadFinanceDatabaseRows, financeDatabaseCatalogStatus } from "./financeDatabaseCatalog";
import { getInstrumentDirectorySnapshot, queryInstrumentDirectory, searchInstrumentDirectory, resetInstrumentDirectoryCache } from "./instrumentDirectory";

/**
 * P5 real-data scale acceptance. NEVER automatically runs in source CI.
 * `LIOS_REAL_DATA_BENCHMARK_ENTITLED=1` means data use was explicitly
 * reviewed. This benchmark neither downloads nor republishes market assets.
 */
test("300k+ imported source integrity, local index p95, directory p95 and RSS", () => {
  assert.equal(process.env.LIOS_REAL_DATA_BENCHMARK_ENTITLED, "1",
    "NOT_RUN: requires explicit local source entitlement attestation");
  const status = financeDatabaseCatalogStatus();
  const rows = loadFinanceDatabaseRows();
  assert.equal(status.imported, true, "NOT_RUN: install actual verified catalog before benchmarking");
  assert.ok(rows.length >= 300_000,
    "NOT_RUN: expected >=300000 imported reference listings; no synthetic padding permitted, got " + rows.length);
  const sourceRows = loadFinanceDatabaseCatalog();
  assert.equal(sourceRows.length, rows.length);
  const memStart = process.memoryUsage().rss;
  const indexStart = performance.now();
  const index = buildInstrumentSearchIndex(sourceRows);
  const indexMs = performance.now() - indexStart;
  resetInstrumentDirectoryCache();
  const directoryStart = performance.now();
  const directory = getInstrumentDirectorySnapshot();
  const directoryMs = performance.now() - directoryStart;
  assert.ok(directory.items.length >= rows.length, "Directory must expose at least imported source rows");
  const queries = ["A", "AA", "APL", "FUND", "BANK", "USD", "BTC", "ASML", "VANGUARD",
    ...sourceRows.slice(0, 80).map(row => row.symbol).filter((x): x is string => !!x)];
  const indexTimings: number[] = [], directoryTimings: number[] = [];
  for (const query of queries) {
    searchInstrumentIndexLocal(index, query, { limit: 20 });
    searchInstrumentDirectory(directory.items, query);
    queryInstrumentDirectory(directory.items, { q: query, page: 1 });
  }
  for (let round = 0; round < 3; round++) {
    for (const query of queries) {
      let start = performance.now();
      searchInstrumentIndexLocal(index, query, { limit: 20 });
      indexTimings.push(performance.now() - start);
      start = performance.now();
      searchInstrumentDirectory(directory.items, query);
      queryInstrumentDirectory(directory.items, { q: query, page: 1 });
      directoryTimings.push(performance.now() - start);
    }
  }
  const p95 = (timings: number[]) => timings.sort((a,b) => a-b)[Math.floor(timings.length * 0.95)]!;
  const p95Index = p95(indexTimings);
  const p95Directory = p95(directoryTimings);
  const rssMB = process.memoryUsage().rss / (1024*1024);
  console.log(JSON.stringify({
    sourceRows: rows.length, mergedDirectoryRows: directory.items.length,
    coldIndexMs: +indexMs.toFixed(2), coldDirectoryMs: +directoryMs.toFixed(2),
    indexP95Ms: +p95Index.toFixed(2), directoryP95Ms: +p95Directory.toFixed(2),
    rssMB: +rssMB.toFixed(1), rssDeltaMB: +((process.memoryUsage().rss - memStart) / 1048576).toFixed(1),
  }, null, 2));
  assert.ok(indexMs < 12_000, "Cold 300k index exceeded 12 seconds");
  assert.ok(p95Index < 300, "P5 index query p95 exceeded 300ms");
  assert.ok(p95Directory < 1200, "Full-facet directory query p95 exceeded 1200ms");
  const maxMB = Number(process.env.LIOS_MAX_INDEX_RSS_MB || "1600");
  assert.ok(Number.isFinite(maxMB) && rssMB < maxMB, "300k catalog index exceeded configured process RSS budget");
});
