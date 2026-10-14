import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFinancialMetric, normalizedObservation, type FinancialNormalizationPolicy } from "./financialNormalization";
import type { FinancialMetricObservation } from "./financialMetricRegistry";

const filedOperatingIncome: FinancialMetricObservation = {
  metricId: "operatingIncome", value: 1_000_000, status: "filed", period: "FY2025",
  asOf: "2025-12-31", publishedAt: "2026-02-15", source: "sec_edgar", currency: "USD",
};

test("normalizeFinancialMetric adds back and subtracts against the filed value in order", () => {
  const policy: FinancialNormalizationPolicy = {
    id: "policy-1", label: "Test Policy",
    adjustments: [
      { id: "adj-1", label: "Stock-Based Compensation", metricId: "operatingIncome", kind: "add-back", amount: 50_000_000, period: "FY2025", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "adj-2", label: "Gain on Asset Sale", metricId: "operatingIncome", kind: "subtract", amount: 5_000_000, period: "FY2025", createdAt: "2026-01-02T00:00:00.000Z" },
    ],
  };
  const result = normalizeFinancialMetric("operatingIncome", "FY2025", [filedOperatingIncome], policy);
  assert.equal(result.reportedValue, 1_000_000);
  // 1,000,000 + 50,000,000 (add-back) - 5,000,000 (subtract) = 46,000,000
  assert.equal(result.normalizedValue, 46_000_000);
  assert.equal(result.adjustments.length, 2);
  assert.equal(result.reportedSource, "sec_edgar");
});

test("normalizeFinancialMetric replace sets the normalized value directly, ignoring the reported figure", () => {
  const policy: FinancialNormalizationPolicy = {
    id: "policy-2", label: "Tax Normalization",
    adjustments: [{ id: "adj-3", label: "One-Time Tax Item", metricId: "operatingIncome", kind: "replace", amount: 900_000, period: "FY2025", createdAt: "2026-01-01T00:00:00.000Z" }],
  };
  const result = normalizeFinancialMetric("operatingIncome", "FY2025", [filedOperatingIncome], policy);
  assert.equal(result.reportedValue, 1_000_000);
  assert.equal(result.normalizedValue, 900_000);
});

test("normalizeFinancialMetric ignores adjustments for a different metric or period", () => {
  const policy: FinancialNormalizationPolicy = {
    id: "policy-3", label: "Unrelated Adjustments",
    adjustments: [
      { id: "adj-4", label: "Wrong Metric", metricId: "revenue", kind: "add-back", amount: 1, period: "FY2025", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "adj-5", label: "Wrong Period", metricId: "operatingIncome", kind: "add-back", amount: 1, period: "FY2024", createdAt: "2026-01-01T00:00:00.000Z" },
    ],
  };
  const result = normalizeFinancialMetric("operatingIncome", "FY2025", [filedOperatingIncome], policy);
  assert.equal(result.normalizedValue, 1_000_000);
  assert.equal(result.adjustments.length, 0);
});

test("normalizeFinancialMetric prefers a manual observation over filed/live for the reported value", () => {
  const manual: FinancialMetricObservation = { metricId: "operatingIncome", value: 1_100_000, status: "manual", period: "FY2025", source: "Analyst override" };
  const policy: FinancialNormalizationPolicy = { id: "policy-4", label: "Empty", adjustments: [] };
  const result = normalizeFinancialMetric("operatingIncome", "FY2025", [filedOperatingIncome, manual], policy);
  assert.equal(result.reportedValue, 1_100_000);
  assert.equal(result.reportedSource, "Analyst override");
});

test("normalizeFinancialMetric returns a null reported/normalized value when no observation exists for the period", () => {
  const policy: FinancialNormalizationPolicy = { id: "policy-5", label: "Empty", adjustments: [] };
  const result = normalizeFinancialMetric("operatingIncome", "FY2099", [filedOperatingIncome], policy);
  assert.equal(result.reportedValue, null);
  assert.equal(result.normalizedValue, null);
});

test("normalizedObservation returns null when the normalized value is not finite", () => {
  const policy: FinancialNormalizationPolicy = { id: "policy-6", label: "Empty", adjustments: [] };
  const result = normalizeFinancialMetric("operatingIncome", "FY2099", [filedOperatingIncome], policy);
  assert.equal(normalizedObservation(result, policy), null);
});

test("normalizedObservation carries the normalized figure forward as a manual, attributed observation", () => {
  const policy: FinancialNormalizationPolicy = {
    id: "policy-7", label: "SBC Add-Back Policy",
    adjustments: [{ id: "adj-6", label: "Stock-Based Compensation", metricId: "operatingIncome", kind: "add-back", amount: 50_000_000, period: "FY2025", createdAt: "2026-01-01T00:00:00.000Z" }],
  };
  const result = normalizeFinancialMetric("operatingIncome", "FY2025", [filedOperatingIncome], policy);
  const observation = normalizedObservation(result, policy);
  assert.ok(observation);
  assert.equal(observation!.value, 51_000_000);
  assert.equal(observation!.status, "manual");
  assert.equal(observation!.manualOverride, true);
  assert.match(observation!.source!, /SBC Add-Back Policy/);
  assert.match(observation!.note!, /1 explicit analyst adjustment/);
});
