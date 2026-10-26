import crypto from "crypto";
import { z } from "zod";
import { tenantContext } from "./tenantContext";
import {
  addProjectChatMessage,
  autoTitleProjectChat,
  getProjectChat,
  listProjectChatMessages,
} from "./projectChatStore";
import { getProject } from "./projectStore";
import { getArtifact, getArtifactVersion, persistConversationDraft } from "./artifactStore";
import { listProjectResources } from "./projectResourceStore";
import { getEnvironmentSetupForUser } from "./environmentSetupService";
import { requireMasterAiOn } from "./masterAiGate";
import type { PersonaPreferenceUser } from "./personaPreferenceService";
import {
  buildConversationContext,
  currentAgentLoopFacts,
  agentResumeToolFacts,
  currentConversationToolApprovalPolicy,
  executeConversationRuntime,
  getConversationTool,
  includedResourceRefs,
  planConversationWorkflow,
} from "./conversationRuntime";
import type { ConversationRuntimeInput, ConversationRuntimeResult } from "./conversationRuntime";
import { createConversationLedgerRecorder } from "./ledgerReproducibility";
import {
  assertGovernedToolAuthorizationMatches,
  discardGovernedToolOperation,
  effectiveApprovals,
  proposeGovernedToolOperation,
  resolveGovernedToolOperation,
  reviewGovernedToolOperation,
  snapshotGovernedToolInput,
  type GovernedToolAuthorization,
} from "./conversationGrantStore";
import { conversationRequestSchema } from "@shared/conversationRuntime";
import type { ProjectChatMessage, ProjectResource } from "@shared/schemaProjects";
import type {
  ConversationRequest,
  ConversationRuntimeEvent,
  ConversationScope,
  GovernedToolReviewDecision,
  WorkflowPlan,
} from "@shared/conversationRuntime";
import { voiceExecutionReviewSchema } from "@shared/multimodalContracts";
import { assertVoiceTranscriptReviewed, prepareVoiceConversationRequest } from "./p12VoiceRuntime";
import {
  ProjectAttachmentContextExcludedError,
  ProjectAttachmentLimitError,
  ProjectAttachmentNotFoundError,
  publicAttachmentRefsFromResources,
  resolveProjectConversationAttachments,
  resolveQuickChatConversationAttachments,
} from "./projectAttachmentService";
import { ProjectAttachmentContentError } from "./projectAttachmentContent";
import type { ResolvedConversationAttachment } from "./projectAttachmentContent";
import { PROJECT_ATTACHMENT_MAX_PER_MESSAGE, ProjectAttachmentStorageUnavailableError } from "./projectAttachmentStore";
import { ConversationRunConflictError, conversationRuns } from "./conversationRunRegistry";
import {
  AgentCheckpointBindingMismatchError,
  AgentCheckpointReconciliationRequiredError,
  assertAgentCheckpointResumeCurrent,
  type AgentCheckpointSnapshot,
  type AgentCheckpointResumeBindingInput,
} from "./agent-checkpoint";
import { reopenInterruptedAgentCheckpoint } from "./agent-checkpoint-runtime";
import {
  NATIVE_AGENT_LOOP_ADAPTER_ID,
  AgentRestartCheckpointUnsafeError,
  AgentRestartResumeRefusedError,
  nativeContinuationOf,
  planAgentLoopReopen,
} from "./agentLoopCheckpoint";
import {
  AgentRestartSourceError,
  agentRestartMetadata,
  resolveAgentRestartSource,
  type AgentRestartSource,
} from "./agentRestartRequest";
import { ExecutionJournalRunIdConflictError, type ExecutionJournalRecord } from "./exec/execution-journal";
import type { TenantContext } from "./tenantContext";
import type { ConversationContextEnvelope } from "@shared/conversationRuntime";
import type { RunSummary } from "./conversationRunRegistry";
import { retainedArtifactMessageRef } from "@shared/conversationArtifactRefs";
import { savedChatArtifactAnswer } from "./savedChatArtifactAnswer";
import { deriveWorkingContext, resolveWorkingContextRequest, restoreWorkingContext } from "@shared/workingContext";
import type { WorkingContextOwner, WorkingContextResolution } from "@shared/workingContext";
import type { WorkingContextSnapshot } from "@shared/conversationRuntime";
import { ConversationExecutionTranscript, ConversationJournalError, getConversationExecutionJournal, withConversationExecutionScope } from "./exec/execution-scope";
import { SandboxRuntimeConfigurationError } from "./exec/sandbox-runtime-profile";
import type { AgentEventInput } from "./exec/agent-run-events";
import { AgentDispatchOutcomeUnknownError, agentPlanSha256, type AgentLoopContinuationState, type AgentLoopReopen } from "./agentLoop";
import { createNativeAgentLoopCheckpoint } from "./agentLoopCheckpoint";
import { createRunApprovalResumeBinding, releaseRunApprovalAndContinue } from "./exec/approval-continuation";
import { proposeAgentExecOperation } from "./agentExecOperation";
import { proposeCodingCheckOperation } from "./acp/coding-exec-operation";
import { codingCheckInputSchema } from "./acp/coding-tools";

/**
 * Starts Conversation Runtime runs for a signed-in user (GM-08b). Both doors — the Gateway (`conversation.start`) and
 * the HTTP/SSE `respond` endpoints — go through here, so there is one engine, one validation path and one run
 * registry. Everything that can be rejected is rejected *before* the run is registered, as a ConversationStartError
 * carrying the HTTP status and body the HTTP door returns and the Gateway maps to a protocol error.
 */

export type ConversationUser = PersonaPreferenceUser;

export class ConversationStartError extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : "Conversation request rejected.");
    this.name = "ConversationStartError";
  }
}

const wireRequestSchema = conversationRequestSchema.extend({
  requestId: z.string().uuid().optional(),
  voiceReview: voiceExecutionReviewSchema.optional(),
});

const temporarySchema = wireRequestSchema.extend({
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(200_000),
  }).strict()).max(20).default([]),
  /** Client-held Working Context (Temporary chats keep it in memory only); validated by `restoreWorkingContext`. */
  workingContext: z.unknown().optional(),
});

function parseWire<T extends z.ZodType>(schema: T, raw: unknown, message: string): z.output<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ConversationStartError(400, { error: message, issues: parsed.error.issues });
  return parsed.data;
}

function canonicalRequest(input: z.infer<typeof wireRequestSchema>): ConversationRequest {
  return conversationRequestSchema.parse({
    ...input,
    requestId: input.requestId ?? crypto.randomUUID(),
  });
}

/**
 * GM-11a: the grants a run may rely on come from the server store, never from the request body. Whatever the client
 * sent in `approvals` / `aiDirectApproved` is discarded here; one-time approvals are consumed by the run they approve.
 */
async function withServerApprovals(user: ConversationUser, request: ConversationRequest, projectId: number | null): Promise<ConversationRequest> {
  const approvals = await effectiveApprovals({ user, projectId, continuationOf: request.continuationOf });
  return conversationRequestSchema.parse({
    ...request,
    approvals,
    aiDirectApproved: request.executionMode === "ai_direct" && approvals.some((grant) => grant.action === "AIDirectEstimate"),
  });
}

