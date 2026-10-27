import assert from "node:assert/strict";
import test from "node:test";
import { LIOS_FIRST_USE_CONTRACT, connectorIdFromRecoveryAction, firstUseConnectionState } from "./firstUseJourney";

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


test("guided recovery only maps exact connector ids, never generic or unsafe instructions", () => {
  assert.equal(connectorIdFromRecoveryAction("Connect fred"), "fred");
  assert.equal(connectorIdFromRecoveryAction("CONNECT twelve_data"), "twelve_data");
  assert.equal(connectorIdFromRecoveryAction("Connect a data source"), null);
  assert.equal(connectorIdFromRecoveryAction("Connect"), null);
  assert.equal(connectorIdFromRecoveryAction("Connect ../secret"), null);
  assert.equal(connectorIdFromRecoveryAction("Connect fred; delete"), null);
  assert.equal(connectorIdFromRecoveryAction("Connect https://other.example"), null);
  assert.equal(connectorIdFromRecoveryAction("Open Connection Center"), null);
});
