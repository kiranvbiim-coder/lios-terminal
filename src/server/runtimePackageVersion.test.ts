import assert from "node:assert/strict";
import test from "node:test";
import { satisfiesRuntimePackageVersion as satisfies } from "./runtimePackageVersion";

test("matches signed manifest's exact, major-series and comparator constraints", () => {
  for (const [actual, spec] of [
    ["2.3.4", "2.x"], ["2.0.0", "2.x"], ["2.2.3", "<3.0"],
    ["2.2.3", ">=2,<3"], ["2.3", ">=2,<=2.3"], ["2.0", "==2.0"],
    ["1.14.1", "1.14.1"], ["2.3.1", "!=3.0"], ["3.0", ">2.9"],
  ]) assert.equal(satisfies(actual, spec), true, `${actual} should satisfy ${spec}`);
});

test("rejects major-version drift, out-of-range values and unknown syntax", () => {
  for (const [actual, spec] of [
    ["3.0", "2.x"], ["1.26.0", "2.x"], ["3.0.0", "<3.0"],
    ["2.99", ">=3"], ["2.4", "<=2.3"], ["2.0", "!=2.0"],
    ["2.3.1", "2.3.0"], ["2.3.0rc1", "<3.0"], ["NaN", "2.x"],
    ["2.3.1", "not-a-version"], ["2.3.1", ">=2,<=3; echo pwned"],
    ["2.3.1", ">=2, <3"], ["2.3.1", ""],
  ]) assert.equal(satisfies(actual, spec), false, `${actual} must not satisfy ${spec}`);
});

test("different precision numeric comparisons remain deterministic", () => {
  assert.equal(satisfies("2.0.0", ">=2"), true);
  assert.equal(satisfies("3.0.0", "<3"), false);
  assert.equal(satisfies("2.10", ">2.9"), true);
  assert.equal(satisfies("2.9", "<2.10"), true);
});
