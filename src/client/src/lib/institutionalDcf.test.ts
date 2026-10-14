import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DCF_SCENARIOS,
  applyDcfScenario,
  assessDcfModelSuitability,
  buildDiscountRatePath,
  reconcileInstitutionalDcf,
  runInstitutionalDcf,
  runProbabilisticDcf,
  validateInstitutionalDcfInput,
  type InstitutionalDcfInput,
} from "./institutionalDcf";

function baseInput(): InstitutionalDcfInput {
  return {
    baseRevenue: 1_000,
    basicShares: 100,
    dilutedShares: 100,
    spotPrice: 10,
    startingInvestedCapital: 600,
    startingNetDebt: 200,
    startingNopat: 96,
    cashFlowMode: "fcff",
    years: Array.from({ length: 5 }, () => ({
      revenueGrowthPct: 8,
      ebitdaMarginPct: 25,
      daPctRevenue: 5,
      taxRatePct: 20,
      capexPctRevenue: 8,
      nwcInvestmentPctRevenue: 2,
      otherInvestmentPctRevenue: 0,
      netBorrowing: 0,
      costOfDebtPct: 5,
    })),
    discount: {
      currentWaccPct: 9,
      terminalWaccPct: 8.5,
      currentCostOfEquityPct: 11,
      terminalCostOfEquityPct: 10,
      maturityFadeYears: 5,
      timing: "year-end",
    },
    terminal: {
      method: "gordon",
      growthPct: 2.5,
      exitMultiple: 10,
      hybridWeightPct: 50,
      fadeStartGrowthPct: 8,
      fadeYears: 5,
    },
    bridge: {
      netDebt: 200,
      preferredEquity: 0,
      minorityInterest: 0,
      pensionLiabilities: 0,
      leaseLiabilities: 0,
      convertibleClaims: 0,
      optionWarrantValue: 0,
      otherClaims: 0,
      excessCash: 0,
      marketableSecurities: 0,
      nonOperatingAssets: 0,
      jointVentureStakes: 0,
    },
    riskFreeRatePct: 4.5,
  };
}

test("institutional DCF refuses missing source/analyst revenue and shares instead of fabricating values", () => {
  const input = baseInput();
  input.baseRevenue = null;
  input.dilutedShares = null;
  input.bridge.netDebt = null;
  const issues = validateInstitutionalDcfInput(input);
  assert.ok(issues.some(issue => issue.includes("Base revenue")));
  assert.ok(issues.some(issue => issue.includes("Diluted shares")));
  assert.ok(issues.some(issue => issue.includes("net-debt bridge")));
  const result = runInstitutionalDcf(input);
  assert.equal(result.status, "incomplete");
  assert.equal(result.valuePerShare, null);
});

test("projected invested capital rolls forward with net reinvestment", () => {
  const result = runInstitutionalDcf(baseInput());
  assert.equal(result.status, "ready");
  const first = result.projections[0];
  assert.equal(first.openingInvestedCapital, 600);
  assert.ok(first.closingInvestedCapital !== null);
  assert.ok(Math.abs(first.closingInvestedCapital! - (600 + first.capex - first.da + first.nwcInvestment)) < 1e-9);
  assert.ok(first.roicPct !== null);
  const last = result.projections[result.projections.length - 1];
  assert.ok(last.closingInvestedCapital! > first.closingInvestedCapital!);
});

test("value-driver terminal return uses forecast capital economics rather than current capital denominator", () => {
  const input = baseInput();
  input.terminal.method = "valueDriver";
  const result = runInstitutionalDcf(input);
  assert.equal(result.status, "ready");
  const last = result.projections[result.projections.length - 1];
  assert.ok(result.terminalReturnOnCapitalPct !== null);
  assert.ok(last.closingInvestedCapital! > input.startingInvestedCapital!);
  assert.ok(Number.isFinite(result.terminalValue!));
  assert.ok(result.terminalValue! > 0);
});

test("mid-year convention increases present value versus year-end for positive cash flows", () => {
  const yearEnd = runInstitutionalDcf(baseInput());
  const midYearInput = baseInput();
  midYearInput.discount.timing = "mid-year";
  const midYear = runInstitutionalDcf(midYearInput);
  assert.ok(midYear.pvExplicitCashFlows! > yearEnd.pvExplicitCashFlows!);
});

test("stub discounting uses a fractional first period", () => {
  const yearEnd = runInstitutionalDcf(baseInput());
  const stubInput = baseInput();
  stubInput.discount.timing = "stub";
  stubInput.discount.stubFractionYears = 0.25;
  const stub = runInstitutionalDcf(stubInput);
  assert.ok(stub.pvExplicitCashFlows! > yearEnd.pvExplicitCashFlows!);
});

test("maturity engine fades WACC toward the terminal rate", () => {
  const input = baseInput();
  input.discount.currentWaccPct = 10;
  input.discount.terminalWaccPct = 8;
  input.discount.maturityFadeYears = 4;
  const path = buildDiscountRatePath(input);
  assert.ok(path[0] < 10 && path[0] > 8);
  assert.equal(path[3], 8);
  assert.equal(path[4], 8);
});

