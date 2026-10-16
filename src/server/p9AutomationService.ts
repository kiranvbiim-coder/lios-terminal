import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { p6PersonalFinanceRequestSchema } from "@shared/p6FinanceContracts";
import {
  users,
  type ProjectAutomationNotification,
  type ProjectAutomationRun,
  type ProjectAutomationWorkflow,
} from "@shared/schema";
import { thesisArtifactContentSchema } from "@shared/artifactContracts";
import {
  conversationRequestSchema,
  type ConversationRuntimeEvent,
} from "@shared/conversationRuntime";
import {
  p9AutomationEventSchema,
  p9WorkflowActionSchema,
  P9_ACCEPTED_FINANCE_TEMPLATES,
  type P9AutomationEvent,
  type P9WorkflowRunResult,
  type P9WorkflowTemplate,
} from "@shared/p9AutomationContracts";
import type { TenantContext } from "./tenantContext";
import { getDb } from "./db";
import { requireAcceptedP9Workflow } from "./p9AcceptedWorkflow";
import { getProject } from "./projectStore";
import { getProjectChat, listProjectChatMessages } from "./projectChatStore";
import { listProjectResources } from "./projectResourceStore";
import { getEnvironmentSetupForUser } from "./environmentSetupService";
import { parseDataStackPins } from "@shared/dataStackPins";
import { loadOrganizationCredentials } from "./organizationCredentialVault";
import { hasActiveCommunityConsent } from "./communityDataConsent";
import { runWithRequestIdentity } from "./requestContext";
import { executeConversationRuntime, planConversationWorkflow } from "./conversationRuntime";
import { runOnConversationSpine } from "./conversationSpineRun";
import { requireMasterAiOn } from "./masterAiGate";
import type { PersonaPreferenceUser } from "./personaPreferenceService";
import { createConversationLedgerRecorder } from "./ledgerReproducibility";
import { createArtifactProposal, listArtifactProposals, getArtifact, getArtifactVersion, persistProjectConversationDraft } from "./artifactStore";
import { normalizeConversationDraft } from "./artifactDiff";
import {
  listProjectIntelligenceSnapshots,
  projectIntelligenceDelta,
  rebuildProjectIntelligence,
} from "./p7ProjectIntelligenceStore";
import { refreshThesisArtifact } from "./p7ThesisEngine";
import { getProviderStatuses } from "./providerStatus";
import { getCompanyFilings } from "./secEdgarData";
import { listSourceConnections } from "./sourceConnectionService";
import { hashLedgerValue } from "./ledgerStore";
import { withP10Span } from "./p10Observability";
import {
  beginP9Run,
  claimDueP9Workflows,
  completeP9Run,
  createP9Notification,
  latestSuccessfulP9Run,
  listP9EventWorkflows,
  parseP9StoredWorkflow,
  renewP9WorkflowClaimSystem,
  updateP9WorkflowEventCursorSystem,
} from "./p9AutomationStore";
import {
  executeMatchedP9EventWorkflows,
  p9AutomationEventMatches,
  p9UnseenObservedFilings,
} from "./p9AutomationEngine";

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function tenantForWorkflow(workflow: ProjectAutomationWorkflow): Promise<TenantContext> {
  const [user] = await getDb().select({
    id: users.id,
    organizationId: users.organizationId,
    role: users.role,
    active: users.active,
    mustChangePassword: users.mustChangePassword,
    lockedUntil: users.lockedUntil,
  }).from(users).where(eq(users.id, workflow.ownerUserId)).limit(1);
  if (!user) throw new Error("Automation workflow owner no longer exists.");
  if (!user.active || user.mustChangePassword || (user.lockedUntil && user.lockedUntil.getTime() > Date.now())) {
    throw new Error("Automation workflow owner has no current execution authority: account inactive, locked or password change required.");
  }
  const organizationId = user.organizationId ?? null;
  if (organizationId !== workflow.organizationId) throw new Error("Automation workflow owner organization no longer matches the saved workflow.");
  return { userId: user.id, organizationId, role: user.role };
}