type DoneEvent = Extract<ConversationRuntimeEvent, { type: "done" }>;

interface HeldRun {
  /** The runtime's own `done`, held back so the turn's Working Context (and the saved answer) can precede or ride on it. */
  done: DoneEvent | null;
  errored: boolean;
}

interface GovernedAgentPausePayload {
  pause: NonNullable<ConversationRuntimeResult["agentPause"]>;
  reviewId: string;
  createExecutor: (authorization: GovernedToolAuthorization) =>
    (emit: (event: ConversationRuntimeEvent) => void, signal: AbortSignal) => Promise<void>;
  terminalizeCancelled: () => Promise<void>;
}


/** The runtime threw: end the run the way the registry would (an error unless one was reported, then `done`), with the pre-run context attached. */
function endFailedRun(
  emit: (event: ConversationRuntimeEvent) => void,
  requestId: string,
  held: HeldRun,
  error: unknown,
  workingContext: WorkingContextSnapshot | null,
): void {
  const at = new Date().toISOString();
  if (!held.errored || error instanceof ConversationJournalError) emit({ type: "error", requestId, at, code: error instanceof ConversationJournalError ? "execution_journal_failed" : "request_failed", message: error instanceof Error ? error.message : "Conversation Runtime failed." });
  emit({ type: "done", requestId, at, status: "failed", workingContext });
}

/** The newest message that carries a snapshot wins (a finished turn's assistant message, else the pre-run one on the user message). An invalid one means "no context", never an older snapshot. */
function savedWorkingContext(
  history: ReadonlyArray<{ metadata: Record<string, unknown> }>,
  owner: WorkingContextOwner,
): WorkingContextSnapshot | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const stored = history[index]!.metadata.workingContext;
    if (stored !== undefined) return restoreWorkingContext(stored, owner);
  }
  return null;
}

/** Working Context is only a hint: a failure here is left for the real lookup further down to report with the right status. */
async function loadSavedChatState(user: ConversationUser, chatId: number, historyOverride?: ProjectChatMessage[]) {
  try {
    const context = tenantContext(user);
    const chat = await getProjectChat(context, chatId);
    const history = historyOverride ?? await listProjectChatMessages(context, chatId);
    return { chat, history, carried: savedWorkingContext(history, { scope: chat.scope, projectId: chat.projectId, chatId }) };
  } catch {
    return null;
  }
}

function assertWorkingContextResolved(resolution: WorkingContextResolution): void {
  if (!resolution.clarification) return;
  throw new ConversationStartError(409, {
    code: "working_context_clarification_required",
    error: resolution.clarification.message,
    requestId: resolution.request.requestId,
    symbols: resolution.clarification.symbols,
  });
}

/** A JSON reference is never permission to read or mutate an Artifact. */
async function assertWorkingContextArtifacts(
  user: ConversationUser,
  scope: ConversationScope,
  projectId: number | null,
  chatId: number | null,
  request: ConversationRequest,
  carried: WorkingContextSnapshot | null,
): Promise<void> {
  const refs = [...new Set([
    ...(request.context?.activeObjectRefs ?? []).filter((ref) => /^artifact:[0-9a-f-]{36}$/i.test(ref)),
    ...(carried?.activeArtifact ? [carried.activeArtifact] : []),
  ])];
  for (const ref of refs) {
    if (scope === "temporary") {
      throw new ConversationStartError(403, { code: "working_context_artifact_forbidden", error: "Temporary Chat cannot access retained Artifact context.", requestId: request.requestId });
    }
    const artifact = await getArtifact(tenantContext(user), ref).catch(() => null);
    if (!artifact || artifact.projectId !== projectId || (scope === "quick" && artifact.owningChatId !== chatId)) {
      throw new ConversationStartError(403, { code: "working_context_artifact_forbidden", error: "Artifact context is outside this Chat ownership boundary.", requestId: request.requestId });
    }
  }
}

async function resolveEffectiveConversationRequest(
  user: ConversationUser,
  requestInput: ConversationRequest,
): Promise<{ request: ConversationRequest; plan: WorkflowPlan }> {
  let request = requestInput;
  let plan = planConversationWorkflow(request);

  if (request.executionMode === "deterministic_first") return { request, plan };

  const gate = await requireMasterAiOn(user);
  if (gate.ok) return { request, plan };

  if (plan.intent.requiresAI) throw new ConversationStartError(gate.status, { error: gate.error });

  // AI-assisted synthesis is optional for deterministic work. Respect an
  // explicit AI-off preference (or unavailable preference service) by
  // degrading to deterministic-only execution without blocking the task.
  request = conversationRequestSchema.parse({
    ...request,
    executionMode: "deterministic_first",
  });
  plan = planConversationWorkflow(request);
  return { request, plan };
}

function assertVoiceReviewed(
  request: ConversationRequest,
  voiceReview: z.infer<typeof voiceExecutionReviewSchema> | undefined,
) {
  const voiceConversation = voiceReview
    ? prepareVoiceConversationRequest({ baseRequest: request, transcripts: voiceReview.transcripts, editedText: request.message })
    : null;
  if (voiceConversation) {
    try {
      assertVoiceTranscriptReviewed(voiceConversation, voiceReview?.transcriptReviewed ?? false);
    } catch (error) {
      throw new ConversationStartError(428, {
        code: "voice_transcript_review_required",
        error: error instanceof Error ? error.message : "Review the spoken transcript before this high-impact action.",
        requestId: request.requestId,
      });
    }
  }
  return voiceConversation;
}

function startErrorFor(error: unknown, requestId: string): ConversationStartError {
  if (error instanceof AgentCheckpointBindingMismatchError) {
    return new ConversationStartError(409, { code: "agent_resume_drift", error: "The tools, policy, context or plan changed since this run was interrupted; it cannot be resumed safely.", requestId });
  }
  if (error instanceof AgentCheckpointReconciliationRequiredError) {
    return new ConversationStartError(409, { code: "agent_resume_reconciliation_required", error: error.message, requestId });
  }
  if (error instanceof AgentRestartResumeRefusedError || error instanceof AgentRestartSourceError) {
    return new ConversationStartError(409, { code: error.code, error: error.message, requestId });
  }
  if (error instanceof ConversationStartError) return error;
  if (error instanceof ConversationJournalError) {
    return new ConversationStartError(503, { code: "execution_journal_failed", error: error.message, requestId });
  }
  if (error instanceof ExecutionJournalRunIdConflictError) {
    return new ConversationStartError(409, { code: "request_id_already_used", error: "This request id already identifies an execution.", requestId });
  }
  if (error instanceof ConversationRunConflictError) return new ConversationStartError(409, { code: "run_conflict", error: error.message, requestId });
  const status = error instanceof ProjectAttachmentLimitError ? 413
    : error instanceof ProjectAttachmentContextExcludedError ? 409
      : error instanceof ProjectAttachmentNotFoundError ? 404
        : error instanceof ProjectAttachmentStorageUnavailableError ? 503
          : error instanceof SandboxRuntimeConfigurationError ? 503
            : error instanceof ProjectAttachmentContentError ? 400
              : 500;
  const message = status === 500 && error instanceof Error && /ENOENT|EACCES|storage|blob|project-attachments/i.test(error.message)
    ? "Project attachment storage is unavailable. Check the local storage volume and try again."
    : error instanceof Error ? error.message : "Conversation Runtime failed.";
  return new ConversationStartError(status, {
    ...(error instanceof ProjectAttachmentContextExcludedError ? { code: "project_attachment_context_excluded" } : {}),
    ...(error instanceof SandboxRuntimeConfigurationError ? { code: "sandbox_runtime_unavailable" } : {}),
    error: message,
    requestId,
  });
}

