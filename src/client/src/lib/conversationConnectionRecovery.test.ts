import test from "node:test";
import assert from "node:assert/strict";
import { conversationSendAvailability } from "./conversationConnectionRecovery";
import type { GatewayState } from "./gateway/gatewayClient";

test("new work needs both browser connectivity and an authenticated ready Home", () => {
  for (const state of ["idle", "connecting", "reconnecting", "pairing", "failed", "stopped"] as GatewayState[]) {
    assert.equal(conversationSendAvailability(true, state).canSubmit, false, state);
    assert.equal(conversationSendAvailability(false, state).canSubmit, false, state);
  }
  assert.equal(conversationSendAvailability(false, "ready").canSubmit, false);
  assert.equal(conversationSendAvailability(true, "ready").canSubmit, true);
});
