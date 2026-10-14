import { z } from "zod";
import { runtimePermissionClassSchema } from "@shared/runtimeContracts";
import type { ToolSideEffect } from "../governedTools";
import { deriveAgentToolIdempotencyKey } from "./agent-idempotency";

/**
 * SI-02.01/.05/.06/.18 (L2): the agent run ledger is an append-only event stream inside the existing encrypted GM-10b
 * execution journal record. It is not a second store. Events carry ids, hashes and opaque references only: never raw
 * prompts, tool arguments or results, secrets or model reasoning. Vocabulary for side effects and permission classes
 * is L1's (`governedTools`, `runtimeContracts`); this module adds none of its own. L4/L5/L6 extend the event kinds
 * additively and fold from the same stream rather than adding stores.
 */

export const AGENT_EVENT_LIMIT = 512;

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const IDEMPOTENCY_KEY = /^agent-tool:v1:[a-f0-9]{64}$/;
// A reference is a pointer (receipt id, artifact id, source ref, hash). No whitespace, quotes or braces fit, so prose and
// serialized tool input/output cannot be stored here.
const REF = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,299}$/;
const SECRET_WORD = /(secret|password|passwd|token|api[-_]?key|authorization|bearer)/i;

const opaqueId = z.string().regex(OPAQUE_ID);
const sha256 = z.string().regex(SHA256);
const idempotencyKey = z.string().regex(IDEMPOTENCY_KEY);
const ref = z.string().regex(REF).refine((value) => !SECRET_WORD.test(value), "References must not look like credentials.");

export const AGENT_STEP_STATUSES = ["completed", "failed", "cancelled", "skipped"] as const;
export const AGENT_TOOL_STATUSES = ["succeeded", "failed", "denied", "cancelled"] as const;
export const AGENT_EVIDENCE_ROLES = ["source", "assumption"] as const;
const SIDE_EFFECTS = ["none", "internal_write", "external"] as const satisfies readonly ToolSideEffect[];

const stepStarted = z.object({
  kind: z.literal("step_started"),
  stepId: opaqueId,
  label: z.string().max(200).optional(),
}).strict();
const stepFinished = z.object({
  kind: z.literal("step_finished"),
  stepId: opaqueId,
  status: z.enum(AGENT_STEP_STATUSES),
}).strict();
const toolCallStarted = z.object({
  kind: z.literal("tool_call_started"),
  toolCallId: opaqueId,
  stepId: opaqueId,
  toolId: opaqueId,
  inputSha256: sha256,
  decision: z.enum(["allow", "confirm", "deny"]),
  permissionClass: runtimePermissionClassSchema,
  sideEffect: z.enum(SIDE_EFFECTS),
  /** Additive, secret-safe link (an opaque call id) from a restart-resumed call to the cancelled call it continues. */
  resumesToolCallId: opaqueId.optional(),
}).strict();
const toolCallFinished = z.object({
  kind: z.literal("tool_call_finished"),
  toolCallId: opaqueId,
  status: z.enum(AGENT_TOOL_STATUSES),
  outputRef: ref.nullable(),
}).strict();
/**
 * A call that needs approval is paused, not finished: it stays open so the same planned step and call can continue after a
 * server-issued approval (L4) without re-planning or inventing a new identity. Only a later `tool_call_finished` is terminal.
 */
const toolCallWaitingApproval = z.object({
  kind: z.literal("tool_call_waiting_approval"),
  toolCallId: opaqueId,
}).strict();
const toolCallResumed = z.object({
  kind: z.literal("tool_call_resumed"),
  toolCallId: opaqueId,
  /** Opaque reference to the server-issued approval that released the call. Never the approval record itself. */
  approvalRef: ref,
}).strict();
const toolCallDispatchIntent = z.object({
  kind: z.literal("tool_call_dispatch_intent"),
  toolCallId: opaqueId,
  idempotencyKey,
  attempt: z.number().int().min(1).max(10),
}).strict();
const toolCallDispatchNoEffect = z.object({
  kind: z.literal("tool_call_dispatch_no_effect"),
  toolCallId: opaqueId,
  idempotencyKey,
  attempt: z.number().int().min(1).max(10),
  reconciliationRef: ref,
}).strict();
const toolCallDispatchCommitted = z.object({
  kind: z.literal("tool_call_dispatch_committed"),
  toolCallId: opaqueId,
  idempotencyKey,
  attempt: z.number().int().min(1).max(10),
  commitRef: ref,
}).strict();
/**
 * L9 evidence attached to an existing call (no phase change, no second execution session): the exact GM-11 prepared
 * operation facts, recorded durably BEFORE approval so the trust evidence exists before any side effect. Digests and opaque
 * ids only: never argv, env, code/command text, output, an approval object or reasoning.
 */
