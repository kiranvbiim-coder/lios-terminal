import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDebtSchedule,
  buildDilutedShareSchedule,
  buildNolCashTaxSchedule,
  buildPpeSchedule,
  buildWorkingCapitalSchedule,
  capitalizeResearchAndDevelopment,
  computeWorkingCapitalFromDrivers,
} from "./valuationAdjustments";

test("R&D capitalization preserves only unamortized vintages and adjusts operating income", () => {
  const result = capitalizeResearchAndDevelopment({
    reportedOperatingIncome: 120,
    reportedInvestedCapital: 600,
    amortizationLifeYears: 4,
    vintages: [
      { ageYears: 0, expense: 40 },
      { ageYears: 1, expense: 32 },
      { ageYears: 2, expense: 24 },
      { ageYears: 3, expense: 16 },
      { ageYears: 4, expense: 999 },
    ],
  });
  // Asset = 40 + 32*3/4 + 24*2/4 + 16*1/4 = 80.
  assert.equal(result.researchAsset, 80);
  // Current amortization excludes the current-year vintage under the stated
  // end-of-year convention: 32/4 + 24/4 + 16/4 = 18.
  assert.equal(result.currentAmortization, 18);
  assert.equal(result.adjustedOperatingIncome, 142);
  assert.equal(result.adjustedInvestedCapital, 680);
});

test("NOL schedule creates losses, respects utilization limit and applies tax credits after NOL", () => {
  const schedule = buildNolCashTaxSchedule({
    openingNol: 20,
    openingTaxCredits: 2,
    nolUtilizationLimitPct: 80,
    years: [
      { preTaxOperatingIncome: -10, statutoryTaxRatePct: 25 },
      { preTaxOperatingIncome: 50, statutoryTaxRatePct: 25 },
      { preTaxOperatingIncome: 100, statutoryTaxRatePct: 25 },
    ],
  });
  assert.equal(schedule[0].closingNol, 30);
  assert.equal(schedule[1].nolUtilized, 30);
  assert.equal(schedule[1].taxableIncomeAfterNol, 20);
  assert.equal(schedule[1].grossCashTax, 5);
  assert.equal(schedule[1].taxCreditsUsed, 2);
  assert.equal(schedule[1].cashTax, 3);
  assert.equal(schedule[2].openingNol, 0);
  assert.equal(schedule[2].cashTax, 25);
});

test("working-capital drivers reconcile DSO/DIO/DPO to operating NWC and schedule changes", () => {
  const point = computeWorkingCapitalFromDrivers({
    revenue: 365,
    costOfRevenue: 182.5,
    dsoDays: 30,
    dioDays: 40,
    dpoDays: 50,
    deferredRevenueDays: 10,
    otherOperatingAssetsPctRevenue: 2,
    otherOperatingLiabilitiesPctRevenue: 1,
  });
  assert.equal(point.receivables, 30);
  assert.equal(point.inventory, 20);
  assert.equal(point.payables, 25);
  assert.equal(point.deferredRevenue, 10);
  assert.equal(point.otherOperatingAssets, 7.3);
  assert.equal(point.otherOperatingLiabilities, 3.65);
  assert.ok(Math.abs(point.operatingNetWorkingCapital - 18.65) < 1e-10);
  const schedule = buildWorkingCapitalSchedule({
    openingNetWorkingCapital: 15,
    years: [{ revenue: 365, costOfRevenue: 182.5, dsoDays: 30, dioDays: 40, dpoDays: 50, deferredRevenueDays: 10, otherOperatingAssetsPctRevenue: 2, otherOperatingLiabilitiesPctRevenue: 1 }],
  });
  assert.ok(Math.abs(schedule[0].changeInNetWorkingCapital - 3.65) < 1e-10);
});

test("PP&E schedule separates maintenance/growth capex and rolls net assets", () => {
  const schedule = buildPpeSchedule(100, [
    { maintenanceCapex: 10, growthCapex: 15, depreciation: 12, assetDisposals: 3 },
    { maintenanceCapex: 11, growthCapex: 10, depreciation: 13 },
  ]);
  assert.equal(schedule[0].totalCapex, 25);
  assert.equal(schedule[0].closingNetPpe, 110);
  assert.equal(schedule[0].netInvestment, 10);
  assert.equal(schedule[1].openingNetPpe, 110);
  assert.equal(schedule[1].closingNetPpe, 118);
});

test("debt schedule caps repayments at available debt and computes interest on average debt", () => {
  const schedule = buildDebtSchedule(100, [
    { issuance: 20, contractualMaturities: 30, discretionaryRepayment: 10, annualInterestRatePct: 6 },
    { issuance: 0, contractualMaturities: 200, annualInterestRatePct: 5 },
  ]);
  assert.equal(schedule[0].repayment, 40);
  assert.equal(schedule[0].closingDebt, 80);
  assert.equal(schedule[0].averageDebt, 90);
  assert.ok(Math.abs(schedule[0].interestExpense - 5.4) < 1e-12);
  assert.equal(schedule[0].netBorrowing, -20);
  assert.equal(schedule[1].repayment, 80);
  assert.equal(schedule[1].closingDebt, 0);
});

test("diluted share schedule uses treasury-stock method and keeps buybacks explicit", () => {
  const schedule = buildDilutedShareSchedule(100, [{
    rsusGranted: 2,
    rsusVested: 2,
    optionsOutstanding: 10,
    optionStrikePrice: 50,
    warrantsOutstanding: 5,
    warrantStrikePrice: 120,
    sharePrice: 100,
    sharesRepurchased: 1,
    sharesIssuedForAcquisitions: 0,
  }]);
  assert.equal(schedule[0].endingBasicShares, 101);
  assert.equal(schedule[0].treasuryMethodOptionDilution, 5);
  assert.equal(schedule[0].treasuryMethodWarrantDilution, 0);
  assert.equal(schedule[0].endingDilutedShares, 106);
});
