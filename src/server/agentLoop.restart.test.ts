import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ConversationContextEnvelope } from "@shared/conversationRuntime";
import { assertAgentCheckpointResumeCurrent } from "./agent-checkpoint";
import { createExecutionJournal } from "./exec/execution-journal";
import {
  createNativeAgentLoopCheckpoint,
  nativeContinuationOf,
} from "./agentLoopCheckpoint";
import {
  AgentPlanError,
  agentInputSha256,
  agentPlanSha256,
  resumeAgentLoopFromCheckpoint,
  runAgentLoop,
  type AgentLoopContinuationState,
  type AgentLoopDeps,
  type AgentLoopTool,
  type AgentPlannedStep,
} from "./agentLoop";
import {
  AgentRestartResumeRefusedError,
  boundAgentLoopContinuation,
  planAgentLoopReopen,
} from "./agentLoopCheckpoint";
import { deriveAgentToolIdempotencyKey } from "./exec/agent-idempotency";
import { assertAgentEventChain, sealAgentEvent, type AgentEventInput, type AgentRunEvent } from "./exec/agent-run-events";

const REQUEST_ID = "91111111-1111-4111-8111-111111111111";
const AT = "2026-10-05T00:00:00.000Z";
const tool = (id: string, decision: AgentLoopTool["decision"] = "allow"): AgentLoopTool => ({
  id, label: `Tool ${id}`, kind: "calculate", permissionClass: decision === "allow" ? "safe_auto" : "user_confirm", sideEffect: "none", decision,
});
const TOOLS = [tool("t.quote"), tool("t.calc"), tool("t.confirm", "confirm")];
const plan = (steps: unknown[]) => JSON.stringify({ steps });
const step = (id: string, toolId = "t.quote", extra: Record<string, unknown> = {}) => ({ id, toolId, label: `Run ${id}`, input: { symbol: "SAFE" }, dependsOn: [], ...extra });
const complete = (answer = "Done.") => JSON.stringify({ decision: "complete", answer });

interface RestartHarness {
  deps: AgentLoopDeps;
  prompts: string[];
  ran: string[];
  checkpoints: AgentLoopContinuationState[];
  ledger: AgentRunEvent[];
}

function harness(
  models: string[],
  options: {
    ledger?: AgentRunEvent[];
    invoke?: (step: AgentPlannedStep, signal: AbortSignal) => Promise<void>;
    signal?: AbortSignal;
    stop?: boolean;
    tools?: AgentLoopTool[];
  } = {},
): RestartHarness {
  const ledger = options.ledger ?? [];
  const prompts: string[] = [];
  const ran: string[] = [];
  const checkpoints: AgentLoopContinuationState[] = [];
  const queue = [...models];
  const signal = options.signal ?? new AbortController().signal;
  const deps: AgentLoopDeps = {
    goal: "Compare the quotes",
    tools: options.tools ?? TOOLS,
    budget: { maxSteps: 6, maxAiCalls: 5, maxRevisions: 1 },
    signal,
    callModel: async (call) => {
      prompts.push(call.user);
      const next = queue.shift();
      if (next === undefined) throw new Error("model called more often than scripted");
      return next;
    },
    invokeTool: async ({ step: planned }) => {
      ran.push(planned.id);
      await options.invoke?.(planned, signal);
      return { kind: "ok", summary: `result of ${planned.id}`, deterministic: true, sourceRefs: [`src:${planned.id}`] };
    },
    ledger: async (event: AgentEventInput) => {
      ledger.push(sealAgentEvent(ledger, event, AT, REQUEST_ID));
    },
    onPlan: async () => undefined,
    onStepStart: async () => undefined,
    onStepResult: async () => undefined,
    onRevise: async () => undefined,
    checkpoint: async (state) => { checkpoints.push(structuredClone(state)); },
    interruptOnAbort: () => options.stop === true,
  };
  return { deps, prompts, ran, checkpoints, ledger };
}

const toolFacts = (toolId: string) => toolId === "t.write" ? { sideEffect: "internal_write" as const, replaySafe: false } : { sideEffect: "none" as const, replaySafe: true };