const toolCallExecutionPrepared = z.object({
  kind: z.literal("tool_call_execution_prepared"),
  toolCallId: opaqueId,
  operationDigest: sha256,
  approvalDigest: sha256,
  policyRevision: sha256,
  backendId: opaqueId,
  backendGenerationId: opaqueId.nullable(),
}).strict();
const evidence = z.object({
  kind: z.literal("evidence"),
  role: z.enum(AGENT_EVIDENCE_ROLES),
  ref,
}).strict();

export const agentEventInputSchema = z.discriminatedUnion("kind", [
  stepStarted,
  stepFinished,
  toolCallStarted,
  toolCallWaitingApproval,
  toolCallResumed,
  toolCallExecutionPrepared,
  toolCallDispatchIntent,
  toolCallDispatchNoEffect,
  toolCallDispatchCommitted,
  toolCallFinished,
  evidence,
]);
export type AgentEventInput = z.infer<typeof agentEventInputSchema>;

const sealed = { seq: z.number().int().nonnegative().safe(), at: z.string().datetime() };
export const agentEventSchema = z.discriminatedUnion("kind", [
  stepStarted.extend(sealed),
  stepFinished.extend(sealed),
  toolCallStarted.extend(sealed),
  toolCallWaitingApproval.extend(sealed),
  toolCallResumed.extend(sealed),
  toolCallExecutionPrepared.extend(sealed),
  toolCallDispatchIntent.extend(sealed),
  toolCallDispatchNoEffect.extend(sealed),
  toolCallDispatchCommitted.extend(sealed),
  toolCallFinished.extend(sealed),
  evidence.extend(sealed),
]);
export type AgentRunEvent = AgentEventInput & { seq: number; at: string };

export class AgentLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentLedgerError";
  }
}

type CallPhase = "started" | "waiting" | "resumed" | "finished";
type DispatchPhase = "intent" | "no_effect" | "committed";

interface DispatchState {
  idempotencyKey: string;
  attempt: number;
  phase: DispatchPhase;
  evidenceRef: string | null;
}

interface ChainCallState {
  stepId: string;
  toolId: string;
  inputSha256: string;
  decision: "allow" | "confirm" | "deny";
  sideEffect: ToolSideEffect;
  phase: CallPhase;
  prepared: boolean;
  dispatch: DispatchState | null;
  finishedStatus: (typeof AGENT_TOOL_STATUSES)[number] | null;
  /** Restart-resume link to the earlier cancelled call this call continues; null for an ordinary call. */
  resumesToolCallId: string | null;
  resumedBy: string | null;
}

interface ChainState {
  steps: Map<string, { finished: boolean }>;
  calls: Map<string, ChainCallState>;
  /** Idempotency keys whose external effect is durably committed, scoped across every call of the run. */
  committedKeys: Set<string>;
}

function emptyState(): ChainState {
  return { steps: new Map(), calls: new Map(), committedKeys: new Set() };
}

function assertDispatchBinding(requestId: string | undefined, call: ChainCallState, value: string): void {
  if (!requestId) return;
  const expected = deriveAgentToolIdempotencyKey({
    requestId,
    stepId: call.stepId,
    toolId: call.toolId,
    inputSha256: call.inputSha256,
  });
  if (value !== expected) {
    throw new AgentLedgerError("Agent tool dispatch idempotency key does not match the request, step, tool and input.");
  }
}

