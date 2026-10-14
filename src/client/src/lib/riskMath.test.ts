import test from "node:test";
import assert from "node:assert/strict";
import { kellyAllocation } from "./riskMath";

test("Kelly allocation matches the canonical binary-payoff formula", () => {
  const result = kellyAllocation({ winProbability: 0.55, averageWinR: 2, averageLossR: 1 });
  assert.ok(result);
  assert.ok(Math.abs(result.fraction - 0.325) < 1e-12);
  assert.equal(result.payoffRatio, 2);
});

test("negative edge floors allocation at zero", () => {
  const result = kellyAllocation({ winProbability: 0.3, averageWinR: 1, averageLossR: 1 });
  assert.equal(result?.fraction, 0);
});

test("invalid probability and payoff inputs fail closed", () => {
  assert.equal(kellyAllocation({ winProbability: 1.1, averageWinR: 2, averageLossR: 1 }), null);
  assert.equal(kellyAllocation({ winProbability: 0.5, averageWinR: 2, averageLossR: 0 }), null);
  assert.equal(kellyAllocation({ winProbability: 0.5, averageWinR: Number.NaN, averageLossR: 1 }), null);
});