test("checkpoints are written only at safe boundaries: after the validated plan and after each settled step", async () => {
  const h = harness([plan([step("a"), step("b", "t.calc", { dependsOn: ["a"] })]), complete()]);
  const outcome = await runAgentLoop(h.deps);
  assert.equal(outcome.status, "completed");
  assert.deepEqual(h.checkpoints.map((state) => state.settled.map((outcome) => `${outcome.id}:${outcome.status}`)), [
    [],
    ["a:completed"],
    ["a:completed", "b:completed"],
  ]);
  for (const state of h.checkpoints) {
    assert.equal(state.planSha256, agentPlanSha256(state.steps));
    assert.deepEqual(state.segment, ["a", "b"]);
    assert.equal(state.settled.some((outcome) => outcome.status === "approval_required"), false);
  }
  assert.equal(h.checkpoints[0]!.counters.aiCalls, 1);
  assert.equal(h.checkpoints[2]!.counters.executed, 2);
});

test("checkpoint resume re-resolves settled research under current rights without persisting observations", async () => {
  const first = harness([plan([step("research")]), complete()]);
  let firstReads = 0;
  first.deps.resolveReviewObservations = async ({ completedSteps }) => {
    firstReads += 1;
    assert.deepEqual(completedSteps.map((planned) => planned.id), ["research"]);
    return { text: "PRE-RESTART-PERMITTED-PASSAGE", sourceRefs: ["source:pre-restart"] };
  };
  await runAgentLoop(first.deps);
  assert.equal(firstReads, 1);
  const state = structuredClone(first.checkpoints.at(-1)!);
  assert.equal(JSON.stringify([boundAgentLoopContinuation(state), first.ledger]).includes("PRE-RESTART-PERMITTED-PASSAGE"), false);

  const second = harness([complete()], { ledger: first.ledger });
  let resumedReads = 0;
  second.deps.resolveReviewObservations = async ({ completedSteps }) => {
    resumedReads += 1;
    assert.deepEqual(completedSteps.map((planned) => planned.id), ["research"]);
    return { text: "POST-RESTART-CURRENT-RIGHTS-REVOKED", sourceRefs: [] };
  };
  const result = await resumeAgentLoopFromCheckpoint(second.deps, state, null);
  assert.equal(result.status, "completed");
  assert.equal(resumedReads, 1);
  assert.deepEqual(second.ran, [], "a completed read is not executed again to recover its original result");
  assert.equal(second.prompts.length, 1);
  assert.ok(second.prompts[0]!.includes("POST-RESTART-CURRENT-RIGHTS-REVOKED"));
  assert.equal(second.prompts[0]!.includes("PRE-RESTART-PERMITTED-PASSAGE"), false);
  assert.equal(JSON.stringify([result, second.checkpoints, second.ledger]).includes("POST-RESTART-CURRENT-RIGHTS-REVOKED"), false);
});

