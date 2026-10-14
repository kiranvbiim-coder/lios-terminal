import test from "node:test";
import assert from "node:assert/strict";
import { projectRetirementStress } from "./p6RetirementStress.ts";

const retirement = Object.freeze({
  currentAge: 60, retirementAge: 60, currentPortfolio: 100,
  monthlyContribution: 0, annualReturnAssumption: 0,
  annualInflationAssumption: 0, annualRetirementSpendingToday: 10,
  withdrawalRate: 0.1,
});
const stress = Object.freeze({
  annualReturnVolatility: 0, paths: 100, yearsInRetirement: 5, seed: 42,
});

test("P6 retirement stress: hand-computed zero-volatility funded path", () => {
  const out = projectRetirementStress(retirement, stress);
  assert.equal(out.yearsUntilRetirement, 0);
  assert.equal(out.targetPortfolioAtRetirement, 100);
  assert.equal(out.survivingPaths, 100);
  assert.equal(out.survivalProbability, 1);
  assert.equal(out.fundingTargetProbability, 1);
  assert.equal(out.terminalPortfolioP10, 50);
  assert.equal(out.terminalPortfolioMedian, 50);
  assert.equal(out.terminalPortfolioP90, 50);
  assert.match(out.inputHash, /^[a-f0-9]{64}$/);
  assert.match(out.outputHash, /^[a-f0-9]{64}$/);
  assert.match(out.limitation, /not a forecast/i);
});

test("P6 retirement stress: hand-computed depletion cannot be called success", () => {
  const out = projectRetirementStress({ ...retirement, annualRetirementSpendingToday: 30 }, stress);
  assert.equal(out.targetPortfolioAtRetirement, 300);
  assert.equal(out.survivingPaths, 0);
  assert.equal(out.survivalProbability, 0);
  assert.equal(out.fundingTargetProbability, 0);
  assert.equal(out.terminalPortfolioMedian, 0);
});

test("P6 retirement stress: inflation and beginning-of-year withdrawal are explicit", () => {
  const out = projectRetirementStress(
    { ...retirement, annualInflationAssumption: 0.05 },
    { ...stress, yearsInRetirement: 2 },
  );
  // Independent arithmetic: 100 - 10 - 10.5 = 79.5 with zero return.
  assert.ok(Math.abs(out.terminalPortfolioMedian - 79.5) < 1e-10);
  assert.equal(out.assumptions.withdrawalTiming, "retirement_year_start");
  assert.equal(out.assumptions.taxesAndFees, "not_modelled");
});

test("P6 retirement stress: accumulation uses monthly-end contributions", () => {
  const out = projectRetirementStress(
    { ...retirement, currentAge: 59, monthlyContribution: 10, annualRetirementSpendingToday: 0 },
    { ...stress, yearsInRetirement: 1 },
  );
  assert.equal(out.yearsUntilRetirement, 1);
  assert.equal(out.terminalPortfolioMedian, 220);
  assert.equal(out.survivalProbability, 1);
  assert.equal(out.assumptions.accumulationContributionTiming, "monthly_end");
});

test("P6 retirement stress: same volatile seed is byte-reproducible and changes with seed", () => {
  const profile = {
    ...retirement, currentAge: 35, retirementAge: 65, currentPortfolio: 500000,
    monthlyContribution: 2000, annualReturnAssumption: 0.05,
    annualInflationAssumption: 0.025, annualRetirementSpendingToday: 40000,
    withdrawalRate: 0.04,
  };
  const scenario = { ...stress, annualReturnVolatility: 0.18, paths: 400, yearsInRetirement: 25 };
  const a = projectRetirementStress(profile, scenario);
  const b = projectRetirementStress(profile, scenario);
  const c = projectRetirementStress(profile, { ...scenario, seed: scenario.seed + 1 });
  assert.deepEqual(a, b);
  assert.equal(a.outputHash, b.outputHash);
  assert.notEqual(a.outputHash, c.outputHash);
  assert.ok(a.survivalProbability >= 0 && a.survivalProbability <= 1);
  assert.ok(a.fundingTargetProbability >= 0 && a.fundingTargetProbability <= 1);
  assert.ok(a.terminalPortfolioP10 <= a.terminalPortfolioMedian);
  assert.ok(a.terminalPortfolioMedian <= a.terminalPortfolioP90);
  assert.notEqual(a.terminalPortfolioP10, a.terminalPortfolioP90);
});

test("P6 retirement stress: refuses malformed/no-data and unbounded simulations", () => {
  assert.throws(() => projectRetirementStress(null, stress), /Explicit/);
  assert.throws(() => projectRetirementStress(retirement, null), /Explicit/);
  for (const change of [
    { paths: 0 }, { paths: 2001 }, { yearsInRetirement: 61 }, { yearsInRetirement: 0 },
    { seed: -1 }, { seed: 4294967296 }, { annualReturnVolatility: Infinity },
    { annualReturnVolatility: -0.1 }, { annualReturnVolatility: 2.1 },
  ]) {
    assert.throws(() => projectRetirementStress(retirement, { ...stress, ...change }));
  }
  assert.throws(() => projectRetirementStress({ ...retirement, currentAge: 59.5 }, stress), /whole-year ages/);
  assert.throws(() => projectRetirementStress({ ...retirement, annualReturnAssumption: -1 }, stress), /greater than -100%/);
});

test("P6 retirement stress: monetary overflow fails closed instead of returning Infinity", () => {
  assert.throws(
    () => projectRetirementStress(
      { ...retirement, currentPortfolio: 1e308, monthlyContribution: 1e308, currentAge: 59 },
      stress,
    ),
    /overflowed or became invalid/,
  );
});
