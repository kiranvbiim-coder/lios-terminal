import type { AgentRole, ConversationContextEnvelope } from "@shared/conversationRuntime";
import {
  assertAgentCheckpointResumeCurrent,
  createAgentCheckpointSnapshot,
  type AgentCheckpointSnapshot,
  type AgentCheckpointResumeBindingInput,
  type AgentCheckpointStep,
  type AgentCheckpointToolOutcome,
} from "./agent-checkpoint";
import {
  checkpointAgentExecution,
  getAgentFrameworkAdapter,
  resumeBoundedAgent,
  type AgentRuntimeResult,
} from "./conversationRuntime";
import type { ExecutionJournal, ExecutionOwner } from "./exec/execution-journal";

export interface PersistBoundedAgentCheckpointInput {
  journal: ExecutionJournal;
  requestId: string;
  owner: ExecutionOwner;
  adapterId: string;
  planSha256: string;
  steps: readonly AgentCheckpointStep[];
  toolSetSha256: string;
  policySha256: string;
  projectInstructions?: string | null;
  sourceMessageId?: number | null;
  context: ConversationContextEnvelope;
  evidenceRefs?: readonly string[];
  toolOutcome: AgentCheckpointToolOutcome;
  signal?: AbortSignal;
}

/**
 * L6 production producer: obtains an opaque adapter checkpoint through the existing
 * P2 checkpointAgentExecution hook, wraps it in the owner/plan/tool/policy/context
 * binding, and persists it in the same encrypted v2 journal record.
 *
 * No checkpoint table, process-memory fallback, approval authority, or execution
 * happens here.
 */
export async function persistBoundedAgentCheckpoint(
  input: PersistBoundedAgentCheckpointInput,
): Promise<AgentCheckpointSnapshot | null> {
  const checkpointRef = await checkpointAgentExecution(
    input.adapterId,
    input.requestId,
    input.signal,
  );
  if (!checkpointRef) return null;

  const snapshot = createAgentCheckpointSnapshot({
    requestId: input.requestId,
    owner: input.owner,
    planSha256: input.planSha256,
    steps: input.steps,
    toolSetSha256: input.toolSetSha256,
    policySha256: input.policySha256,
    projectInstructions: input.projectInstructions,
    sourceMessageId: input.sourceMessageId,
    context: input.context,
    evidenceRefs: input.evidenceRefs,
    adapterId: input.adapterId,
    checkpointRef,
    toolOutcome: input.toolOutcome,
  });
  await input.journal.writeAgentCheckpoint(input.requestId, input.owner, snapshot);
  return snapshot;
}

export interface ResumePersistedBoundedAgentCheckpointInput {
  journal: ExecutionJournal;
  requestId: string;
  owner: ExecutionOwner;
  adapterId: string;
  role: AgentRole;
  /** Server-owned original objective for this request, never a client authority field. */
  objective: string;
  planSha256: string;
  toolSetSha256: string;
  policySha256: string;
  context: ConversationContextEnvelope;
  /**
   * Mandatory server-owned authorization preflight for this explicit user
   * resume. It must re-check the canonical current approval/lease authority;
   * request bodies and persisted checkpoints cannot self-authorize.
   */
  projectInstructions?: string | null;
  sourceMessageId?: number | null;
  revalidateAuthorization: (checkpoint: AgentCheckpointSnapshot) => void | Promise<void>;
  maxDurationMs?: number;
  signal?: AbortSignal;
}

export interface ReopenInterruptedAgentCheckpointInput {
  journal: ExecutionJournal;
  requestId: string;
  owner: ExecutionOwner;
  adapterId: string;
  planSha256: string;
  toolSetSha256: string;
  policySha256: string;
  context: ConversationContextEnvelope;
  projectInstructions?: string | null;
  sourceMessageId?: number | null;
  /** Server-owned original identity for version-2 native checkpoints; never a client-provided grant. */
  resumeBinding?: AgentCheckpointResumeBindingInput;
  /** Mandatory server-owned authorization preflight; see ResumePersistedBoundedAgentCheckpointInput. */
  revalidateAuthorization: (checkpoint: AgentCheckpointSnapshot) => void | Promise<void>;
  signal?: AbortSignal;
}

