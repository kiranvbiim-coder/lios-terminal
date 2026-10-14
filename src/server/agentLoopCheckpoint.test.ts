import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationContextEnvelope } from "@shared/conversationRuntime";
import {
  AgentCheckpointBindingMismatchError,
  MAX_AGENT_CHECKPOINT_BYTES,
  MAX_AGENT_CONTINUATION_BYTES,
  assertAgentCheckpointResumeCurrent,
  createAgentCheckpointSnapshot,
  parseAgentCheckpointSnapshot,
} from "./agent-checkpoint";
import { agentPlanSha256, type AgentLoopContinuationState, type AgentPlannedStep } from "./agentLoop";
import {
  NATIVE_AGENT_LOOP_ADAPTER_ID,
  AgentRestartCheckpointUnsafeError,
  boundAgentLoopContinuation,
  createNativeAgentLoopCheckpoint,
  nativeContinuationOf,
} from "./agentLoopCheckpoint";

const REQUEST_ID = "a1111111-1111-4111-8111-111111111111";
const OWNER = { userId: 7, projectId: 12, chatId: 34 };
const TOOLS = "b".repeat(64);
const POLICY = "c".repeat(64);
const ORIGINAL_OBJECTIVE = "Research the confirmed company evidence and produce a cited answer.";
const RESUME_BINDING = {
  role: "internal_analyst",
  objective: ORIGINAL_OBJECTIVE,
  budget: { maxSteps: 12, maxAiCalls: 6, maxRevisions: 2, maxDurationMs: 180_000 },
};

function context(): ConversationContextEnvelope {
  return {
    schemaVersion: "1",
    identity: { userId: 7, organizationId: 9, role: "internal_analyst" },
    project: { projectId: 12, name: "Sensitive project name", instructionIncluded: true, resourceRefs: ["project://12/file/private-model.xlsx"] },
    conversation: { chatId: 34, scope: "project", sourceScope: "auto", branchId: null },
    workspace: { sessionId: "desktop-session-private", view: "analysis", symbol: "AAPL" },
    active: { objectRefs: ["artifact:private-model"], selection: null },
  };
}

function state(overrides: Partial<AgentLoopContinuationState> = {}): AgentLoopContinuationState {
  const steps: AgentPlannedStep[] = [
    { id: "a", toolId: "t.quote", label: "Quote", input: { symbol: "SECRET-TICKER-INPUT" }, dependsOn: [] },
    { id: "b", toolId: "t.calc", label: "Calc", input: { window: 20 }, dependsOn: ["a"] },
  ];
  return {
    version: 1,
    planSha256: agentPlanSha256(steps),
    steps,
    segment: ["a", "b"],
    settled: [{ id: "a", toolId: "t.quote", label: "Quote", status: "completed", summary: "AAPL 190.10", deterministic: true, sourceRefs: ["src:quote"] }],
    counters: { aiCalls: 1, revisions: 0, executed: 1 },
    delegatedBudgetUsed: { maxSteps: 0, maxAiCalls: 0, maxRevisions: 0, maxDurationMs: 0 },
    ...overrides,
  };
}

function checkpoint(next = state()) {
  return createNativeAgentLoopCheckpoint({
    requestId: REQUEST_ID, owner: OWNER, context: context(), projectInstructions: "Only use permitted sources.", sourceMessageId: 123,
    state: next, toolSetSha256: TOOLS, policySha256: POLICY, resumeBinding: RESUME_BINDING,
  });
}

test("a native checkpoint carries the validated plan inputs inside the one binding hash, with no objective or authority fields", () => {
  const snapshot = checkpoint();
  assert.equal(snapshot.adapterId, NATIVE_AGENT_LOOP_ADAPTER_ID);
  assert.equal(snapshot.version, 2);
  assert.match(snapshot.resumeBinding?.objectiveSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.equal(snapshot.toolOutcome, "known_completed");
  assert.deepEqual(snapshot.steps.map((step) => `${step.stepId}:${step.status}:${step.attempts}`), ["a:completed:1", "b:pending:0"]);
  assert.deepEqual(snapshot.continuation?.steps[0]?.input, { symbol: "SECRET-TICKER-INPUT" });
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of ["goal", ORIGINAL_OBJECTIVE, "authorization", "grant", "lease", "approval", "Sensitive project name", "desktop-session-private", "private-model"]) {
    assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false, `snapshot leaked ${forbidden}`);
  }
  assert.deepEqual(parseAgentCheckpointSnapshot(JSON.parse(serialized)), snapshot);
  assert.equal(nativeContinuationOf(snapshot)?.counters.executed, 1);
});