/** Server-internal options. These are never read from a request body. */
export interface ConversationRunServiceOptions {
  /** Model seam for tests; production leaves it unset and uses the single BYOAI path. */
  aiCompletion?: ConversationRuntimeInput["aiCompletion"];
  nodeFinanceGateway?: ConversationRuntimeInput["nodeFinanceGateway"];
}

interface RestartLaunch {
  source: AgentRestartSource;
  /** The interrupted journal record as read for its owning user; its Project/Chat has been authorized by the caller. */
  record: ExecutionJournalRecord;
}

interface PreparedRestartRun {
  /** The owner-bound checkpoint continuation, with the plan hash the checkpoint is bound to. */
  state: AgentLoopContinuationState;
  reopen: AgentLoopReopen | null;
  envelope: ConversationContextEnvelope;
  toolSetSha256: string;
  policySha256: string;
  resumeBinding: AgentCheckpointResumeBindingInput;
  revalidateAuthorization: (checkpoint: AgentCheckpointSnapshot) => Promise<void>;
}

/** Attachments are re-resolved from current Project resources; any change since the run started refuses the resume. */
function assertRestartAttachmentsUnchanged(
  stored: ReadonlyArray<{ id: string; sha256: string; byteLength: number }>,
  current: ReadonlyArray<{ id: string; sha256: string; byteLength: number }>,
  requestId: string,
): void {
  const key = (item: { id: string; sha256: string; byteLength: number }) => `${item.id}:${item.sha256}:${item.byteLength}`;
  const left = stored.map(key).sort();
  const right = current.map(key).sort();
  if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
    throw new ConversationStartError(409, { code: "agent_resume_attachment_drift", error: "The files attached to this run changed since it was interrupted; it cannot be resumed safely.", requestId });
  }
}

/**
 * Read-only preparation of a restart-resume: rebuild the CURRENT context envelope, tool set and policy facts, validate the
 * owner-bound checkpoint against them, and reconcile the durable ledger. Nothing is written and nothing executes.
 */
async function prepareRestartRun(input: {
  user: ConversationUser;
  chatId: number;
  chat: { scope: ConversationScope; projectId: number | null };
  tenant: TenantContext;
  restart: RestartLaunch;
  runtimeRequest: ConversationRequest;
  resources: ProjectResource[];
  projectName: string | null;
  projectInstructions: string | null;
  resolvedAttachments: ResolvedConversationAttachment[];
}): Promise<PreparedRestartRun> {
  const { record } = input.restart;
  const checkpoint = record.checkpoint;
  const continuation = nativeContinuationOf(checkpoint);
  if (!checkpoint || !continuation || !record.events) {
    throw new ConversationStartError(409, { code: "agent_resume_unavailable", error: "This execution has no checkpoint it can resume from.", requestId: record.id });
  }
  const envelope = buildConversationContext({
    tenant: input.tenant,
    scope: input.chat.scope,
    chatId: input.chatId,
    projectId: input.chat.projectId,
    projectName: input.projectName,
    projectInstructions: input.projectInstructions,
    resources: input.resources.map((resource) => ({
      id: resource.id,
      kind: resource.kind,
      label: resource.label,
      resourceRef: resource.resourceRef,
      contextMode: resource.contextMode,
    })),
    request: input.runtimeRequest,
    resolvedAttachments: input.resolvedAttachments,
  });
  const facts = currentAgentLoopFacts(input.tenant.role);
  const resumeBinding: AgentCheckpointResumeBindingInput = {
    role: input.tenant.role,
    objective: input.restart.source.objective,
    budget: facts.budget,
  };
  assertAgentCheckpointResumeCurrent({
    snapshot: checkpoint,
    requestId: record.id,
    owner: record.owner,
    planSha256: agentPlanSha256(continuation.steps),
    toolSetSha256: facts.toolSetSha256,
    policySha256: facts.policySha256,
    context: envelope,
    projectInstructions: input.projectInstructions,
    sourceMessageId: input.restart.source.messageId,
    adapterId: NATIVE_AGENT_LOOP_ADAPTER_ID,
    resumeBinding,
  });
  const reopen = planAgentLoopReopen({
    requestId: record.id,
    events: record.events,
    continuation,
    toolFacts: agentResumeToolFacts,
  });
  return {
    state: { ...continuation, planSha256: checkpoint.planSha256 },
    reopen,
    envelope,
    ...facts,
    resumeBinding,
    // Re-checked again at the moment of the atomic reopen: the chat and Project must still be this user's, and AI still on.
    revalidateAuthorization: async () => {
      await getProjectChat(input.tenant, input.chatId);
      if (input.chat.projectId) await getProject(input.tenant, input.chat.projectId);
      const gate = await requireMasterAiOn(input.user);
      if (!gate.ok) throw new ConversationStartError(gate.status, { error: gate.error, requestId: record.id });
    },
  };
}

const projectChatWireSchema = wireRequestSchema.extend({
  /** SI-02 L3 opt-in: run the bounded agent loop. Needs AI-assisted mode; recorded in a v2 journal record. */
  agent: z.boolean().default(false),
});

export async function startProjectChatRun(
  user: ConversationUser,
  chatId: number,
  rawBody: unknown,
  options: ConversationRunServiceOptions = {},
): Promise<RunSummary> {
  return runProjectChat(user, chatId, rawBody, options, null);
}

