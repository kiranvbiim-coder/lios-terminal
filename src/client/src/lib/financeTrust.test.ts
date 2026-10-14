import assert from "node:assert/strict";
import test from "node:test";
import { buildFinancialTrustReport, assessFinancialObservationTrust, reconcileFinancialObservations } from "@shared/financialTrust";
import type { FinancialMetricObservation } from "@shared/financialMetricRegistry";

const observation = (input: Partial<FinancialMetricObservation> & Pick<FinancialMetricObservation, "metricId" | "value" | "status">): FinancialMetricObservation => ({
  period: "FY2025",
  source: "SEC EDGAR",
  asOf: "2026-02-01T00:00:00.000Z",
  currency: "USD",
  ...input,
});

test("financial trust requires source period and as-of metadata for filed values", () => {
  const result = assessFinancialObservationTrust({ metricId: "revenue", value: 100, status: "filed" });
  assert.deepEqual(result.issues.map(issue => issue.kind), ["missing-source", "missing-period", "missing-as-of"]);
  assert.equal(result.complete, false);
});

test("financial reconciliation surfaces material provider disagreement", () => {
  const result = reconcileFinancialObservations([
    observation({ metricId: "revenue", value: 100, source: "SEC EDGAR" }),
    observation({ metricId: "revenue", value: 112, source: "Provider B" }),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].conflict, true);
  assert.ok((result[0].relativeDelta ?? 0) > 0.1);
});

test("financial trust report separates coverage, provenance and conflicts", () => {
  const report = buildFinancialTrustReport([
    observation({ metricId: "revenue", value: 100 }),
    observation({ metricId: "ebitda", value: 20 }),
    observation({ metricId: "ebitda", value: 25, source: "Provider B" }),
    { metricId: "epsNtm", value: null, status: "missing", period: "NTM" },
  ]);
  assert.equal(report.conflictCount, 1);
  assert.equal(report.missingCount > 0, true);
  assert.equal(report.provenanceIssues.length, 0);
  assert.equal(report.resolvableCount < report.totalMetricCount, true);
});

test("financial trust report exposes weighted workflow coverage", () => {
  const report = buildFinancialTrustReport([
    observation({ metricId: "revenue", value: 100 }),
    observation({ metricId: "marketCap", value: 500, period: "CURRENT" }),
  ]);
  assert.equal(report.coverageBands.length, 6);
  assert.equal(report.coverageBands.reduce((sum, band) => sum + band.weight, 0), 100);
  assert.ok(report.weightedCoveragePct >= 0 && report.weightedCoveragePct <= 100);
});