test("successful reviewed references persist through revised checkpoints without storing passages and old checkpoints remain resumable", async () => {
  const controller = new AbortController();
  const first = harness([
    plan([step("research")]),
    JSON.stringify({ decision: "revise", steps: [step("next", "t.calc")] }),
  ], {
    signal: controller.signal, stop: true,
    invoke: async (planned) => {
      if (planned.id === "next") {
        controller.abort();
        throw new DOMException("Stopped at revised step", "AbortError");
      }
    },
  });
  first.deps.resolveReviewObservations = async () => ({
    text: "EPHEMERAL-CHECKPOINT-REVIEW-PASSAGE", sourceRefs: ["source:reviewed-before-checkpoint"],
  });
  await assert.rejects(runAgentLoop(first.deps), { name: "AbortError" });
  const state = structuredClone(first.checkpoints.at(-1)!);
  assert.deepEqual(state.reviewedSourceRefs, ["source:reviewed-before-checkpoint"]);
  assert.deepEqual(boundAgentLoopContinuation(state).reviewedSourceRefs, state.reviewedSourceRefs);
  assert.equal(JSON.stringify(state).includes("EPHEMERAL-CHECKPOINT-REVIEW-PASSAGE"), false);
  const originalLedger = structuredClone(first.ledger);
  const reopen = planAgentLoopReopen({
    requestId: REQUEST_ID, events: originalLedger, continuation: boundAgentLoopContinuation(state), toolFacts,
  });
  const second = harness([complete()], { ledger: structuredClone(originalLedger) });
  second.deps.resolveReviewObservations = async ({ reviewedSourceRefs }) => {
    assert.deepEqual(reviewedSourceRefs, ["source:reviewed-before-checkpoint"]);
    return null;
  };
  const done = await resumeAgentLoopFromCheckpoint(second.deps, state, reopen);
  assert.deepEqual(done.reviewedSourceRefs, ["source:reviewed-before-checkpoint"]);
  assert.deepEqual(second.ran, ["next"]);
  assert.equal(JSON.stringify(second.prompts).includes("EPHEMERAL-CHECKPOINT-REVIEW-PASSAGE"), false);

  const legacy = structuredClone(state);
  delete legacy.reviewedSourceRefs;
  assert.equal(Object.hasOwn(boundAgentLoopContinuation(legacy), "reviewedSourceRefs"), false,
    "old checkpoints keep their original shape rather than gaining a hash-changing default");
  const legacyResume = harness([complete()], { ledger: structuredClone(originalLedger) });
  legacyResume.deps.resolveReviewObservations = async ({ reviewedSourceRefs }) => {
    assert.deepEqual(reviewedSourceRefs, []);
    return null;
  };
  const legacyDone = await resumeAgentLoopFromCheckpoint(legacyResume.deps, legacy, reopen);
  assert.deepEqual(legacyDone.reviewedSourceRefs, []);
});

test("an approval pause is not a checkpoint boundary and a settled denial/failure is", async () => {
  const h = harness([plan([step("c", "t.confirm")])]);
  const outcome = await runAgentLoop(h.deps);
  assert.equal(outcome.status, "awaiting_approval");
  assert.equal(h.checkpoints.length, 1, "only the validated plan was checkpointed");
  assert.equal(h.checkpoints[0]!.settled.length, 0);
});

test("a user Stop with a checkpoint writer leaves the in-flight step and call open and resume continues it without re-planning", async () => {
  const controller = new AbortController();
  const first = harness([plan([step("a"), step("b", "t.calc", { dependsOn: ["a"] })])], {
    signal: controller.signal,
    stop: true,
    invoke: async (planned) => {
      if (planned.id === "b") {
        controller.abort();
        throw new DOMException("Agent run cancelled.", "AbortError");
      }
    },
  });
  await assert.rejects(runAgentLoop(first.deps), { name: "AbortError" });
  assert.deepEqual(first.ran, ["a", "b"]);
  assert.equal(first.ledger.some((event) => event.kind === "step_finished" && event.stepId === "b"), false, "the stopped step stays open");
  assert.equal(first.ledger.some((event) => event.kind === "tool_call_finished" && event.toolCallId === "b-call"), false);

  const state = first.checkpoints.at(-1)!;
  assert.deepEqual(state.settled.map((outcome) => outcome.id), ["a"]);
  const continuation = boundAgentLoopContinuation(state);
  const reopen = planAgentLoopReopen({ requestId: REQUEST_ID, events: first.ledger, continuation, toolFacts });
  assert.deepEqual(reopen, { stepId: "b", supersedeToolCallId: "b-call", resumesToolCallId: "b-call", toolCallId: "b-call-r1" });

  const second = harness([complete("Quotes compared.")], { ledger: first.ledger });
  const outcome = await resumeAgentLoopFromCheckpoint(second.deps, state, reopen);
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.answer, "Quotes compared.");
  assert.deepEqual(second.ran, ["b"], "the settled step is not re-run and the stopped step runs once");
  assert.equal(second.prompts.length, 1, "no re-plan: the only model call is the inspection");
  assert.match(second.prompts[0]!, /result of a/);
  assert.equal(outcome.aiCalls, 2, "counters continue from the checkpoint");
  assert.doesNotThrow(() => assertAgentEventChain(second.ledger, REQUEST_ID));
  assert.equal(second.ledger.filter((event) => event.kind === "step_started" && event.stepId === "b").length, 1, "no second step_started");
  assert.ok(second.ledger.some((event) => event.kind === "tool_call_finished" && event.toolCallId === "b-call" && event.status === "cancelled"));
  assert.ok(second.ledger.some((event) => event.kind === "tool_call_started" && event.toolCallId === "b-call-r1" && event.stepId === "b"));
  const linked = second.ledger.find((event) => event.kind === "tool_call_started" && event.toolCallId === "b-call-r1");
  assert.equal(linked?.kind === "tool_call_started" && linked.resumesToolCallId, "b-call");
  assert.ok(second.ledger.some((event) => event.kind === "step_finished" && event.stepId === "b" && event.status === "completed"));
});

