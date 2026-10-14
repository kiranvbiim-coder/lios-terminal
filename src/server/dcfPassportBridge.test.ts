import test from "node:test";
import assert from "node:assert/strict";
import { buildDcfPassportBundle } from "./dcfPassportBridge";
import type { FinancialDatasetPayload } from "@shared/pointInTimeData";
import type { IntegratedFinancialModelResult } from "@shared/integratedFinancialModel";

const MOCK_PAYLOAD: FinancialDatasetPayload = {
  symbol: "AAPL",
  periods: [{
    fiscalYear: "2024", period: "annual", periodEnd: "2024-09-28",
    filingDate: "2024-11-01", currency: "USD", availableAt: "2024-11-01T00:00:00.000Z",
    income: { revenue: 391_035_000_000, costOfRevenue: 214_137_000_000, grossProfit: 176_898_000_000, operatingIncome: 123_216_000_000, netIncome: 93_736_000_000, depreciationAndAmortization: 11_445_000_000, interestExpense: 3_933_000_000, incomeTaxExpense: 29_749_000_000 },
    balance: { totalAssets: 364_980_000_000, totalLiabilities: 308_030_000_000, totalStockholdersEquity: 56_950_000_000, cashAndCashEquivalents: 29_943_000_000, totalDebt: 104_590_000_000, netReceivables: 66_243_000_000, inventory: 7_286_000_000, accountPayables: 68_960_000_000 },
    cashflow: { investmentsInPropertyPlantAndEquipment: -9_959_000_000, operatingCashFlow: 118_254_000_000, freeCashFlow: 108_295_000_000 },
    segments: {}, geographies: {},
    sources: [{ statementType: "income", provider: "SEC EDGAR" }],
  }],
};

// Use a simplified mock that matches IntegratedFinancialModelResult structure.
// The real type uses nested Record<string, number> for income/balance/cashflow
// inside IntegratedForecastPeriod; we only need enough shape to exercise the bridge.
const MOCK_RESULT = {
  symbol: "AAPL",
  datasetSnapshotId: "snapshot-uuid-123",
  modelVersion: "integrated-v3.0.0",
  forecast: [
    {
      fiscalYear: "FY2025",
      income: { revenue: 410_586_750_000, costOfRevenue: 224_870_595_000, ebit: 161_080_950_000, netIncome: 112_966_462_500 },
      balance: { totalAssets: 383_229_000_000, totalLiabilities: 323_431_500_000, totalEquity: 59_797_500_000 },
      cashflow: { operatingCashFlow: 124_411_462_500, fcff: 114_147_295_000 },
      schedules: {},
      checks: { balanceSheet: 0, cashRollForward: 0, debtNonNegative: true, sharesPositive: true, circularConverged: true, passed: true },
    },
  ],
  historicalPeriod: MOCK_PAYLOAD.periods[0],
  openingReconciliation: { amount: 0, classification: "none" as const },
  assumptions: {
    projectionYears: 5, revenueGrowth: 0.05, usePriceVolumeDrivers: false, priceGrowth: 0, volumeGrowth: 0,
    cogsPercentRevenue: 0.5476, sgaPercentRevenue: 0.06,
    taxRate: 0.25, openingNol: 0, nolUtilizationLimit: 1,
    capexPercentRevenue: 0.025, depreciationPercentRevenue: 0.028, interestRate: 0.04,
    dso: 60, dio: 7, dpo: 64, minimumCashPercentRevenue: 0.05, dividendPayout: 0,
    leaseAdditionsPercentRevenue: 0, leaseAssetAmortizationRate: 0, leaseInterestRate: 0, leasePrincipalRepaymentRate: 0,
    stockCompPercentRevenue: 0, stockCompDilutionPercent: 0, buybackPercentRevenue: 0,
    sharePrice: 200, sharePriceGrowth: 0,
    circularMaxIterations: 100, circularTolerance: 0.001,
  },
  specializedSchedules: { segments: [], pension: null, associates: [], minority: null, transaction: null },
  checks: { passed: true, maxBalanceDifference: 0, maxCashDifference: 0, balanceTolerance: 0.01, cashTolerance: 0.01, circularConverged: true, maxCircularDifference: 0, warnings: [] },
};