async function runProjectChat(
  user: ConversationUser,
  chatId: number,
  rawBody: unknown,
  options: ConversationRunServiceOptions,
  restart: RestartLaunch | null,
): Promise<RunSummary> {
  const wire = parseWire(projectChatWireSchema, rawBody, "Invalid chat request.");
  const { voiceReview, agent, ...conversationInput } = wire;
  const initialRequest = canonicalRequest(conversationInput);
  const early = restart ? await loadSavedChatState(user, chatId, restart.source.priorHistory) : await loadSavedChatState(user, chatId);
  if (restart && !early) throw new ConversationStartError(404, { code: "interrupted_run_not_found", error: "Interrupted execution not found.", requestId: initialRequest.requestId });
  const resolution = resolveWorkingContextRequest(initialRequest, early?.carried ?? null);
  assertWorkingContextResolved(resolution);
  if (early) await assertWorkingContextArtifacts(user, early.chat.scope, early.chat.projectId, chatId, resolution.request, early.carried);
  const { request, plan } = await resolveEffectiveConversationRequest(user, resolution.request);
  if (agent && request.executionMode !== "ai_assisted") {
    throw new ConversationStartError(409, { code: "agent_requires_ai", error: "Agent runs need AI-assisted mode with AI turned on.", requestId: request.requestId });
  }
  const voiceConversation = assertVoiceReviewed(request, voiceReview);

  let finalizeUnstartedRun: (() => Promise<void>) | null = null;
  try {
    const context = tenantContext(user);
    const chat = early?.chat ?? await getProjectChat(context, chatId);
    if (request.attachments.length > PROJECT_ATTACHMENT_MAX_PER_MESSAGE) {
      throw new ProjectAttachmentLimitError("A message can include at most five attachments.");
    }

    let projectName: string | null = null;
    let projectInstructions: string | null = null;
    let resources: ProjectResource[] = [];
    if (chat.projectId) {
      const [project, projectResources] = await Promise.all([
        getProject(context, chat.projectId),
        listProjectResources(context, chat.projectId),
      ]);
      projectName = project.name;
      projectInstructions = project.instructions;
      resources = projectResources;
    }

    let resolvedAttachments: ResolvedConversationAttachment[] = [];
    const approvedRequest = await withServerApprovals(user, request, chat.scope === "project" ? chat.projectId : null);
    let runtimeRequest = approvedRequest;
    if (chat.scope === "project" && chat.projectId) {
      const projectRuntimeResources = resources.map((resource) => ({
        id: resource.id,
        kind: resource.kind,
        label: resource.label,
        resourceRef: resource.resourceRef,
        contextMode: resource.contextMode,
      }));
      const sourceScopedAttachments = request.sourceScope === "web" ? [] : request.attachments;
      const projectScopedAttachments = sourceScopedAttachments.filter((attachment) => !attachment.sourceRef.startsWith("quick-attachment:"));
      const quickScopedAttachments = sourceScopedAttachments.filter((attachment) => attachment.sourceRef.startsWith("quick-attachment:"));
      const selectedResources = includedResourceRefs(
        projectRuntimeResources,
        request.message,
        projectScopedAttachments,
        request.sourceScope,
      ).filter((resource) => resource.kind === "chat_attachment");
      const selectedResourceIds = new Set(selectedResources.map((resource) => resource.id));
      const selectedProjectResources = resources.filter((resource) => selectedResourceIds.has(resource.id));
      const canonicalById = new Map([
        ...projectScopedAttachments.map((attachment) => [attachment.id, attachment] as const),
        ...publicAttachmentRefsFromResources(selectedProjectResources).map((attachment) => [attachment.id, attachment] as const),
      ]);
      resolvedAttachments = await resolveProjectConversationAttachments(
        context,
        chat.projectId,
        resources,
        Array.from(canonicalById.values()),
        request.transmissionPolicy.allowResourceReferences,
      );
      if (quickScopedAttachments.length) {
        // An explicitly promoted Quick Chat retains the original chat-owned files; no Project resource is fabricated.
        resolvedAttachments.push(...await resolveQuickChatConversationAttachments(
          context, chatId, quickScopedAttachments, request.transmissionPolicy.allowResourceReferences,
        ));
      }
    } else if (chat.scope === "quick") {
      resolvedAttachments = await resolveQuickChatConversationAttachments(
        context, chatId, request.sourceScope === "web" ? [] : request.attachments,
        request.transmissionPolicy.allowResourceReferences,
      );
    }
    if (resolvedAttachments.length > PROJECT_ATTACHMENT_MAX_PER_MESSAGE || new Set(resolvedAttachments.map((item) => item.reference.id)).size !== resolvedAttachments.length) {
      throw new ProjectAttachmentLimitError("A message contains too many or duplicate attachment references.");
    }
    runtimeRequest = conversationRequestSchema.parse({ ...approvedRequest, attachments: resolvedAttachments.map((item) => item.reference) });
    if (restart) assertRestartAttachmentsUnchanged(restart.source.attachments, runtimeRequest.attachments, request.requestId);

    const priorHistory = early?.history ?? await listProjectChatMessages(context, chatId);
    if (agent && !restart && !request.continuationOf
      && priorHistory.some((message) => message.role === "user" && message.metadata.runtimeRequestId === request.requestId)) {
      throw new ConversationStartError(409, {
        code: "request_id_already_used",
        error: "This request id already identifies a message in this chat.",
        requestId: request.requestId,
      });
    }
    const aiSetup = await getEnvironmentSetupForUser(user.id);
    const owner = { scope: chat.scope, projectId: chat.projectId, chatId } as const;
    const carried = early?.carried ?? null;
    // The snapshot for this turn is derivable from the request alone, so it is saved with the user message: a turn that
    // fails before answering still leaves the chat knowing what it was about. A completed run overwrites it (below).
    const preRun = deriveWorkingContext({ previous: carried, owner, resolution: { ...resolution, request: runtimeRequest }, plan, result: { receiptIds: [] }, providerId: aiSetup?.aiProviderId ?? null });
    const journal = await getConversationExecutionJournal().catch((error: unknown) => { throw new ConversationJournalError(error); });
    const runOwner = { userId: user.id, projectId: chat.projectId, chatId } as const;
    const transcript = new ConversationExecutionTranscript(journal, request.requestId);
    let begun = restart !== null;
    if (!begun) {
      try {
        await journal.begin({
          id: request.requestId,
          owner: runOwner,
          label: agent ? "Agent run" : "Conversation execution",
          agentRun: agent,
        });
        begun = true;
        finalizeUnstartedRun = () => transcript.finish("failed");
      } catch (error) {
        if (error instanceof ExecutionJournalRunIdConflictError) throw error;
        throw new ConversationJournalError(error);
      }
    }
    let initiatingMessageId: number | null = restart?.source.messageId ?? null;
    if (!request.continuationOf && !restart) {
      const initiatingMessage = await addProjectChatMessage(context, chatId, {
        role: "user",
        content: request.message,
        metadata: {
          runtimeRequestId: request.requestId,
          ...(agent ? agentRestartMetadata(initialRequest) : {}),
          executionMode: request.executionMode,
          workingContext: preRun,
          ...(voiceConversation ? {
            voiceReview: {
              transcriptReviewed: voiceReview!.transcriptReviewed,
              transcriptEdited: voiceConversation.transcriptEdited,
              transcripts: voiceConversation.transcripts.map(({ transcriptId, providerId, local, language, durationMs, confidence, audioSha256, sourceRef }) => ({
                transcriptId, providerId, local, language, durationMs, confidence, audioSha256, sourceRef,
              })),
            },
          } : {}),
          attachments: runtimeRequest.attachments.map((attachment) => ({
            id: attachment.id,
            kind: attachment.kind,
            sourceRef: attachment.sourceRef,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            sha256: attachment.sha256,
            byteLength: attachment.byteLength,
          })),
        },
      });
      initiatingMessageId = initiatingMessage.id;
      await autoTitleProjectChat(context, chatId, request.message);
    }
    const runtimeHistory = request.continuationOf
      && priorHistory.at(-1)?.role === "user"
      && priorHistory.at(-1)?.content === request.message
      ? priorHistory.slice(0, -1)
      : priorHistory;

    const preparedRestart = restart ? await prepareRestartRun({
      user, chatId, chat, tenant: context, restart, runtimeRequest, resources, projectName, projectInstructions, resolvedAttachments,
    }) : null;
    const ledger = createConversationLedgerRecorder({
      tenant: context,
      projectId: chat.projectId,
      chatId,
      sessionId: chat.projectId ? request.context?.sessionId ?? null : null,
      request: runtimeRequest,
      plan,
    });
    if (!restart) await ledger.recordRequest();

    // Owner-only display data survives live approval resumes, not process
    // restarts or model checkpoints. A restarted run must inspect again.
    const ownerMemoryInspection: { text: string | null } = { text: null };
    const executeAttempt = (
      resume?: { state: NonNullable<ConversationRuntimeResult["agentPause"]>["resume"]; authorization: GovernedToolAuthorization },
      restartRun?: PreparedRestartRun,
    ) => async (emit: (event: ConversationRuntimeEvent) => void, signal: AbortSignal): Promise<void> => {
      // `done` is held until durable transcript/message state is committed.
      const held: HeldRun = { done: null, errored: false };
      let governedApprovalEvent: Extract<ConversationRuntimeEvent, { type: "governed_tool_approval_required" }> | null = null;
      let pendingReviewId: string | null = null;
      let pendingExactToolCallId: string | null = null;
      if (restartRun) {
        // Registered first, reopened second: a refusal here leaves the record interrupted and the run ends visibly failed.
        try {
          await reopenInterruptedAgentCheckpoint({
            journal,
            requestId: request.requestId,
            owner: runOwner,
            adapterId: NATIVE_AGENT_LOOP_ADAPTER_ID,
            planSha256: restartRun.state.planSha256,
            toolSetSha256: restartRun.toolSetSha256,
            policySha256: restartRun.policySha256,
            projectInstructions,
            sourceMessageId: initiatingMessageId,
            context: restartRun.envelope,
            resumeBinding: restartRun.resumeBinding,
            revalidateAuthorization: restartRun.revalidateAuthorization,
            signal,
          });
        } catch (error) {
          endFailedRun(emit, request.requestId, held, error, preRun);
          return;
        }
      }
      const persistedArtifacts: Array<{ id: string; version: number; title: string; kind: string }> = [];
      const pendingArtifacts: Extract<ConversationRuntimeEvent, { type: "artifact" }>[] = [];
      try {
        const result = await withConversationExecutionScope(request.requestId, () => executeConversationRuntime({
          tenant: context,
          signal,
          scope: chat.scope,
          chatId,
          projectId: chat.projectId,
          projectName,
          projectInstructions,
          resources: resources.map((resource) => ({
            id: resource.id,
            kind: resource.kind,
            label: resource.label,
            resourceRef: resource.resourceRef,
            contextMode: resource.contextMode,
          })),
          history: runtimeHistory.slice(-20).map((message) => ({
            role: message.role === "user" ? "user" : "assistant",
            content: message.content,
          })),
          request: runtimeRequest,
          ...(agent ? {
            agentLoop: {
              ownerMemoryInspection,
              ledger: (event: AgentEventInput) => journal.appendAgentEvent(request.requestId, event),
              prepareApproval: async ({ step, toolCallId }) => {
                if (!chat.projectId) {
                  if (
                    step.toolId === "agent.python.data"
                    || step.toolId === "agent.shell.command"
                    || step.toolId === "lios.coding.run_check"
                  ) throw new Error("Governed agent execution requires a Project chat.");
                  return;
                }
                if (step.toolId === "lios.coding.run_check") {
                  const coding = codingCheckInputSchema.parse(step.input);
                  await proposeCodingCheckOperation({
                    user,
                    projectId: chat.projectId,
                    chatId,
                    requestId: request.requestId,
                    toolCallId,
                    workspaceSha256: coding.workspaceSha256,
                    check: coding.check,
                    targets: coding.targets,
                    recordPreparedEvidence: (event) => journal.appendAgentEvent(request.requestId, event),
                    signal,
                  });
                  return;
                }
                if (step.toolId !== "agent.python.data" && step.toolId !== "agent.shell.command") return;
                const execution = step.toolId === "agent.python.data"
                  ? { kind: "python" as const, code: String(step.input.code ?? "") }
                  : { kind: "shell" as const, command: String(step.input.command ?? "") };
                await proposeAgentExecOperation({
                  user,
                  projectId: chat.projectId,
                  chatId,
                  requestId: request.requestId,
                  toolCallId,
                  execution,
                  recordPreparedEvidence: (event) => journal.appendAgentEvent(request.requestId, event),
                  signal,
                });
              },
              ...(initiatingMessageId === null ? {} : {
                checkpoint: async ({ state, context: envelope, toolSetSha256, policySha256, budget }) => {
                  try {
                    await journal.writeAgentCheckpoint(request.requestId, runOwner, createNativeAgentLoopCheckpoint({
                      requestId: request.requestId,
                      owner: runOwner,
                      context: envelope,
                      projectInstructions,
                      sourceMessageId: initiatingMessageId!,
                      state,
                      toolSetSha256,
                      policySha256,
                      resumeBinding: {
                        role: envelope.identity.role,
                        objective: runtimeRequest.message,
                        budget,
                      },
                    }));
                  } catch (error) {
                    if (error instanceof AgentRestartCheckpointUnsafeError) {
                      // Never retain a stale prior checkpoint after a later unsafe continuation.
                      // The live run can continue; only restart eligibility is revoked.
                      await journal.clearAgentCheckpoint(request.requestId, runOwner).catch((clearError) => {
                        throw new ConversationJournalError(clearError);
                      });
                      return;
                    }
                    throw new ConversationJournalError(error);
                  }
                },
              }),
              ...(resume ? { resume } : {}),
              ...(restartRun ? { restart: { state: restartRun.state, reopen: restartRun.reopen } } : {}),
            },
          } : {}),
          resolvedAttachments,
          ...(options.aiCompletion ? { aiCompletion: options.aiCompletion } : {}),
          ...(options.nodeFinanceGateway ? { nodeFinanceGateway: options.nodeFinanceGateway } : {}),
          preferredProvider: aiSetup?.aiProviderId,
          preferredModel: aiSetup?.aiModelId,
          emit: async (runtimeEvent) => {
            const event = runtimeEvent;
            if (event.type === "artifact") {
              pendingArtifacts.push(event);
              if (event.persistedArtifact) {
                const artifact = await getArtifact(context, event.persistedArtifact.id);
                const version = await getArtifactVersion(context, artifact.id, event.persistedArtifact.version);
                if (artifact.projectId !== chat.projectId || (artifact.projectId === null && artifact.owningChatId !== chatId)) throw new Error("Updated Artifact is outside this conversation owner.");
                persistedArtifacts.push(retainedArtifactMessageRef({ artifact, version }));
                pendingArtifacts.pop();
                await ledger.recordRuntimeEvent(event); await transcript.recordEvent(event); emit(event);
              }
              return;
            }
            if (event.type === "done") { held.done = event; return; }
            await ledger.recordRuntimeEvent(event);
            await transcript.recordEvent(event);
            if (event.type === "error") held.errored = true;
            emit(event);
          },
        }));
        if (!result.cancelled && !result.awaitingApproval && !conversationRuns.claimCompletion(request.requestId, user.id)) {
          // Stop won before durable output commit. Do not save a completed
          // assistant answer or pending Artifact after acknowledging cancellation.
          const cancelled: Extract<ConversationRuntimeEvent, { type: "done" }> = { type: "done", requestId: request.requestId, at: new Date().toISOString(), status: "cancelled" };
          await ledger.recordRuntimeEvent(cancelled);
          await transcript.recordEvent(cancelled);
          if (agent) await transcript.finishCancelled(runOwner);
          else await transcript.finish("cancelled");
          emit({ ...cancelled, workingContext: preRun });
          return;
        }
        if (!result.cancelled && !result.awaitingApproval && !held.errored && held.done?.status === "completed") {
          const capabilityIds = result.plan.capabilities.map((capability) => capability.id);
          const selection = runtimeRequest.context?.selection;
          const refreshSpec = {
            kind: "conversation" as const,
            sourceScope: runtimeRequest.sourceScope,
            executionMode: runtimeRequest.executionMode,
            capabilityIds,
            message: runtimeRequest.message,
            selection: selection ? {
              kind: selection.kind,
              id: selection.id,
              label: selection.label,
              view: selection.view,
              symbol: selection.symbol,
            } : null,
            engineRef: null,
          };
          for (const event of pendingArtifacts) {
            const savedArtifact = await persistConversationDraft(context, {
              projectId: chat.projectId,
              owningChatId: chatId,
              requestId: request.requestId,
              draft: event.artifact,
              trustManifest: result.trustManifest ?? null,
              dependencyRefs: [...event.artifact.sourceRefs, ...capabilityIds.map((id) => `capability:${id}`)],
              refreshSpec,
            });
            const persistedArtifact = { id: savedArtifact.artifact.id, version: savedArtifact.version.version };
            persistedArtifacts.push(retainedArtifactMessageRef(savedArtifact));
            const retainedEvent = { ...event, persistedArtifact };
            await ledger.recordRuntimeEvent(retainedEvent);
            await transcript.recordEvent(retainedEvent);
            emit(retainedEvent);
          }
        }
        // A successful tool can produce a canonical P4 Artifact with no
        // narrative text. Retain a truthful assistant card carrier instead
        // of leaving its exact saved ID/version unreachable from Chat history.
        // Partial, cancelled, failed and approval-paused work remains unsaved.
        const savedAnswer = savedChatArtifactAnswer({
          text: result.text,
          persistedArtifactCount: persistedArtifacts.length,
          cancelled: result.cancelled,
          awaitingApproval: result.awaitingApproval,
          failed: held.errored || held.done?.status !== "completed",
        });
        await transcript.recordText(savedAnswer ?? result.text);

        if (agent && result.awaitingApproval) {
          if (!result.agentPause) throw new Error("Agent approval pause is missing its live continuation state.");
          const pause = result.agentPause;
          const paused = pause.resume.paused;
          if (paused.stepId !== pause.stepId || paused.toolId !== pause.toolId || !/^[a-f0-9]{64}$/i.test(pause.planSha256)) {
            throw new Error("Agent approval pause identity is inconsistent.");
          }
          const step = pause.resume.steps.find((candidate) => candidate.id === pause.stepId && candidate.toolId === pause.toolId);
          const descriptor = getConversationTool(pause.toolId);
          if (!step || !descriptor || (descriptor.permissionClass !== "user_confirm" && descriptor.permissionClass !== "admin_confirm")) {
            throw new Error("Agent approval pause no longer matches a registered confirming tool.");
          }
          const policy = currentConversationToolApprovalPolicy(pause.toolId);
          const proposal = await proposeGovernedToolOperation({
            user,
            projectId: chat.projectId,
            chatId,
            requestId: request.requestId,
            stepId: pause.stepId,
            toolCallId: paused.toolCallId,
            toolId: pause.toolId,
            input: step.input,
            descriptor,
            planHash: pause.planSha256,
            policy,
            currentPolicy: () => currentConversationToolApprovalPolicy(pause.toolId),
            runSignal: signal,
          });

          let cancellationFinalization: Promise<void> | null = null;
          // Deny or an invalid release is terminal. An explicit Stop on the pause parks the run as interrupted when it
          // holds a checkpoint (resumable by its owner). Both share one memoized finalization.
          const terminalizeCancelled = () => cancellationFinalization ??= transcript.finish("cancelled");
          const stopPausedRun = () => cancellationFinalization ??= (async () => {
            // The pause's one-use review dies with it, so a later explicit resume proposes a fresh one.
            discardGovernedToolOperation({ user, requestId: request.requestId, reviewId: proposal.reviewId });
            await transcript.finishCancelled(runOwner);
          })();
          const payload: GovernedAgentPausePayload = {
            pause,
            reviewId: proposal.reviewId,
            createExecutor: (authorization) => executeAttempt({ state: pause.resume, authorization }),
            terminalizeCancelled,
          };
          const staged = conversationRuns.stagePauseScoped(
            request.requestId,
            runOwner,
            payload,
            stopPausedRun,
          );
          if (!staged) {
            await reviewGovernedToolOperation({
              user,
              requestId: request.requestId,
              reviewId: proposal.reviewId,
              allow: false,
              scope: "once",
              exactToolCallId: paused.toolCallId,
            }).catch(() => undefined);
            throw new Error("Agent approval pause could not be staged on its canonical run.");
          }

          pendingReviewId = proposal.reviewId;
          pendingExactToolCallId = paused.toolCallId;
          const blastRadius = descriptor.sideEffect === "external"
            ? "This step may change an external system. LiOS uses a write-ahead idempotency key and will reconcile any ambiguous outcome before retrying."
            : descriptor.sideEffect === "internal_write"
              ? "This step may change LiOS or Project state, but it does not declare an external side effect."
              : "This step declares no side effect.";
          governedApprovalEvent = {
            type: "governed_tool_approval_required",
            requestId: request.requestId,
            at: new Date().toISOString(),
            reviewId: proposal.reviewId,
            label: descriptor.label,
            permissionClass: policy.permissionClass,
            sideEffect: descriptor.sideEffect,
            replaySafe: descriptor.replaySafe,
            externalSideEffect: descriptor.sideEffect === "external",
            blastRadius,
            // Only the canonical pending grant's immutable identifiers/hashes cross
            // the wire. Never send the tool arguments or credential-bearing target.
            reviewBinding: {
              toolId: proposal.binding.toolId,
              stepId: proposal.binding.stepId,
              toolCallId: proposal.binding.toolCallId,
              inputSha256: proposal.binding.inputSha256,
              planSha256: proposal.binding.planHash,
              chatId: proposal.binding.chatId,
              projectId: proposal.binding.projectId,
            },
            choices: chat.projectId === null || descriptor.allowProjectApproval === false
              ? ["allow_once", "deny"]
              : ["allow_once", "allow_project", "deny"],
            expiresAt: new Date(proposal.expiresAtMs).toISOString(),
            message: `${descriptor.label} requires your approval before this exact planned step can run. ${blastRadius}`,
          };
        }

        // A waiting-for-approval message is transient run state. The same requestId continues after approval.
        const saved = savedAnswer !== null;
        const workingContext = saved
          ? deriveWorkingContext({
              previous: carried,
              owner,
              resolution: { ...resolution, request: runtimeRequest },
              plan: result.plan,
              result,
              providerId: aiSetup?.aiProviderId ?? null,
            })
          : preRun;
        if (workingContext && persistedArtifacts.length > 0) {
          workingContext.activeArtifact = persistedArtifacts[persistedArtifacts.length - 1].id;
        }
        if (saved) {
          await addProjectChatMessage(context, chatId, {
            role: "assistant",
            content: savedAnswer!,
            metadata: {
              runtime: "p2",
              runtimeRequestId: request.requestId,
              resultLabel: result.label,
              executionReceiptIds: result.receiptIds,
              artifactDraftIds: result.artifacts.map((artifact) => artifact.artifactId),
              persistedArtifacts,
              citationSources: (result.trustManifest?.evidence ?? []).map(evidence => ({ id: evidence.sourceRef, label: evidence.providerLabel ?? evidence.sourceRef })),
              deterministic: result.label === "deterministic",
              aiDerived: result.label === "ai_derived",
              workingContext,
            },
          });
        }

        const terminal = held.done ?? {
          type: "done" as const,
          requestId: request.requestId,
          at: new Date().toISOString(),
          status: "failed" as const,
        };
        await ledger.recordRuntimeEvent(terminal);
        await transcript.recordEvent(terminal);
        if (terminal.status === "waiting_approval" && agent) {
          await transcript.pauseForApproval();
          emit({ ...terminal, workingContext });
          // The registry enters paused state synchronously while handling the waiting event.
          // Only then expose the actionable review id, eliminating click-before-pause races.
          if (governedApprovalEvent) emit(governedApprovalEvent);
        } else {
          if (terminal.status === "cancelled" && agent) await transcript.finishCancelled(runOwner);
          else await transcript.finish(terminal.status === "waiting_approval" ? "completed" : terminal.status);
          emit({ ...terminal, workingContext });
        }
      } catch (error) {
        if (pendingReviewId && !conversationRuns.getPausedPayloadScoped(request.requestId, runOwner)) {
          await reviewGovernedToolOperation({
            user,
            requestId: request.requestId,
            reviewId: pendingReviewId,
            allow: false,
            scope: "once",
            exactToolCallId: pendingExactToolCallId,
          }).catch(() => undefined);
        }
        let failure: unknown = error;
        if (begun) {
          try {
            await transcript.recordFailure(error);
            if (error instanceof AgentDispatchOutcomeUnknownError) {
              await transcript.interruptForReconciliation();
            } else {
              await transcript.finish("failed");
            }
          } catch (journalError) {
            failure = journalError;
          }
        }
        endFailedRun(emit, request.requestId, held, failure, preRun);
      }
    };

    return conversationRuns.start({ ...runOwner, requestId: request.requestId }, executeAttempt(undefined, preparedRestart ?? undefined), { pausable: agent });
  } catch (error) {
    let failure = error;
    try {
      await finalizeUnstartedRun?.();
    } catch (journalError) {
      failure = journalError;
    }
    throw startErrorFor(failure, request.requestId);
  }
}

