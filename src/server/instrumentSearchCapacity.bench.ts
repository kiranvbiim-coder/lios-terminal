import assert from "node:assert/strict";
import test from "node:test";
import { buildInstrumentSearchIndex, searchInstrumentIndexLocal } from "@shared/instrumentSearchIndex";
import type { InstrumentMasterCandidate } from "@shared/globalInstrumentMaster";
import { P5_INDEX_CAPACITY_PROOF_SIZE } from "./coverageLedgerService";

function candidate(i: number): InstrumentMasterCandidate {
  const symbol = `P5${String(i).padStart(6, "0")}`;
  return {
    entityId: `lios:entity:capacity:${i}`,
    listingId: `lios:listing:capacity:${i}`,
    securityId: `lios:security:capacity:${i}`,
    name: `P5 Capacity Instrument ${i}`,
    symbol,
    exchange: i % 2 ? "XNYS" : "XNAS",
    mic: i % 2 ? "XNYS" : "XNAS",
    countryCode: "US",
    currency: "USD",
    isPrimaryListing: true,
    lifecycleStatus: "active",
    identifiers: [{ type: "ticker", value: symbol, provider: "capacity_fixture" }],
    aliases: [],
    source: "capacity_fixture",
    canonical: true,
  };
}

test("P5 instrument index capacity proof exceeds 100k with p95 under 300ms", () => {
  const universe = Array.from({ length: P5_INDEX_CAPACITY_PROOF_SIZE }, (_, i) => candidate(i));
  assert.ok(universe.length >= 100_000);
  const index = buildInstrumentSearchIndex(universe);
  const queries = ["P5000001", "P5012345", "P5054321", "P5119999", "CAPACITY", "P50", "P51"];
  for (const query of queries) searchInstrumentIndexLocal(index, query, { limit: 20 });

  const timings: number[] = [];
  // Full offline runs execute many server files concurrently. Measure CPU
  // consumed by this worker rather than wall time so another test worker's
  // scheduler/GC pause cannot become a false capacity failure. The p95
  // threshold remains the same 300ms execution budget.
  for (let round = 0; round < 12; round += 1) {
    for (const query of queries) {
      const start = process.cpuUsage();
      searchInstrumentIndexLocal(index, query, { limit: 20 });
      const elapsed = process.cpuUsage(start);
      timings.push((elapsed.user + elapsed.system) / 1_000);
    }
  }
  timings.sort((a, b) => a - b);
  const p95 = timings[Math.min(timings.length - 1, Math.floor(timings.length * 0.95))];
  assert.ok(p95 < 300, `120k capacity proof p95 ${p95.toFixed(2)}ms exceeds 300ms`);
});
