import test from "node:test";
import assert from "node:assert/strict";
import type { FinancialMetricObservation } from "@shared/financialMetricRegistry";
import { buildFinancialDataCube, compareFinancialScenarios, sortFinancialPeriods } from "@shared/financialDataCube";
import { auditFinancialDataQuality } from "@shared/financialDataQuality";
import { normalizeFinancialMetric, type FinancialNormalizationPolicy } from "@shared/financialNormalization";
import { assessValuationMethodReadiness, VALUATION_METHODS } from "@shared/valuationModelReadiness";
import { findKnowledgeForMetric } from "@shared/financeKnowledgeCanon";
import { evaluateFinancialScreen } from "@shared/financialScreener";

const o = (metricId: string, value: number, period = "CURRENT", status: FinancialMetricObservation["status"] = "filed", scenarioId?: string): FinancialMetricObservation => ({ metricId, value, period, status, scenarioId, source: "test" });

test("V6 sorts spot, forward and historical financial periods deterministically", () => {
  const periods = sortFinancialPeriods(["2023", "FY1", "TTM", "2025", "CURRENT", "NTM"]);
  assert.equal(periods[0], "CURRENT");
  assert.ok(periods.indexOf("TTM") < periods.indexOf("2025"));
});

test("V6 financial cube preserves scenario dimension", () => {
  const cube = buildFinancialDataCube({
    symbol: "AAPL",
    observations: [
      o("price", 100, "CURRENT", "live"),
      o("epsDiluted", 5, "CURRENT"),
      o("epsDiluted", 8, "CURRENT", "manual", "BULL"),
    ],
    metricIds: ["pe"], periods: ["CURRENT"], scenarioIds: ["BASE", "BULL"],
  });
  const rows = compareFinancialScenarios(cube, "pe", "CURRENT");
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.scenarioId === "BASE")?.value, 20);
  assert.equal(rows.find(row => row.scenarioId === "BULL")?.value, 12.5);
});

test("V6 data quality catches a broken balance sheet identity", () => {
  const report = auditFinancialDataQuality([o("totalAssets", 100), o("totalLiabilities", 80), o("totalEquity", 10)]);
  assert.ok(report.issues.some(issue => issue.id === "balance-sheet"));
  assert.ok(report.score < 100);
});

test("V6 normalization preserves reported value and explicit adjustment lineage", () => {
  const policy: FinancialNormalizationPolicy = {
    id: "analyst", label: "Analyst Normalized",
    adjustments: [{ id: "r1", label: "Restructuring", metricId: "ebit", kind: "add-back", amount: 10, period: "2025", rationale: "one-off", createdAt: "2026-01-01" }],
  };
  const result = normalizeFinancialMetric("ebit", "2025", [o("ebit", 90, "2025")], policy);
  assert.equal(result.reportedValue, 90);
  assert.equal(result.normalizedValue, 100);
  assert.equal(result.adjustments.length, 1);
});

test("V6 valuation readiness identifies missing model inputs", () => {
  const dcf = VALUATION_METHODS.find(method => method.id === "dcf-fcff")!;
  const readiness = assessValuationMethodReadiness(dcf, [o("revenue", 1000), o("ebit", 100)]);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.coverage > 0 && readiness.coverage < 1);
  assert.ok(readiness.missing.some(item => item.metricId === "wacc"));
});

test("V6 finance knowledge canon exposes methodology for EV/EBITDA inputs", () => {
  const concepts = findKnowledgeForMetric("enterpriseValue");
  assert.ok(concepts.some(concept => concept.id === "enterprise-value"));
});

test("V6 universal screener can filter derived metrics", () => {
  const match = evaluateFinancialScreen({
    symbol: "TEST",
    observations: [o("marketCap", 1000), o("fcf", 80), o("shortTermDebt", 0), o("longTermDebt", 100), o("cash", 50), o("ebitda", 200)],
  }, [
    { metricId: "fcfYield", operator: "gte", value: 0.05 },
    { metricId: "netDebtEbitda", operator: "lte", value: 1 },
  ]);
  assert.equal(match.pass, true);
});
