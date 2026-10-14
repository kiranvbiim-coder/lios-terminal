import assert from "node:assert/strict";
import test from "node:test";
import {
  SP02_DEFAULT_REQUEST,
  SP02_PACKAGED_CHECK_IDS,
  hasBoundedPlanEvidence,
  hasCompleteSp02CheckSet,
  hasPersistedReceiptEvidence,
  inspectApprovalLedger,
  inspectRecoveryLedger,
  type Sp02PackagedCheck,
} from "./sp02_packaged_contract";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function planEvent(requestId = REQUEST_ID) {
  return {
    type: "plan",
    requestId,
    at: "2026-10-05T00:00:00.000Z",
    plan: {
      schemaVersion: "1",
      requestId,
      intent: {},
      capabilities: [],
      steps: [{ id: "inspect" }, { id: "execute" }],
      budget: { maxSteps: 8, maxDurationMs: 90_000, maxAiCalls: 2 },
    },
  };
}

const KEY = `agent-tool:v1:${"a".repeat(64)}`;
const INPUT = "c".repeat(64);
const started = (toolCallId: string, seq: number, extra: Record<string, unknown> = {}) => ({
  kind: "tool_call_started", toolCallId, stepId: "write", toolId: "provider.write", inputSha256: INPUT, sideEffect: "external", seq, ...extra,
});

/** Attempt 1 proven no-effect in `write-call`, closed cancelled, then continued by the LINKED `write-call-r1` which commits once. */
function recoveryEvents() {
  return [
    { kind: "step_started", stepId: "write", seq: 0 },
    started("write-call", 1),
    { kind: "tool_call_dispatch_intent", toolCallId: "write-call", idempotencyKey: KEY, attempt: 1, seq: 2 },
    { kind: "tool_call_dispatch_no_effect", toolCallId: "write-call", idempotencyKey: KEY, attempt: 1, reconciliationRef: "provider:no-effect:first", seq: 3 },
    { kind: "tool_call_finished", toolCallId: "write-call", status: "cancelled", outputRef: null, seq: 4 },
    started("write-call-r1", 5, { resumesToolCallId: "write-call" }),
    { kind: "tool_call_waiting_approval", toolCallId: "write-call-r1", seq: 6 },
    { kind: "tool_call_resumed", toolCallId: "write-call-r1", approvalRef: "approval:second", seq: 7 },
    { kind: "tool_call_dispatch_intent", toolCallId: "write-call-r1", idempotencyKey: KEY, attempt: 1, seq: 8 },
    { kind: "tool_call_dispatch_committed", toolCallId: "write-call-r1", idempotencyKey: KEY, attempt: 1, commitRef: "provider:commit:one", seq: 9 },
    { kind: "tool_call_finished", toolCallId: "write-call-r1", status: "succeeded", outputRef: "provider:result:one", seq: 10 },
  ];
}

/** The earlier in-call retry shape (attempt 2 inside the same call) stays valid. */
function sameCallRecoveryEvents() {
  return [
    { kind: "step_started", stepId: "write", seq: 0 },
    started("write-call", 1),
    { kind: "tool_call_dispatch_intent", toolCallId: "write-call", idempotencyKey: KEY, attempt: 1, seq: 2 },
    { kind: "tool_call_dispatch_no_effect", toolCallId: "write-call", idempotencyKey: KEY, attempt: 1, reconciliationRef: "provider:no-effect:first", seq: 3 },
    { kind: "tool_call_dispatch_intent", toolCallId: "write-call", idempotencyKey: KEY, attempt: 2, seq: 4 },
    { kind: "tool_call_dispatch_committed", toolCallId: "write-call", idempotencyKey: KEY, attempt: 2, commitRef: "provider:commit:one", seq: 5 },
    { kind: "tool_call_finished", toolCallId: "write-call", status: "succeeded", outputRef: "provider:result:one", seq: 6 },
  ];
}


test("complete evidence still requires every check exactly once", () => {
  const checks: Sp02PackagedCheck[] = SP02_PACKAGED_CHECK_IDS.map((id) => ({ id, pass: true, detail: id }));
  assert.equal(hasCompleteSp02CheckSet(checks), true);
  assert.equal(hasCompleteSp02CheckSet(checks.slice(1)), false);
  assert.equal(hasCompleteSp02CheckSet(checks.map((check) => check.id === "sp02.receipt" ? { ...check, pass: false } : check)), false);
  assert.equal(hasCompleteSp02CheckSet([...checks.slice(0, -1), checks[0]!]), false);
});

test("prompt or page prose cannot satisfy bounded-plan evidence", () => {
  const echo = `${SP02_DEFAULT_REQUEST} Agent plan: bounded plan, 8 steps remaining.`;
  assert.equal(hasBoundedPlanEvidence(echo, REQUEST_ID), false);
  assert.equal(hasBoundedPlanEvidence({ text: echo, requestId: REQUEST_ID }, REQUEST_ID), false);
  assert.equal(hasBoundedPlanEvidence(planEvent("22222222-2222-4222-8222-222222222222"), REQUEST_ID), false);
  assert.equal(hasBoundedPlanEvidence({ ...planEvent(), plan: { ...planEvent().plan, steps: [{ id: "one" }] } }, REQUEST_ID), false);
  assert.equal(hasBoundedPlanEvidence(planEvent(), REQUEST_ID), true);
});

