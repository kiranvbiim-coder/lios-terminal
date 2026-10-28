import test from "node:test";
import assert from "node:assert/strict";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { canPrepareProjectAutomationDraft, type ProjectAutomationDraftFacts } from "./projectAutomationDraftEligibility";
const R = "11111111-1111-4111-8111-111111111111";
const O = "22222222-2222-4222-8222-222222222222";
const event = (type: string, fields: Record<string, unknown> = {}, requestId = R) =>
  ({ type, requestId, at: "2026-10-28T04:00:00Z", ...fields }) as unknown as ConversationRuntimeEvent;
const completed = event("done", { status: "completed" });
const original: ProjectAutomationDraftFacts = {
  mode: "project", projectId: 12, chatId: 10, activeChatScope: "project",
  sourceRequestId: R, currentRequestId: R, hasSavedRequest: true, busy: false,
  events: [event("plan", { plan: { steps: [] } }), completed],
};

test("C07 offers read-only P9 draft review only for matching completed Project Chat request", () => {
  assert.equal(canPrepareProjectAutomationDraft(original), true);
  assert.equal(canPrepareProjectAutomationDraft({ ...original, sourceRequestId: O }), false);
  assert.equal(canPrepareProjectAutomationDraft({ ...original, currentRequestId: O }), false);
  assert.equal(canPrepareProjectAutomationDraft({ ...original, mode: "quick" }), false);
  assert.equal(canPrepareProjectAutomationDraft({ ...original, mode: "temporary" }), false);
  assert.equal(canPrepareProjectAutomationDraft({ ...original, projectId: null }), false);
  assert.equal(canPrepareProjectAutomationDraft({ ...original, chatId: null }), false);
  assert.equal(canPrepareProjectAutomationDraft({ ...original, activeChatScope: "quick" }), false);
  assert.equal(canPrepareProjectAutomationDraft({ ...original, hasSavedRequest: false }), false);
  assert.equal(canPrepareProjectAutomationDraft({ ...original, busy: true }), false);
});

test("C07 failed or unfinished work cannot become an enabled automation offer", () => {
  assert.equal(canPrepareProjectAutomationDraft({ ...original, events: [event("done", { status: "failed" })] }), false);
  assert.equal(canPrepareProjectAutomationDraft({ ...original, events: [event("tool_start", { stepId: "a", label: "write", componentId: "external" })] }), false);
  assert.equal(canPrepareProjectAutomationDraft({ ...original, events: [completed, event("error", { message: "error", code: "BAD" })] }), false);
  assert.equal(canPrepareProjectAutomationDraft({ ...original, events: [
    event("tool_start", { stepId: "a", label: "write", componentId: "external" }), completed,
  ] }), false);
  assert.equal(canPrepareProjectAutomationDraft({ ...original, events: [
    event("tool_result", { stepId: "a", label: "write", summary: "", outcome: "denied", deterministic: false }), completed,
  ] }), false);
  assert.equal(canPrepareProjectAutomationDraft({ ...original, events: [
    event("tool_result", { stepId: "a", label: "write", summary: "", outcome: "failed", deterministic: false }), completed,
  ] }), false);
});

test("C07 foreign run completions cannot authorize another current run", () => {
  const foreignDone = event("done", { status: "completed" }, O);
  assert.equal(canPrepareProjectAutomationDraft({ ...original, events: [foreignDone] }), false);
  assert.equal(canPrepareProjectAutomationDraft({ ...original, events: [
    completed, event("done", { status: "cancelled" }),
  ] }), false);
  assert.equal(canPrepareProjectAutomationDraft({ ...original, events: [
    event("tool_result", { stepId: "a", label: "read", summary: "", outcome: "completed", deterministic: true }),
    completed, foreignDone,
  ] }), true);
});
