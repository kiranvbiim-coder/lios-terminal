import type { ConversationContextEnvelope } from "@shared/conversationRuntime";
import { containsCredentialShape } from "@shared/workingContext";
import {
  checkpointStepsFromContinuation,
  createAgentCheckpointSnapshot,
  type AgentCheckpointOwner,
  type AgentCheckpointSnapshot,
  type AgentLoopContinuation,
  type AgentCheckpointResumeBindingInput,
} from "./agent-checkpoint";
import type { AgentLoopContinuationState, AgentLoopReopen } from "./agentLoop";
import { foldAgentToolDispatchState, projectAgentLedger, type AgentRunEvent } from "./exec/agent-run-events";
import type { ToolSideEffect } from "./governedTools";

/**
 * SI-02 restart-resume: the native L3 loop as the production L6 checkpoint producer/consumer.
 *
 * One journal, one registry and one L6 snapshot type: the continuation rides inside the same encrypted v2 journal record and
 * is covered by the same binding hash. This module owns no authority and persists no grants, approvals or leases.
 */

/** Opaque L6 adapter id of the in-process native loop; there is no external adapter process to reopen. */
export const NATIVE_AGENT_LOOP_ADAPTER_ID = "lios.native-agent-loop";

const SUMMARY_LIMIT = 2_000;
const SOURCE_REF_LIMIT = 10;
const SOURCE_REF_CHARS = 300;
const DELEGATE_TOOL_ID = "lios.agent.delegate";

export type AgentRestartRefusalCode =
  | "checkpoint_stale"
  | "reconciliation_required"
  | "not_replay_safe"
  | "tool_unavailable";

/** The interrupted run cannot be safely continued. The record stays interrupted; nothing executes. */
export class AgentRestartResumeRefusedError extends Error {
  constructor(readonly code: AgentRestartRefusalCode, message: string) {
    super(message);
    this.name = "AgentRestartResumeRefusedError";
  }
}

/** Live work may continue, but credential-shaped inputs must never enter durable restart state. */
export class AgentRestartCheckpointUnsafeError extends Error {
  readonly code = "credential_shaped_checkpoint" as const;
  constructor() {
    super("The native agent continuation contains credential-shaped data and cannot be persisted for restart.");
    this.name = "AgentRestartCheckpointUnsafeError";
  }
}

/** Structural key check complements the shared token-pattern policy, including ordinary passwords without a token prefix. */
function hasCredentialNamedField(value: unknown, depth = 0): boolean {
  if (depth > 20) return true; // do not persist unbounded/uninspectable input
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasCredentialNamedField(item, depth + 1));
  return Object.entries(value).some(([key, item]) =>
    /(?:password|passwd|passphrase|secret|credential|authorization|bearer|token|api[_-]?key|private[_-]?key)/i.test(key)
    || hasCredentialNamedField(item, depth + 1));
}

/** Bounds the live loop state to the persisted continuation. Plan steps are kept exactly: the plan hash covers them. */
export function boundAgentLoopContinuation(state: AgentLoopContinuationState): AgentLoopContinuation {
  return {
    version: 1,
    steps: state.steps.map((step) => ({
      id: step.id,
      toolId: step.toolId,
      ...(step.skillId ? { skillId: step.skillId } : {}),
      label: step.label,
      input: step.input,
      dependsOn: [...step.dependsOn],
    })),
    segment: [...state.segment],
    settled: state.settled.flatMap((outcome) => outcome.status === "approval_required" ? [] : [{
      id: outcome.id,
      toolId: outcome.toolId,
      label: outcome.label,
      status: outcome.status,
      summary: outcome.summary.slice(0, SUMMARY_LIMIT),
      deterministic: outcome.deterministic,
      sourceRefs: outcome.sourceRefs.slice(0, SOURCE_REF_LIMIT).map((ref) => ref.slice(0, SOURCE_REF_CHARS)),
    }]),
    counters: { ...state.counters },
    delegatedBudgetUsed: state.delegatedBudgetUsed
      ? { ...state.delegatedBudgetUsed }
      : { maxSteps: 0, maxAiCalls: 0, maxRevisions: 0, maxDurationMs: 0 },
  };
}