test("approval proof requires one exact waiting call and a later durable release", () => {
  const events = [
    { kind: "tool_call_waiting_approval", toolCallId: "call-1", seq: 3 },
    { kind: "tool_call_resumed", toolCallId: "call-1", approvalRef: "approval:one", seq: 4 },
  ];
  assert.deepEqual(inspectApprovalLedger(events), { toolCallId: "call-1", waitingSeq: 3, resumedSeq: 4 });
  assert.equal(inspectApprovalLedger([{ text: "approval continued the same requestId" }]), null);
  assert.equal(inspectApprovalLedger([{ ...events[0] }, { ...events[1], toolCallId: "call-2" }]), null);
  assert.equal(inspectApprovalLedger([...events, { ...events[0], toolCallId: "call-2", seq: 5 }]), null);
});

test("recovery proof is idempotency-key scoped across calls and requires the explicit resume link", () => {
  const events = recoveryEvents();
  const proof = inspectRecoveryLedger(events);
  assert.equal(proof?.durableCommitCount, 1);
  assert.equal(proof?.toolCallId, "write-call-r1");
  assert.equal(proof?.noEffectToolCallId, "write-call");
  assert.equal(proof?.noEffectAttempt, 1);
  assert.equal(proof?.committedAttempt, 1);
  // A retry inside one call remains a valid recovery shape.
  assert.equal(inspectRecoveryLedger(sameCallRecoveryEvents())?.committedAttempt, 2);

  assert.equal(inspectRecoveryLedger([{ text: "no duplicate; exactly once; replay-safe" }]), null, "prose");
  assert.equal(inspectRecoveryLedger(events.filter((event) => event.kind !== "tool_call_dispatch_no_effect")), null, "missing induction");
  assert.equal(inspectRecoveryLedger(events.filter((event) => !(event.kind === "tool_call_dispatch_intent" && event.toolCallId === "write-call-r1"))), null, "missing retry intent");
  assert.equal(inspectRecoveryLedger([...events, { ...events[9], seq: 11, commitRef: "provider:commit:two" }]), null, "duplicate commit");
  const otherKey = `agent-tool:v1:${"b".repeat(64)}`;
  assert.equal(inspectRecoveryLedger(events.map((event) => event.kind === "tool_call_dispatch_committed" ? { ...event, idempotencyKey: otherKey } : event)), null, "wrong key on the commit");
  assert.equal(inspectRecoveryLedger(events.map((event) => event.kind === "tool_call_dispatch_intent" && event.toolCallId === "write-call-r1" ? { ...event, idempotencyKey: otherKey } : event)), null, "wrong key on the retry intent");
  assert.equal(inspectRecoveryLedger(events.map((event) => event.kind === "tool_call_started" && event.toolCallId === "write-call-r1" ? { ...event, resumesToolCallId: undefined } : event)), null, "missing link");
  assert.equal(inspectRecoveryLedger(events.map((event) => event.kind === "tool_call_started" && event.toolCallId === "write-call-r1" ? { ...event, resumesToolCallId: "other-call" } : event)), null, "link to a call that is not the no-effect call");
  assert.equal(inspectRecoveryLedger(events.map((event) => event.kind === "tool_call_started" && event.toolCallId === "write-call-r1" ? { ...event, stepId: "other-step" } : event)), null, "link across steps");
  assert.equal(inspectRecoveryLedger(events.map((event) => event.kind === "tool_call_started" && event.toolCallId === "write-call-r1" ? { ...event, inputSha256: "f".repeat(64) } : event)), null, "link across different input");
  assert.equal(inspectRecoveryLedger(events.filter((event) => !(event.kind === "tool_call_finished" && event.toolCallId === "write-call"))), null, "linked call never finished cancelled");
  assert.equal(inspectRecoveryLedger(events.map((event) => event.kind === "tool_call_finished" && event.toolCallId === "write-call" ? { ...event, status: "failed" } : event)), null, "linked call not cancelled");
  assert.equal(inspectRecoveryLedger(events.map((event) => event.kind === "tool_call_finished" && event.toolCallId === "write-call-r1" ? { ...event, status: "failed" } : event)), null, "no later success");
  assert.equal(inspectRecoveryLedger([
    events[0], events[1], events[2],
    { ...events[3], seq: 3 },
    { ...events[9], toolCallId: "write-call", attempt: 1, seq: 4 },
    events[10],
  ]), null, "ordinary one-shot success");
});

test("persisted receipt proof is exact-run structured state, not text or a bare marker", () => {
  const events = [planEvent(), { type: "done", requestId: REQUEST_ID, status: "completed" }];
  assert.equal(hasPersistedReceiptEvidence(events, REQUEST_ID), true);
  assert.equal(hasPersistedReceiptEvidence([SP02_DEFAULT_REQUEST, "receipt completed"], REQUEST_ID), false);
  assert.equal(hasPersistedReceiptEvidence([planEvent(), { type: "done", requestId: REQUEST_ID, status: "cancelled" }], REQUEST_ID), false);
  assert.equal(hasPersistedReceiptEvidence([planEvent(), { type: "done", requestId: "22222222-2222-4222-8222-222222222222", status: "completed" }], REQUEST_ID), false);
});