test("buildDcfPassportBundle produces a complete passport bundle", () => {
  const bundle = buildDcfPassportBundle(
    "AAPL",
    MOCK_PAYLOAD,
    MOCK_RESULT,
    "snapshot-uuid-123",
    "content-hash-abc",
    "input-hash-def",
    "SEC EDGAR",
  );

  // Financial passport
  assert.ok(bundle.financialPassport.id.startsWith("ppt_"));
  assert.equal(bundle.financialPassport.contractFamily, "financial_statements");
  assert.equal(bundle.financialPassport.entityKey, "AAPL");
  assert.ok(bundle.financialPassport.entries.length >= 10, `Expected >= 10 financial entries, got ${bundle.financialPassport.entries.length}`);
  assert.equal(bundle.financialPassport.quality.completeness, 1); // all required fields present

  // Check revenue entry
  const revenueEntry = bundle.financialPassport.entries.find((e) => e.field === "revenue");
  assert.ok(revenueEntry);
  assert.equal(revenueEntry.value, 391_035_000_000);
  assert.equal(revenueEntry.source.provider, "SEC EDGAR");
  assert.equal(revenueEntry.source.priority, "primary");

  // Assumption passport
  assert.ok(bundle.assumptionPassport.id.startsWith("ppt_"));
  assert.equal(bundle.assumptionPassport.contractFamily, "assumptions");
  assert.ok(bundle.assumptionPassport.entries.length > 0);

  // Calculated passport
  assert.ok(bundle.calculatedPassport.id.startsWith("ppt_"));
  assert.equal(bundle.calculatedPassport.engineId, "valuation.dcf");
  assert.equal(bundle.calculatedPassport.engineVersion, "integrated-v3.0.0");
  assert.equal(bundle.calculatedPassport.inputs.length, 2);
  assert.equal(bundle.calculatedPassport.inputs[0].passportId, bundle.financialPassport.id);
  assert.equal(bundle.calculatedPassport.inputs[1].passportId, bundle.assumptionPassport.id);
  assert.ok(bundle.calculatedPassport.outputHash.length === 64);
  assert.ok(bundle.calculatedPassport.limitations.length > 0);

  // Decision receipt payload
  assert.equal(bundle.decisionReceiptPayload.symbol, "AAPL");
  assert.equal(bundle.decisionReceiptPayload.engineId, "valuation.dcf");
  assert.equal(bundle.decisionReceiptPayload.deterministic, true);
  assert.equal(bundle.decisionReceiptPayload.datasetSnapshotId, "snapshot-uuid-123");
  assert.equal(bundle.decisionReceiptPayload.financialPassportId, bundle.financialPassport.id);
  assert.equal(bundle.decisionReceiptPayload.assumptionPassportId, bundle.assumptionPassport.id);
  assert.equal(bundle.decisionReceiptPayload.calculatedPassportId, bundle.calculatedPassport.id);
  assert.equal(bundle.decisionReceiptPayload.projectionYears, 1);
  assert.ok(bundle.decisionReceiptPayload.terminalRevenue != null);
});

test("DCF passport bundle is deterministic for same inputs", () => {
  const a = buildDcfPassportBundle("AAPL", MOCK_PAYLOAD, MOCK_RESULT, "snap1", "ch1", "ih1", "SEC");
  const b = buildDcfPassportBundle("AAPL", MOCK_PAYLOAD, MOCK_RESULT, "snap1", "ch1", "ih1", "SEC");
  // Passports have unique IDs, but snapshot hashes should be identical
  assert.equal(a.financialPassport.snapshotHash, b.financialPassport.snapshotHash);
  assert.equal(a.calculatedPassport.outputHash, b.calculatedPassport.outputHash);
  assert.equal(a.decisionReceiptPayload.outputHash, b.decisionReceiptPayload.outputHash);
});

test("DCF passport financial quality degrades with missing data", () => {
  const sparse: FinancialDatasetPayload = {
    symbol: "SPARSE",
    periods: [{
      fiscalYear: "2024", period: "annual", periodEnd: "2024-12-31",
      filingDate: null, currency: "USD", availableAt: "2024-12-31T00:00:00.000Z",
      income: { revenue: 100_000 },
      balance: {},
      cashflow: {},
      segments: {}, geographies: {},
      sources: [{ statementType: "income", provider: "manual" }],
    }],
  };
  const bundle = buildDcfPassportBundle("SPARSE", sparse, MOCK_RESULT, "s1", "c1", "i1", "manual");
  // Should have low completeness since many required fields are missing
  assert.ok(bundle.financialPassport.quality.completeness < 1);
  assert.ok(bundle.financialPassport.quality.warnings.length > 0);
});
