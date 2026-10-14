import assert from "node:assert/strict";
import test from "node:test";
import { runIntegratedFinancialModel } from "@shared/integratedFinancialModel";
import type { FinancialDatasetPayload } from "@shared/pointInTimeData";
import { buildForecastActualVariance } from "./financialModelRunStore";

const base = { period: "FY", filingDate: "2024-02-15", availableAt: "2024-02-15T00:00:00.000Z", currency: "USD", sources: [] };
const historical: FinancialDatasetPayload = { symbol: "TEST", periods: [{ ...base, fiscalYear: "2023", periodEnd: "2023-12-31", income: { revenue: 1000, costOfRevenue: 600, sellingGeneralAndAdministrativeExpenses: 200, incomeBeforeTax: 140, incomeTaxExpense: 28, netIncome: 112, weightedAverageShsOutDil: 100 }, balance: { cashAndCashEquivalents: 100, netReceivables: 100, inventory: 100, propertyPlantEquipmentNet: 500, accountPayables: 100, shortTermDebt: 50, longTermDebt: 150, totalAssets: 800, totalLiabilities: 300, totalStockholdersEquity: 500 }, cashflow: { depreciationAndAmortization: 50, investmentsInPropertyPlantAndEquipment: -60 } }] };

test("forecast-versus-actual bridge remains pending until a matching fiscal year arrives", () => {
  const model = runIntegratedFinancialModel({ datasetSnapshotId: "fixture", payload: historical, assumptions: { projectionYears: 1 } });
  assert.equal(buildForecastActualVariance(model, historical).status, "pending_actuals");
  const actuals = structuredClone(historical);
  actuals.periods.push({ ...base, fiscalYear: "2024", periodEnd: "2024-12-31", income: { revenue: 1100, netIncome: 120, epsDiluted: 1.1 }, balance: {}, cashflow: {} });
  const measured = buildForecastActualVariance(model, actuals);
  assert.equal(measured.status, "measured");
  assert.equal(measured.rows.length, 3);
  assert.equal(measured.rows.find((row) => row.metric === "revenue")?.actual, 1100);
});