function advance(state: ChainState, event: AgentEventInput, requestId?: string): void {
  switch (event.kind) {
    case "step_started":
      if (state.steps.has(event.stepId)) throw new AgentLedgerError("Agent step id was already started.");
      state.steps.set(event.stepId, { finished: false });
      return;
    case "step_finished": {
      const step = state.steps.get(event.stepId);
      if (!step) throw new AgentLedgerError("Agent step finished before it started.");
      if (step.finished) throw new AgentLedgerError("Agent step already has a terminal state.");
      for (const call of state.calls.values()) {
        if (call.stepId === event.stepId && call.phase !== "finished") throw new AgentLedgerError("Agent step cannot finish with a tool call still open.");
      }
      step.finished = true;
      return;
    }
    case "tool_call_started": {
      const step = state.steps.get(event.stepId);
      if (!step || step.finished) throw new AgentLedgerError("Agent tool call must belong to a started, unfinished step.");
      if (state.calls.has(event.toolCallId)) throw new AgentLedgerError("Agent tool call id was already used in this run.");
      const resumed = event.resumesToolCallId === undefined ? null : state.calls.get(event.resumesToolCallId);
      if (event.resumesToolCallId !== undefined) {
        // Restart-resume link: a fresh call continues work abandoned by one earlier call of the SAME step, tool and exact
        // input (hence the same idempotency key). The earlier call must already be finished `cancelled` and unlinked: no
        // call is ever reopened, and a link can neither cross steps nor be taken twice.
        if (!resumed || event.resumesToolCallId === event.toolCallId) throw new AgentLedgerError("A resumed tool call must link to an existing earlier call.");
        if (resumed.stepId !== event.stepId || resumed.toolId !== event.toolId || resumed.inputSha256 !== event.inputSha256) {
          throw new AgentLedgerError("A resumed tool call must link to a call of the same step, tool and input.");
        }
        if (resumed.phase !== "finished" || resumed.finishedStatus !== "cancelled") {
          throw new AgentLedgerError("A resumed tool call can only link to a call that was finished cancelled.");
        }
        if (resumed.resumedBy !== null) throw new AgentLedgerError("That tool call was already resumed.");
        resumed.resumedBy = event.toolCallId;
      }
      state.calls.set(event.toolCallId, {
        stepId: event.stepId,
        toolId: event.toolId,
        inputSha256: event.inputSha256,
        decision: event.decision,
        sideEffect: event.sideEffect,
        phase: "started",
        prepared: false,
        dispatch: null,
        finishedStatus: null,
        resumesToolCallId: event.resumesToolCallId ?? null,
        resumedBy: null,
      });
      return;
    }
    case "tool_call_waiting_approval": {
      const call = state.calls.get(event.toolCallId);
      if (!call) throw new AgentLedgerError("Agent tool call is waiting for approval before it started.");
      if (call.phase !== "started") throw new AgentLedgerError("Only a started tool call can wait for approval.");
      if (call.dispatch) throw new AgentLedgerError("A tool call cannot wait for approval after dispatch started.");
      call.phase = "waiting";
      return;
    }
    case "tool_call_resumed": {
      const call = state.calls.get(event.toolCallId);
      if (!call || call.phase !== "waiting") throw new AgentLedgerError("Only a tool call waiting for approval can resume.");
      call.phase = "resumed";
      return;
    }
    case "tool_call_execution_prepared": {
      const call = state.calls.get(event.toolCallId);
      if (!call) throw new AgentLedgerError("Agent tool call was prepared before it started.");
      if (call.phase === "finished") throw new AgentLedgerError("A finished tool call cannot be prepared.");
      if (call.phase === "waiting") throw new AgentLedgerError("Execution must be prepared before the call waits for approval.");
      if (call.prepared) throw new AgentLedgerError("Agent tool call execution was already prepared.");
      call.prepared = true;
      return;
    }
    case "tool_call_dispatch_intent": {
      const call = state.calls.get(event.toolCallId);
      if (!call || (call.phase !== "started" && call.phase !== "resumed")) {
        throw new AgentLedgerError("Only an active released tool call can prepare a dispatch.");
      }
      if (call.sideEffect !== "external") {
        throw new AgentLedgerError("L5 dispatch tracking is only valid for external side effects.");
      }
      if (call.decision === "confirm" && call.phase !== "resumed") {
        throw new AgentLedgerError("A confirm-class external call must be durably resumed before dispatch.");
      }
      assertDispatchBinding(requestId, call, event.idempotencyKey);
      if (call.resumesToolCallId !== null) {
        const prior = state.calls.get(call.resumesToolCallId);
        if (prior?.dispatch && prior.dispatch.idempotencyKey !== event.idempotencyKey) {
          throw new AgentLedgerError("A resumed call must reuse the idempotency key of the call it continues.");
        }
      } else {
        for (const [otherId, other] of state.calls) {
          if (other.dispatch && other.stepId === call.stepId && other.toolId === call.toolId && other.inputSha256 === call.inputSha256 && otherId !== event.toolCallId) {
            throw new AgentLedgerError("A call repeating an operation that already dispatched must link to the call it continues.");
          }
        }
      }
      if (!call.dispatch) {
      if (state.committedKeys.has(event.idempotencyKey)) {
        throw new AgentLedgerError("This idempotency key already has a committed effect; it cannot dispatch again.");
      }
        if (event.attempt !== 1) throw new AgentLedgerError("The first tool dispatch attempt must be 1.");
      } else {
        if (call.dispatch.phase === "intent") throw new AgentLedgerError("A tool dispatch attempt is already outcome-unknown.");
        if (call.dispatch.phase === "committed") throw new AgentLedgerError("A committed tool call cannot dispatch again.");
        if (event.idempotencyKey !== call.dispatch.idempotencyKey) {
          throw new AgentLedgerError("Tool retries must reuse the same idempotency key.");
        }
        if (event.attempt !== call.dispatch.attempt + 1) {
          throw new AgentLedgerError("Tool retry attempt numbers must increase by one.");
        }
      }
      call.dispatch = { idempotencyKey: event.idempotencyKey, attempt: event.attempt, phase: "intent", evidenceRef: null };
      return;
    }
    case "tool_call_dispatch_no_effect": {
      const call = state.calls.get(event.toolCallId);
      if (!call?.dispatch || call.dispatch.phase !== "intent") {
        throw new AgentLedgerError("A no-effect reconciliation requires one unresolved dispatch intent.");
      }
      assertDispatchBinding(requestId, call, event.idempotencyKey);
      if (event.idempotencyKey !== call.dispatch.idempotencyKey || event.attempt !== call.dispatch.attempt) {
        throw new AgentLedgerError("Tool dispatch reconciliation does not match the unresolved attempt.");
      }
      call.dispatch = { ...call.dispatch, phase: "no_effect", evidenceRef: event.reconciliationRef };
      return;
    }
    case "tool_call_dispatch_committed": {
      const call = state.calls.get(event.toolCallId);
      if (!call?.dispatch || call.dispatch.phase !== "intent") {
        throw new AgentLedgerError("A dispatch commit requires one unresolved dispatch intent.");
      }
      assertDispatchBinding(requestId, call, event.idempotencyKey);
      if (event.idempotencyKey !== call.dispatch.idempotencyKey || event.attempt !== call.dispatch.attempt) {
        throw new AgentLedgerError("Tool dispatch commit does not match the unresolved attempt.");
      }
      if (state.committedKeys.has(event.idempotencyKey)) {
        throw new AgentLedgerError("This idempotency key already has a committed effect; it cannot commit twice.");
      }
      state.committedKeys.add(event.idempotencyKey);
      call.dispatch = { ...call.dispatch, phase: "committed", evidenceRef: event.commitRef };
      return;
    }
    case "tool_call_finished": {
      const call = state.calls.get(event.toolCallId);
      if (!call) throw new AgentLedgerError("Agent tool call finished before it started.");
      if (call.phase === "finished") throw new AgentLedgerError("Agent tool call already has a terminal state.");
      // A paused call cannot succeed or fail without having been released: it can only be refused or abandoned.
      if (call.phase === "waiting" && event.status !== "denied" && event.status !== "cancelled") {
        throw new AgentLedgerError("A tool call waiting for approval can only end denied or cancelled.");
      }
      if (call.dispatch?.phase === "intent") {
        throw new AgentLedgerError("An outcome-unknown dispatch must be reconciled before the tool call can finish.");
      }
      if (call.dispatch?.phase === "committed" && event.status !== "succeeded") {
        throw new AgentLedgerError("A committed dispatch must finish as succeeded.");
      }
      if (call.dispatch?.phase === "no_effect" && event.status === "succeeded") {
        throw new AgentLedgerError("A dispatch proven to have no effect cannot finish as succeeded.");
      }
      call.phase = "finished";
      call.finishedStatus = event.status;
      return;
    }
    case "evidence":
      return;
  }
}

