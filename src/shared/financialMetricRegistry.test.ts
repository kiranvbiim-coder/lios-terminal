import test from "node:test";
import assert from "node:assert/strict";
import { resolveFinancialMetric, type FinancialMetricObservation } from "./financialMetricRegistry";

function filedObservation(metricId: string, value: number, fiscalYear: string, asOf: string): FinancialMetricObservation {
  return { metricId, value, status: "filed", period: fiscalYear, asOf, source: "fixture" };
}

test("resolveFinancialMetric prefers the most recent observation when multiple periods tie on status", () => {
  // Real filed multi-year statements all carry the same "filed" status, and
  // a provider's payload lists periods oldest-first (see
  // buildFinancialDatasetPayload's periodEnd sort in pointInTimeDatasetStore.ts).
  // Deliberately push the oldest fiscal year first, matching that real
  // ordering, to catch a resolver that silently falls back to array order
  // (i.e. the oldest period) instead of picking the latest asOf.
  const observations: FinancialMetricObservation[] = [
    filedObservation("revenue", 265_595_000_000, "2018", "2018-09-29"),
    filedObservation("revenue", 391_035_000_000, "2025", "2025-09-27"),
  ];
  const resolved = resolveFinancialMetric("revenue", observations);
  assert.equal(resolved?.value, 391_035_000_000, "must resolve to the 2025 filing, not the 2018 filing that happens to be first in the array");
  assert.equal(resolved?.period, "2025");
});

test("resolveFinancialMetric still prefers a higher-priority status over mere recency", () => {
  // An analyst's manual override for an older period must still beat a
  // newer but lower-priority filed observation -- recency only breaks ties
  // within the same status, it never overrides STATUS_PRIORITY.
  const observations: FinancialMetricObservation[] = [
    { metricId: "revenue", value: 300_000_000_000, status: "manual", period: "2020", asOf: "2020-09-30", source: "fixture" },
    filedObservation("revenue", 391_035_000_000, "2025", "2025-09-27"),
  ];
  const resolved = resolveFinancialMetric("revenue", observations);
  assert.equal(resolved?.value, 300_000_000_000);
  assert.equal(resolved?.status, "manual");
});

test("resolveFinancialMetric with an explicit period request is unaffected by the recency tiebreaker", () => {
  const observations: FinancialMetricObservation[] = [
    filedObservation("revenue", 265_595_000_000, "2018", "2018-09-29"),
    filedObservation("revenue", 391_035_000_000, "2025", "2025-09-27"),
  ];
  const resolved = resolveFinancialMetric("revenue", observations, { period: "2018" });
  assert.equal(resolved?.value, 265_595_000_000);
});
