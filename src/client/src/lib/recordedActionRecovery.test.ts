import assert from "node:assert/strict";
import test from "node:test";
import { inspectRecordedActionRecovery } from "./recordedActionRecovery";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";

const R = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
function event(type: string, fields: Record<string, unknown> = {}, requestId = R): ConversationRuntimeEvent {
  return { type, at: "2026-10-28T03:00:00Z", requestId, ...fields } as unknown as ConversationRuntimeEvent;
}
function receipt(id: string, status: "failed" | "completed" | "cancelled", requestId = R): ConversationRuntimeEvent {
  return event("receipt", { receipt: { id, requestId, status } });
}

test("C08 retains exact denied, failed, skipped and unresolved tool outcomes after overall success", () => {
  const result = inspectRecordedActionRecovery([
    event("tool_start", { stepId: "a", label: "write", componentId: "external" }),
    event("tool_result", { stepId: "a", outcome: "denied", label: "write", summary: "", deterministic: false }),
    event("tool_result", { stepId: "b", outcome: "failed", label: "read", summary: "", deterministic: true }),
    event("tool_result", { stepId: "c", outcome: "skipped", label: "skip", summary: "", deterministic: true }),
    event("tool_result", { stepId: "d", label: "legacy", summary: "", deterministic: true }),
    event("tool_start", { stepId: "e", label: "unsettled", componentId: "external" }),
    event("done", { status: "completed" }),
  ], R);
  assert.deepEqual([
    result.deniedToolReports, result.failedToolReports, result.skippedToolReports,
    result.unconfirmedToolReports, result.unfinishedToolStarts, result.needsReconciliation,
  ], [1, 1, 1, 1, 1, true]);
});

test("C08 a newer start supersedes an earlier tool result, not vice versa", () => {
  const result = inspectRecordedActionRecovery([
    event("tool_result", { stepId: "a", outcome: "completed", label: "write", summary: "", deterministic: true }),
    event("tool_start", { stepId: "a", label: "write again", componentId: "external" }),
    event("tool_start", { stepId: "b", label: "read", componentId: "external" }),
    event("tool_result", { stepId: "b", outcome: "completed", label: "read", summary: "", deterministic: true }),
  ], R);
  assert.equal(result.unfinishedToolStarts, 1);
  assert.equal(result.unconfirmedToolReports, 0);
});

test("C08 rejects foreign runs and nested foreign receipts, deduplicates exact receipt IDs", () => {
  const id = "33333333-3333-4333-8333-333333333333";
  const result = inspectRecordedActionRecovery([
    receipt(id, "failed"), receipt(id, "failed"),
    receipt("44444444-4444-4444-8444-444444444444", "cancelled"),
    receipt("55555555-5555-4555-8555-555555555555", "failed", OTHER),
    event("tool_result", { stepId: "foreign", outcome: "denied", label: "foreign", summary: "" }, OTHER),
    event("receipt", { receipt: { id: "66666666-6666-4666-8666-666666666666", requestId: OTHER, status: "failed" } }),
  ], R);
  assert.equal(result.failedReceipts, 1);
  assert.equal(result.cancelledReceipts, 1);
  assert.equal(result.ignoredForeignReceipts, 1);
  assert.equal(result.deniedToolReports, 0);
  assert.equal(result.needsReconciliation, true);
  assert.equal(inspectRecordedActionRecovery([receipt(id, "failed")], null).needsReconciliation, false);
});

test("C08 only completed individual outcomes are quiet; overall completed alone proves nothing", () => {
  const complete = inspectRecordedActionRecovery([
    event("tool_start", { stepId: "a", label: "read", componentId: "local" }),
    event("tool_result", { stepId: "a", outcome: "completed", label: "read", summary: "" }),
    event("done", { status: "completed" }),
  ], R);
  assert.equal(complete.needsReconciliation, false);
  assert.equal(inspectRecordedActionRecovery([event("done", { status: "completed" })], R).needsReconciliation, false);
});
