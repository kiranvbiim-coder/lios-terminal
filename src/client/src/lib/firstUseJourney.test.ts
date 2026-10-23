import assert from "node:assert/strict";
import test from "node:test";
import { FIRST_USE_UNIVERSAL_STARTERS, LIOS_FIRST_USE_CONTRACT, firstUseConnectionState, firstUseRecoveryDestination } from "./firstUseJourney";

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

test("WS-14 new users get universal topics before advanced finance without a wizard", () => {
  assert.equal(FIRST_USE_UNIVERSAL_STARTERS.length, 3);
  assert.deepEqual(FIRST_USE_UNIVERSAL_STARTERS.map(item => item.id), [
    "explain-any-topic",
    "plan-a-project",
    "explore-an-idea",
  ]);
  assert.ok(FIRST_USE_UNIVERSAL_STARTERS.every(item => item.prompt.includes("[") && item.prompt.includes("]")));
  assert.equal(LIOS_FIRST_USE_CONTRACT.primaryAction, "ask");
  assert.equal(LIOS_FIRST_USE_CONTRACT.connectionsRequiredToEnter, false);
  assert.match(LIOS_FIRST_USE_CONTRACT.optionalConnectionAction, /optional/i);
});

test("WS-14 examples do not claim access to private accounts or invent facts", () => {
  const samples = FIRST_USE_UNIVERSAL_STARTERS.map(item => item.prompt).join("\n");
  assert.match(samples, /needs verification/);
  assert.match(samples, /essential missing context/);
  assert.match(samples, /my approval/);
  assert.doesNotMatch(samples, /my bank|my account|my portfolio|my private data|live prices|guaranteed/);
});

test("WS-14 known missing-source and AI actions open optional Connections rather than execute arbitrary text", () => {
  for (const action of [
    "Connect",
    "Connect your source",
    "connect a data provider",
    "Open Connection Center",
    "Open Connections",
    "Configure AI",
    "configure AI provider",
    "Set up AI",
  ]) assert.equal(firstUseRecoveryDestination(action), "connections", action);
  for (const action of ["/delete all", "Run shell command", "Trade now", "", "Use another source", "Reconnect secret vault"]) {
    assert.equal(firstUseRecoveryDestination(action), "compose", action);
  }
});

test("WS-14 unknown recovery actions remain a staged editable composer draft", () => {
  assert.equal(firstUseRecoveryDestination("/analyze AAPL"), "compose");
  assert.equal(firstUseRecoveryDestination("  CONFIGURE AI for this task  "), "connections");
  assert.equal(LIOS_FIRST_USE_CONTRACT.recoveryPreservesTask, true);
});