test("FCFE requires real or analyst-entered opening net debt", () => {
  const input = baseInput();
  input.cashFlowMode = "fcfe";
  input.startingNetDebt = null;
  const result = runInstitutionalDcf(input);
  assert.equal(result.status, "partial");
  assert.ok(result.blockingIssues.some(issue => issue.includes("opening net-debt")));
});

test("scenario presets are transparent shocks and bear is below bull under the base case", () => {
  const input = baseInput();
  const bear = runInstitutionalDcf(applyDcfScenario(input, DEFAULT_DCF_SCENARIOS.bear));
  const bull = runInstitutionalDcf(applyDcfScenario(input, DEFAULT_DCF_SCENARIOS.bull));
  assert.ok(bear.valuePerShare !== null && bull.valuePerShare !== null);
  assert.ok(bear.valuePerShare! < bull.valuePerShare!);
});

test("probabilistic DCF is reproducible with a fixed seed", () => {
  const settings = {
    runs: 300,
    seed: 424242,
    growthShockPctPoints: { low: -2, mode: 0, high: 2 },
    marginShockPctPoints: { low: -1.5, mode: 0, high: 1.5 },
    capexShockPctPoints: { low: -0.5, mode: 0, high: 0.5 },
    waccShockPctPoints: { low: -0.75, mode: 0, high: 0.75 },
    terminalGrowthShockPctPoints: { low: -0.4, mode: 0, high: 0.4 },
    correlationMatrix: [
      [1, 0.45, 0.10, -0.25, 0.25],
      [0.45, 1, 0.10, -0.20, 0.20],
      [0.10, 0.10, 1, 0.10, 0.05],
      [-0.25, -0.20, 0.10, 1, -0.15],
      [0.25, 0.20, 0.05, -0.15, 1],
    ],
  };
  const a = runProbabilisticDcf(baseInput(), settings);
  const b = runProbabilisticDcf(baseInput(), settings);
  assert.deepEqual(a, b);
  assert.equal(a.validRuns, 300);
  assert.ok(a.p10! <= a.median! && a.median! <= a.p90!);
});

test("financial institutions receive a low FCFF suitability rating", () => {
  const assessment = assessDcfModelSuitability("Financial Services", "Banks - Regional", 1_000, 100);
  assert.equal(assessment.suitability, "low");
  assert.match(assessment.primaryMethod, /FCFE|RESIDUAL/i);
});

test("FCFF/FCFE/EVA reconciliation produces explicit comparable outputs", () => {
  const recon = reconcileInstitutionalDcf(baseInput());
  assert.ok(recon.fcffEquityValue !== null);
  assert.ok(recon.fcfeEquityValue !== null);
  assert.ok(recon.fcffVsFcfeDeltaPct !== null);
  assert.ok(recon.evaEnterpriseValue !== null);
  assert.ok(recon.dcfVsEvaDeltaPct !== null);
});


test("institutional DCF reconciles with the P11 explicit-cash-flow known answer under matching conventions", () => {
  const input: InstitutionalDcfInput = {
    baseRevenue: 1_000,
    basicShares: 10,
    dilutedShares: 10,
    spotPrice: null,
    startingInvestedCapital: null,
    startingNetDebt: 50,
    startingNopat: null,
    cashFlowMode: "fcff",
    years: [
      { revenueGrowthPct: 0, ebitdaMarginPct: 10, daPctRevenue: 0, taxRatePct: 0, capexPctRevenue: 0, nwcInvestmentPctRevenue: 0 },
      { revenueGrowthPct: 0, ebitdaMarginPct: 11, daPctRevenue: 0, taxRatePct: 0, capexPctRevenue: 0, nwcInvestmentPctRevenue: 0 },
      { revenueGrowthPct: 0, ebitdaMarginPct: 12, daPctRevenue: 0, taxRatePct: 0, capexPctRevenue: 0, nwcInvestmentPctRevenue: 0 },
    ],
    discount: {
      currentWaccPct: 10,
      terminalWaccPct: 10,
      currentCostOfEquityPct: 10,
      terminalCostOfEquityPct: 10,
      maturityFadeYears: 3,
      timing: "year-end",
    },
    terminal: {
      method: "gordon",
      growthPct: 3,
      exitMultiple: 8,
    },
    bridge: {
      netDebt: 50,
    },
  };

  const result = runInstitutionalDcf(input);
  // The fixture deliberately has no quote: valuation is available, but upside is not.
  assert.equal(result.status, "partial");
  assert.equal(result.upsidePct, null);
  assert.deepEqual(result.projections.map((projection) => projection.fcff), [100, 110, 120]);
  assert.ok(Math.abs(result.pvExplicitCashFlows! - 271.97595792637117) <= 1e-9);
  assert.ok(Math.abs(result.terminalValue! - 1765.7142857142858) <= 1e-9);
  assert.ok(Math.abs(result.enterpriseValue! - 1598.5832349468712) <= 1e-9);
  assert.ok(Math.abs(result.equityValue! - 1548.5832349468712) <= 1e-9);
  assert.ok(Math.abs(result.valuePerShare! - 154.85832349468714) <= 1e-9);
});
