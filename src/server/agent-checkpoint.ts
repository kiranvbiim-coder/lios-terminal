import crypto from "node:crypto";
import { z } from "zod";
import { agentInputSha256, agentPlanSha256 } from "./agentLoop";
import type { ConversationContextEnvelope } from "@shared/conversationRuntime";
import type { AgentDelegationBudget } from "./agent-delegation";

export const MAX_AGENT_CHECKPOINT_BYTES = 64 * 1024;
/** Extra allowance for the optional native L3 continuation (validated plan inputs + settled summaries). */
export const MAX_AGENT_CONTINUATION_BYTES = 768 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,299}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SECRET_WORD = /(secret|password|passwd|token|api[-_]?key|authorization|bearer)/i;

const opaqueId = z.string().regex(OPAQUE_ID);
const sha256 = z.string().regex(SHA256);
const safeRef = z.string().regex(REF).refine((value) => !SECRET_WORD.test(value), "Checkpoint references must not look like credentials.");

export const agentCheckpointOwnerSchema = z.object({
  userId: z.number().int().positive().safe(),
  projectId: z.number().int().positive().safe().nullable(),
  chatId: z.number().int().positive().safe().nullable(),
}).strict();
export type AgentCheckpointOwner = z.infer<typeof agentCheckpointOwnerSchema>;

export const AGENT_CHECKPOINT_STEP_STATUSES = [
  "pending",
  "waiting_approval",
  "running",
  "completed",
  "failed",
  "cancelled",
  "skipped",
] as const;

export const agentCheckpointStepSchema = z.object({
  stepId: opaqueId,
  toolId: opaqueId,
  inputSha256: sha256,
  dependsOn: z.array(opaqueId).max(32),
  status: z.enum(AGENT_CHECKPOINT_STEP_STATUSES),
  attempts: z.number().int().min(0).max(10),
}).strict();
export type AgentCheckpointStep = z.infer<typeof agentCheckpointStepSchema>;

export const agentCheckpointContextSchema = z.object({
  schemaVersion: z.literal("1"),
  identity: z.object({
    userId: z.number().int().positive().safe(),
    organizationId: z.number().int().positive().safe().nullable(),
    role: z.string().trim().min(1).max(80),
  }).strict(),
  project: z.object({
    projectId: z.number().int().positive().safe().nullable(),
    instructionIncluded: z.boolean(),
    projectInstructionsSha256: sha256.nullable().optional(),
    resourceRefSha256s: z.array(sha256).max(100),
  }).strict(),
  conversation: z.object({
    chatId: z.number().int().positive().safe().nullable(),
    scope: z.enum(["quick", "project", "temporary"]),
    sourceScope: z.enum(["auto", "my_data", "web", "files"]),
    branchIdSha256: sha256.nullable(),
  }).strict(),
  workspace: z.object({
    sessionIdSha256: sha256.nullable(),
    view: z.string().trim().max(120).nullable(),
    symbol: z.string().trim().max(120).nullable(),
  }).strict(),
  active: z.object({
    objectRefSha256s: z.array(sha256).max(50),
    selectionSha256: sha256.nullable(),
  }).strict(),
}).strict();
export type AgentCheckpointContext = z.infer<typeof agentCheckpointContextSchema>;

export const agentCheckpointToolOutcomeSchema = z.enum([
  "none_pending",
  "known_completed",
  "known_failed",
  "outcome_unknown",
]);
export type AgentCheckpointToolOutcome = z.infer<typeof agentCheckpointToolOutcomeSchema>;

/**
 * Native L3 continuation: the bounded, validated state the agent loop needs to continue without re-planning. It holds the
 * schema-validated model plan (raw tool inputs included, like the live approval-pause state) and tool-authored summaries.
 * It never holds the objective, grants, authorization, approval leases, the full context envelope, or provider credentials.
 */