async function workflowIdentity<T>(ctx: TenantContext, callback: () => Promise<T>): Promise<T> {
  const [setup, communityYahooConsent, publicFillerConsent, credentials] = await Promise.all([
    getEnvironmentSetupForUser(ctx.userId),
    hasActiveCommunityConsent(ctx.userId, "yahoo_community"),
    hasActiveCommunityConsent(ctx.userId, "public_filler"),
    ctx.organizationId !== null ? loadOrganizationCredentials(ctx.organizationId) : Promise.resolve(undefined),
  ]);
  return runWithRequestIdentity({
    userId: ctx.userId,
    organizationId: ctx.organizationId,
    credentials,
    selectedConnectorIds: setup?.selectedConnectorIds ?? [],
    providerStackOrder: setup?.providerStackOrder ?? [],
    dataStackPins: parseDataStackPins(setup?.dataStackPins ?? []),
    communityYahooConsent,
    publicFillerConsent,
  }, callback);
}

function collectThesisEvidence(thesis: ReturnType<typeof thesisArtifactContentSchema.parse>): string[] {
  return unique([
    ...thesis.claims.flatMap((item) => [...item.evidenceRefs, ...item.counterEvidenceRefs]),
    ...thesis.expectedOutcomes.flatMap((item) => item.evidenceRefs),
    ...thesis.catalysts.flatMap((item) => item.evidenceRefs),
    ...thesis.risks.flatMap((item) => item.evidenceRefs),
    ...thesis.invalidationConditions.flatMap((item) => item.evidenceRefs),
    ...thesis.openQuestions.flatMap((item) => item.evidenceRefs),
    ...thesis.postmortems.flatMap((item) => item.evidenceRefs),
  ]).slice(0, 2_000);
}

async function runProjectWhatChanged(ctx: TenantContext, workflow: ProjectAutomationWorkflow): Promise<P9WorkflowRunResult> {
  const before = await listProjectIntelligenceSnapshots(ctx, workflow.projectId, 1);
  const rebuilt = await rebuildProjectIntelligence(ctx, workflow.projectId);
  const prior = before[0] ?? null;
  const delta = prior && prior.id !== rebuilt.snapshot.id
    ? await projectIntelligenceDelta(ctx, workflow.projectId, prior.id, rebuilt.snapshot.id)
    : null;
  const changedCount = delta ? delta.added.length + delta.changed.length + delta.removed.length : 0;
  const sourceRefs = delta
    ? unique([
        ...delta.added.map((item) => item.sourceRef),
        ...delta.changed.map((item) => item.sourceRef),
        ...delta.removed.map((item) => item.sourceRef),
      ])
    : [];
  return {
    summary: prior
      ? changedCount
        ? changedCount + " Project Intelligence source change(s) detected."
        : "No indexed Project source changed since the previous snapshot."
      : "Created the first Project Intelligence baseline snapshot.",
    changed: changedCount > 0,
    conditionMet: changedCount > 0,
    relevanceScore: changedCount > 0 ? Math.min(1, 0.55 + changedCount * 0.05) : 0.1,
    sourceRefs: unique([...workflow.sourceRefs, ...sourceRefs]),
    engineRefs: unique([...workflow.engineRefs, "lios.project-intelligence"]),
    artifactRefs: workflow.artifactRefs,
    executionReceiptIds: [],
    output: {
      snapshotId: rebuilt.snapshot.id,
      contentHash: rebuilt.snapshot.contentHash,
      added: delta?.added.length ?? 0,
      changed: delta?.changed.length ?? 0,
      removed: delta?.removed.length ?? 0,
    },
  };
}