test("without interruptOnAbort an abort still terminalizes the call and step as cancelled", async () => {
  const controller = new AbortController();
  const h = harness([plan([step("a")])], {
    signal: controller.signal,
    stop: false,
    invoke: async () => {
      controller.abort();
      throw new DOMException("cancelled", "AbortError");
    },
  });
  await assert.rejects(runAgentLoop(h.deps), { name: "AbortError" });
  assert.ok(h.ledger.some((event) => event.kind === "tool_call_finished" && event.status === "cancelled"));
  assert.ok(h.ledger.some((event) => event.kind === "step_finished" && event.status === "cancelled"));
});

test("a confirm-class step interrupted while waiting is abandoned and re-pauses under a fresh call that needs its own approval", async () => {
  const first = harness([plan([step("c", "t.confirm")])]);
  const paused = await runAgentLoop(first.deps);
  assert.equal(paused.status, "awaiting_approval");
  assert.ok(first.ledger.some((event) => event.kind === "tool_call_waiting_approval" && event.toolCallId === "c-call"));

  const state = first.checkpoints.at(-1)!;
  const reopen = planAgentLoopReopen({ requestId: REQUEST_ID, events: first.ledger, continuation: boundAgentLoopContinuation(state), toolFacts });
  assert.deepEqual(reopen, { stepId: "c", supersedeToolCallId: "c-call", resumesToolCallId: "c-call", toolCallId: "c-call-r1" });

  const second = harness([], { ledger: first.ledger });
  const outcome = await resumeAgentLoopFromCheckpoint(second.deps, state, reopen);
  assert.equal(outcome.status, "awaiting_approval", "a resumed confirm-class step never self-authorizes");
  assert.equal(outcome.resume?.paused.toolCallId, "c-call-r1");
  assert.deepEqual(second.ran, [], "nothing executed");
  assert.equal(second.prompts.length, 0);
  assert.doesNotThrow(() => assertAgentEventChain(second.ledger, REQUEST_ID));
  assert.ok(second.ledger.some((event) => event.kind === "tool_call_finished" && event.toolCallId === "c-call" && event.status === "cancelled"));
});

test("resume from a checkpoint refuses a changed plan hash, an unavailable tool and a reserved input key", async () => {
  const base = harness([plan([step("a"), step("b")]), complete()]);
  await runAgentLoop(base.deps);
  const state = base.checkpoints[0]!;

  const tampered = structuredClone(state);
  tampered.steps[0]!.label = "Changed label";
  await assert.rejects(resumeAgentLoopFromCheckpoint(harness([complete()]).deps, tampered, null), AgentPlanError);

  await assert.rejects(
    resumeAgentLoopFromCheckpoint(harness([complete()], { tools: [tool("t.calc")] }).deps, state, null),
    /no longer available/,
  );

  const reserved = structuredClone(state);
  reserved.steps[0]!.input = { userId: 9 };
  reserved.planSha256 = agentPlanSha256(reserved.steps);
  await assert.rejects(resumeAgentLoopFromCheckpoint(harness([complete()]).deps, reserved, null), /reserved field/);

  await assert.rejects(resumeAgentLoopFromCheckpoint(harness([complete()]).deps, state, { stepId: "ghost", supersedeToolCallId: null, resumesToolCallId: null, toolCallId: "ghost-call" }), AgentPlanError);
});

function ledgerOf(events: AgentEventInput[]): AgentRunEvent[] {
  const sealed: AgentRunEvent[] = [];
  for (const event of events) sealed.push(sealAgentEvent(sealed, event, AT, REQUEST_ID));
  return sealed;
}

