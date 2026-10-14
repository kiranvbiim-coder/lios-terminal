import test from "node:test";
import assert from "node:assert/strict";
import { computeForecastAccountability } from "./decisionReceiptEngine";

// ─── Forecast Accountability ──────────────────────────────────────────────

test("forecast accountability: computes errors and accuracy score", () => {
  const result = computeForecastAccountability([
    { id: "f1", metric: "revenue", forecastValue: 110, forecastDate: "2026-01-01", targetDate: "2026-12-31", actualValue: 100, actualDate: "2026-12-31", engineId: "dcf", receiptId: "r1", owner: { userId: 1, name: "A" } },
    { id: "f2", metric: "eps", forecastValue: 5.0, forecastDate: "2026-01-01", targetDate: "2026-12-31", actualValue: 5.2, actualDate: "2026-12-31", engineId: "dcf", receiptId: "r1", owner: { userId: 1, name: "A" } },
    { id: "f3", metric: "revenue", forecastValue: 200, forecastDate: "2026-01-01", targetDate: "2027-12-31", engineId: "dcf", receiptId: "r2", owner: { userId: 1, name: "A" } },
  ]);
  assert.equal(result.totalForecasts, 3);
  assert.equal(result.resolvedForecasts, 2);
  assert.equal(result.forecasts.length, 2);
  // Revenue: |110-100|/100 = 10%, EPS: |5.0-5.2|/5.2 ≈ 3.8%
  assert.ok(result.meanPercentageError > 0.05);
  assert.ok(result.accuracyScore > 0 && result.accuracyScore < 100);
  assert.equal(result.forecasts[0].direction, "over"); // revenue over-predicted
  assert.equal(result.forecasts[1].direction, "under"); // eps under-predicted
  assert.ok(result.mostAccurateMetric != null);
});

test("forecast accountability: no resolved forecasts returns zero score", () => {
  const result = computeForecastAccountability([
    { id: "f1", metric: "revenue", forecastValue: 100, forecastDate: "2026-01-01", targetDate: "2027-12-31", engineId: "dcf", receiptId: "r1", owner: { userId: 1, name: "A" } },
  ]);
  assert.equal(result.resolvedForecasts, 0);
  assert.equal(result.accuracyScore, 0);
});

test("forecast accountability: perfect forecast scores 100", () => {
  const result = computeForecastAccountability([
    { id: "f1", metric: "eps", forecastValue: 5.0, forecastDate: "2026-01-01", targetDate: "2026-12-31", actualValue: 5.0, actualDate: "2026-12-31", engineId: "dcf", receiptId: "r1", owner: { userId: 1, name: "A" } },
  ]);
  assert.equal(result.accuracyScore, 100);
  assert.equal(result.forecasts[0].direction, "exact");
});

