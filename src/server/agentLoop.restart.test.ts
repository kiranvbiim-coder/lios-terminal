import assert from "node:assert/strict";
import test from "node:test";
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