function continuationOf(settledIds: string[], stepIds = ["a", "b"]) {
  const steps = stepIds.map((id) => ({ id, toolId: id === "w" ? "t.write" : "t.quote", label: `Run ${id}`, input: { symbol: "SAFE" }, dependsOn: [] as string[] }));
  return boundAgentLoopContinuation({
    version: 1,
    planSha256: agentPlanSha256(steps),
    steps,
    segment: stepIds,
    settled: settledIds.map((id) => ({ id, toolId: "t.quote", label: `Run ${id}`, status: "completed" as const, summary: "ok", deterministic: true, sourceRefs: [] })),
    counters: { aiCalls: 1, revisions: 0, executed: settledIds.length },
  });
}

const started = (stepId: string, toolId = "t.quote", extra: Partial<Extract<AgentEventInput, { kind: "tool_call_started" }>> = {}): AgentEventInput[] => [
  { kind: "step_started", stepId },
  {
    kind: "tool_call_started", toolCallId: `${stepId}-call`, stepId, toolId, inputSha256: agentInputSha256({ symbol: "SAFE" }),
    decision: "allow", permissionClass: "safe_auto", sideEffect: "none", ...extra,
  },
];
const finished = (stepId: string): AgentEventInput[] => [
  { kind: "tool_call_finished", toolCallId: `${stepId}-call`, status: "succeeded", outputRef: "tool-result:abc" },
  { kind: "step_finished", stepId, status: "completed" },
];

test("reopen planning: a ledger that is exactly at the checkpoint needs no reopen, and a ledger ahead of it is stale", () => {
  const atCheckpoint = ledgerOf([...started("a"), ...finished("a")]);
  assert.equal(planAgentLoopReopen({ requestId: REQUEST_ID, events: atCheckpoint, continuation: continuationOf(["a"]), toolFacts }), null);
  assert.throws(
    () => planAgentLoopReopen({ requestId: REQUEST_ID, events: atCheckpoint, continuation: continuationOf([]), toolFacts }),
    (error: unknown) => error instanceof AgentRestartResumeRefusedError && error.code === "checkpoint_stale",
  );
  const unknownStep = ledgerOf([...started("zzz")]);
  assert.throws(
    () => planAgentLoopReopen({ requestId: REQUEST_ID, events: unknownStep, continuation: continuationOf([]), toolFacts }),
    (error: unknown) => error instanceof AgentRestartResumeRefusedError && error.code === "checkpoint_stale",
  );
});

test("restart after abandoning a no-effect call preserves linkage without closing it twice", async () => {
  const key = deriveAgentToolIdempotencyKey({
    requestId: REQUEST_ID, stepId: "a", toolId: "t.quote", inputSha256: agentInputSha256({ symbol: "SAFE" }),
  });
  const ledger = ledgerOf([
    ...started("a", "t.quote", { sideEffect: "external", decision: "confirm", permissionClass: "user_confirm" }),
    { kind: "tool_call_waiting_approval", toolCallId: "a-call" },
    { kind: "tool_call_resumed", toolCallId: "a-call", approvalRef: "approval:one" },
    { kind: "tool_call_dispatch_intent", toolCallId: "a-call", idempotencyKey: key, attempt: 1 },
    { kind: "tool_call_dispatch_no_effect", toolCallId: "a-call", idempotencyKey: key, attempt: 1, reconciliationRef: "provider:no-effect:one" },
    // The process stopped after this durable event but before the replacement call was started.
    { kind: "tool_call_finished", toolCallId: "a-call", status: "cancelled", outputRef: null },
  ]);
  const continuation = continuationOf([], ["a"]);
  const reopen = planAgentLoopReopen({
    requestId: REQUEST_ID, events: ledger, continuation,
    toolFacts: () => ({ sideEffect: "external", replaySafe: false }),
  });
  const next = harness([], { ledger, tools: [{ ...tool("t.quote", "confirm"), sideEffect: "external" }] });
  const result = await resumeAgentLoopFromCheckpoint(
    next.deps, { ...continuation, planSha256: agentPlanSha256(continuation.steps) }, reopen,
  );
  assert.equal(result.status, "awaiting_approval");
  assert.deepEqual(next.ran, [], "a new approval is still required");
  assert.equal(ledger.filter((event) => event.kind === "tool_call_finished" && event.toolCallId === "a-call").length, 1);
  const resumed = ledger.find((event) => event.kind === "tool_call_started" && event.toolCallId === "a-call-r1");
  assert.equal(resumed?.kind === "tool_call_started" && resumed.resumesToolCallId, "a-call");
  for (const event of [
    { kind: "tool_call_resumed", toolCallId: "a-call-r1", approvalRef: "approval:two" },
    { kind: "tool_call_dispatch_intent", toolCallId: "a-call-r1", idempotencyKey: key, attempt: 1 },
    { kind: "tool_call_dispatch_committed", toolCallId: "a-call-r1", idempotencyKey: key, attempt: 1, commitRef: "provider:commit:one" },
  ] satisfies AgentEventInput[]) {
    ledger.push(sealAgentEvent(ledger, event, AT, REQUEST_ID));
  }
  assertAgentEventChain(ledger, REQUEST_ID);
});