const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Explicit, owner-requested resume of an interrupted agent run after a Stop or restart (SI-02).
 *
 * The caller supplies ONLY the requestId. The owner Project/Chat comes from the encrypted journal record and is then
 * authorized for this user; the objective is the exact initiating user message; the request facts come from what the
 * server persisted with that message; the tool set, policy, context and plan are rebuilt from current server facts and
 * checked against the owner-bound checkpoint. Any drift, ambiguity, outcome-unknown dispatch or unsafe interrupted tool
 * refuses with a typed 4xx and leaves the record interrupted. Nothing executes until the SAME requestId is registered in
 * the one run registry and the journal is atomically reopened interrupted -> running; a confirm-class step then pauses for
 * a fresh approval instead of self-authorizing.
 */
export async function resumeInterruptedConversationRun(
  user: ConversationUser,
  requestId: unknown,
  options: ConversationRunServiceOptions = {},
): Promise<RunSummary> {
  if (typeof requestId !== "string" || !LOWERCASE_UUID.test(requestId)) {
    throw new ConversationStartError(400, { code: "invalid_request_id", error: "Resume needs the canonical lowercase run id." });
  }
  const journal = await getConversationExecutionJournal().catch((error: unknown) => { throw new ConversationStartError(500, { code: "execution_journal_failed", error: new ConversationJournalError(error).message, requestId }); });
  const record = await journal.readForUser(requestId, user.id).catch(() => { throw new ConversationStartError(500, { code: "execution_journal_failed", error: "The execution journal could not be read.", requestId }); });
  if (!record || record.owner.chatId === null) throw new ConversationStartError(404, { code: "interrupted_run_not_found", error: "Interrupted execution not found.", requestId });
  const chatId = record.owner.chatId;
  const context = tenantContext(user);
  const chat = await getProjectChat(context, chatId).catch(() => null);
  if (!chat || chat.projectId !== record.owner.projectId) {
    throw new ConversationStartError(404, { code: "interrupted_run_not_found", error: "Interrupted execution not found.", requestId });
  }
  if (record.status !== "interrupted") {
    throw new ConversationStartError(409, { code: "run_not_interrupted", error: "Only an interrupted execution can be resumed.", requestId });
  }
  if (record.version !== 2 || !nativeContinuationOf(record.checkpoint)) {
    throw new ConversationStartError(409, { code: "agent_resume_unavailable", error: "This execution has no checkpoint it can resume from.", requestId });
  }
  let source: AgentRestartSource;
  try {
    const sourceMessageId = record.checkpoint?.sourceMessageId;
    if (!Number.isSafeInteger(sourceMessageId) || (sourceMessageId ?? 0) <= 0) {
      throw new ConversationStartError(409, { code: "initiating_message_missing", error: "The exact message that started this run is not bound to its checkpoint.", requestId });
    }
    source = resolveAgentRestartSource(await listProjectChatMessages(context, chatId), requestId, sourceMessageId!);
  } catch (error) {
    throw startErrorFor(error, requestId);
  }
  const wire = {
    requestId,
    message: source.objective,
    executionMode: source.executionMode,
    sourceScope: source.projection.sourceScope,
    transmissionPolicy: source.projection.transmissionPolicy,
    ...(source.projection.context ? { context: source.projection.context } : {}),
    attachments: source.attachments,
    agent: true,
  };
  return runProjectChat(user, chatId, wire, options, { source, record });
}

