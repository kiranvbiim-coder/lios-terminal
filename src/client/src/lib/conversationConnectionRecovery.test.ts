import test from "node:test";
import assert from "node:assert/strict";
import { conversationSendAvailability, unconfirmedRunRecoveryNotice } from "./conversationConnectionRecovery";

test("WS-61 offline blocks new sends without telling users private staged files were uploaded", () => {
  for (const state of ["ready", "connecting", "reconnecting", "failed"] as const) {
    const gate = conversationSendAvailability(false, state);
    assert.equal(gate.canSubmit, false);
    assert.match(gate.title, /offline/i);
    assert.match(gate.detail, /stay in this tab/);
    assert.match(gate.detail, /Nothing will send automatically/);
  }
});

test("WS-61 Home states require actual readiness, not only navigator online", () => {
  for (const state of ["idle", "connecting", "reconnecting", "pairing", "failed", "stopped"] as const) {
    const gate = conversationSendAvailability(true, state);
    assert.equal(gate.canSubmit, false, state);
    assert.match(gate.detail, /No action is replayed automatically/);
  }
  const ready = conversationSendAvailability(true, "ready");
  assert.equal(ready.canSubmit, true);
  assert.equal(ready.detail, "");
});

test("WS-61 ambiguous run outcome asks for review and never promises safe auto retry", () => {
  assert.match(unconfirmedRunRecoveryNotice(), /Check Chat and run activity before sending again/);
  assert.match(unconfirmedRunRecoveryNotice(), /may have received/);
  assert.match(unconfirmedRunRecoveryNotice(), /Nothing was retried automatically/);
});
