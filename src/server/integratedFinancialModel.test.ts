import assert from "node:assert/strict";
import test from "node:test";
import { runIntegratedFinancialModel } from "@shared/integratedFinancialModel";
import type { FinancialDatasetPayload } from "@shared/pointInTimeData";

function payload(): FinancialDatasetPayload {
  const base = { period: "FY", filingDate: "2024-02-15", availableAt: "2024-02-15T00:00:00.000Z", currency: "USD", sources: [] };
  return {
    symbol: "TEST",
    periods: [
      { ...base, fiscalYear: "2022", periodEnd: "2022-12-31", income: { revenue: 900, costOfRevenue: 550 }, balance: {}, cashflow: {} },
      {
        ...base, fiscalYear: "2023", periodEnd: "2023-12-31",
        income: { revenue: 1000, costOfRevenue: 600, sellingGeneralAndAdministrativeExpenses: 200, interestExpense: 10, incomeBeforeTax: 140, incomeTaxExpense: 28, netIncome: 112, weightedAverageShsOutDil: 100, epsDiluted: 1.12 },
        balance: { cashAndCashEquivalents: 100, netReceivables: 100, inventory: 100, propertyPlantEquipmentNet: 500, accountPayables: 100, shortTermDebt: 50, longTermDebt: 150, totalAssets: 800, totalLiabilities: 300, totalStockholdersEquity: 500 },
        cashflow: { depreciationAndAmortization: 50, investmentsInPropertyPlantAndEquipment: -60 },
      },
    ],
  };
}

test("integrated model links statements and passes accounting checks deterministically", () => {
  const first = runIntegratedFinancialModel({ datasetSnapshotId: "fixture", payload: payload() });
  const second = runIntegratedFinancialModel({ datasetSnapshotId: "fixture", payload: payload() });
  assert.deepEqual(first, second);
  assert.equal(first.forecast.length, 5);
  assert.equal(first.checks.passed, true);
  assert.equal(first.checks.maxBalanceDifference, 0);
  assert.equal(first.checks.maxCashDifference, 0);
  for (const period of first.forecast) {
    assert.ok(Math.abs(period.balance.totalAssets - period.balance.totalLiabilitiesAndEquity) < 1e-7);
    assert.equal(period.checks.passed, true);
  }
});

test("integrated model draws debt to preserve minimum liquidity in a downside case", () => {
  const result = runIntegratedFinancialModel({
    datasetSnapshotId: "fixture", payload: payload(),
    assumptions: { projectionYears: 2, revenueGrowth: -0.5, cogsPercentRevenue: 1.2, sgaPercentRevenue: 0.5, minimumCashPercentRevenue: 0.1 },
  });
  assert.ok(result.forecast[0].cashflow.debtDraw > 0);
  assert.ok(result.forecast[0].balance.cash >= result.forecast[0].income.revenue * 0.1 - 1e-7);
  assert.equal(result.checks.passed, true);
});

test("integrated model sweeps surplus cash against debt and exposes source reconciliation", () => {
  const data = payload();
  data.periods[1].balance.totalAssets = 850;
  const result = runIntegratedFinancialModel({ datasetSnapshotId: "fixture", payload: data, assumptions: { revenueGrowth: 0.2 } });
  assert.ok(result.forecast[0].cashflow.debtRepayment > 0);
  assert.ok(result.forecast[0].balance.totalDebt < result.forecast[0].schedules.openingDebt);
  assert.ok(result.openingReconciliation.amount > 0);
  assert.ok(result.checks.warnings.some((warning) => warning.includes("reconciliation")));
});

test("integrated model accepts immaterial floating-point residue on large statements", () => {
  const data = payload();
  for (const period of data.periods) {
    for (const statement of [period.income, period.balance, period.cashflow]) {
      for (const key of Object.keys(statement)) statement[key] *= 1_000_000_000;
    }
  }
  const result = runIntegratedFinancialModel({ datasetSnapshotId: "fixture", payload: data });
  assert.equal(result.checks.passed, true);
  assert.ok(result.checks.balanceTolerance >= 0.01);
  assert.ok(result.checks.maxBalanceDifference <= result.checks.balanceTolerance);
});

test("price and volume drivers compound and circular interest converges on average debt", () => {
  const result = runIntegratedFinancialModel({ datasetSnapshotId: "fixture", payload: payload(), assumptions: {
    projectionYears: 1, usePriceVolumeDrivers: true, priceGrowth: 0.1, volumeGrowth: 0.2, interestRate: 0.1,
  } });
  assert.ok(Math.abs(result.forecast[0].income.revenue - 1320) < 1e-9);
  assert.equal(result.forecast[0].checks.circularConverged, true);
  assert.ok(result.forecast[0].income.debtInterestExpense < 20);
  assert.ok(result.forecast[0].income.debtInterestExpense > 0);
});

