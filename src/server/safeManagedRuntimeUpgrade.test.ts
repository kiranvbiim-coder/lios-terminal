import assert from "node:assert/strict";
import test from "node:test";
import * as runtimeUpgrade from "./safeManagedRuntimeUpgrade";

test("SI-07.10 exposes one dedicated safe managed-runtime upgrade authority", () => {
  assert.equal(typeof runtimeUpgrade.upgradeManagedRuntimeSafely, "function");
});
