import assert from "node:assert/strict";
import test from "node:test";
import { evaluateQlibRiskChallenger as evaluate, QLIB_RISK_CHALLENGER_SOURCE } from "./qlibRiskChallenger.mjs";

function close(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    "Expected " + actual + " to equal " + expected + " within " + tolerance);
}

test("source pin and MIT provenance are explicit; no upstream runtime is asserted", () => {
  assert.equal(QLIB_RISK_CHALLENGER_SOURCE.repository, "microsoft/qlib");
  assert.match(QLIB_RISK_CHALLENGER_SOURCE.commit, /^[a-f0-9]{40}$/);
  assert.equal(QLIB_RISK_CHALLENGER_SOURCE.license, "MIT");
  assert.equal(QLIB_RISK_CHALLENGER_SOURCE.implementation, "adapted_formula_not_qlib_runtime");
});

test("Qlib SUM semantics use sample volatility, arithmetic annualization and sum drawdown", () => {
  // Hand-calculated fixture: 10%, -10%, 10%, -10%.
  const m = evaluate({ returns: [0.1, -0.1, 0.1, -0.1], annualizationSessions: 4, mode: "sum" });
  close(m.mean, 0);
  close(m.std, Math.sqrt(0.04 / 3));
  close(m.annualizedReturn, 0);
  close(m.informationRatio, 0);
  close(m.maxDrawdown, -0.1);
  assert.equal(m.sampleCount, 4);
  assert.equal(m.inputTruth, "unknown");
});

test("Qlib PRODUCT semantics use geometric annualization, log-volatility and percentage drawdown", () => {
  // Hand fixture: cumulative growth = 1.1 * .9 * 1.1 * .9 = 0.9801.
  const m = evaluate({ returns: [0.1, -0.1, 0.1, -0.1], annualizationSessions: 4, mode: "product" });
  close(m.annualizedReturn, -0.0199);
  close(m.mean, Math.pow(0.9801, 0.25) - 1);
  const logHigh = Math.log(1.1);
  const logLow = Math.log(0.9);
  const average = (logHigh + logLow) / 2;
  const sampleLogStd = Math.sqrt((2 * (logHigh - average) ** 2 + 2 * (logLow - average) ** 2) / 3);
  close(m.std, sampleLogStd);
  // The last compounded balance (0.9801) is 10.9% under first period peak (1.1).
  close(m.maxDrawdown, -0.109);
  close(m.informationRatio, m.mean / sampleLogStd * 2);
});

test("constant returns do not become fake infinite information ratio", () => {
  for (const mode of ["sum", "product"]) {
    const m = evaluate({ returns: [0.02, 0.02, 0.02], annualizationSessions: 252, mode });
    assert.equal(m.informationRatio, null);
    assert.match(m.caveats.join(" "), /undefined/);
    close(m.maxDrawdown, 0);
  }
  // Cumulative floating-point addition must not create a fake huge IR.
  for (const mode of ["sum", "product"]) {
    for (const value of [0.01, 0.02, 0.1]) {
      const long = evaluate({ returns: Array(512).fill(value), annualizationSessions: 252, mode });
      assert.equal(long.std, 0);
      assert.equal(long.informationRatio, null);
    }
  }
});

test("rejects bad shapes, invalid returns, -100%, nonfinite values and unknown conventions", () => {
  const good = { returns: [0.02, -0.01], annualizationSessions: 252, mode: "product" };
  for (const returns of [[0.01], Array(513).fill(0), [0, -1], [0, NaN], [0, Infinity], [0, 11], ["0", 0]]) {
    assert.throws(() => evaluate({ ...good, returns }));
  }
  for (const annualizationSessions of [0, -1, 366, 2.5, Infinity, "252"]) {
    assert.throws(() => evaluate({ ...good, annualizationSessions }));
  }
  assert.throws(() => evaluate({ ...good, mode: "magic" }));
  assert.throws(() => evaluate(null));
});

test("large compound growth fails closed instead of emitting Infinity/NaN", () => {
  assert.throws(
    () => evaluate({ returns: Array(512).fill(10), annualizationSessions: 252, mode: "product" }),
    /underflow\/overflow/,
  );
});

test("same input is byte-for-byte reproducible and never claims an observed source", () => {
  const input = { returns: [0.001, -0.002, 0.003, 0.004], annualizationSessions: 238, mode: "product" };
  const a = evaluate(input);
  assert.deepEqual(a, evaluate(input));
  assert.equal(a.runtime, "liOS_adapted_formula");
  assert.match(a.caveats.join(" "), /not observed data/i);
});