async function runThesisRefresh(ctx: TenantContext, workflow: ProjectAutomationWorkflow, artifactId: string): Promise<P9WorkflowRunResult> {
  const artifact = await getArtifact(ctx, artifactId);
  if (artifact.projectId !== workflow.projectId || artifact.kind !== "thesis") {
    throw new Error("Saved Thesis workflow target does not belong to this Project.");
  }
  const version = await getArtifactVersion(ctx, artifact.id, artifact.headVersion);
  const thesis = thesisArtifactContentSchema.parse(version.content);
  const beforeSnapshots = await listProjectIntelligenceSnapshots(ctx, workflow.projectId, 1);
  const rebuilt = await rebuildProjectIntelligence(ctx, workflow.projectId);
  const delta = beforeSnapshots[0] && beforeSnapshots[0].id !== rebuilt.snapshot.id
    ? await projectIntelligenceDelta(ctx, workflow.projectId, beforeSnapshots[0].id, rebuilt.snapshot.id)
    : null;
  const refreshed = refreshThesisArtifact({
    thesis,
    documents: rebuilt.documents,
    snapshot: rebuilt.snapshot,
    delta,
  });
  // Observation timestamps/snapshot churn are not a change to the owner's thesis.
  const patch = {
    ...refreshed.thesis,
    refresh: thesis.refresh,
    claims: refreshed.thesis.claims.map((claim, index) => ({ ...claim, updatedAt: thesis.claims[index].updatedAt })),
  };
  const material = hashLedgerValue(patch) !== hashLedgerValue(thesis);
  let proposalId: string | null = null;
  let newlyProposed = false;
  if (material) {
    const proposalHash = hashLedgerValue(patch);
    const previousProposals = await listArtifactProposals(ctx, artifact.id);
    const existing = previousProposals.find(proposal => proposal.baseVersion === artifact.headVersion
      && proposal.proposalType === "artifact_patch" && hashLedgerValue(proposal.patch) === proposalHash);
    const proposal = existing ?? await createArtifactProposal(ctx, {
      artifactId: artifact.id,
      baseVersion: artifact.headVersion,
      type: "artifact_patch",
      patch,
      actorType: "conversation",
      summary: "Review observed Thesis evidence before changing owner state. " + refreshed.review.summary,
    }, { key: `thesis-monitor:${artifact.headVersion}:${proposalHash}`, payloadHash: proposalHash });
    proposalId = proposal.id;
    newlyProposed = !existing;
  }
  const invalidated = refreshed.thesis.status === "invalidated";
  return {
    summary: newlyProposed
      ? "Thesis evidence requires review; a canonical change proposal was saved. The owner's thesis was not changed."
      : material ? "This Thesis evidence already has a review proposal; no duplicate change was created."
        : "Thesis refresh found no material state change.",
    changed: newlyProposed,
    conditionMet: newlyProposed && (invalidated || refreshed.contradictions.length > 0),
    relevanceScore: newlyProposed ? (invalidated ? 1 : refreshed.contradictions.length ? 0.9 : 0.7) : 0.1,
    sourceRefs: unique([...workflow.sourceRefs, ...collectThesisEvidence(refreshed.thesis)]),
    engineRefs: unique([...workflow.engineRefs, "lios.thesis.native", "lios.project-intelligence"]),
    artifactRefs: unique([...workflow.artifactRefs, artifact.id]),
    executionReceiptIds: [],
    output: {
      artifactId: artifact.id,
      fromVersion: artifact.headVersion,
      toVersion: null,
      proposalId,
      snapshotId: rebuilt.snapshot.id,
      status: thesis.status,
      proposedStatus: refreshed.thesis.status,
      changes: refreshed.changes.slice(0, 100),
      contradictions: refreshed.contradictions.slice(0, 100),
    },
  };
}

