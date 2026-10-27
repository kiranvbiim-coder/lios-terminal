import test from "node:test";
import assert from "node:assert/strict";
import { resolveSpatialMotionBudget } from "./spatialMotionPolicy";

const allOn = {
  visualEnvironmentsEnabled: true, visualEnvironmentMotion: true,
  reducedMotion: false, lowResourceMode: false, softwareRendered: false,
};

test("Phase 2 decorative depth motion is disabled by default for quiet retail UX", () => {
  assert.equal(resolveSpatialMotionBudget({ ...allOn, visualEnvironmentsEnabled: false }), "still");
});

test("Phase 2 motion is never enabled on reduced motion, low GPU or software renderer", () => {
  assert.equal(resolveSpatialMotionBudget({ ...allOn, visualEnvironmentMotion: false }), "still");
  assert.equal(resolveSpatialMotionBudget({ ...allOn, reducedMotion: true }), "still");
  assert.equal(resolveSpatialMotionBudget({ ...allOn, lowResourceMode: true }), "still");
  assert.equal(resolveSpatialMotionBudget({ ...allOn, softwareRendered: true }), "still");
  assert.equal(resolveSpatialMotionBudget(allOn), "subtle");
});

test("Phase 2 motion budget has no access to or output for underlying research or permissions", () => {
  const budget = resolveSpatialMotionBudget(allOn);
  assert.equal(budget, "subtle");
  assert.equal(typeof budget, "string");
});
