import assert from "node:assert/strict";
import test from "node:test";
import {
  validateCovarianceMatrix,
  validateDiscountCurve,
  validateEuropeanOptionNoArbitrage,
  validateProbabilityVector,
} from "./financialInvariants";

test("European option bounds and put-call parity accept an arbitrage-free pair", () => {
  const spot = 100;
  const strike = 100;
  const timeYears = 1;
  const riskFreeRate = 0.05;
  const discountedStrike = strike * Math.exp(-riskFreeRate * timeYears);
  const callPrice = 10;
  const putPrice = callPrice - spot + discountedStrike;
  const result = validateEuropeanOptionNoArbitrage({
    spot,
    strike,
    timeYears,
    riskFreeRate,
    callPrice,
    putPrice,
    tolerance: 1e-10,
  });
  assert.equal(result.pass, true);
  assert.deepEqual(result.findings, []);
});

test("put-call parity violation is a blocker", () => {
  const result = validateEuropeanOptionNoArbitrage({
    spot: 100,
    strike: 100,
    timeYears: 1,
    riskFreeRate: 0,
    callPrice: 10,
    putPrice: 2,
    tolerance: 1e-8,
  });
  assert.equal(result.pass, false);
  assert.ok(result.findings.some((finding) => finding.code === "PUT_CALL_PARITY"));
});

test("option prices outside hard no-arbitrage bounds are blocked", () => {
  const result = validateEuropeanOptionNoArbitrage({
    spot: 100,
    strike: 80,
    timeYears: 1,
    riskFreeRate: 0,
    callPrice: 10,
  });
  assert.equal(result.pass, false);
  assert.ok(result.findings.some((finding) => finding.code === "CALL_ARBITRAGE_BOUND"));
});

test("discount curve rejects non-positive factors and unordered maturities", () => {
  const result = validateDiscountCurve([
    { timeYears: 1, discountFactor: 0.98 },
    { timeYears: 0.5, discountFactor: 0.97 },
    { timeYears: 2, discountFactor: 0 },
  ]);
  assert.equal(result.pass, false);
  assert.ok(result.findings.some((finding) => finding.code === "CURVE_TIME_ORDER"));
  assert.ok(result.findings.some((finding) => finding.code === "CURVE_NON_POSITIVE_DF"));
});

test("negative forwards are warnings when not explicitly allowed", () => {
  const result = validateDiscountCurve([
    { timeYears: 1, discountFactor: 1.001 },
    { timeYears: 2, discountFactor: 1.002 },
  ]);
  assert.equal(result.pass, true);
  assert.ok(result.findings.some((finding) => finding.code === "CURVE_NEGATIVE_FORWARD" && finding.severity === "warning"));
});

test("probability vectors must be normalized and in domain", () => {
  assert.equal(validateProbabilityVector([0.2, 0.3, 0.5]).pass, true);
  const invalid = validateProbabilityVector([0.7, 0.7, -0.4]);
  assert.equal(invalid.pass, false);
  assert.ok(invalid.findings.some((finding) => finding.code === "PROBABILITY_DOMAIN"));
});

test("positive semidefinite covariance matrix passes", () => {
  const result = validateCovarianceMatrix([
    [0.04, 0.018, 0.012],
    [0.018, 0.09, 0.015],
    [0.012, 0.015, 0.16],
  ]);
  assert.equal(result.pass, true);
});

test("indefinite covariance matrix is blocked", () => {
  const result = validateCovarianceMatrix([
    [1, 2],
    [2, 1],
  ]);
  assert.equal(result.pass, false);
  assert.ok(result.findings.some((finding) => finding.code === "COVARIANCE_NOT_PSD"));
});

test("near-singular covariance is surfaced for review", () => {
  const result = validateCovarianceMatrix([
    [1, 1],
    [1, 1],
  ]);
  assert.equal(result.pass, true);
  assert.ok(result.findings.some((finding) => finding.code === "COVARIANCE_NEAR_SINGULAR"));
});