test("reopen planning refuses outcome-unknown, committed-but-unfinished and non-replay-safe interrupted work", () => {
  const externalStarted = (stepId: string): AgentEventInput[] => started(stepId, "t.quote", { sideEffect: "external", decision: "confirm", permissionClass: "user_confirm" });
  const derive = (stepId: string) => `agent-tool:v1:${deriveKeyHex(stepId)}`;

  const unknown = ledgerOf([
    ...externalStarted("a"),
    { kind: "tool_call_waiting_approval", toolCallId: "a-call" },
    { kind: "tool_call_resumed", toolCallId: "a-call", approvalRef: "approval:one" },
    { kind: "tool_call_dispatch_intent", toolCallId: "a-call", idempotencyKey: derive("a"), attempt: 1 },
  ]);
  assert.throws(
    () => planAgentLoopReopen({ requestId: REQUEST_ID, events: unknown, continuation: continuationOf([]), toolFacts }),
    (error: unknown) => error instanceof AgentRestartResumeRefusedError && error.code === "reconciliation_required",
  );

  const committed = ledgerOf([
    ...externalStarted("a"),
    { kind: "tool_call_waiting_approval", toolCallId: "a-call" },
    { kind: "tool_call_resumed", toolCallId: "a-call", approvalRef: "approval:one" },
    { kind: "tool_call_dispatch_intent", toolCallId: "a-call", idempotencyKey: derive("a"), attempt: 1 },
    { kind: "tool_call_dispatch_committed", toolCallId: "a-call", idempotencyKey: derive("a"), attempt: 1, commitRef: "provider:commit:one" },
  ]);
  assert.throws(
    () => planAgentLoopReopen({ requestId: REQUEST_ID, events: committed, continuation: continuationOf([]), toolFacts }),
    (error: unknown) => error instanceof AgentRestartResumeRefusedError && error.code === "reconciliation_required",
  );

  const noEffect = ledgerOf([
    ...externalStarted("a"),
    { kind: "tool_call_waiting_approval", toolCallId: "a-call" },
    { kind: "tool_call_resumed", toolCallId: "a-call", approvalRef: "approval:one" },
    { kind: "tool_call_dispatch_intent", toolCallId: "a-call", idempotencyKey: derive("a"), attempt: 1 },
    { kind: "tool_call_dispatch_no_effect", toolCallId: "a-call", idempotencyKey: derive("a"), attempt: 1, reconciliationRef: "provider:no-effect:one" },
  ]);
  assert.deepEqual(
    planAgentLoopReopen({ requestId: REQUEST_ID, events: noEffect, continuation: continuationOf([]), toolFacts }),
    { stepId: "a", supersedeToolCallId: "a-call", resumesToolCallId: "a-call", toolCallId: "a-call-r1" },
    "a proven no-effect attempt may continue under a fresh call, with the same derived idempotency key",
  );

  const writeInFlight = ledgerOf(started("w", "t.write"));
  assert.throws(
    () => planAgentLoopReopen({ requestId: REQUEST_ID, events: writeInFlight, continuation: continuationOf([], ["w"]), toolFacts }),
    (error: unknown) => error instanceof AgentRestartResumeRefusedError && error.code === "not_replay_safe",
  );

  const unavailable = ledgerOf(started("a"));
  assert.throws(
    () => planAgentLoopReopen({ requestId: REQUEST_ID, events: unavailable, continuation: continuationOf([]), toolFacts: () => null }),
    (error: unknown) => error instanceof AgentRestartResumeRefusedError && error.code === "tool_unavailable",
  );
});