test("credential-shaped native continuation cannot be persisted or marked restart-safe", () => {
  for (const unsafeInput of [
    { apiKey: "sk-1234567890abcdef1234567890abcdef" },
    { nested: { password: "ordinary-password-value" } },
    { authorization: "not-a-token-shaped-value" },
  ]) {
    const next = state();
    next.steps[1] = { ...next.steps[1]!, input: unsafeInput };
    next.planSha256 = agentPlanSha256(next.steps);
    assert.throws(
      () => checkpoint(next),
      (error: unknown) => error instanceof AgentRestartCheckpointUnsafeError,
    );
  }
});

test("tampering with any continuation field breaks the binding or the plan/steps consistency", () => {
  const snapshot = checkpoint();
  interface Tamperable {
    continuation?: {
      steps: Array<{ input: unknown }>;
      counters: { aiCalls: number };
      settled: Array<{ summary: string }>;
      segment: string[];
      delegatedBudgetUsed: { maxSteps: number };
    };
  }
  const mutate = (change: (value: Tamperable) => void): unknown => {
    const copy = JSON.parse(JSON.stringify(snapshot)) as Tamperable;
    change(copy);
    return copy;
  };
  for (const tampered of [
    mutate((value) => { value.continuation!.steps[1]!.input = { window: 999 }; }),
    mutate((value) => { value.continuation!.counters.aiCalls = 0; }),
    mutate((value) => { value.continuation!.settled[0]!.summary = "AAPL 1.00"; }),
    mutate((value) => { value.continuation!.segment = ["b"]; }),
    mutate((value) => { value.continuation!.delegatedBudgetUsed.maxSteps = 3; }),
    mutate((value) => { delete value.continuation; }),
  ]) {
    assert.throws(() => parseAgentCheckpointSnapshot(tampered), (error: unknown) => error instanceof Error);
  }
});

test("a continuation that references an unknown step, or whose steps do not match its checkpoint steps, is rejected", () => {
  const base = checkpoint();
  assert.throws(() => createAgentCheckpointSnapshot({
    requestId: REQUEST_ID, owner: OWNER, planSha256: base.planSha256, steps: base.steps, toolSetSha256: TOOLS, policySha256: POLICY,
    context: context(), projectInstructions: "Only use permitted sources.", sourceMessageId: 123,
    adapterId: NATIVE_AGENT_LOOP_ADAPTER_ID, checkpointRef: base.checkpointRef, toolOutcome: "none_pending",
    continuation: { ...base.continuation!, segment: ["a", "ghost"] },
  }), AgentCheckpointBindingMismatchError);
  assert.throws(() => createAgentCheckpointSnapshot({
    requestId: REQUEST_ID, owner: OWNER, planSha256: base.planSha256, steps: base.steps.map((step) => ({ ...step, status: "pending" as const, attempts: 0 })),
    toolSetSha256: TOOLS, policySha256: POLICY, context: context(), projectInstructions: "Only use permitted sources.", sourceMessageId: 123,
    adapterId: NATIVE_AGENT_LOOP_ADAPTER_ID, checkpointRef: base.checkpointRef, toolOutcome: "none_pending", continuation: base.continuation!,
  }), AgentCheckpointBindingMismatchError);
  assert.throws(() => createAgentCheckpointSnapshot({
    requestId: REQUEST_ID, owner: OWNER, planSha256: "d".repeat(64), steps: base.steps, toolSetSha256: TOOLS, policySha256: POLICY,
    context: context(), projectInstructions: "Only use permitted sources.", sourceMessageId: 123,
    adapterId: NATIVE_AGENT_LOOP_ADAPTER_ID, checkpointRef: base.checkpointRef, toolOutcome: "none_pending", continuation: base.continuation!,
  }), AgentCheckpointBindingMismatchError);
});

test("persistence bounds: summaries and source refs are truncated and the size bound still applies", () => {
  const long = "x".repeat(10_000);
  const bounded = boundAgentLoopContinuation(state({
    settled: [{ id: "a", toolId: "t.quote", label: "Quote", status: "completed", summary: long, deterministic: true, sourceRefs: Array.from({ length: 40 }, () => long) }],
  }));
  assert.equal(bounded.settled[0]!.summary.length, 2_000);
  assert.equal(bounded.settled[0]!.sourceRefs.length, 10);
  assert.equal(bounded.settled[0]!.sourceRefs[0]!.length, 300);
  assert.equal(boundAgentLoopContinuation(state({ settled: [{ id: "a", toolId: "t.quote", label: "Quote", status: "completed", summary: "ok", deterministic: true, sourceRefs: [] }, { id: "b", toolId: "t.calc", label: "Calc", status: "failed", summary: "no", deterministic: false, sourceRefs: [] }] })).settled.length, 2);
  assert.ok(MAX_AGENT_CONTINUATION_BYTES > MAX_AGENT_CHECKPOINT_BYTES);

  const big: AgentPlannedStep[] = Array.from({ length: 50 }, (_, index) => ({ id: `s${index}`, toolId: "t.quote", label: "Big", input: { blob: "y".repeat(7_900) }, dependsOn: [] }));
  const fits = checkpoint(state({ steps: big, planSha256: agentPlanSha256(big), segment: big.map((step) => step.id), settled: [] }));
  assert.ok(Buffer.byteLength(JSON.stringify(fits), "utf8") <= MAX_AGENT_CHECKPOINT_BYTES + MAX_AGENT_CONTINUATION_BYTES);
});

