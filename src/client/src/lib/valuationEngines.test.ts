import test from "node:test";
import assert from "node:assert/strict";
import {
  computeResidualIncome,
  computeEva,
  computeImpliedGrowth,
  computeImpliedWacc,
  computeImpliedMargin,
  buildValuationBridge,
  computeValueCreationMetrics,
  type ValuationMethodResult,
} from "./valuationEngines";

// ─── Residual Income ──────────────────────────────────────────────────────

test("residual income: basic case with positive excess returns", () => {
  const result = computeResidualIncome({
    bookValueOfEquity: 1000,
    costOfEquity: 0.10,
    forecastNetIncome: [150, 160, 170],
    forecastBookValue: [1050, 1110, 1180],
    terminalGrowth: 0.03,
  });
  // RI year 1: 150 - 0.10*1000 = 50
  assert.ok(Math.abs(result.residualIncomes[0] - 50) < 0.01);
  // RI year 2: 160 - 0.10*1050 = 55
  assert.ok(Math.abs(result.residualIncomes[1] - 55) < 0.01);
  // RI year 3: 170 - 0.10*1110 = 59
  assert.ok(Math.abs(result.residualIncomes[2] - 59) < 0.01);
  // Intrinsic value > book value (positive excess returns)
  assert.ok(result.intrinsicValue > 1000);
  assert.equal(result.currentBookValue, 1000);
  assert.equal(result.pvResidualIncomes.length, 3);
  assert.ok(result.pvTerminalValue > 0);
});

test("residual income: zero excess returns equals book value", () => {
  // If ROE exactly equals cost of equity, intrinsic value = book value
  const bv = 1000;
  const ke = 0.10;
  const ni = bv * ke; // exactly earns the cost
  const result = computeResidualIncome({
    bookValueOfEquity: bv,
    costOfEquity: ke,
    forecastNetIncome: [ni, ni, ni],
    forecastBookValue: [bv, bv, bv],
    terminalGrowth: 0,
  });
  // RI should be ~0 for each period
  for (const ri of result.residualIncomes) {
    assert.ok(Math.abs(ri) < 0.01);
  }
  // Intrinsic value should be very close to book value
  assert.ok(Math.abs(result.intrinsicValue - bv) < 1);
});

test("residual income: empty forecast returns book value", () => {
  const result = computeResidualIncome({
    bookValueOfEquity: 500,
    costOfEquity: 0.12,
    forecastNetIncome: [],
    forecastBookValue: [],
    terminalGrowth: 0.02,
  });
  assert.equal(result.intrinsicValue, 500);
  assert.equal(result.residualIncomes.length, 0);
});

// ─── EVA ──────────────────────────────────────────────────────────────────

test("EVA: positive spread creates value above invested capital", () => {
  const result = computeEva({
    investedCapital: 5000,
    nopat: 800,
    wacc: 0.10,
    forecastNopat: [850, 900, 950],
    forecastInvestedCapital: [5200, 5400, 5600],
    terminalGrowth: 0.03,
  });
  // Current EVA: 800 - 0.10*5000 = 300
  assert.ok(Math.abs(result.currentEva - 300) < 0.01);
  // Current spread: 800/5000 - 0.10 = 0.06
  assert.ok(Math.abs(result.currentSpread - 0.06) < 0.001);
  // Intrinsic EV > invested capital (positive EVA)
  assert.ok(result.intrinsicEnterpriseValue > 5000);
  assert.ok(result.marketValueAdded > 0);
  assert.equal(result.evaPerPeriod.length, 3);
});

test("EVA: zero spread means EV equals invested capital", () => {
  const ic = 5000;
  const wacc = 0.10;
  const nopat = ic * wacc; // exactly earns WACC
  const result = computeEva({
    investedCapital: ic,
    nopat,
    wacc,
    forecastNopat: [nopat, nopat, nopat],
    forecastInvestedCapital: [ic, ic, ic],
    terminalGrowth: 0,
  });
  assert.ok(Math.abs(result.currentEva) < 0.01);
  assert.ok(Math.abs(result.currentSpread) < 0.001);
  // EVA per period should be ~0
  for (const eva of result.evaPerPeriod) {
    assert.ok(Math.abs(eva) < 0.01);
  }
});

test("EVA: negative spread destroys value", () => {
  const result = computeEva({
    investedCapital: 5000,
    nopat: 300,         // ROIC = 6% < WACC = 10%
    wacc: 0.10,
    forecastNopat: [300, 300, 300],
    forecastInvestedCapital: [5000, 5000, 5000],
    terminalGrowth: 0.02,
  });
  assert.ok(result.currentEva < 0);
  assert.ok(result.currentSpread < 0);
  assert.ok(result.marketValueAdded < 0);
  assert.ok(result.intrinsicEnterpriseValue < 5000);
});