/** Validates a caller-supplied event against the existing chain and returns the sealed event (seq and time are ours). */
export function sealAgentEvent(events: readonly AgentRunEvent[], input: unknown, nowIso: string, requestId?: string): AgentRunEvent {
  const parsed = agentEventInputSchema.safeParse(input);
  if (!parsed.success) throw new AgentLedgerError("Agent event is invalid, oversized or carries unhashed/raw content.");
  if (events.length >= AGENT_EVENT_LIMIT) throw new AgentLedgerError("Agent run ledger is full.");
  const state = emptyState();
  for (const event of events) advance(state, event, requestId);
  advance(state, parsed.data, requestId);
  return { ...parsed.data, seq: events.length, at: nowIso };
}

/** True when some tool call is paused for approval and has not been released or refused. */
export function hasCallWaitingApproval(events: readonly AgentRunEvent[]): boolean {
  const state = emptyState();
  for (const event of events) advance(state, event);
  for (const call of state.calls.values()) if (call.phase === "waiting") return true;
  return false;
}

/** The single tool call currently waiting for approval, or null when none (or more than one) is waiting. */
export function waitingCallId(events: readonly AgentRunEvent[]): string | null {
  const state = emptyState();
  for (const event of events) advance(state, event);
  const waiting = [...state.calls.entries()].filter(([, call]) => call.phase === "waiting").map(([id]) => id);
  return waiting.length === 1 ? waiting[0]! : null;
}

