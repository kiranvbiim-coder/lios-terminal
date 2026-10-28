import test from "node:test";
import assert from "node:assert/strict";
import type { IntegratedFinancialModelResult } from "@shared/integratedFinancialModel";
import { valueIntegratedForecast, type ScenarioPipelineRequest } from "./scenarioPipeline";

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