// ─── Implied Growth ───────────────────────────────────────────────────────

test("implied growth: market pricing high EV implies positive growth", () => {
  const result = computeImpliedGrowth({
    enterpriseValue: 10000,
    lastFcf: 500,
    wacc: 0.10,
    terminalGrowth: 0.03,
    forecastYears: 5,
  });
  assert.ok(result.impliedGrowthRate > 0);
  assert.ok(result.impliedGrowthRate < 0.10);
  assert.ok(result.impliedTerminalValue > 0);
});

test("implied growth: low EV implies low/negative growth", () => {
  const result = computeImpliedGrowth({
    enterpriseValue: 3000,
    lastFcf: 500,
    wacc: 0.10,
    terminalGrowth: 0.03,
    forecastYears: 5,
  });
  assert.ok(result.impliedGrowthRate < 0.05);
});

// ─── Implied WACC ─────────────────────────────────────────────────────────

test("implied WACC: converges for realistic inputs", () => {
  const fcfs = [100, 105, 110, 116, 122];
  const result = computeImpliedWacc({
    enterpriseValue: 2000,
    fcfForecast: fcfs,
    terminalGrowth: 0.02,
  });
  assert.ok(result.impliedWacc > 0.01);
  assert.ok(result.impliedWacc < 0.50);
  assert.ok(result.iterations > 0);
  assert.ok(result.iterations < 100);
  assert.equal(result.converged, true);
});

test("implied WACC: higher EV implies lower WACC", () => {
  const fcfs = [100, 110, 120, 130, 140];
  const lowEv = computeImpliedWacc({ enterpriseValue: 1500, fcfForecast: fcfs, terminalGrowth: 0.02 });
  const highEv = computeImpliedWacc({ enterpriseValue: 3000, fcfForecast: fcfs, terminalGrowth: 0.02 });
  assert.ok(highEv.impliedWacc < lowEv.impliedWacc, "Higher EV should imply lower discount rate");
});

test("implied WACC: empty forecast returns 0 and is not reported as converged", () => {
  const result = computeImpliedWacc({ enterpriseValue: 1000, fcfForecast: [], terminalGrowth: 0.02 });
  assert.equal(result.impliedWacc, 0);
  assert.equal(result.converged, false);
});

test("implied WACC: reports non-convergence, not a fabricated near-zero rate, when EV vastly exceeds achievable PV", () => {
  // Reproduces the live bug: a mega-cap's real market EV can dwarf what a
  // manual-assumption DCF forecast can ever discount up to, even at the
  // solver's 0.1% floor. The UI must not display that floor value as if
  // it were a genuine "the market requires a 0.10% return" answer.
  const fcfs = [100_000_000_000, 108_000_000_000, 117_000_000_000, 126_000_000_000, 136_000_000_000];
  const result = computeImpliedWacc({
    enterpriseValue: 4_884_000_000_000, // AAPL-scale real market EV
    fcfForecast: fcfs,
    terminalGrowth: 0.025,
  });
  assert.equal(result.converged, false, "no rate in [0.1%, 50%] can reconcile these cash flows with this EV");
  assert.equal(result.impliedWacc, 0.001, "must be pinned exactly at the floor, not a spuriously precise value");
  assert.equal(result.iterations, 100, "must have exhausted the search rather than satisfied the PV tolerance");
});

// ─── Implied Margin ───────────────────────────────────────────────────────

test("implied margin: reasonable range for typical inputs", () => {
  const result = computeImpliedMargin({
    enterpriseValue: 5000,
    revenue: 2000,
    wacc: 0.10,
    terminalGrowth: 0.03,
    revenueGrowth: 0.05,
    forecastYears: 5,
    taxRate: 0.25,
    daPercentRevenue: 0.03,
    capexPercentRevenue: 0.04,
    nwcPercentRevenue: 0.10,
  });
  assert.ok(result.impliedOperatingMargin > 0);
  assert.ok(result.impliedOperatingMargin < 0.80);
  assert.equal(result.impliedEbitMargin, result.impliedOperatingMargin);
  assert.equal(result.converged, true);
});

test("implied margin: reports non-convergence when EV exceeds any achievable margin in [-50%, 80%]", () => {
  const result = computeImpliedMargin({
    enterpriseValue: 1_000_000_000, // far beyond what an 80% margin on this revenue can justify
    revenue: 1000,
    wacc: 0.10,
    terminalGrowth: 0.03,
    revenueGrowth: 0.05,
    forecastYears: 5,
    taxRate: 0.25,
    daPercentRevenue: 0.03,
    capexPercentRevenue: 0.04,
    nwcPercentRevenue: 0.10,
  });
  assert.equal(result.converged, false);
  assert.ok(result.impliedOperatingMargin >= 0.79, "must be pinned at the search's upper bound");
});

