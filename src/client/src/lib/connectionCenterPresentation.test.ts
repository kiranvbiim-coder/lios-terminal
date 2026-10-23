import test from "node:test";
import assert from "node:assert/strict";
import { connectionRecoveryPresentation, isConnectorConnectable, summarizeConnectionCenter } from "./connectionCenterPresentation";

test("first entry remains available for empty, loading, failed and unusable connections without promoting configuration to verification", () => {
  const empty = summarizeConnectionCenter([]);
  assert.equal(empty.state, "unconfigured");
  assert.equal(empty.canEnterTerminal, true);
  for (const status of ["configured", "credential_configured"]) {
    const saved = summarizeConnectionCenter([{ status }]);
    assert.equal(saved.state, "configured");
    assert.equal(saved.verifiedCount, 0);
    assert.equal(saved.canEnterTerminal, true);
  }
  const failed = summarizeConnectionCenter(undefined, true);
  assert.equal(failed.state, "unavailable");
  assert.equal(failed.canEnterTerminal, true);
  assert.equal(summarizeConnectionCenter(undefined).state, "loading");
  const mixed = summarizeConnectionCenter([{ status: "healthy" }, { status: "configured" }, { status: "unreachable" }, { status: "disabled" }]);
  assert.equal(mixed.state, "attention");
  assert.equal(mixed.savedCount, 4);
  assert.equal(mixed.verifiedCount, 1);
  assert.equal(mixed.attentionCount, 2);
  assert.equal(mixed.canEnterTerminal, true);
  assert.equal(summarizeConnectionCenter([{ status: "live_verified" }, { status: "healthy" }]).state, "verified");
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