/** Re-validates a stored stream: contiguous sequence, monotonic time and legal transitions. Tamper evidence beyond encryption. */
export function assertAgentEventChain(events: readonly AgentRunEvent[], requestId?: string): void {
  if (events.length > AGENT_EVENT_LIMIT) throw new AgentLedgerError("Agent run ledger exceeds its bound.");
  const state = emptyState();
  let previous = "";
  for (const [index, event] of events.entries()) {
    if (event.seq !== index) throw new AgentLedgerError("Agent run ledger sequence is not contiguous.");
    if (event.at < previous) throw new AgentLedgerError("Agent run ledger time moved backwards.");
    previous = event.at;
    advance(state, event, requestId);
  }
}

export interface AgentToolDispatchState {
  toolCallId: string;
  idempotencyKey: string;
  attempt: number;
  status: "outcome_unknown" | "proven_no_effect" | "committed";
  evidenceRef: string | null;
}

/** Pure recovery projection; an intent without durable reconciliation/commit remains outcome-unknown. */
export function foldAgentToolDispatchState(
  events: readonly AgentRunEvent[],
  requestId?: string,
): AgentToolDispatchState[] {
  assertAgentEventChain(events, requestId);
  const state = new Map<string, AgentToolDispatchState>();
  for (const event of events) {
    if (event.kind === "tool_call_dispatch_intent") {
      state.set(event.toolCallId, {
        toolCallId: event.toolCallId,
        idempotencyKey: event.idempotencyKey,
        attempt: event.attempt,
        status: "outcome_unknown",
        evidenceRef: null,
      });
    } else if (event.kind === "tool_call_dispatch_no_effect") {
      state.set(event.toolCallId, {
        toolCallId: event.toolCallId,
        idempotencyKey: event.idempotencyKey,
        attempt: event.attempt,
        status: "proven_no_effect",
        evidenceRef: event.reconciliationRef,
      });
    } else if (event.kind === "tool_call_dispatch_committed") {
      state.set(event.toolCallId, {
        toolCallId: event.toolCallId,
        idempotencyKey: event.idempotencyKey,
        attempt: event.attempt,
        status: "committed",
        evidenceRef: event.commitRef,
      });
    }
  }
  return [...state.values()];
}

export interface AgentLedgerStepProjection {
  stepId: string;
  finished: boolean;
}

export interface AgentLedgerCallProjection {
  toolCallId: string;
  stepId: string;
  toolId: string;
  decision: "allow" | "confirm" | "deny";
  sideEffect: ToolSideEffect;
  phase: CallPhase;
  finishedStatus: (typeof AGENT_TOOL_STATUSES)[number] | null;
  resumesToolCallId: string | null;
  dispatch: { idempotencyKey: string; attempt: number; phase: DispatchPhase } | null;
}

/**
 * Pure, validating projection of the ledger for restart-resume: which steps were started/finished and which tool calls are
 * still open (and how far their dispatch got). It never mutates the stream.
 */
export function projectAgentLedger(
  events: readonly AgentRunEvent[],
  requestId?: string,
): { steps: AgentLedgerStepProjection[]; calls: AgentLedgerCallProjection[] } {
  assertAgentEventChain(events, requestId);
  const state = emptyState();
  for (const event of events) advance(state, event, requestId);
  return {
    steps: [...state.steps.entries()].map(([stepId, step]) => ({ stepId, finished: step.finished })),
    calls: [...state.calls.entries()].map(([toolCallId, call]) => ({
      toolCallId,
      stepId: call.stepId,
      toolId: call.toolId,
      decision: call.decision,
      sideEffect: call.sideEffect,
      phase: call.phase,
      finishedStatus: call.finishedStatus,
      resumesToolCallId: call.resumesToolCallId,
      dispatch: call.dispatch
        ? { idempotencyKey: call.dispatch.idempotencyKey, attempt: call.dispatch.attempt, phase: call.dispatch.phase }
        : null,
    })),
  };
}