test("explicit resume validation covers the continuation snapshot like any L6 checkpoint (drift refuses)", () => {
  const snapshot = checkpoint();
  const current = {
    snapshot, requestId: REQUEST_ID, owner: OWNER, planSha256: snapshot.planSha256, toolSetSha256: TOOLS, policySha256: POLICY,
    context: context(), projectInstructions: "Only use permitted sources.", sourceMessageId: 123,
    adapterId: NATIVE_AGENT_LOOP_ADAPTER_ID,
    resumeBinding: RESUME_BINDING,
  };
  assert.equal(assertAgentCheckpointResumeCurrent(current).bindingSha256, snapshot.bindingSha256);
  for (const changed of [
    { ...RESUME_BINDING, role: "viewer" },
    { ...RESUME_BINDING, objective: "A different initiating message." },
    { ...RESUME_BINDING, budget: { ...RESUME_BINDING.budget, maxSteps: 13 } },
  ]) {
    assert.throws(
      () => assertAgentCheckpointResumeCurrent({ ...current, resumeBinding: changed }),
      AgentCheckpointBindingMismatchError,
    );
  }
  assert.throws(
    () => assertAgentCheckpointResumeCurrent({ ...current, resumeBinding: undefined }),
    AgentCheckpointBindingMismatchError,
  );
  assert.throws(() => assertAgentCheckpointResumeCurrent({ ...current, toolSetSha256: "e".repeat(64) }), AgentCheckpointBindingMismatchError);
  assert.throws(() => assertAgentCheckpointResumeCurrent({ ...current, policySha256: "e".repeat(64) }), AgentCheckpointBindingMismatchError);
  assert.throws(() => assertAgentCheckpointResumeCurrent({ ...current, planSha256: "e".repeat(64) }), AgentCheckpointBindingMismatchError);
  assert.throws(() => assertAgentCheckpointResumeCurrent({ ...current, owner: { ...OWNER, chatId: 35 } }), AgentCheckpointBindingMismatchError);
  const drifted = context();
  drifted.workspace.symbol = "MSFT";
  assert.throws(() => assertAgentCheckpointResumeCurrent({ ...current, context: drifted }), AgentCheckpointBindingMismatchError);
  assert.throws(() => assertAgentCheckpointResumeCurrent({ ...current, projectInstructions: "A different instruction." }), AgentCheckpointBindingMismatchError);
  assert.throws(() => assertAgentCheckpointResumeCurrent({ ...current, adapterId: "lios.other" }), AgentCheckpointBindingMismatchError);
});

test("an older native checkpoint remains readable but cannot restart without original runtime binding", () => {
  const current = checkpoint();
  const legacy = createAgentCheckpointSnapshot({
    requestId: REQUEST_ID, owner: OWNER, context: context(), projectInstructions: "Only use permitted sources.",
    sourceMessageId: 123, planSha256: current.planSha256, steps: current.steps,
    toolSetSha256: TOOLS, policySha256: POLICY, adapterId: NATIVE_AGENT_LOOP_ADAPTER_ID,
    checkpointRef: current.checkpointRef, toolOutcome: current.toolOutcome,
    continuation: current.continuation,
  });
  assert.equal(legacy.version, 1);
  assert.equal(parseAgentCheckpointSnapshot(JSON.parse(JSON.stringify(legacy))).version, 1);
  assert.equal(nativeContinuationOf(legacy), null);
  assert.throws(
    () => assertAgentCheckpointResumeCurrent({
      snapshot: legacy, requestId: REQUEST_ID, owner: OWNER, context: context(),
      projectInstructions: "Only use permitted sources.", sourceMessageId: 123,
      planSha256: legacy.planSha256, toolSetSha256: TOOLS, policySha256: POLICY,
      adapterId: NATIVE_AGENT_LOOP_ADAPTER_ID, resumeBinding: RESUME_BINDING,
    }),
    AgentCheckpointBindingMismatchError,
  );
});

test("an adapter-only or outcome-unknown snapshot has no native continuation", () => {
  const adapterOnly = createAgentCheckpointSnapshot({
    requestId: REQUEST_ID, owner: OWNER, planSha256: "a".repeat(64), steps: [], toolSetSha256: TOOLS, policySha256: POLICY,
    context: context(), projectInstructions: "Only use permitted sources.", sourceMessageId: 123,
    adapterId: "lios.native", checkpointRef: "agent-checkpoint:opaque", toolOutcome: "none_pending",
  });
  assert.equal(nativeContinuationOf(adapterOnly), null);
  assert.equal(nativeContinuationOf(null), null);
});