test("implied margin: higher EV requires higher margin", () => {
  const base = {
    revenue: 2000, wacc: 0.10, terminalGrowth: 0.03, revenueGrowth: 0.05,
    forecastYears: 5, taxRate: 0.25, daPercentRevenue: 0.03,
    capexPercentRevenue: 0.04, nwcPercentRevenue: 0.10,
  };
  const low = computeImpliedMargin({ ...base, enterpriseValue: 3000 });
  const high = computeImpliedMargin({ ...base, enterpriseValue: 8000 });
  assert.ok(high.impliedOperatingMargin > low.impliedOperatingMargin);
});

// ─── Valuation Bridge ─────────────────────────────────────────────────────

test("valuation bridge: weights by confidence correctly", () => {
  const methods: ValuationMethodResult[] = [
    { method: "dcf", label: "DCF", enterpriseValue: 10000, equityValue: 8000, valuePerShare: 80, confidence: "high", notes: "" },
    { method: "comps", label: "Trading Comps", enterpriseValue: 12000, equityValue: 10000, valuePerShare: 100, confidence: "medium", notes: "" },
    { method: "lbo", label: "LBO Floor", enterpriseValue: 8000, equityValue: 6000, valuePerShare: 60, confidence: "low", notes: "" },
  ];
  const bridge = buildValuationBridge(methods, 100);
  // DCF weight 3, Comps weight 2, LBO weight 1: (8000*3 + 10000*2 + 6000*1) / 6 = 50000/6 ≈ 8333.33
  assert.ok(Math.abs(bridge.weightedEquityValue - 8333.33) < 1);
  assert.ok(Math.abs(bridge.weightedValuePerShare - 83.33) < 1);
  assert.equal(bridge.rangeHigh, 100); // 10000/100
  assert.equal(bridge.rangeLow, 60);   // 6000/100
  assert.equal(bridge.sharesOutstanding, 100);
});

test("valuation bridge: handles single method", () => {
  const methods: ValuationMethodResult[] = [
    { method: "dcf", label: "DCF", enterpriseValue: 10000, equityValue: 8000, valuePerShare: 80, confidence: "high", notes: "" },
  ];
  const bridge = buildValuationBridge(methods, 100);
  assert.equal(bridge.weightedEquityValue, 8000);
  assert.equal(bridge.weightedValuePerShare, 80);
  assert.equal(bridge.rangeHigh, 80);
  assert.equal(bridge.rangeLow, 80);
});

test("valuation bridge: handles no valid methods", () => {
  const methods: ValuationMethodResult[] = [
    { method: "dcf", label: "DCF", enterpriseValue: null, equityValue: null, valuePerShare: null, confidence: "low", notes: "Insufficient data" },
  ];
  const bridge = buildValuationBridge(methods, 100);
  assert.equal(bridge.weightedEquityValue, 0);
  assert.equal(bridge.weightedValuePerShare, 0);
});

test("valuation bridge: excludes negative equity values", () => {
  const methods: ValuationMethodResult[] = [
    { method: "dcf", label: "DCF", enterpriseValue: 10000, equityValue: 8000, valuePerShare: 80, confidence: "high", notes: "" },
    { method: "nav", label: "NAV", enterpriseValue: 0, equityValue: -500, valuePerShare: -5, confidence: "low", notes: "Negative NAV" },
  ];
  const bridge = buildValuationBridge(methods, 100);
  assert.equal(bridge.weightedEquityValue, 8000); // only DCF counts
});

// ─── Value Creation & Growth Quality ──────────────────────────────────────

// Hand-calculable fixture: current period NOPAT = 150, invested capital =
// 900 (ROIC = 1/6); prior period NOPAT = 112.5, invested capital = 770.
// Every expected value below is an exact fraction, not a rounded estimate.
const CURRENT = {
  revenue: 1200, operatingIncome: 200, incomeBeforeTax: 180, incomeTaxExpense: 45, // 25% effective tax rate
  totalDebt: 300, totalEquity: 700, cash: 100, currentAssets: 400, currentLiabilities: 250,
  depreciationAndAmortization: 50, capitalExpenditure: -80,
};
const PRIOR = {
  revenue: 1000, operatingIncome: 150, incomeBeforeTax: 130, incomeTaxExpense: 32.5, // 25% effective tax rate
  totalDebt: 250, totalEquity: 600, cash: 80, currentAssets: 350, currentLiabilities: 220,
};

