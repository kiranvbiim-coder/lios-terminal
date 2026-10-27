import test from "node:test";
import assert from "node:assert/strict";
import { canRetryHomeConnection, conversationSendAvailability, unconfirmedRunRecoveryNotice } from "./conversationConnectionRecovery";
import type { GatewayState } from "./gateway/gatewayClient";

test("new work needs both browser connectivity and an authenticated ready Home", () => {
  for (const state of ["idle", "connecting", "reconnecting", "pairing", "failed", "stopped"] as GatewayState[]) {
    assert.equal(conversationSendAvailability(true, state).canSubmit, false, state);
    assert.equal(conversationSendAvailability(false, state).canSubmit, false, state);
  }
  assert.equal(conversationSendAvailability(false, "ready").canSubmit, false);
  assert.equal(conversationSendAvailability(true, "ready").canSubmit, true);
});

test("a stopped or failed Home exposes manual recovery only while browser is online", () => {
  for (const state of ["failed", "stopped"] as GatewayState[]) {
    assert.equal(canRetryHomeConnection(true, state), true, state);
    assert.equal(canRetryHomeConnection(false, state), false, state);
    const unavailable = conversationSendAvailability(true, state);
    assert.equal(unavailable.canSubmit, false);
    assert.match(unavailable.detail, /Retry connection/);
    assert.match(unavailable.detail, /Nothing is resent automatically/);
    assert.match(unavailable.detail, /staged files remain/);
  }
  for (const state of ["idle", "connecting", "reconnecting", "pairing", "ready"] as GatewayState[]) {
    assert.equal(canRetryHomeConnection(true, state), false, state);
  }
});

test("connecting, pairing and offline never offer a false ready or automatic retry", () => {
  assert.match(conversationSendAvailability(true, "pairing").detail, /approval is still pending/);
  assert.match(conversationSendAvailability(true, "reconnecting").detail, /press Send/);
  const offline = conversationSendAvailability(false, "failed");
  assert.equal(offline.title, "You're offline");
  assert.equal(canRetryHomeConnection(false, "failed"), false);
  assert.match(offline.detail, /Nothing will send automatically/);
});

test("uncertain run delivery instructs user to inspect activity and never duplicates work", () => {
  const notice = unconfirmedRunRecoveryNotice();
  assert.match(notice, /Home may have received the earlier request/);
  assert.match(notice, /Nothing was retried automatically/);
});
