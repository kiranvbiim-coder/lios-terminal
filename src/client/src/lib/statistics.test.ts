import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapMeanCI, permutationTestMeanDiff } from "./statistics";

test("seeded bootstrap preserves a constant population and replays finite-sample intervals", () => {
  assert.deepEqual(bootstrapMeanCI([7, 7, 7], 1000, 95, 42), { estimate: 7, ciLow: 7, ciHigh: 7 });
  const data = [1, 2, 4, 7, 8, 10, 12, 15];
  const result = bootstrapMeanCI(data, 2000, 95, 17);
  assert.equal(result.estimate, 7.375);
  assert.ok(result.ciLow <= result.estimate && result.ciHigh >= result.estimate);
  assert.deepEqual(bootstrapMeanCI(data, 2000, 95, 17), result);
});

test("permutation inference replays a recorded seed and handles a null comparison", () => {
  assert.equal(permutationTestMeanDiff([3, 3, 3], [3, 3, 3], 1000, 42).pValue, 1);
  const result = permutationTestMeanDiff([1, 2, 3, 4], [10, 11, 12, 13], 5000, 19);
  assert.equal(result.observedDifference, -9);
  assert.ok(Math.abs(result.pValue - 2 / 70) < 0.01, "Monte Carlo p-value reconciles the exact two-sided enumeration of 70 group allocations.");
  assert.deepEqual(permutationTestMeanDiff([1, 2, 3, 4], [10, 11, 12, 13], 5000, 19), result);
});
test("missing observations, nonfinite inputs and invalid seeds refuse rather than return zero inference", () => {
  assert.throws(() => bootstrapMeanCI([], 100, 95, 1));
  assert.throws(() => bootstrapMeanCI([1, Number.NaN], 100, 95, 1));
  assert.throws(() => bootstrapMeanCI([1, 2], 100, 100, 1));
  assert.throws(() => permutationTestMeanDiff([], [1, 2], 100, 1));
  assert.throws(() => permutationTestMeanDiff([1], [2], 0, 1));
  assert.throws(() => permutationTestMeanDiff([1], [2], 100, -1));
});