test("value creation: NOPAT, invested capital, and ROIC match hand-calculated values", () => {
  const result = computeValueCreationMetrics({ ...CURRENT, prior: null });
  // NOPAT = 200 * (1 - 45/180) = 200 * 0.75 = 150
  assert.ok(Math.abs(result.nopat - 150) < 1e-9);
  // Invested capital = 300 + 700 - 100 = 900
  assert.ok(Math.abs(result.investedCapital - 900) < 1e-9);
  // ROIC = 150 / 900 = 1/6
  assert.ok(Math.abs(result.roic - 1 / 6) < 1e-9);
});

test("value creation: economic profit is null without a WACC, computed when supplied", () => {
  const noWacc = computeValueCreationMetrics({ ...CURRENT, prior: null });
  assert.equal(noWacc.economicProfit, null);
  // EVA = NOPAT - WACC * IC = 150 - 0.10*900 = 60
  const withWacc = computeValueCreationMetrics({ ...CURRENT, prior: null, wacc: 0.10 });
  assert.ok(Math.abs((withWacc.economicProfit ?? NaN) - 60) < 1e-9);
});

test("value creation: growth-quality metrics are null without a prior period", () => {
  const result = computeValueCreationMetrics({ ...CURRENT, prior: null });
  assert.equal(result.operatingLeverage, null);
  assert.equal(result.incrementalMargin, null);
  assert.equal(result.incrementalRoic, null);
  assert.equal(result.reinvestmentRate, null);
  assert.equal(result.sustainableGrowth, null);
});

test("value creation: operating leverage and incremental margin match hand-calculated values", () => {
  const result = computeValueCreationMetrics({ ...CURRENT, prior: PRIOR });
  // deltaRevenue=200, deltaEBIT=50. %change EBIT = 50/150 = 1/3. %change revenue = 200/1000 = 1/5.
  // DOL = (1/3)/(1/5) = 5/3
  assert.ok(Math.abs((result.operatingLeverage ?? NaN) - 5 / 3) < 1e-9);
  // Incremental margin = 50/200 = 0.25
  assert.ok(Math.abs((result.incrementalMargin ?? NaN) - 0.25) < 1e-9);
});

test("value creation: incremental ROIC matches hand-calculated value", () => {
  const result = computeValueCreationMetrics({ ...CURRENT, prior: PRIOR });
  // Prior NOPAT = 150*(1-32.5/130) = 150*0.75 = 112.5; prior IC = 250+600-80 = 770.
  // Incremental ROIC = (150-112.5)/(900-770) = 37.5/130
  assert.ok(Math.abs((result.incrementalRoic ?? NaN) - 37.5 / 130) < 1e-9);
});

test("value creation: reinvestment rate and sustainable growth match hand-calculated values", () => {
  const result = computeValueCreationMetrics({ ...CURRENT, prior: PRIOR });
  // Net CapEx = |-80| - 50 = 30. NWC current = 400-250=150, NWC prior = 350-220=130, deltaNWC=20.
  // Reinvestment = 30+20 = 50. Reinvestment rate = 50/150 (current NOPAT) = 1/3.
  assert.ok(Math.abs((result.reinvestmentRate ?? NaN) - 1 / 3) < 1e-9);
  // Sustainable growth = ROIC * reinvestment rate = (1/6)*(1/3) = 1/18
  assert.ok(Math.abs((result.sustainableGrowth ?? NaN) - 1 / 18) < 1e-9);
});

test("value creation: capital expenditure sign convention does not change the result", () => {
  // A provider reporting CapEx as a positive magnitude instead of a negative
  // outflow must produce the identical reinvestment rate (Math.abs guard).
  const negativeConvention = computeValueCreationMetrics({ ...CURRENT, capitalExpenditure: -80, prior: PRIOR });
  const positiveConvention = computeValueCreationMetrics({ ...CURRENT, capitalExpenditure: 80, prior: PRIOR });
  assert.equal(negativeConvention.reinvestmentRate, positiveConvention.reinvestmentRate);
});

test("value creation: zero-denominator guards return null instead of Infinity/NaN", () => {
  const flatRevenue = computeValueCreationMetrics({
    ...CURRENT, revenue: PRIOR.revenue, operatingIncome: PRIOR.operatingIncome, prior: PRIOR,
  });
  assert.equal(flatRevenue.operatingLeverage, null);
  assert.equal(flatRevenue.incrementalMargin, null);

  const sameInvestedCapital = computeValueCreationMetrics({
    ...CURRENT, totalDebt: PRIOR.totalDebt, totalEquity: PRIOR.totalEquity, cash: PRIOR.cash, prior: PRIOR,
  });
  assert.equal(sameInvestedCapital.incrementalRoic, null);

  const zeroNopat = computeValueCreationMetrics({ ...CURRENT, operatingIncome: 0, prior: PRIOR });
  assert.equal(zeroNopat.reinvestmentRate, null);
  assert.equal(zeroNopat.sustainableGrowth, null);
});