async function runProviderHealth(
  ctx: TenantContext,
  workflow: ProjectAutomationWorkflow,
  previous: ProjectAutomationRun | null,
): Promise<P9WorkflowRunResult> {
  const [providers, connections] = await Promise.all([
    getProviderStatuses(),
    listSourceConnections(ctx.userId),
  ]);
  const safeProviders = providers.map((item) => ({
    id: item.id,
    label: item.label,
    category: item.category,
    state: item.state,
    detail: item.detail,
  }));
  const safeConnections = connections.map((item) => ({
    id: item.id,
    connectorId: item.connectorId,
    name: item.name,
    sourceType: item.sourceType,
    status: item.status,
    lastTestedAt: item.lastTestedAt?.toISOString() ?? null,
    lastHealthyAt: item.lastHealthyAt?.toISOString() ?? null,
    statusDetail: item.statusDetail,
  }));
  const unhealthy = [
    ...safeProviders.filter((item) => item.state === "unreachable"),
    ...safeConnections.filter((item) => item.status === "degraded" || item.status === "unreachable" || item.status === "invalid"),
  ];
  const healthHash = hashLedgerValue({ providers: safeProviders, connections: safeConnections });
  const previousHash = typeof previous?.output?.healthHash === "string" ? previous.output.healthHash : null;
  const changed = previousHash !== null && previousHash !== healthHash;
  return {
    summary: unhealthy.length
      ? unhealthy.length + " provider/source health issue(s) require attention."
      : "Configured provider and source-connection health has no active degraded/unreachable/invalid state.",
    changed,
    conditionMet: unhealthy.length > 0,
    relevanceScore: unhealthy.length > 0 ? 0.95 : changed ? 0.7 : 0.1,
    sourceRefs: unique([
      ...workflow.sourceRefs,
      ...safeProviders.map((item) => "provider:" + item.id),
      ...safeConnections.map((item) => "source-connection:" + item.id),
    ]),
    engineRefs: unique([...workflow.engineRefs, "lios.provider-status", "lios.source-connections"]),
    artifactRefs: workflow.artifactRefs,
    executionReceiptIds: [],
    output: { healthHash, providers: safeProviders, connections: safeConnections, unhealthyCount: unhealthy.length },
  };
}

