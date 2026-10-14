import test from "node:test";
import assert from "node:assert/strict";
import type { IntegratedFinancialModelResult } from "@shared/integratedFinancialModel";
import { runScenarioPipeline, valueIntegratedForecast, type ScenarioPipelineRequest } from "./scenarioPipeline";

function model(fcff: [number, number], id: string): IntegratedFinancialModelResult {
  const period = (value: number, year: string) => ({ fiscalYear: year, income: { ebit: value }, cashflow: { depreciationAndAmortization: 0, leaseAssetAmortization: 0, intangibleAmortization: 0, stockCompensation: 0, capitalExpenditure: 0, changeInNetWorkingCapital: 0 }, balance: {}, schedules: {}, checks: { balanceSheet: 0, cashRollForward: 0, debtNonNegative: true, sharesPositive: true, circularConverged: true, passed: true } });
  return { symbol: "TEST", datasetSnapshotId: id, modelVersion: "3.0.0", assumptions: { taxRate: 0.2 } as IntegratedFinancialModelResult["assumptions"], specializedSchedules: {} as IntegratedFinancialModelResult["specializedSchedules"], historicalPeriod: {} as IntegratedFinancialModelResult["historicalPeriod"], forecast: [period(fcff[0] / 0.8, "2025"), period(fcff[1] / 0.8, "2026")], openingReconciliation: { amount: 0, classification: "none" }, checks: { passed: true, maxBalanceDifference: 0, maxCashDifference: 0, balanceTolerance: 1, cashTolerance: 1, circularConverged: true, maxCircularDifference: 0, warnings: [] } };
}

const request: ScenarioPipelineRequest = {
  scenarioId: "rate-shock", scenarioName: "Rate shock", financialDatasetSnapshotId: "00000000-0000-4000-8000-000000000001", scenarioAssumptions: { revenueGrowth: 0.1 },
  valuation: { discountRate: 0.1, terminalGrowth: 0.02, netDebt: 10, sharesOutstanding: 10 }, factorRiskSnapshotId: "factor-risk-fixture", portfolioWeights: { AAA: 0.6, BBB: 0.4 }, factorShocks: { value: -0.1 },
};

test("valueIntegratedForecast matches a hand-computed two-period FCFF valuation", () => {
  const result = valueIntegratedForecast(model([80, 100], "fixture"), request.valuation);
  const pvForecast = 80 / 1.1 + 100 / 1.1 ** 2;
  const terminal = 100 * 1.02 / 0.08;
  const pvTerminal = terminal / 1.1 ** 2;
  assert.ok(Math.abs(result.presentValueOfForecast - pvForecast) < 1e-12);
  assert.ok(Math.abs(result.terminalValue - terminal) < 1e-12);
  assert.ok(Math.abs(result.presentValueOfTerminalValue - pvTerminal) < 1e-12);
  assert.ok(Math.abs(result.intrinsicValuePerShare - (pvForecast + pvTerminal - 10) / 10) < 1e-12);
});

test("scenario pipeline uses immutable dataset payload and provider scenario P&L", async () => {
  const calls: Array<{ assumptions?: unknown; payload: unknown }> = [];
  const payload = { symbol: "TEST", periods: [] } as never;
  const snapshot = { id: request.financialDatasetSnapshotId, dataClass: "financial_statements", contentHash: "a".repeat(64), provider: "fixture", payload } as never;
  const factorSnapshot = { snapshotId: request.factorRiskSnapshotId, contentHash: "b".repeat(64), request: { asOf: "2026-01-01" }, capturedAt: "2026-01-01T00:00:00.000Z", securities: [{ securityId: "AAA" }, { securityId: "BBB" }] } as never;
  const actionResult = { candidates: [], recommendedAction: null, approvalRequired: true, source: {}, inputCoverage: { assets: 2, assetsWithImpact: 2, assetsWithExposure: 2, complete: true } } as never;
  const result = await runScenarioPipeline(request, {
    getDatasetSnapshot: async () => snapshot,
    runIntegratedFinancialModel: (input) => { calls.push({ assumptions: input.assumptions, payload: input.payload }); return model(input.assumptions ? [90, 110] : [80, 100], input.datasetSnapshotId); },
    getFactorRiskSnapshot: async () => factorSnapshot,
    decomposeFactorRiskSnapshot: async () => ({ snapshotId: factorSnapshot.snapshotId, contentHash: factorSnapshot.contentHash, provenance: {}, factorReturnSelection: "arithmetic-average-of-estimated-period-returns", result: { scenario: { factorShocks: { value: -0.1 }, securities: [{ securityId: "AAA", factorPnl: -0.1, specificPnl: 0, totalPnl: -0.1 }, { securityId: "BBB", factorPnl: -0.2, specificPnl: 0, totalPnl: -0.2 }], portfolioPnl: -0.14, provenance: {} } } } as never),
    calculateScenarioActionCandidates: () => actionResult,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].payload, calls[1].payload);
  assert.deepEqual(result.trace.factorRisk.derivedAssetImpacts.map((item) => item.scenarioImpact), [-0.1, -0.2]);
  assert.equal(result.receiptCalculation.name, "Scenario-to-action pipeline");
  assert.match(result.receiptCalculation.deterministicRef, /^scenario-pipeline:[a-f0-9]{64}$/);
  assert.equal(result.trace.traceHash.length, 64);
});
