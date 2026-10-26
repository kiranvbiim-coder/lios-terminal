import assert from "node:assert/strict";
import test from "node:test";
import { describeDeviceContinuity } from "./deviceContinuityTruth";
import type { GatewayState } from "./gateway/gatewayClient";

test("browser offline overrides a retained ready Gateway; reconnecting and unverified states remain distinct", () => {
  assert.equal(describeDeviceContinuity("ready", false).state, "offline");
  assert.equal(describeDeviceContinuity("ready", true).state, "online");
  for (const state of ["connecting", "reconnecting"] as GatewayState[]) {
    assert.equal(describeDeviceContinuity(state, true).state, "reconnecting");
    assert.equal(describeDeviceContinuity(state, false).state, "offline");
  }
  for (const state of ["idle", "pairing", "stopped", "failed"] as GatewayState[]) {
    assert.equal(describeDeviceContinuity(state, true).state, "unknown");
    assert.equal(describeDeviceContinuity(state, null).state, "unknown");
  }
});