export async function reviewGovernedToolRun(
  user: ConversationUser,
  requestId: string,
  reviewId: string,
  decision: GovernedToolReviewDecision,
): Promise<{ ok: true; status: "cancelled" | "resuming" }> {
  const run = conversationRuns.get(requestId, user.id);
  if (!run || run.finished) {
    throw new ConversationStartError(404, { error: "Paused execution not found.", requestId });
  }
  const owner = { userId: user.id, projectId: run.projectId, chatId: run.chatId } as const;
  const live = conversationRuns.getPausedPayloadScoped<GovernedAgentPausePayload>(requestId, owner);
  if (!live || live.payload.reviewId !== reviewId) {
    throw new ConversationStartError(409, { error: "That approval is no longer the active paused operation.", requestId });
  }

  const { payload, signal: runSignal } = live;
  const pause = payload.pause;
  const paused = pause.resume.paused;
  const step = pause.resume.steps.find((candidate) => candidate.id === pause.stepId && candidate.toolId === pause.toolId);
  const descriptor = getConversationTool(pause.toolId);
  if (!step || !descriptor || paused.stepId !== pause.stepId || paused.toolId !== pause.toolId) {
    throw new ConversationStartError(409, { error: "The paused tool operation changed.", requestId });
  }
  if (descriptor.permissionClass !== "user_confirm" && descriptor.permissionClass !== "admin_confirm") {
    throw new ConversationStartError(409, { error: "The paused tool no longer requires the same approval.", requestId });
  }
  const parsed = descriptor.inputSchema?.safeParse(step.input);
  if (!parsed || !parsed.success || typeof parsed.data !== "object" || parsed.data === null || Array.isArray(parsed.data)) {
    throw new ConversationStartError(409, { error: "The paused tool input is no longer valid.", requestId });
  }
  const parsedInput = snapshotGovernedToolInput(parsed.data);

  if (decision === "deny") {
    await reviewGovernedToolOperation({
      user, requestId, reviewId, allow: false, scope: "once", exactToolCallId: paused.toolCallId,
    });
    try {
      await payload.terminalizeCancelled();
    } finally {
      conversationRuns.cancelScoped(requestId, owner);
    }
    return { ok: true, status: "cancelled" };
  }

  if (decision === "allow_project" && descriptor.allowProjectApproval === false) {
    throw new ConversationStartError(409, {
      code: "project_approval_not_allowed",
      error: "This exact operation only permits one-time approval.",
      requestId,
    });
  }
  const scope = decision === "allow_project" ? "project" : "once";
  await reviewGovernedToolOperation({
    user, requestId, reviewId, allow: true, scope, exactToolCallId: paused.toolCallId,
  });
  const authorization = await resolveGovernedToolOperation({ user, requestId, reviewId });

  const exactInvocation = {
    authorization,
    userId: owner.userId,
    projectId: owner.projectId,
    chatId: owner.chatId,
    requestId,
    stepId: pause.stepId,
    toolCallId: paused.toolCallId,
    toolId: pause.toolId,
    input: parsedInput,
    descriptor,
    planHash: pause.planSha256,
    permissionClass: descriptor.permissionClass,
    runSignal,
  } as const;

  const binding = createRunApprovalResumeBinding({
    requestId,
    owner,
    planHash: pause.planSha256,
    inputSha256: authorization.binding.inputSha256,
    stepId: pause.stepId,
    toolId: pause.toolId,
    toolCallId: paused.toolCallId,
    lease: authorization.lease,
  });
  const journal = await getConversationExecutionJournal();

  await releaseRunApprovalAndContinue({
    journal,
    binding,
    requestId,
    owner,
    planHash: pause.planSha256,
    inputSha256: authorization.binding.inputSha256,
    stepId: pause.stepId,
    toolId: pause.toolId,
    toolCallId: paused.toolCallId,
    lease: authorization.lease,
    getCurrentPolicy: () => currentConversationToolApprovalPolicy(pause.toolId),
    assertExternalCurrent: async () => {
      await assertGovernedToolAuthorizationMatches(exactInvocation);
    },
    onReleasedInvalid: async () => {
      try {
        await payload.terminalizeCancelled();
      } finally {
        conversationRuns.cancelScoped(requestId, owner);
      }
    },
    continueRun: async () => {
      const resumed = conversationRuns.resumeScoped(requestId, owner, payload.createExecutor(authorization));
      if (!resumed) {
        try {
          await payload.terminalizeCancelled();
        } finally {
          conversationRuns.cancelScoped(requestId, owner);
        }
        throw new ConversationStartError(409, { error: "The paused execution could not be resumed.", requestId });
      }
      return true;
    },
  });

  return { ok: true, status: "resuming" };
}