async function runConversationRerun(
  ctx: TenantContext,
  workflow: ProjectAutomationWorkflow,
  action: Extract<ReturnType<typeof p9WorkflowActionSchema.parse>, { kind: "conversation_rerun" }>,
  previous: ProjectAutomationRun | null,
): Promise<P9WorkflowRunResult> {
  const chat = await getProjectChat(ctx, action.chatId);
  if (chat.projectId !== workflow.projectId || chat.scope !== "project") {
    throw new Error("Saved workflow chat no longer belongs to the workflow Project.");
  }
  const [history, project, resources, setup] = await Promise.all([
    listProjectChatMessages(ctx, chat.id),
    getProject(ctx, workflow.projectId),
    listProjectResources(ctx, workflow.projectId),
    getEnvironmentSetupForUser(ctx.userId),
  ]);
  const currentProfileResource = action.currentPersonalFinanceResourceId
    ? resources.find(resource => resource.id === action.currentPersonalFinanceResourceId && resource.kind === "personal_finance_profile")
    : null;
  if (action.currentPersonalFinanceResourceId && !currentProfileResource) {
    throw new Error("The explicitly selected personal-finance source is unavailable; no frozen-input fallback was used.");
  }
  const currentProfile = currentProfileResource ? p6PersonalFinanceRequestSchema.parse(currentProfileResource.metadata.profile) : null;
  const request = conversationRequestSchema.parse({
    ...action.request,
    ...(currentProfile ? { context: { ...action.request.context, personalFinance: currentProfile } } : {}),
    requestId: crypto.randomUUID(),
    continuationOf: null,
  });
  const plan = planConversationWorkflow(request);
  if (plan.intent.requiresAI) {
    const [user] = await getDb().select({
      id: users.id,
      email: users.email,
      role: users.role,
      organizationId: users.organizationId,
    }).from(users).where(eq(users.id, ctx.userId)).limit(1);
    if (!user) throw new Error("Saved workflow owner no longer exists.");
    const gate = await requireMasterAiOn({
      id: user.id,
      email: user.email,
      role: user.role as PersonaPreferenceUser["role"],
      organizationId: user.organizationId,
    });
    if (!gate.ok) throw new Error(gate.error);
  }
  const ledger = createConversationLedgerRecorder({
    tenant: ctx,
    projectId: workflow.projectId,
    chatId: chat.id,
    sessionId: request.context?.sessionId ?? null,
    request,
    plan,
  });
  await ledger.recordRequest();

  const sourceRefs = new Set<string>(workflow.sourceRefs);
  const receiptIds = new Set<string>();
  const artifactRefs = new Set<string>(workflow.artifactRefs);
  const runtimeEvents: ConversationRuntimeEvent[] = [];
  const pendingArtifacts: Extract<ConversationRuntimeEvent, { type: "artifact" }>[] = [];
  const retainedVersions: Array<{ artifactId: string; version: number; contentHash: string }> = [];
  let runtimeFailed = false;
  // Automation reruns run on the chat spine: registry entry, encrypted journal record, one cancellation tree (SI-02.07).
  const result = await runOnConversationSpine({
    requestId: request.requestId,
    owner: { userId: ctx.userId, projectId: workflow.projectId, chatId: chat.id },
    label: "Automation rerun",
    run: async ({ signal, emit }) => {
      const result = await executeConversationRuntime({
      tenant: ctx,
      scope: "project",
      chatId: chat.id,
      projectId: workflow.projectId,
      projectName: project.name,
      projectInstructions: project.instructions,
      resources: resources.map((resource) => ({
        id: resource.id,
        kind: resource.kind,
        label: resource.label,
        resourceRef: resource.resourceRef,
        contextMode: resource.contextMode,
      })),
      history: history.slice(-20).map((message) => ({
        role: message.role === "user" ? "user" : "assistant",
        content: message.content,
      })),
      request,
      preferredProvider: setup?.aiProviderId,
      preferredModel: setup?.aiModelId,
      signal,
      emit: async (event) => {
        if (event.type === "error" || (event.type === "done" && event.status === "failed")) runtimeFailed = true;
        if (event.type === "artifact") {
          pendingArtifacts.push(event);
          return;
        }
        runtimeEvents.push(event);
        await ledger.recordRuntimeEvent(event);
        if (event.type === "tool_result") event.sourceRefs.forEach((ref) => sourceRefs.add(ref));
        if (event.type === "receipt") {
          receiptIds.add(event.receipt.id);
          event.receipt.sourceRefs.forEach((ref) => sourceRefs.add(ref));
        }
        await emit(event);
      },
      });
      if (runtimeFailed) throw new Error("Saved workflow runtime failed; no output was accepted as a successful financial refresh.");
      if (!result.cancelled && !result.awaitingApproval) {
        const capabilityIds = result.plan.capabilities.map(capability => capability.id);
        const selection = request.context?.selection;
        for (const event of pendingArtifacts) {
          const saved = await persistProjectConversationDraft(ctx, {
            projectId: workflow.projectId,
            requestId: request.requestId,
            draft: event.artifact,
            trustManifest: result.trustManifest ?? null,
            dependencyRefs: [...event.artifact.sourceRefs, ...capabilityIds.map(id => `capability:${id}`)],
            refreshSpec: {
              kind: "conversation",
              sourceScope: request.sourceScope,
              executionMode: request.executionMode,
              capabilityIds,
              message: request.message,
              selection: selection ? { kind: selection.kind, id: selection.id, label: selection.label, view: selection.view, symbol: selection.symbol } : null,
              engineRef: null,
            },
          });
          artifactRefs.add(saved.artifact.id);
          retainedVersions.push({ artifactId: saved.artifact.id, version: saved.version.version, contentHash: saved.version.contentHash });
          const retained = { ...event, persistedArtifact: { id: saved.artifact.id, version: saved.version.version } };
          await ledger.recordRuntimeEvent(retained);
          await emit(retained);
        }
      }
      return result;
    },
  });
  if (result.cancelled) throw new Error("Saved workflow execution was cancelled.");
  if (result.awaitingApproval) {
    throw new Error("Saved workflow requires fresh user approval before it can continue in the background.");
  }
  const outputHash = hashLedgerValue({
    text: result.text,
    label: result.label,
    artifacts: result.artifacts.map(artifact => normalizeConversationDraft(artifact)),
  });
  const previousHash = typeof previous?.output?.outputHash === "string" ? previous.output.outputHash : null;
  const changed = previousHash !== null && previousHash !== outputHash;
  return {
    summary: result.text.slice(0, 2_000) || "Saved conversation workflow completed.",
    changed,
    conditionMet: false,
    relevanceScore: changed ? 0.75 : 0.15,
    sourceRefs: unique([...sourceRefs]),
    engineRefs: unique([...workflow.engineRefs, "lios.conversation-runtime"]),
    artifactRefs: unique([...artifactRefs]),
    executionReceiptIds: unique([...receiptIds, ...result.receiptIds]),
    output: {
      outputHash,
      label: result.label,
      text: result.text.slice(0, 50_000),
      runtimeEventCount: runtimeEvents.length,
      retainedVersions,
      currentInput: currentProfileResource && currentProfile ? {
        resourceId: currentProfileResource.id,
        inputHash: hashLedgerValue(currentProfile),
        asOf: currentProfile.asOf,
      } : null,
    },
  };
}