export interface NativeAgentLoopCheckpointInput {
  requestId: string;
  owner: AgentCheckpointOwner;
  context: ConversationContextEnvelope;
  projectInstructions: string | null;
  sourceMessageId: number;
  state: AgentLoopContinuationState;
  toolSetSha256: string;
  policySha256: string;
  resumeBinding: AgentCheckpointResumeBindingInput;
}

/** Builds the L6 snapshot for one safe loop boundary. It never classifies a boundary as outcome-unknown. */
export function createNativeAgentLoopCheckpoint(input: NativeAgentLoopCheckpointInput): AgentCheckpointSnapshot {
  const continuation = boundAgentLoopContinuation(input.state);
  if (containsCredentialShape(continuation) || continuation.steps.some((step) => hasCredentialNamedField(step.input))) {
    throw new AgentRestartCheckpointUnsafeError();
  }
  const last = continuation.settled.at(-1);
  return createAgentCheckpointSnapshot({
    projectInstructions: input.projectInstructions,
    sourceMessageId: input.sourceMessageId,
    requestId: input.requestId,
    owner: input.owner,
    planSha256: input.state.planSha256,
    steps: checkpointStepsFromContinuation(continuation),
    toolSetSha256: input.toolSetSha256,
    policySha256: input.policySha256,
    context: input.context,
    adapterId: NATIVE_AGENT_LOOP_ADAPTER_ID,
    checkpointRef: `agent-loop-checkpoint:${input.state.planSha256}:s${continuation.settled.length}`,
    toolOutcome: !last ? "none_pending" : last.status === "completed" ? "known_completed" : "known_failed",
    continuation,
    resumeBinding: input.resumeBinding,
  });
}

/** The continuation of a snapshot that the native loop can resume, or null (adapter-only or outcome-unknown snapshots). */
export function nativeContinuationOf(checkpoint: AgentCheckpointSnapshot | undefined | null): AgentLoopContinuation | null {
  if (!checkpoint || checkpoint.adapterId !== NATIVE_AGENT_LOOP_ADAPTER_ID || checkpoint.version !== 2) return null;
  if (!Number.isSafeInteger(checkpoint.sourceMessageId) || (checkpoint.sourceMessageId ?? 0) <= 0) return null;
  if (checkpoint.context.project.instructionIncluded && !checkpoint.context.project.projectInstructionsSha256) return null;
  if (checkpoint.toolOutcome === "outcome_unknown") return null;
  return checkpoint.continuation ?? null;
}

export interface PlanAgentLoopReopenInput {
  requestId: string;
  events: readonly AgentRunEvent[];
  continuation: AgentLoopContinuation;
  toolFacts: (toolId: string) => { sideEffect: ToolSideEffect; replaySafe: boolean } | null;
}

/**
 * Reconciles the durable ledger with a checkpoint before a resume. The checkpoint is written at safe boundaries only, so the
 * ledger may be ahead of it by at most the one in-flight step. Anything else (a step the checkpoint does not know, a step
 * the ledger finished that the checkpoint did not settle, an ambiguous or committed dispatch, a tool that cannot be shown to
 * be replay-safe) refuses the resume with a typed error; nothing is written and nothing executes.
 *
 * The abandoned call is finished `cancelled` and the step continues under a fresh call id. The L5 idempotency key derives
 * from request/step/tool/input, so it is identical across the calls of one step.
 */