export interface AgentRunReceipt {
  runId: string;
  status: "running" | "waiting_approval" | "completed" | "cancelled" | "failed" | "interrupted" | "denied";
  startedAt: string;
  endedAt: string | null;
  steps: Array<{ stepId: string; label: string | null; status: "running" | "unfinished" | (typeof AGENT_STEP_STATUSES)[number] }>;
  tools: Array<{
    toolCallId: string;
    stepId: string;
    toolId: string;
    decision: "allow" | "confirm" | "deny";
    permissionClass: z.infer<typeof runtimePermissionClassSchema>;
    sideEffect: ToolSideEffect;
    status: "in_flight" | "waiting_approval" | "unfinished" | (typeof AGENT_TOOL_STATUSES)[number];
    durationMs: number | null;
    outputRef: string | null;
    approvalRef: string | null;
    /** The earlier cancelled call this call continues after a restart-resume, or null. Opaque id only. */
    resumesToolCallId: string | null;
  }>;
  sources: string[];
  assumptions: string[];
}

/**
 * Pure projection of the event stream for the visible receipt: tools, sources, assumptions and status. It contains no
 * input hashes and nothing that could be chain-of-thought, and it never mutates the stream.
 */
export function foldAgentReceipt(record: {
  id: string;
  status: AgentRunReceipt["status"];
  startedAt: string;
  endedAt: string | null;
  events: readonly AgentRunEvent[];
}): AgentRunReceipt {
  const live = record.status === "running" || record.status === "waiting_approval";
  const steps = new Map<string, AgentRunReceipt["steps"][number]>();
  const tools = new Map<string, AgentRunReceipt["tools"][number] & { startedAtMs: number }>();
  const sources = new Set<string>();
  const assumptions = new Set<string>();
  for (const event of record.events) {
    if (event.kind === "step_started") {
      steps.set(event.stepId, { stepId: event.stepId, label: event.label ?? null, status: live ? "running" : "unfinished" });
    } else if (event.kind === "step_finished") {
      const step = steps.get(event.stepId);
      if (step) step.status = event.status;
    } else if (event.kind === "tool_call_started") {
      tools.set(event.toolCallId, {
        toolCallId: event.toolCallId,
        stepId: event.stepId,
        toolId: event.toolId,
        decision: event.decision,
        permissionClass: event.permissionClass,
        sideEffect: event.sideEffect,
        status: live ? "in_flight" : "unfinished",
        durationMs: null,
        outputRef: null,
        approvalRef: null,
        resumesToolCallId: event.resumesToolCallId ?? null,
        startedAtMs: Date.parse(event.at),
      });
    } else if (event.kind === "tool_call_waiting_approval") {
      const call = tools.get(event.toolCallId);
      if (call) call.status = live ? "waiting_approval" : "unfinished";
    } else if (event.kind === "tool_call_resumed") {
      const call = tools.get(event.toolCallId);
      if (call) {
        call.status = live ? "in_flight" : "unfinished";
        call.approvalRef = event.approvalRef;
      }
    } else if (
      event.kind === "tool_call_dispatch_intent"
      || event.kind === "tool_call_dispatch_no_effect"
      || event.kind === "tool_call_dispatch_committed"
    ) {
      // L5 dispatch state is recovery/audit evidence only and is deliberately absent from concise user receipts.
    } else if (event.kind === "tool_call_finished") {
      const call = tools.get(event.toolCallId);
      if (call) {
        call.status = event.status;
        call.outputRef = event.outputRef;
        call.durationMs = Math.max(0, Date.parse(event.at) - call.startedAtMs);
      }
    } else if (event.kind === "evidence") {
      if (event.role === "source") sources.add(event.ref);
      else assumptions.add(event.ref);
    }
    // tool_call_execution_prepared is audit evidence for L9; the receipt projection deliberately omits digests.
  }
  return {
    runId: record.id,
    status: record.status,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    steps: [...steps.values()],
    tools: [...tools.values()].map(({ startedAtMs: _startedAtMs, ...call }) => call),
    sources: [...sources],
    assumptions: [...assumptions],
  };
}