async function executeP9Action(
  ctx: TenantContext,
  workflow: ProjectAutomationWorkflow,
  previous: ProjectAutomationRun | null,
): Promise<P9WorkflowRunResult> {
  const action = p9WorkflowActionSchema.parse(workflow.action);
  if (action.kind === "project_what_changed") return runProjectWhatChanged(ctx, workflow);
  if (action.kind === "thesis_refresh") return runThesisRefresh(ctx, workflow, action.artifactId);
  if (action.kind === "provider_health") return runProviderHealth(ctx, workflow, previous);
  return runConversationRerun(ctx, workflow, action, previous);
}

export interface ExecuteP9WorkflowInput {
  workflow: ProjectAutomationWorkflow;
  ctx?: TenantContext;
  triggerType: "manual" | "schedule" | "event";
  triggerDetail?: Record<string, unknown>;
  dedupeKey?: string | null;
  // Only a keyed, human-approved manual run may pass this revision claim.
  expectedWorkflowUpdatedAt?: Date | null;
  claimToken?: string | null;
}

export async function executeP9Workflow(input: ExecuteP9WorkflowInput): Promise<{
  run: ProjectAutomationRun | null;
  notification: ProjectAutomationNotification | null;
  result: P9WorkflowRunResult | null;
  error: string | null;
}> {
  const ctx = await tenantForWorkflow(input.workflow);
  if (input.ctx && (input.ctx.userId !== ctx.userId || input.ctx.organizationId !== ctx.organizationId || input.ctx.role !== ctx.role)) {
    throw new Error("Automation caller authority changed; inspect current account permissions before running.");
  }
  if (input.triggerType !== "manual" && !input.workflow.enabled) {
    return { run: null, notification: null, result: null, error: null };
  }
  const previous = await latestSuccessfulP9Run(ctx, input.workflow.id);
  const run = await beginP9Run(
    ctx,
    input.workflow,
    input.triggerType,
    input.triggerDetail ?? {},
    input.dedupeKey ?? null,
    input.expectedWorkflowUpdatedAt ?? null,
  );
  if (!run) return { run: null, notification: null, result: null, error: null };

  let claimHeartbeat: NodeJS.Timeout | null = null;
  if (input.claimToken) {
    claimHeartbeat = setInterval(() => {
      void renewP9WorkflowClaimSystem(input.workflow.id, input.claimToken!).catch((error) => {
        console.warn("[p9Automation] workflow claim heartbeat failed:", error);
      });
    }, 60_000);
    claimHeartbeat.unref?.();
  }

  try {
    const action = p9WorkflowActionSchema.parse(input.workflow.action);
    if (action.kind === "conversation_rerun" && (action.acceptedArtifact || action.currentPersonalFinanceResourceId || P9_ACCEPTED_FINANCE_TEMPLATES.includes(input.workflow.template as P9WorkflowTemplate))) {
      await requireAcceptedP9Workflow(ctx, input.workflow.projectId, action);
    }
    const result = await workflowIdentity(ctx, () => withP10Span(
      "automation.workflow.run",
      {
        workflowTemplate: input.workflow.template,
        triggerType: input.triggerType,
        actionKind: action.kind,
      },
      () => executeP9Action(ctx, input.workflow, previous),
    ));
    const completed = await completeP9Run(ctx, input.workflow, run.id, {
      result,
      claimToken: input.claimToken ?? null,
    });
    const notification = await createP9Notification(ctx, input.workflow, completed.id, { result, error: null });
    return { run: completed, notification, result, error: null };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : "Automation workflow failed.";
    const completed = await completeP9Run(ctx, input.workflow, run.id, {
      error,
      claimToken: input.claimToken ?? null,
    });
    const notification = await createP9Notification(ctx, input.workflow, completed.id, { result: null, error });
    return { run: completed, notification, result: null, error };
  } finally {
    if (claimHeartbeat) clearInterval(claimHeartbeat);
  }
}

