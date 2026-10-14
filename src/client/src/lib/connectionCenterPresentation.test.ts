import test from "node:test";
import assert from "node:assert/strict";
import { connectionRecoveryPresentation, isConnectorConnectable, summarizeConnectionCenter } from "./connectionCenterPresentation";

test("allows entering the terminal before any connection is saved", () => {
  const summary = summarizeConnectionCenter(0, 12);

  assert.equal(summary.canEnterTerminal, true);
  assert.equal(summary.statusLabel, "Ready without setup");
  assert.equal(summary.ctaLabel, "Continue to LiOS");
  assert.match(summary.statusDetail, /Connect data or AI only when a task needs it/);
});

test("marks a connected environment as ready for the terminal", () => {
  const summary = summarizeConnectionCenter(2, 10);

  assert.equal(summary.canEnterTerminal, true);
  assert.equal(summary.statusLabel, "Sources ready");
  assert.equal(summary.ctaLabel, "Continue to LiOS");
});


test("connection recovery actions are concise and state-aware", () => {
  assert.deepEqual(connectionRecoveryPresentation("healthy"), {
    needsAttention: false,
    testLabel: "Test",
    editLabel: "Edit",
  });
  assert.deepEqual(connectionRecoveryPresentation("credential_configured"), {
    needsAttention: false,
    testLabel: "Verify",
    editLabel: "Edit",
  });
  assert.deepEqual(connectionRecoveryPresentation("degraded"), {
    needsAttention: true,
    testLabel: "Retry",
    editLabel: "Fix",
  });
  assert.deepEqual(connectionRecoveryPresentation("invalid"), {
    needsAttention: true,
    testLabel: "Retry",
    editLabel: "Fix",
  });
});


test("catalog-only connectors stay discoverable without being connectable", () => {
  assert.equal(isConnectorConnectable({ adapterImplemented: true }), true);
  assert.equal(isConnectorConnectable({}), true);
  assert.equal(isConnectorConnectable({ adapterImplemented: false }), false);
});