test("NOL schedule limits utilization and reduces cash tax without creating a tax benefit", () => {
  const withNol = runIntegratedFinancialModel({ datasetSnapshotId: "fixture", payload: payload(), assumptions: {
    projectionYears: 1, openingNol: 100, nolUtilizationLimit: 0.5,
  } });
  const withoutNol = runIntegratedFinancialModel({ datasetSnapshotId: "fixture", payload: payload(), assumptions: { projectionYears: 1, openingNol: 0 } });
  const period = withNol.forecast[0];
  assert.ok(period.schedules.nolUsed > 0);
  assert.ok(period.schedules.nolUsed <= period.income.incomeBeforeTax * 0.5 + 1e-9);
  assert.ok(period.income.incomeTaxExpense < withoutNol.forecast[0].income.incomeTaxExpense);
  assert.ok(period.income.incomeTaxExpense >= 0);
});

test("lease, stock compensation, and buyback schedules remain linked to cash, equity, and shares", () => {
  const result = runIntegratedFinancialModel({ datasetSnapshotId: "fixture", payload: payload(), assumptions: {
    projectionYears: 1, leaseAdditionsPercentRevenue: 0.05, leaseAssetAmortizationRate: 0.2,
    leasePrincipalRepaymentRate: 0.1, stockCompPercentRevenue: 0.02, stockCompDilutionPercent: 0.01,
    buybackPercentRevenue: 0.01, sharePrice: 20, sharePriceGrowth: 0,
  } });
  const period = result.forecast[0];
  assert.ok(period.schedules.leaseAdditions > 0);
  assert.ok(period.balance.leaseRightOfUseAsset > 0);
  assert.ok(period.balance.leaseLiability > 0);
  assert.ok(period.cashflow.stockCompensation > 0);
  assert.ok(period.schedules.stockCompDilutionShares > 0);
  assert.ok(period.schedules.repurchasedShares > 0);
  assert.equal(period.checks.passed, true);
});

test("segment drivers replace the consolidated growth shortcut with auditable segment economics", () => {
  const result = runIntegratedFinancialModel({ datasetSnapshotId: "fixture", payload: payload(), assumptions: { projectionYears: 2 }, schedules: { segments: [
    { name: "Core", openingRevenue: 700, revenueGrowth: 0.1, cogsPercentRevenue: 0.5, sgaPercentRevenue: 0.1 },
    { name: "Growth", openingRevenue: 300, revenueGrowth: 0.2, cogsPercentRevenue: 0.4, sgaPercentRevenue: 0.2 },
  ] } });
  assert.ok(Math.abs(result.forecast[0].income.revenue - 1130) < 1e-9);
  assert.ok(Math.abs(result.forecast[1].income.revenue - 1279) < 1e-9);
  assert.equal(result.checks.passed, true);
});

test("pension, associate, and minority schedules roll forward independently", () => {
  const result = runIntegratedFinancialModel({ datasetSnapshotId: "fixture", payload: payload(), assumptions: { projectionYears: 1, taxRate: 0 }, schedules: {
    pension: { openingObligation: 100, openingPlanAssets: 80, serviceCost: 5, discountRate: 0.05, expectedReturn: 0.1, cashContribution: 7, benefitsPaid: 3 },
    associates: [{ name: "JV", openingCarryingValue: 40, ownershipPercent: 0.25, annualInvesteeIncome: 20, annualDividends: 8 }],
    minority: { openingNonControllingInterest: 25, shareOfConsolidatedIncome: 0.1 },
  } });
  const period = result.forecast[0];
  assert.equal(period.schedules.closingPensionObligation, 107); assert.equal(period.schedules.closingPensionPlanAssets, 92);
  assert.equal(period.schedules.associateIncome, 5); assert.equal(period.schedules.associateDividends, 2); assert.equal(period.schedules.closingAssociateValue, 43);
  assert.equal(period.schedules.closingNci, 25 + period.income.nciIncome); assert.equal(period.income.netIncomeAttributableToParent, period.income.netIncome - period.income.nciIncome);
  assert.equal(period.checks.passed, true);
});

test("transaction schedule links consideration, financing, goodwill, intangibles, and amortization", () => {
  const result = runIntegratedFinancialModel({ datasetSnapshotId: "fixture", payload: payload(), assumptions: { projectionYears: 2 }, schedules: { transaction: {
    closeProjectionYear: 1, purchasePrice: 200, acquiredCash: 20, identifiableNetAssets: 120, intangibleAssets: 30, intangibleLifeYears: 10,
    acquiredRevenue: 100, acquiredRevenueGrowth: 0.1, acquiredEbitMargin: 0.2, cashConsiderationPercent: 0.5, debtConsiderationPercent: 0.5,
  } } });
  const first = result.forecast[0];
  assert.equal(first.schedules.transactionCashConsideration, 100); assert.equal(first.schedules.transactionDebtConsideration, 100);
  assert.equal(first.schedules.goodwill, 50); assert.equal(first.income.intangibleAmortization, 3); assert.equal(result.forecast[1].income.intangibleAmortization, 3);
  assert.equal(result.checks.passed, true); assert.equal(result.modelVersion, "3.0.0");
});