export async function runDueP9Workflows(now = new Date()): Promise<{ claimed: number; succeeded: number; failed: number }> {
  const claimed = await claimDueP9Workflows(now, 25);
  let succeeded = 0;
  let failed = 0;
  for (const item of claimed) {
    try {
      const outcome = await executeP9Workflow({
        workflow: item.workflow,
        triggerType: "schedule",
        triggerDetail: { dueAt: item.workflow.nextRunAt?.toISOString() ?? now.toISOString() },
        claimToken: item.claimToken,
      });
      if (outcome.error) failed += 1;
      else if (outcome.run) succeeded += 1;
    } catch {
      // Current-authority denial is a failure, not permission to stop other owners' due work.
      // Its lease expires normally; no unreceipted action is retried within this cycle.
      failed += 1;
    }
  }
  return { claimed: claimed.length, succeeded, failed };
}

function eventDedupeKey(event: P9AutomationEvent): string {
  return "event:" + crypto.createHash("sha256").update(JSON.stringify({
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    projectId: event.projectId,
    ownerUserId: event.ownerUserId,
    organizationId: event.organizationId,
    sourceRef: event.sourceRef,
    payload: event.payload,
  })).digest("hex");
}

export async function publishP9FilingObserved(input: {
  symbol: string;
  accessionNumber: string;
  formType: string;
  filedDate: string;
  filingUrl: string;
  projectId?: number | null;
  ownerUserId?: number | null;
  organizationId?: number | null;
}): Promise<{ matched: number; executed: number; failed: number }> {
  const symbol = input.symbol.trim().toUpperCase();
  const occurredAt = /^\d{4}-\d{2}-\d{2}$/.test(input.filedDate)
    ? input.filedDate + "T00:00:00.000Z"
    : new Date(input.filedDate).toISOString();
  return emitP9AutomationEvent({
    eventType: "filing",
    occurredAt,
    projectId: input.projectId ?? null,
    ownerUserId: input.ownerUserId ?? null,
    organizationId: input.organizationId ?? null,
    sourceRef: "sec-filing:" + input.accessionNumber,
    payload: {
      symbol,
      accessionNumber: input.accessionNumber,
      formType: input.formType,
      filedDate: input.filedDate,
      filingUrl: input.filingUrl,
    },
  });
}

export async function publishP9EarningsObserved(input: {
  symbol: string;
  occurredAt: string;
  quarter?: string | null;
  epsActual?: number | null;
  revenueActual?: number | null;
  sourceRef: string;
  projectId?: number | null;
  ownerUserId?: number | null;
  organizationId?: number | null;
}): Promise<{ matched: number; executed: number; failed: number }> {
  return emitP9AutomationEvent({
    eventType: "earnings",
    occurredAt: input.occurredAt,
    projectId: input.projectId ?? null,
    ownerUserId: input.ownerUserId ?? null,
    organizationId: input.organizationId ?? null,
    sourceRef: input.sourceRef,
    payload: {
      symbol: input.symbol.trim().toUpperCase(),
      quarter: input.quarter ?? "",
      epsActual: input.epsActual ?? null,
      revenueActual: input.revenueActual ?? null,
    },
  });
}

export async function emitP9AutomationEvent(raw: unknown): Promise<{ matched: number; executed: number; failed: number }> {
  const event = p9AutomationEventSchema.parse(raw);
  const workflows = await listP9EventWorkflows(event.eventType, {
    projectId: event.projectId,
    ownerUserId: event.ownerUserId,
    organizationId: event.organizationId,
  });
  const matched = workflows.filter((workflow) => p9AutomationEventMatches(parseP9StoredWorkflow(workflow).trigger, event));
  const dedupeKey = eventDedupeKey(event);
  const summary = await executeMatchedP9EventWorkflows(matched, (workflow) =>
    executeP9Workflow({
      workflow,
      triggerType: "event",
      triggerDetail: {
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        sourceRef: event.sourceRef,
        payload: event.payload,
      },
      dedupeKey,
    }),
  );
  if (summary.unexpectedFailures > 0) {
    console.warn("[p9Automation] unexpected event workflow failures:", summary.unexpectedFailures);
  }
  return { matched: summary.matched, executed: summary.executed, failed: summary.failed };
}