export function planAgentLoopReopen(input: PlanAgentLoopReopenInput): AgentLoopReopen | null {
  const { continuation } = input;
  const dispatches = foldAgentToolDispatchState(input.events, input.requestId);
  if (dispatches.some((dispatch) => dispatch.status === "outcome_unknown")) {
    throw new AgentRestartResumeRefusedError("reconciliation_required", "An outcome-unknown tool dispatch must be reconciled before this run can resume.");
  }
  const ledger = projectAgentLedger(input.events, input.requestId);
  const planned = new Set(continuation.steps.map((step) => step.id));
  const settled = new Set(continuation.settled.map((outcome) => outcome.id));
  const stale = (message: string) => new AgentRestartResumeRefusedError("checkpoint_stale", message);

  for (const step of ledger.steps) {
    if (!planned.has(step.stepId)) throw stale("The run ledger contains a step the checkpoint does not know.");
    if (step.finished && !settled.has(step.stepId)) throw stale("The run ledger is ahead of its checkpoint.");
  }
  for (const id of settled) {
    const step = ledger.steps.find((candidate) => candidate.stepId === id);
    if (!step?.finished) throw stale("A checkpointed settled step is not finished in the run ledger.");
  }

  const unfinished = ledger.steps.filter((step) => !step.finished);
  if (unfinished.length === 0) return null;
  if (unfinished.length > 1) throw stale("More than one step is unfinished in the run ledger.");
  const [open] = unfinished;
  if (!continuation.segment.includes(open!.stepId) || settled.has(open!.stepId)) {
    throw stale("The unfinished step is not an unsettled step of the checkpointed plan.");
  }

  const calls = ledger.calls.filter((call) => call.stepId === open!.stepId);
  for (const call of calls) {
    if (call.toolId === DELEGATE_TOOL_ID) {
      throw new AgentRestartResumeRefusedError("not_replay_safe", "An interrupted delegated run cannot be replayed without reconciling its child budget.");
    }
    if (call.dispatch?.phase === "intent") {
      throw new AgentRestartResumeRefusedError("reconciliation_required", "An outcome-unknown tool dispatch must be reconciled before this run can resume.");
    }
    if (call.dispatch?.phase === "committed") {
      throw new AgentRestartResumeRefusedError("reconciliation_required", "A tool effect was committed but its step never finished; its result cannot be recovered or replayed.");
    }
    const facts = input.toolFacts(call.toolId);
    if (!facts) throw new AgentRestartResumeRefusedError("tool_unavailable", "An interrupted tool is no longer registered.");
    if (call.phase === "finished") {
      // A call that finished `succeeded` while its step never finished: replaying is only sound for a pure read.
      if (call.finishedStatus === "succeeded" && facts.sideEffect !== "none") {
        throw new AgentRestartResumeRefusedError("reconciliation_required", "A tool call succeeded but its step never finished; replaying it could repeat its effect.");
      }
      continue;
    }
    // An open call: a confirm-class call that never reached invocation is safe; otherwise only replay-safe or pure tools.
    const neverInvoked = call.decision === "confirm" && (call.phase === "started" || call.phase === "waiting");
    if (facts.sideEffect === "internal_write" && !facts.replaySafe && !neverInvoked) {
      throw new AgentRestartResumeRefusedError("not_replay_safe", "An interrupted internal write is not declared replay-safe.");
    }
    // External effects are covered above: only a durably absent (null) or proven no-effect dispatch reaches this point.
  }

  const openCalls = calls.filter((call) => call.phase !== "finished");
  if (openCalls.length > 1) throw stale("More than one tool call is open for the unfinished step.");
  const ordinal = calls.length;
  const latestCall = calls.at(-1);
  const resumesToolCallId = openCalls[0]?.toolCallId
    ?? (latestCall?.finishedStatus === "cancelled" ? latestCall.toolCallId : null);
  return {
    stepId: open!.stepId,
    supersedeToolCallId: openCalls[0]?.toolCallId ?? null,
    resumesToolCallId,
    toolCallId: ordinal === 0 ? `${open!.stepId}-call` : `${open!.stepId}-call-r${ordinal}`,
  };
}