const planStepId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);
const continuationStepSchema = z.object({
  id: planStepId,
  toolId: z.string().trim().min(1).max(300),
  skillId: z.string().trim().min(1).max(300).optional(),
  label: z.string().trim().min(1).max(200),
  input: z.record(z.unknown()),
  dependsOn: z.array(planStepId).max(10),
}).strict();
const continuationOutcomeSchema = z.object({
  id: planStepId,
  toolId: z.string().trim().min(1).max(300),
  label: z.string().trim().min(1).max(200),
  status: z.enum(["completed", "failed", "skipped", "denied"]),
  summary: z.string().max(2_000),
  deterministic: z.boolean(),
  sourceRefs: z.array(z.string().min(1).max(300)).max(10),
}).strict();
const budgetCount = z.number().int().min(0).max(1_000_000);
export const agentLoopContinuationSchema = z.object({
  version: z.literal(1),
  steps: z.array(continuationStepSchema).min(1).max(50),
  segment: z.array(planStepId).min(1).max(50),
  settled: z.array(continuationOutcomeSchema).max(50),
  counters: z.object({
    aiCalls: z.number().int().min(0).max(100),
    revisions: z.number().int().min(0).max(10),
    executed: z.number().int().min(0).max(50),
  }).strict(),
  delegatedBudgetUsed: z.object({
    maxSteps: budgetCount,
    maxAiCalls: budgetCount,
    maxRevisions: budgetCount,
    maxDurationMs: budgetCount,
  }).strict(),
}).strict();
export type AgentLoopContinuation = z.infer<typeof agentLoopContinuationSchema>;

const checkpointCoreCommon = {
  requestId: z.string().regex(UUID),
  sourceMessageId: z.number().int().positive().safe().nullable().optional(),
  owner: agentCheckpointOwnerSchema,
  ownerSha256: sha256,
  planSha256: sha256,
  steps: z.array(agentCheckpointStepSchema).max(64),
  toolSetSha256: sha256,
  policySha256: sha256,
  context: agentCheckpointContextSchema,
  contextSha256: sha256,
  evidenceRefs: z.array(safeRef).max(128),
  adapterId: opaqueId,
  checkpointRef: safeRef,
  toolOutcome: agentCheckpointToolOutcomeSchema,
  continuation: agentLoopContinuationSchema.optional(),
};

const checkpointResumeBindingSchema = z.object({
  // The server's execution/tenant role, distinct from a model-chosen specialist agent.
  role: z.string().trim().min(1).max(80),
  objectiveSha256: sha256,
  budget: z.object({
    maxSteps: z.number().int().min(1).max(50),
    maxAiCalls: z.number().int().min(1).max(20),
    maxRevisions: z.number().int().min(0).max(5),
    maxDurationMs: z.number().int().min(1_000).max(300_000),
  }).strict(),
}).strict();

// Retain version-1 reads for encrypted-journal audit; only fully bound v2 native
// continuations are eligible for future explicit restart. No legacy upgrade by inference.
const checkpointCoreV1Schema = z.object({ version: z.literal(1), ...checkpointCoreCommon }).strict();
const checkpointCoreV2Schema = z.object({
  version: z.literal(2),
  ...checkpointCoreCommon,
  resumeBinding: checkpointResumeBindingSchema,
}).strict();
const checkpointCoreSchema = z.discriminatedUnion("version", [
  checkpointCoreV1Schema, checkpointCoreV2Schema,
]);

export const agentCheckpointSnapshotSchema = z.discriminatedUnion("version", [
  checkpointCoreV1Schema.extend({ bindingSha256: sha256 }).strict(),
  checkpointCoreV2Schema.extend({ bindingSha256: sha256 }).strict(),
]);
export type AgentCheckpointSnapshot = z.infer<typeof agentCheckpointSnapshotSchema>;

export interface AgentCheckpointResumeBindingInput {
  role: string;
  /** Exact persisted initiating user-message content, never saved in the checkpoint. */
  objective: string;
  /** Actual server-resolved parent limits; never accepted from the client. */
  budget: AgentDelegationBudget;
}

export interface AgentCheckpointSnapshotInput {
  requestId: string;
  owner: AgentCheckpointOwner;
  planSha256: string;
  steps: readonly AgentCheckpointStep[];
  toolSetSha256: string;
  policySha256: string;
  projectInstructions?: string | null;
  sourceMessageId?: number | null;
  context: ConversationContextEnvelope;
  evidenceRefs?: readonly string[];
  adapterId: string;
  checkpointRef: string;
  toolOutcome: AgentCheckpointToolOutcome;
  continuation?: AgentLoopContinuation;
  resumeBinding?: AgentCheckpointResumeBindingInput;
}

export class AgentCheckpointBindingMismatchError extends Error {
  readonly code = "agent_checkpoint_binding_mismatch" as const;

  constructor(message = "Agent checkpoint no longer matches the current owner, plan, context, tool set, policy, or adapter.") {
    super(message);
    this.name = "AgentCheckpointBindingMismatchError";
  }
}

export class AgentCheckpointReconciliationRequiredError extends Error {
  readonly code = "agent_checkpoint_reconciliation_required" as const;

  constructor() {
    super("Agent checkpoint has an outcome-unknown dispatched tool and must be reconciled before resume.");
    this.name = "AgentCheckpointReconciliationRequiredError";
  }
}