/**
 * Adapter-independent half of an explicit resume: read the owner-scoped checkpoint, revalidate owner + plan + tool-set +
 * policy + context + adapter against current facts, re-check canonical authorization, then atomically reopen
 * interrupted -> running against the exact binding hash. It executes nothing. Any failure leaves the record interrupted.
 * Both the registered-adapter path and the native L3 loop path use this one sequence.
 */
export async function reopenInterruptedAgentCheckpoint(
  input: ReopenInterruptedAgentCheckpointInput,
): Promise<AgentCheckpointSnapshot> {
  const checkpoint = await input.journal.readAgentCheckpoint(input.requestId, input.owner);
  if (!checkpoint) throw new Error("Interrupted agent checkpoint was not found.");

  const validated = assertAgentCheckpointResumeCurrent({
    snapshot: checkpoint,
    requestId: input.requestId,
    owner: input.owner,
    planSha256: input.planSha256,
    toolSetSha256: input.toolSetSha256,
    policySha256: input.policySha256,
    projectInstructions: input.projectInstructions,
    sourceMessageId: input.sourceMessageId,
    context: input.context,
    adapterId: input.adapterId,
    resumeBinding: input.resumeBinding,
  });

  // Restart invalidates live approval leases. The explicit resume caller must re-authorize against current canonical
  // policy/approval facts before the durable record is reopened. A denied/stale/revoked authorization therefore leaves the
  // record interrupted and cannot invoke anything.
  await input.revalidateAuthorization(validated);
  if (input.signal?.aborted) {
    throw input.signal.reason instanceof Error
      ? input.signal.reason
      : new DOMException("Agent checkpoint resume cancelled.", "AbortError");
  }

  return input.journal.resumeInterruptedAgentCheckpoint(input.requestId, input.owner, validated.bindingSha256);
}

/**
 * L6 explicit resume orchestration.
 *
 * Sequence is deliberately fail-closed:
 * 1. read owner-scoped encrypted checkpoint;
 * 2. preflight the currently registered adapter/role/resume capability;
 * 3. revalidate owner + plan + tool-set + policy + context + adapter;
 * 4. require the caller to re-check canonical current approval/lease authority;
 * 5. atomically reopen interrupted -> running against the exact binding hash;
 * 6. invoke the existing P2 resumeBoundedAgent hook;
 * 7. durably terminalize the same journal record.
 *
 * Restart recovery never calls this function. A caller must explicitly invoke it.
 */
export async function resumePersistedBoundedAgentCheckpoint(
  input: ResumePersistedBoundedAgentCheckpointInput,
): Promise<AgentRuntimeResult> {
  const adapter = getAgentFrameworkAdapter(input.adapterId);
  if (!adapter) throw new Error(`Agent adapter "${input.adapterId}" is not registered.`);
  if (!adapter.roles.includes(input.role)) {
    throw new Error(`Agent adapter "${input.adapterId}" does not support role "${input.role}".`);
  }
  if (!adapter.resume) {
    throw new Error(`Agent adapter "${input.adapterId}" does not support resume.`);
  }

  const reopened = await reopenInterruptedAgentCheckpoint(input);

  try {
    const result = await resumeBoundedAgent({
      adapterId: input.adapterId,
      requestId: input.requestId,
      role: input.role,
      objective: input.objective,
      checkpointRef: reopened.checkpointRef,
      context: input.context,
      maxDurationMs: input.maxDurationMs,
      signal: input.signal,
    });
    await input.journal.finish(input.requestId, "completed", null);
    return result;
  } catch (error) {
    const cancelled = input.signal?.aborted === true
      || (error instanceof DOMException && error.name === "AbortError");
    await input.journal.finish(
      input.requestId,
      cancelled ? "cancelled" : "failed",
      null,
    ).catch(() => undefined);
    throw error;
  }
}
