import assert from "node:assert/strict";
import test from "node:test";
import type { FinancialMetricObservation } from "@shared/financialMetricRegistry";
import { materializeFinancialScenarioObservations, propagateFinancialScenario, resolveScenarioMetric } from "@shared/financialScenarioPropagation";

const observation = (metricId: string, value: number): FinancialMetricObservation => ({ metricId, value, status: "filed", period: "CURRENT", source: "fixture", asOf: "2026-01-01", currency: "USD" });

const scenario = { id: "bull", name: "Bull", assumptions: [{ key: "ebitda", value: 30, unit: "currency", source: "Analyst case" }] };

test("scenario assumptions materialize as explicit scenario observations", () => {
  const result = materializeFinancialScenarioObservations(scenario);
  assert.deepEqual(result, [{ metricId: "ebitda", value: 30, status: "derived", period: "CURRENT", scenarioId: "bull", source: "Scenario assumption: Bull", note: "Analyst case" }]);
});

test("scenario propagation compares derived metrics against the base case", () => {
  const impacts = propagateFinancialScenario({ baseObservations: [observation("marketCap", 1000), observation("cash", 100), observation("shortTermDebt", 0), observation("longTermDebt", 100), observation("ebitda", 20)], scenario, metricIds: ["enterpriseValue", "evEbitda"] });
  const multiple = impacts.find(item => item.metricId === "evEbitda");
  assert.equal(multiple?.base?.value, 50);
  assert.equal(multiple?.scenario?.value, 33.333333333333336);
  assert.ok((multiple?.percentDelta ?? 0) < 0);
});

test("scenario metric resolution preserves explicit scenario identity", () => {
  const resolved = resolveScenarioMetric("ebitda", [observation("ebitda", 20)], scenario);
  assert.equal(resolved?.value, 30);
  assert.equal(resolved?.scenarioId, "bull");
});