function hashJson(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function digestEqual(left: string, right: string): boolean {
  if (!SHA256.test(left) || !SHA256.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function hashNullable(value: string | null): string | null {
  return value === null ? null : hashJson(value);
}

function assertUniqueStrings(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Agent checkpoint ${field} must be unique.`);
  }
}

function stableSelectionHash(selection: ConversationContextEnvelope["active"]["selection"]): string | null {
  if (!selection) return null;
  return hashJson({
    kind: selection.kind,
    id: selection.id,
    label: selection.label,
    text: selection.text,
    view: selection.view,
    symbol: selection.symbol,
  });
}

/**
 * Secret-minimizing projection of the existing P2 context envelope.
 * Resource/object/selection/branch/session values are hashed so the encrypted
 * journal binds resume to them without becoming another content store.
 */
export function checkpointContextFromEnvelope(
  context: ConversationContextEnvelope,
  projectInstructions?: string | null,
): AgentCheckpointContext {
  if (context.project.instructionIncluded && typeof projectInstructions !== "string") {
    throw new AgentCheckpointBindingMismatchError("Project instructions required by the current context are unavailable for checkpoint binding.");
  }
  const projectInstructionsSha256 = context.project.instructionIncluded
    ? hashJson(projectInstructions!)
    : null;
  const resourceRefSha256s = context.project.resourceRefs.map(hashJson);
  const objectRefSha256s = context.active.objectRefs.map(hashJson);
  assertUniqueStrings(resourceRefSha256s, "project resource refs");
  assertUniqueStrings(objectRefSha256s, "active object refs");

  return Object.freeze({
    schemaVersion: "1" as const,
    identity: Object.freeze({
      userId: context.identity.userId,
      organizationId: context.identity.organizationId,
      role: context.identity.role,
    }),
    project: Object.freeze({
      projectId: context.project.projectId,
      instructionIncluded: context.project.instructionIncluded,
      ...(context.project.instructionIncluded ? { projectInstructionsSha256 } : {}),
      resourceRefSha256s: Object.freeze(resourceRefSha256s) as unknown as string[],
    }),
    conversation: Object.freeze({
      chatId: context.conversation.chatId,
      scope: context.conversation.scope,
      sourceScope: context.conversation.sourceScope,
      branchIdSha256: hashNullable(context.conversation.branchId),
    }),
    workspace: Object.freeze({
      sessionIdSha256: hashNullable(context.workspace.sessionId),
      view: context.workspace.view,
      symbol: context.workspace.symbol,
    }),
    active: Object.freeze({
      objectRefSha256s: Object.freeze(objectRefSha256s) as unknown as string[],
      selectionSha256: stableSelectionHash(context.active.selection),
    }),
  });
}

function ownerDigest(owner: AgentCheckpointOwner): string {
  return hashJson({
    userId: owner.userId,
    projectId: owner.projectId,
    chatId: owner.chatId,
  });
}

function assertOwnerMatchesContext(owner: AgentCheckpointOwner, context: AgentCheckpointContext): void {
  if (
    owner.userId !== context.identity.userId ||
    owner.projectId !== context.project.projectId ||
    owner.chatId !== context.conversation.chatId
  ) {
    throw new AgentCheckpointBindingMismatchError("Agent checkpoint owner does not match its context envelope.");
  }
  if (context.conversation.scope === "temporary") {
    throw new AgentCheckpointBindingMismatchError("Temporary conversations cannot have durable agent checkpoints.");
  }
}

function checkpointBindingDigest(core: z.infer<typeof checkpointCoreSchema>): string {
  return hashJson(core);
}

function validateCheckpointSize(value: unknown): void {
  const hasContinuation = typeof value === "object" && value !== null && "continuation" in value && value.continuation !== undefined;
  const limit = MAX_AGENT_CHECKPOINT_BYTES + (hasContinuation ? MAX_AGENT_CONTINUATION_BYTES : 0);
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > limit) {
    throw new Error("Agent checkpoint exceeds the encrypted checkpoint size bound.");
  }
}

/** Checkpoint step projection of a continuation: settled outcomes by status, everything else still pending. */
export function checkpointStepsFromContinuation(continuation: AgentLoopContinuation): AgentCheckpointStep[] {
  const settled = new Map(continuation.settled.map((outcome) => [outcome.id, outcome] as const));
  return continuation.steps.map((step) => {
    const outcome = settled.get(step.id);
    const status: AgentCheckpointStep["status"] = !outcome ? "pending" : outcome.status === "denied" ? "failed" : outcome.status;
    return {
      stepId: step.id,
      toolId: step.toolId,
      inputSha256: agentInputSha256(step.input),
      dependsOn: [...step.dependsOn],
      status,
      attempts: !outcome || outcome.status === "skipped" ? 0 : 1,
    };
  });
}

function assertContinuationConsistent(core: z.infer<typeof checkpointCoreSchema>): void {
  const continuation = core.continuation;
  if (!continuation) return;
  assertUniqueStrings(continuation.steps.map((step) => step.id), "continuation step ids");
  const ids = new Set(continuation.steps.map((step) => step.id));
  assertUniqueStrings(continuation.segment, "continuation segment ids");
  assertUniqueStrings(continuation.settled.map((outcome) => outcome.id), "continuation settled ids");
  if (continuation.segment.some((id) => !ids.has(id)) || continuation.settled.some((outcome) => !ids.has(outcome.id))) {
    throw new AgentCheckpointBindingMismatchError("Agent checkpoint continuation references an unknown step.");
  }
  if (!digestEqual(core.planSha256, agentPlanSha256(continuation.steps))) {
    throw new AgentCheckpointBindingMismatchError("Agent checkpoint continuation does not match its plan hash.");
  }
  if (hashJson(core.steps) !== hashJson(checkpointStepsFromContinuation(continuation))) {
    throw new AgentCheckpointBindingMismatchError("Agent checkpoint steps do not match its continuation.");
  }
}


export function createAgentCheckpointSnapshot(input: AgentCheckpointSnapshotInput): AgentCheckpointSnapshot {
  const context = checkpointContextFromEnvelope(input.context, input.projectInstructions);
  const resumeBinding = input.resumeBinding ? checkpointResumeBindingSchema.parse({
    role: input.resumeBinding.role,
    objectiveSha256: hashJson(input.resumeBinding.objective),
    budget: input.resumeBinding.budget,
  }) : null;
  const core = checkpointCoreSchema.parse({
    version: resumeBinding ? 2 : 1,
    ...(resumeBinding ? { resumeBinding } : {}),
    requestId: input.requestId,
    ...(input.sourceMessageId !== undefined ? { sourceMessageId: input.sourceMessageId } : {}),
    owner: input.owner,
    ownerSha256: ownerDigest(input.owner),
    planSha256: input.planSha256,
    steps: input.steps.map((step) => ({ ...step, dependsOn: [...step.dependsOn] })),
    toolSetSha256: input.toolSetSha256,
    policySha256: input.policySha256,
    context,
    contextSha256: hashJson(context),
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    adapterId: input.adapterId,
    checkpointRef: input.checkpointRef,
    toolOutcome: input.toolOutcome,
    ...(input.continuation ? { continuation: input.continuation } : {}),
  });
  assertOwnerMatchesContext(core.owner, core.context);
  assertContinuationConsistent(core);
  assertUniqueStrings(core.steps.map((step) => step.stepId), "step ids");
  assertUniqueStrings(core.evidenceRefs, "evidence refs");
  assertCheckpointStepGraph(core.steps);
  const snapshot = agentCheckpointSnapshotSchema.parse({
    ...core,
    bindingSha256: checkpointBindingDigest(core),
  });
  validateCheckpointSize(snapshot);
  return Object.freeze(snapshot);
}

function assertCheckpointStepGraph(steps: readonly AgentCheckpointStep[]): void {
  const byId = new Map(steps.map((step) => [step.stepId, step] as const));
  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (!byId.has(dependency)) {
        throw new Error(`Agent checkpoint step ${step.stepId} depends on unknown step ${dependency}.`);
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (stepId: string): void => {
    if (visited.has(stepId)) return;
    if (visiting.has(stepId)) throw new Error("Agent checkpoint step graph contains a dependency cycle.");
    visiting.add(stepId);
    for (const dependency of byId.get(stepId)?.dependsOn ?? []) visit(dependency);
    visiting.delete(stepId);
    visited.add(stepId);
  };
  for (const step of steps) visit(step.stepId);
}

export function parseAgentCheckpointSnapshot(value: unknown): AgentCheckpointSnapshot {
  validateCheckpointSize(value);
  const parsed = agentCheckpointSnapshotSchema.parse(value);
  const { bindingSha256: _bindingSha256, ...coreCandidate } = parsed;
  const core = checkpointCoreSchema.parse(coreCandidate);
  assertOwnerMatchesContext(core.owner, core.context);
  assertContinuationConsistent(core);
  assertUniqueStrings(core.steps.map((step) => step.stepId), "step ids");
  assertUniqueStrings(core.evidenceRefs, "evidence refs");
  assertCheckpointStepGraph(core.steps);
  if (!digestEqual(parsed.ownerSha256, ownerDigest(parsed.owner))) {
    throw new AgentCheckpointBindingMismatchError("Agent checkpoint owner binding is invalid.");
  }
  if (!digestEqual(parsed.contextSha256, hashJson(parsed.context))) {
    throw new AgentCheckpointBindingMismatchError("Agent checkpoint context binding is invalid.");
  }
  if (!digestEqual(parsed.bindingSha256, checkpointBindingDigest(core))) {
    throw new AgentCheckpointBindingMismatchError("Agent checkpoint integrity binding is invalid.");
  }
  return Object.freeze(parsed);
}

export function assertAgentCheckpointStoredFor(input: {
  snapshot: AgentCheckpointSnapshot;
  requestId: string;
  owner: AgentCheckpointOwner;
}): AgentCheckpointSnapshot {
  const snapshot = parseAgentCheckpointSnapshot(input.snapshot);
  if (
    snapshot.requestId !== input.requestId ||
    !digestEqual(snapshot.ownerSha256, ownerDigest(input.owner))
  ) {
    throw new AgentCheckpointBindingMismatchError("Agent checkpoint belongs to a different run or owner.");
  }
  return snapshot;
}

/**
 * Explicit-resume revalidation. This function never executes and never mutates
 * the journal. The caller must independently re-check L1/L4 approval authority
 * before invoking the existing P2 resumeBoundedAgent hook.
 */
export function assertAgentCheckpointResumeCurrent(input: {
  snapshot: AgentCheckpointSnapshot;
  requestId: string;
  owner: AgentCheckpointOwner;
  planSha256: string;
  toolSetSha256: string;
  policySha256: string;
  projectInstructions?: string | null;
  sourceMessageId?: number | null;
  context: ConversationContextEnvelope;
  adapterId: string;
  resumeBinding?: AgentCheckpointResumeBindingInput;
}): AgentCheckpointSnapshot {
  const snapshot = assertAgentCheckpointStoredFor({
    snapshot: input.snapshot,
    requestId: input.requestId,
    owner: input.owner,
  });
  const currentContext = checkpointContextFromEnvelope(input.context, input.projectInstructions);
  assertOwnerMatchesContext(input.owner, currentContext);

  if (!digestEqual(snapshot.planSha256, input.planSha256)) {
    throw new AgentCheckpointBindingMismatchError("The agent plan changed after this checkpoint.");
  }
  if (!digestEqual(snapshot.toolSetSha256, input.toolSetSha256)) {
    throw new AgentCheckpointBindingMismatchError("The available governed tool set changed after this checkpoint.");
  }
  if (!digestEqual(snapshot.policySha256, input.policySha256)) {
    throw new AgentCheckpointBindingMismatchError("The execution policy changed after this checkpoint.");
  }
  if (!digestEqual(snapshot.contextSha256, hashJson(currentContext))) {
    throw new AgentCheckpointBindingMismatchError("The conversation context or Project instructions changed after this checkpoint.");
  }
  if (snapshot.adapterId !== input.adapterId) {
    throw new AgentCheckpointBindingMismatchError("The checkpoint's agent adapter changed.");
  }
  if ((snapshot.sourceMessageId ?? null) !== (input.sourceMessageId ?? null)) {
    throw new AgentCheckpointBindingMismatchError("The initiating chat message changed after this checkpoint.");
  }
  // Native version-1 records remain readable for audit but never silently
  // inherit a newly introduced original-objective/role/budget authority.
  if (snapshot.version === 1 && snapshot.continuation) {
    throw new AgentCheckpointBindingMismatchError("Legacy native checkpoint has no original role, objective or budget binding.");
  }
  if (snapshot.version === 2) {
    const current = input.resumeBinding ? checkpointResumeBindingSchema.safeParse({
      role: input.resumeBinding.role,
      objectiveSha256: hashJson(input.resumeBinding.objective),
      budget: input.resumeBinding.budget,
    }) : null;
    if (!current?.success || !digestEqual(hashJson(snapshot.resumeBinding), hashJson(current.data))) {
      throw new AgentCheckpointBindingMismatchError("The original agent role, objective or execution budget changed.");
    }
  }
  if (snapshot.toolOutcome === "outcome_unknown") {
    throw new AgentCheckpointReconciliationRequiredError();
  }
  return snapshot;
}

export function checkpointRequiresReconciliation(snapshot: AgentCheckpointSnapshot): boolean {
  return parseAgentCheckpointSnapshot(snapshot).toolOutcome === "outcome_unknown";
}