export async function startTemporaryRun(user: ConversationUser, rawBody: unknown): Promise<RunSummary> {
  const wire = parseWire(temporarySchema, rawBody, "Invalid temporary chat request.");
  const { history, voiceReview, workingContext: clientContext, ...requestInput } = wire;
  const initialRequest = canonicalRequest(requestInput);
  // Temporary chats keep their context in client memory only; it is validated like any stored snapshot.
  const owner = { scope: "temporary", projectId: null, chatId: null } as const;
  const carried = restoreWorkingContext(clientContext, owner);
  if (clientContext !== undefined && clientContext !== null && carried === null) {
    throw new ConversationStartError(400, { code: "working_context_invalid", error: "The temporary chat context is invalid or unsafe. It has been discarded; retry with an explicit $ticker.", requestId: initialRequest.requestId });
  }
  const resolution = resolveWorkingContextRequest(initialRequest, carried);
  assertWorkingContextResolved(resolution);
  await assertWorkingContextArtifacts(user, owner.scope, owner.projectId, null, resolution.request, carried);
  const { request, plan } = await resolveEffectiveConversationRequest(user, resolution.request);
  if (request.attachments.length) {
    throw new ConversationStartError(400, { error: "Temporary chats do not retain file attachments. Start a Project chat to attach files." });
  }
  assertVoiceReviewed(request, voiceReview);
  try {
    const context = tenantContext(user);
    const aiSetup = await getEnvironmentSetupForUser(user.id);
    const preRun = deriveWorkingContext({ previous: carried, owner, resolution: { ...resolution, request }, plan, result: { receiptIds: [] }, providerId: aiSetup?.aiProviderId ?? null });
    const approvedRequest = await withServerApprovals(user, request, null);

    return conversationRuns.start({
      requestId: request.requestId,
      userId: user.id,
      projectId: null,
      chatId: null,
    }, async (emit, signal) => {
      const held: HeldRun = { done: null, errored: false };
      const result = await withConversationExecutionScope(request.requestId, () => executeConversationRuntime({
        tenant: context,
        signal,
        scope: "temporary",
        chatId: null,
        projectId: null,
        projectName: null,
        projectInstructions: null,
        resources: [],
        history: request.continuationOf
          && history.at(-1)?.role === "user"
          && history.at(-1)?.content === request.message
          ? history.slice(0, -1)
          : history,
        request: approvedRequest,
        preferredProvider: aiSetup?.aiProviderId,
        preferredModel: aiSetup?.aiModelId,
        emit: (runtimeEvent) => {
          if (runtimeEvent.type === "done") held.done = runtimeEvent;
          else {
            if (runtimeEvent.type === "error") held.errored = true;
            emit(runtimeEvent);
          }
        },
      })).catch((error: unknown) => {
        endFailedRun(emit, request.requestId, held, error, preRun);
        return null;
      });
      if (!result) return;
      if (!result.cancelled && !result.awaitingApproval && !conversationRuns.claimCompletion(request.requestId, user.id)) {
        emit({ type: "done", requestId: request.requestId, at: new Date().toISOString(), status: "cancelled", workingContext: preRun });
        return;
      }
      const workingContext = result.text && !result.cancelled
        ? deriveWorkingContext({ previous: carried, owner, resolution: { ...resolution, request }, plan: result.plan, result, providerId: aiSetup?.aiProviderId ?? null })
        : preRun;
      if (held.done) emit({ ...held.done, workingContext });
    });
  } catch (error) {
    throw startErrorFor(error, request.requestId);
  }
}