function deriveKeyHex(stepId: string): string {
  return deriveAgentToolIdempotencyKey({ requestId: REQUEST_ID, stepId, toolId: "t.quote", inputSha256: agentInputSha256({ symbol: "SAFE" }) }).replace("agent-tool:v1:", "");
}


test("GM-12: real encrypted L6 checkpoint survives Stop/restart and resumes one settled read and one unfinished call without re-planning", { timeout: 20_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lios-agent-restart-joined-"));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const opts = { directory: path.join(root, "journal"), keyDirectory: path.join(root, "keys") };
  const journal = await createExecutionJournal(opts);
  const requestId = crypto.randomUUID();
  const owner = { userId: 7, projectId: 12, chatId: 34 };
  const foreign = { ...owner, userId: 8 };
  const objective = "Compare two synthetic quote references using governed reads.";
  const budget = { maxSteps: 3, maxAiCalls: 3, maxRevisions: 0, maxDurationMs: 30_000 };
  const toolSetSha256 = "a".repeat(64);
  const policySha256 = "b".repeat(64);
  const context: ConversationContextEnvelope = {
    schemaVersion: "1",
    identity: { userId: owner.userId, organizationId: null, role: "internal_analyst" },
    project: { projectId: owner.projectId, name: "Synthetic project", instructionIncluded: false, resourceRefs: [] },
    conversation: { chatId: owner.chatId, scope: "project", sourceScope: "my_data", branchId: null },
    workspace: { sessionId: null, view: "conversation", symbol: null },
    active: { objectRefs: [], selection: null },
  };
  const binding = { role: "internal_analyst", objective, budget };
  const sourceMessageId = 7;
  const checkpoint = (state: AgentLoopContinuationState) => createNativeAgentLoopCheckpoint({
    state, requestId, owner, context, projectInstructions: null,
    sourceMessageId, toolSetSha256, policySha256, resumeBinding: binding,
  });

  await journal.begin({ id: requestId, owner, label: "Synthetic interruption with durable L6", agentRun: true });
  const stopped = new AbortController();
  const first = harness([plan([step("a"), step("b", "t.calc", { dependsOn: ["a"] })])], {
    signal: stopped.signal,
    stop: true,
    invoke: async (planned) => {
      if (planned.id === "b") {
        stopped.abort();
        throw new DOMException("Stopped by owner", "AbortError");
      }
    },
  });
  first.deps.goal = objective;
  first.deps.budget = budget;
  first.deps.ledger = async (event) => { await journal.appendAgentEvent(requestId, event); };
  first.deps.checkpoint = async (state) => { await journal.writeAgentCheckpoint(requestId, owner, checkpoint(state)); };
  await assert.rejects(runAgentLoop(first.deps), { name: "AbortError" });
  assert.deepEqual(first.ran, ["a", "b"]);
  await journal.interruptCheckpointed(requestId, owner);

  // New journal instance deliberately reconstructs the state from encrypted
  // bytes, not the original process's in-memory checkpoint and event arrays.
  const restarted = await createExecutionJournal(opts);
  await restarted.recoverInterrupted();
  assert.equal((await restarted.read(requestId, owner))?.status, "interrupted");
  assert.equal(await restarted.readAgentCheckpoint(requestId, foreign), null);
  await assert.rejects(
    restarted.resumeInterruptedAgentCheckpoint(requestId, foreign, "0".repeat(64)),
    /not found/i,
  );
  const snapshot = await restarted.readAgentCheckpoint(requestId, owner);
  assert.ok(snapshot);
  assert.equal(snapshot.version, 2, "native restart must carry original role, goal and budgets");
  const continuation = nativeContinuationOf(snapshot);
  assert.ok(continuation);
  assert.deepEqual(continuation.settled.map((outcome) => outcome.id), ["a"]);
  assert.equal(continuation.counters.aiCalls, 1);

  const current = {
    snapshot, requestId, owner,
    planSha256: snapshot.planSha256, toolSetSha256, policySha256,
    context, adapterId: snapshot.adapterId, sourceMessageId, projectInstructions: null, resumeBinding: binding,
  };
  assert.equal(assertAgentCheckpointResumeCurrent(current).bindingSha256, snapshot.bindingSha256);
  for (const mismatched of [
    { resumeBinding: { ...binding, objective: "A different goal" } },
    { resumeBinding: { ...binding, budget: { ...budget, maxSteps: 4 } } },
    { policySha256: "c".repeat(64) },
    { toolSetSha256: "d".repeat(64) },
    { sourceMessageId: sourceMessageId + 1 },
  ]) {
    assert.throws(() => assertAgentCheckpointResumeCurrent({ ...current, ...mismatched }), /changed|mismatch|original/i);
  }
  assert.equal((await restarted.read(requestId, owner))?.status, "interrupted",
    "a rejected binding cannot authorize or reopen the execution");

  const before = await restarted.read(requestId, owner);
  assert.ok(before?.events);
  const reopen = planAgentLoopReopen({
    requestId, events: before.events, continuation,
    toolFacts: (toolId) => TOOLS.some((tool) => tool.id === toolId)
      ? { sideEffect: "none", replaySafe: true } : null,
  });
  assert.deepEqual(reopen, {
    stepId: "b", supersedeToolCallId: "b-call", resumesToolCallId: "b-call", toolCallId: "b-call-r1",
  });

  await assert.rejects(
    restarted.resumeInterruptedAgentCheckpoint(requestId, owner, "f".repeat(64)),
    /checkpoint changed after resume validation/,
  );
  assert.equal((await restarted.read(requestId, owner))?.status, "interrupted");
  await restarted.resumeInterruptedAgentCheckpoint(requestId, owner, snapshot.bindingSha256);
  await assert.rejects(
    restarted.resumeInterruptedAgentCheckpoint(requestId, owner, snapshot.bindingSha256),
    /Only an interrupted/,
  );

  const second = harness([complete("The synthetic comparison is completed.")]);
  second.deps.goal = objective;
  second.deps.budget = budget;
  second.deps.ledger = async (event) => { await restarted.appendAgentEvent(requestId, event); };
  second.deps.checkpoint = async (state) => {
    await restarted.writeAgentCheckpoint(requestId, owner, checkpoint(state));
  };
  const result = await resumeAgentLoopFromCheckpoint(
    second.deps, { ...continuation, planSha256: snapshot.planSha256 }, reopen,
  );
  assert.equal(result.status, "completed");
  assert.deepEqual(second.ran, ["b"], "the settled first step cannot execute again after restart");
  assert.equal(second.prompts.length, 1, "the model reviews completed results but does not re-plan");
  assert.equal(result.aiCalls, 2, "model budget and counters continue from the real checkpoint");
  await restarted.finish(requestId, "completed", 0);
  const finalJournal = await createExecutionJournal(opts);
  const record = await finalJournal.read(requestId, owner);
  assert.ok(record?.events);
  assert.equal(record.status, "completed");
  assert.doesNotThrow(() => assertAgentEventChain(record.events, requestId));
  assert.equal(record.events.filter((event) => event.kind === "step_started" && event.stepId === "a").length, 1);
  assert.equal(record.events.filter((event) => event.kind === "step_started" && event.stepId === "b").length, 1);
  assert.equal(record.events.filter((event) => event.kind === "tool_call_finished" && event.toolCallId === "b-call" && event.status === "cancelled").length, 1);
  assert.equal(record.events.filter((event) => event.kind === "tool_call_started" && event.toolCallId === "b-call-r1").length, 1);
  assert.equal(record.events.filter((event) => event.kind === "tool_call_finished" && event.toolCallId === "b-call-r1" && event.status === "succeeded").length, 1);
  const ciphertext = await fs.readFile(path.join(opts.directory, requestId));
  assert.equal(ciphertext.subarray(0, 8).toString("utf8"), "LIOSENC1");
  assert.equal(ciphertext.includes(Buffer.from(objective)), false, "raw objective is not a checkpoint/ledger field");
  assert.equal(await finalJournal.read(requestId, foreign), null);
});
