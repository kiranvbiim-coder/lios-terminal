import test from "node:test";
import assert from "node:assert/strict";
import {
  computeLiquidationValue,
  computeReplacementCost,
  syntheticCreditRating,
  factorCostOfEquity,
  terminalValue,
} from "./valuationModels";

const close = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);

test("liquidation value applies category recovery rates, costs, and liabilities", () => {
  const result = computeLiquidationValue({
    cash: 100, receivables: 200, inventory: 300, ppe: 400, otherAssets: 100, totalLiabilities: 250,
    cashRecoveryPct: 100, receivablesRecoveryPct: 80, inventoryRecoveryPct: 60,
    ppeRecoveryPct: 50, otherAssetsRecoveryPct: 25, liquidationCostPct: 10,
  });
  // Gross = 100 + 160 + 180 + 200 + 25 = 665; costs = 66.5; equity = 348.5.
  close(result.grossRecovery, 665);
  close(result.liquidationCosts, 66.5);
  close(result.netRecovery, 598.5);
  close(result.liquidationValue, 348.5);
});

test("liquidation value guards non-finite inputs and clamps assumptions", () => {
  const result = computeLiquidationValue({
    cash: Number.NaN, receivables: 100, inventory: 0, ppe: 0, otherAssets: 0, totalLiabilities: 10,
    receivablesRecoveryPct: 200, liquidationCostPct: -20,
  });
  close(result.grossRecovery, 100);
  close(result.liquidationCosts, 0);
  close(result.liquidationValue, 90);
});

test("replacement cost restates filed assets and subtracts liabilities", () => {
  const result = computeReplacementCost({
    cash: 100, receivables: 200, inventory: 300, netPPE: 400,
    otherOperatingAssets: 50, intangibleRebuildCost: 75, totalLiabilities: 250,
  });
  // 100 + 200 + 330 + 520 + 50 + 75 = 1,275; net = 1,025.
  close(result.reproductionCostOfAssets, 1275);
  close(result.reproductionCostOfNetAssets, 1025);
  close(result.byCategory.inventory, 330);
  close(result.byCategory.ppe, 520);
});

test("replacement cost guards negative and non-finite values", () => {
  const result = computeReplacementCost({
    cash: -10, receivables: Number.NaN, inventory: 100, netPPE: 100,
    otherOperatingAssets: 0, intangibleRebuildCost: 0, totalLiabilities: Number.POSITIVE_INFINITY,
    inventoryReplacementMultiple: -2,
  });
  close(result.reproductionCostOfAssets, 130);
  close(result.reproductionCostOfNetAssets, 130);
});

test("synthetic credit rating selects the highest qualifying coverage band", () => {
  const result = syntheticCreditRating(3.2, 4.0);
  assert.equal(result.rating, "A-");
  close(result.spreadPct, 1.55);
  close(result.costOfDebt, 5.55);
});

test("synthetic credit rating handles distressed and non-finite coverage", () => {
  assert.equal(syntheticCreditRating(0.25, 4).rating, "D");
  assert.equal(syntheticCreditRating(Number.NaN, 4).rating, "D");
  const empty = syntheticCreditRating(2, 4, []);
  assert.equal(empty.rating, "NR");
  close(empty.costOfDebt, 4);
});

test("factor cost of equity sums loading times premium in percentage units", () => {
  const result = factorCostOfEquity({ riskFreeRate: 4, factorLoadings: [1.2, -0.5, 0.8], factorPremia: [5, 3, 2] });
  // 4 + (6 - 1.5 + 1.6) = 10.1%.
  assert.deepEqual(result.factorContributions, [6, -1.5, 1.6]);
  close(result.costOfEquity, 10.1);
});

test("factor cost of equity truncates mismatched factors and guards non-finite values", () => {
  const result = factorCostOfEquity({ riskFreeRate: Number.NaN, factorLoadings: [1, Number.NaN, 4], factorPremia: [5, 3] });
  assert.deepEqual(result.factorContributions, [5, 0]);
  close(result.costOfEquity, 5);
});

test("terminal value supports Gordon, exit multiple, and hybrid methods", () => {
  const base = { lastFcf: 100, lastEbitda: 200, discountRate: 10, terminalGrowth: 2, exitMultiple: 8 };
  close(terminalValue({ ...base, method: "gordon" }), 1275);
  close(terminalValue({ ...base, method: "exitMultiple" }), 1600);
  close(terminalValue({ ...base, method: "hybrid", hybridWeight: 25 }), 1518.75);
});

test("terminal value value-driver method makes ROIC reinvestment explicit", () => {
  const result = terminalValue({
    method: "valueDriver", lastFcf: 100, lastNopat: 150, lastEbitda: 200,
    discountRate: 10, terminalGrowth: 2, exitMultiple: 8, roic: 15,
  });
  // NOPAT_(n+1)=150×1.02; reinvestment rate=2/15; TV=132.6/(.10-.02)=1,657.5.
  close(result, 1657.5);
});

test("terminal value fade-to-maturity uses the standard H-model", () => {
  const result = terminalValue({
    method: "fadeToMaturity", lastFcf: 100, lastEbitda: 200,
    discountRate: 10, terminalGrowth: 2, exitMultiple: 8,
    fadeStartGrowth: 10, fadeYears: 6,
  });
  // H=3: 100 × [1.02 + 3×(.10-.02)] / (.10-.02) = 1,575.
  close(result, 1575);
});

test("terminal value guards denominator, invalid inputs, and hybrid weight", () => {
  const base = { lastFcf: 100, lastEbitda: 200, discountRate: 5, terminalGrowth: 5, exitMultiple: 8 };
  close(terminalValue({ ...base, method: "gordon" }), 0);
  close(terminalValue({ ...base, method: "valueDriver", lastNopat: 100, roic: 10 }), 0);
  close(terminalValue({ ...base, method: "fadeToMaturity", fadeStartGrowth: 8, fadeYears: 5 }), 0);
  // With a valid denominator, an out-of-range 200% Gordon weight is clamped
  // to 100%, leaving only the Gordon value.
  close(terminalValue({ ...base, discountRate: 10, terminalGrowth: 2, method: "hybrid", hybridWeight: 200 }), 1275);
  close(terminalValue({ ...base, method: "exitMultiple", lastEbitda: Number.NaN }), 0);
});
