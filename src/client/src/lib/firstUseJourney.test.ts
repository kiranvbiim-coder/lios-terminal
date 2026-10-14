import assert from "node:assert/strict";
import test from "node:test";
import { LIOS_FIRST_USE_CONTRACT, firstUseConnectionState } from "./firstUseJourney";

test("LiOS first use keeps identity as the only entry gate", () => {
  assert.equal(LIOS_FIRST_USE_CONTRACT.identityIsOnlyEntryGate, true);
  assert.equal(LIOS_FIRST_USE_CONTRACT.connectionsRequiredToEnter, false);
  assert.equal(LIOS_FIRST_USE_CONTRACT.primaryAction, "ask");
  assert.equal(LIOS_FIRST_USE_CONTRACT.recoveryPreservesTask, true);
});

test("first-use connection state is informative rather than gating", () => {
  assert.equal(firstUseConnectionState(0), "unconfigured");
  assert.equal(firstUseConnectionState(-1), "unconfigured");
  assert.equal(firstUseConnectionState(1), "connected");
  assert.equal(firstUseConnectionState(4), "connected");
  assert.equal(LIOS_FIRST_USE_CONTRACT.continueAction, "Continue to LiOS");
});