export async function runP9FilingObserverCycle(
  sources: { filings: typeof getCompanyFilings } = { filings: getCompanyFilings },
): Promise<{ observed: number; baselined: number; emitted: number; failed: number }> {
  const workflows = await listP9EventWorkflows("filing", {
    projectId: null,
    ownerUserId: null,
    organizationId: null,
  });
  let observed = 0;
  let baselined = 0;
  let emitted = 0;
  let failed = 0;

  for (const workflow of workflows) {
    const { trigger } = parseP9StoredWorkflow(workflow);
    if (trigger.type !== "event" || trigger.eventType !== "filing") continue;
    const rawSymbol = trigger.filters.symbol ?? trigger.filters.ticker;
    if (typeof rawSymbol !== "string" || !rawSymbol.trim()) continue;
    const symbol = rawSymbol.trim().toUpperCase();
    const formFilter = typeof trigger.filters.formType === "string"
      ? trigger.filters.formType.trim().toUpperCase()
      : typeof trigger.filters.form === "string"
        ? trigger.filters.form.trim().toUpperCase()
        : null;

    try {
      const ctx = await tenantForWorkflow(workflow);
      const filings = (await workflowIdentity(ctx, () => sources.filings(symbol, 40)))
        .filter((filing) => !formFilter || filing.formType.toUpperCase() === formFilter);
      const latest = filings[0] ?? null;
      if (!latest) continue;
      observed += 1;

      const cursor = workflow.eventCursor && typeof workflow.eventCursor === "object"
        ? workflow.eventCursor as Record<string, unknown>
        : {};
      const priorAccession = typeof cursor.filingAccessionNumber === "string" ? cursor.filingAccessionNumber : null;
      const priorFiledDate = typeof cursor.filingFiledDate === "string" ? cursor.filingFiledDate : null;
      if (!priorAccession) {
        await updateP9WorkflowEventCursorSystem(workflow.id, {
          ...cursor,
          filingAccessionNumber: latest.accessionNumber,
          filingFiledDate: latest.filedDate,
          filingObservedAt: new Date().toISOString(),
        });
        baselined += 1;
        continue;
      }
      if (priorAccession === latest.accessionNumber) continue;

      const unseen = p9UnseenObservedFilings(filings, priorAccession, priorFiledDate);
      for (const filing of unseen.slice().reverse()) {
        const outcome = await publishP9FilingObserved({
          symbol,
          accessionNumber: filing.accessionNumber,
          formType: filing.formType,
          filedDate: filing.filedDate,
          filingUrl: filing.filingUrl,
          projectId: workflow.projectId,
          ownerUserId: workflow.ownerUserId,
          organizationId: workflow.organizationId,
        });
        emitted += outcome.executed;
      }
      await updateP9WorkflowEventCursorSystem(workflow.id, {
        ...cursor,
        filingAccessionNumber: latest.accessionNumber,
        filingFiledDate: latest.filedDate,
        filingObservedAt: new Date().toISOString(),
      });
    } catch (error) {
      failed += 1;
      console.warn("[p9Automation] filing observer failed for workflow", workflow.id, error);
    }
  }
  return { observed, baselined, emitted, failed };
}

export function startP9AutomationRuntime(intervalMs = 30_000): () => void {
  let running = false;
  let stopped = false;
  let lastFilingObserverAt = 0;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await runDueP9Workflows();
      const now = Date.now();
      if (now - lastFilingObserverAt >= 5 * 60_000) {
        lastFilingObserverAt = now;
        await runP9FilingObserverCycle();
      }
    } catch (error) {
      console.warn("[p9Automation] scheduler cycle failed:", error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, Math.max(intervalMs, 5_000));
  timer.unref?.();
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
