import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import {
  projectAutomationNotifications,
  projectAutomationRuns,
  projectAutomationWorkflows,
  projects,
  type ProjectAutomationNotification,
  type ProjectAutomationRun,
  type ProjectAutomationWorkflow,
} from "@shared/schema";
import {
  p9NotificationPolicySchema,
  p9WorkflowActionSchema,
  p9WorkflowDefinitionInputSchema,
  p9WorkflowTriggerSchema,
  P9_RECURRING_FAILURE_PAUSE_LIMIT,
  type P9AutomationEventType,
  type P9WorkflowDefinitionInput,
  type P9WorkflowRunResult,
} from "@shared/p9AutomationContracts";
import { getDb } from "./db";
import type { TenantContext } from "./tenantContext";
import { getProject, touchProjectActivity } from "./projectStore";
import { appendLedgerEvent } from "./ledgerStore";
import { decideP9Notification, nextP9ScheduledRun, p9FailureBackoff, p9NotificationTitle } from "./p9AutomationEngine";
import { admitP9ApprovedManualRun } from "./p9ManualRunIdempotency";
import { requireAcceptedP9Workflow, requireSuccessfulP9Recipe } from "./p9AcceptedWorkflow";
import { requireP9ModelRefreshReview } from "./p9ModelRefresh";
import { requireP9PortfolioMateriality } from "./p9PortfolioMateriality";
import { assertP9HasNoReplayedGrant } from "./p9SavedAuthority";
import { notifyDataChanged } from "./gatewayRuntime";

const SECRET_KEY = /(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential|authorization|cookie|private[_-]?key)/i;
const SECRET_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+\/-]{16,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*\S{8,})/i;
const CLAIM_LEASE_MS = 5 * 60_000;

function orgClause(column: any, ctx: TenantContext) {
  return ctx.organizationId === null ? isNull(column) : eq(column, ctx.organizationId);
}

function workflowTenantFilter(ctx: TenantContext, id?: string) {
  return and(
    eq(projectAutomationWorkflows.ownerUserId, ctx.userId),
    orgClause(projectAutomationWorkflows.organizationId, ctx),
    ...(id ? [eq(projectAutomationWorkflows.id, id)] : []),
  );
}

function runTenantFilter(ctx: TenantContext) {
  return and(
    eq(projectAutomationRuns.ownerUserId, ctx.userId),
    orgClause(projectAutomationRuns.organizationId, ctx),
  );
}

function notificationTenantFilter(ctx: TenantContext) {
  return and(
    eq(projectAutomationNotifications.ownerUserId, ctx.userId),
    orgClause(projectAutomationNotifications.organizationId, ctx),
  );
}

function assertSecretFree(value: unknown, path = "workflow", depth = 0): void {
  if (depth > 30) throw new Error("Workflow definition exceeds the maximum nesting depth.");
  if (typeof value === "string") {
    if (SECRET_VALUE.test(value)) throw new Error(`Workflow definitions cannot persist credential-shaped content at "${path}".`);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSecretFree(item, path + "[" + index + "]", depth + 1));
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) throw new Error(`Workflow definitions cannot persist credential-shaped field "${path}.${key}".`);
    assertSecretFree(nested, path + "." + key, depth + 1);
  }
}

export async function createP9Workflow(
  ctx: TenantContext,
  projectId: number,
  raw: unknown,
): Promise<ProjectAutomationWorkflow> {
  await getProject(ctx, projectId);
  const input = p9WorkflowDefinitionInputSchema.parse(raw);
  assertP9HasNoReplayedGrant(input.action);
  assertSecretFree(input);
  if (input.action.kind === "model_refresh_review") await requireP9ModelRefreshReview(ctx, projectId, input.action);
  if (input.action.kind === "portfolio_materiality") await requireP9PortfolioMateriality(ctx, projectId, input.action);
  if (input.action.kind === "conversation_rerun" && input.action.sourceRequestId) {
    input.action.request = await requireSuccessfulP9Recipe(ctx, projectId, input.action);
  }
  if (input.action.kind === "conversation_rerun" && (input.action.acceptedArtifact || input.action.currentPersonalFinanceResourceId)) {
    await requireAcceptedP9Workflow(ctx, projectId, input.action);
  }
  // Canonical recipe resolution may replace an action request: check again.
  assertP9HasNoReplayedGrant(input.action);
  const now = new Date();
  const nextRunAt = input.enabled ? nextP9ScheduledRun(input.trigger, now) : null;
  const id = "workflow:" + crypto.randomUUID();
  const [row] = await getDb().insert(projectAutomationWorkflows).values({
    id,
    projectId,
    ownerUserId: ctx.userId,
    organizationId: ctx.organizationId,
    name: input.name,
    description: input.description,
    template: input.template,
    enabled: input.enabled,
    trigger: input.trigger,
    action: input.action,
    notificationPolicy: input.notificationPolicy,
    sourceRefs: input.sourceRefs,
    engineRefs: input.engineRefs,
    artifactRefs: input.artifactRefs,
    eventCursor: {},
    nextRunAt,
    createdAt: now,
    updatedAt: now,
  }).returning();
  await appendLedgerEvent(ctx, {
    projectId,
    eventType: "policy.changed",
    actorType: "user",
    payload: {
      workflowId: id,
      policy: "automation",
      action: "created",
      template: input.template,
      triggerType: input.trigger.type,
    },
  });
  await touchProjectActivity(ctx, projectId);
  return row;
}

export async function listP9Workflows(ctx: TenantContext, projectId: number): Promise<ProjectAutomationWorkflow[]> {
  await getProject(ctx, projectId);
  return getDb().select().from(projectAutomationWorkflows)
    .where(and(workflowTenantFilter(ctx), eq(projectAutomationWorkflows.projectId, projectId)))
    .orderBy(desc(projectAutomationWorkflows.updatedAt));
}

export async function getP9Workflow(ctx: TenantContext, workflowId: string): Promise<ProjectAutomationWorkflow> {
  const [row] = await getDb().select().from(projectAutomationWorkflows)
    .where(workflowTenantFilter(ctx, workflowId)).limit(1);
  if (!row) throw new Error("Automation workflow not found or not owned by the requesting user.");
  await getProject(ctx, row.projectId);
  return row;
}

export async function replaceP9Workflow(
  ctx: TenantContext,
  workflowId: string,
  raw: unknown,
  expectedUpdatedAt?: string,
): Promise<ProjectAutomationWorkflow> {
  const current = await getP9Workflow(ctx, workflowId);
  const input = p9WorkflowDefinitionInputSchema.parse(raw);
  assertP9HasNoReplayedGrant(input.action);
  assertSecretFree(input);
  if (input.action.kind === "model_refresh_review") await requireP9ModelRefreshReview(ctx, current.projectId, input.action);
  if (input.action.kind === "portfolio_materiality") await requireP9PortfolioMateriality(ctx, current.projectId, input.action);
  if (input.action.kind === "conversation_rerun" && input.action.sourceRequestId) {
    input.action.request = await requireSuccessfulP9Recipe(ctx, current.projectId, input.action);
  }
  if (input.action.kind === "conversation_rerun" && (input.action.acceptedArtifact || input.action.currentPersonalFinanceResourceId)) {
    await requireAcceptedP9Workflow(ctx, current.projectId, input.action);
  }
  assertP9HasNoReplayedGrant(input.action);
  const now = new Date();
  const nextRunAt = input.enabled ? nextP9ScheduledRun(input.trigger, now) : null;
  const [row] = await getDb().update(projectAutomationWorkflows).set({
    name: input.name,
    description: input.description,
    template: input.template,
    enabled: input.enabled,
    trigger: input.trigger,
    action: input.action,
    notificationPolicy: input.notificationPolicy,
    sourceRefs: input.sourceRefs,
    engineRefs: input.engineRefs,
    artifactRefs: input.artifactRefs,
    nextRunAt,
    consecutiveFailures: 0,
    claimToken: null,
    claimExpiresAt: null,
    updatedAt: now,
  }).where(and(workflowTenantFilter(ctx, workflowId), eq(projectAutomationWorkflows.updatedAt, expectedUpdatedAt ? new Date(expectedUpdatedAt) : current.updatedAt))).returning();
  if (!row) throw new Error("Workflow changed since review. Refresh and inspect the current Project before saving.");
  await appendLedgerEvent(ctx, {
    projectId: current.projectId,
    eventType: "policy.changed",
    actorType: "user",
    payload: { workflowId, policy: "automation", action: "updated", triggerType: input.trigger.type },
  });
  await touchProjectActivity(ctx, current.projectId);
  return row;
}

export async function setP9WorkflowEnabled(
  ctx: TenantContext,
  workflowId: string,
  enabled: boolean,
  expectedUpdatedAt?: string,
): Promise<ProjectAutomationWorkflow> {
  const current = await getP9Workflow(ctx, workflowId);
  const now = new Date();
  const [row] = await getDb().update(projectAutomationWorkflows).set({
    enabled,
    // An invalid persisted definition must still be pausable; enabling revalidates it.
    nextRunAt: enabled ? nextP9ScheduledRun(p9WorkflowTriggerSchema.parse(current.trigger), now) : null,
    ...(enabled ? { consecutiveFailures: 0 } : {}),
    claimToken: null,
    claimExpiresAt: null,
    updatedAt: now,
  }).where(and(workflowTenantFilter(ctx, workflowId), eq(projectAutomationWorkflows.updatedAt, expectedUpdatedAt ? new Date(expectedUpdatedAt) : current.updatedAt))).returning();
  if (!row) throw new Error("Workflow changed since review. Refresh before changing its enabled state.");
  await appendLedgerEvent(ctx, {
    projectId: current.projectId,
    eventType: "policy.changed",
    actorType: "user",
    payload: { workflowId, policy: "automation", action: enabled ? "enabled" : "paused" },
  });
  return row;
}

export async function deleteP9Workflow(ctx: TenantContext, workflowId: string, expectedUpdatedAt?: string): Promise<void> {
  const current = await getP9Workflow(ctx, workflowId);
  const deleted = await getDb().delete(projectAutomationWorkflows)
    .where(and(workflowTenantFilter(ctx, workflowId), eq(projectAutomationWorkflows.updatedAt, expectedUpdatedAt ? new Date(expectedUpdatedAt) : current.updatedAt))).returning();
  if (!deleted.length) throw new Error("Workflow changed since review. Refresh before deleting it.");
  await appendLedgerEvent(ctx, {
    projectId: current.projectId,
    eventType: "policy.changed",
    actorType: "user",
    payload: { workflowId, policy: "automation", action: "deleted" },
  });
  await touchProjectActivity(ctx, current.projectId);
}

export interface ClaimedP9Workflow {
  workflow: ProjectAutomationWorkflow;
  claimToken: string;
}

export async function claimDueP9Workflows(now = new Date(), limit = 25): Promise<ClaimedP9Workflow[]> {
  const db = getDb();
  const candidates = await db.select().from(projectAutomationWorkflows).where(and(
    eq(projectAutomationWorkflows.enabled, true),
    lte(projectAutomationWorkflows.nextRunAt, now),
    or(isNull(projectAutomationWorkflows.claimExpiresAt), lt(projectAutomationWorkflows.claimExpiresAt, now)),
  )).orderBy(projectAutomationWorkflows.nextRunAt).limit(Math.min(Math.max(limit, 1), 100));

  const claimed: ClaimedP9Workflow[] = [];
  for (const candidate of candidates) {
    const claimToken = crypto.randomUUID();
    const claimExpiresAt = new Date(now.getTime() + CLAIM_LEASE_MS);
    const [row] = await db.update(projectAutomationWorkflows).set({
      claimToken,
      claimExpiresAt,
      updatedAt: now,
    }).where(and(
      eq(projectAutomationWorkflows.id, candidate.id),
      eq(projectAutomationWorkflows.enabled, true),
      lte(projectAutomationWorkflows.nextRunAt, now),
      or(isNull(projectAutomationWorkflows.claimExpiresAt), lt(projectAutomationWorkflows.claimExpiresAt, now)),
    )).returning();
    if (row) claimed.push({ workflow: row, claimToken });
  }
  return claimed;
}

export async function renewP9WorkflowClaimSystem(
  workflowId: string,
  claimToken: string,
  now = new Date(),
): Promise<boolean> {
  const [row] = await getDb().update(projectAutomationWorkflows).set({
    claimExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS),
    updatedAt: now,
  }).where(and(
    eq(projectAutomationWorkflows.id, workflowId),
    eq(projectAutomationWorkflows.claimToken, claimToken),
    eq(projectAutomationWorkflows.enabled, true),
  )).returning();
  return Boolean(row);
}

export async function updateP9WorkflowEventCursorSystem(
  workflowId: string,
  eventCursor: Record<string, unknown>,
): Promise<void> {
  const { pendingAutomationEvents: _pending, pendingAutomationAttemptedAt: _attempted, ...observerCursor } = eventCursor;
  await getDb().update(projectAutomationWorkflows).set({
    eventCursor: sql`${projectAutomationWorkflows.eventCursor} || ${JSON.stringify(observerCursor)}::jsonb`,
    updatedAt: new Date(),
  }).where(eq(projectAutomationWorkflows.id, workflowId));
}

export async function listP9EventWorkflows(
  eventType: P9AutomationEventType,
  scope: { projectId: number | null; ownerUserId: number | null; organizationId: number | null },
): Promise<ProjectAutomationWorkflow[]> {
  const rows = await getDb().select().from(projectAutomationWorkflows)
    .where(and(
      eq(projectAutomationWorkflows.enabled, true),
      ...(scope.projectId ? [eq(projectAutomationWorkflows.projectId, scope.projectId)] : []),
      ...(scope.ownerUserId ? [eq(projectAutomationWorkflows.ownerUserId, scope.ownerUserId)] : []),
      ...(scope.organizationId ? [eq(projectAutomationWorkflows.organizationId, scope.organizationId)] : []),
    ))
    .orderBy(projectAutomationWorkflows.updatedAt);
  return rows.filter((row) => {
    const parsed = p9WorkflowTriggerSchema.safeParse(row.trigger);
    return parsed.success && parsed.data.type === "event" && parsed.data.eventType === eventType;
  });
}

export async function beginP9Run(
  ctx: TenantContext,
  workflow: ProjectAutomationWorkflow,
  triggerType: "manual" | "schedule" | "event",
  triggerDetail: Record<string, unknown>,
  dedupeKey: string | null = null,
  expectedWorkflowUpdatedAt: Date | null = null,
): Promise<ProjectAutomationRun | null> {
  await getProject(ctx, workflow.projectId);
  // Persisted definitions can outlive their original validation. Refuse an
  // invalid cron before an action starts; the due runner isolates this denial.
  p9WorkflowTriggerSchema.parse(workflow.trigger);
  const id = "workflow-run:" + crypto.randomUUID();
  const startedAt = new Date();
  const values = {
    id,
    workflowId: workflow.id,
    projectId: workflow.projectId,
    ownerUserId: ctx.userId,
    organizationId: ctx.organizationId,
    triggerType,
    triggerDetail,
    dedupeKey,
    status: "running",
    startedAt,
    leaseExpiresAt: new Date(startedAt.getTime() + CLAIM_LEASE_MS),
  };

  const row = triggerType === "manual" && dedupeKey && expectedWorkflowUpdatedAt
    ? await getDb().transaction(async (tx) => admitP9ApprovedManualRun(
        async () => {
          // Serialize against UPDATE/DELETE of this canonical workflow row.
          // The lock and unique-key run insert MUST share this transaction:
          // a route-level revision check alone is a TOCTOU vulnerability.
          const [locked] = await tx.select().from(projectAutomationWorkflows)
            .where(and(
              workflowTenantFilter(ctx, workflow.id),
              eq(projectAutomationWorkflows.projectId, workflow.projectId),
            ))
            .limit(1)
            .for("update");
          return locked ?? null;
        },
        async () => {
          const [admitted] = await tx.insert(projectAutomationRuns).values(values)
            .onConflictDoNothing().returning();
          return admitted ?? null;
        },
        workflow,
        expectedWorkflowUpdatedAt,
      ))
    : await getDb().transaction(async (tx) => {
      const [current] = await tx.select().from(projectAutomationWorkflows)
        .where(and(workflowTenantFilter(ctx, workflow.id), eq(projectAutomationWorkflows.projectId, workflow.projectId)))
        .for("update").limit(1);
      if (!current) return null;
      if (triggerType !== "manual" && (!current.enabled || !isDeepStrictEqual(
        [current.trigger, current.action, current.sourceRefs, current.engineRefs, current.artifactRefs],
        [workflow.trigger, workflow.action, workflow.sourceRefs, workflow.engineRefs, workflow.artifactRefs],
      ))) return null;
      const [admitted] = await tx.insert(projectAutomationRuns).values(values).onConflictDoNothing().returning();
      return admitted ?? null;
    });
  if (!row) return null;
  await appendLedgerEvent(ctx, {
    projectId: workflow.projectId,
    eventType: "execution.planned",
    actorType: triggerType === "manual" ? "user" : "system",
    correlationId: workflow.id,
    causationId: id,
    payload: { workflowId: workflow.id, workflowRunId: id, triggerType, template: workflow.template },
  });
  return row;
}

/**
 * Tenant-scoped lookup of an existing manual idempotency receipt.
 * The unique (workflow_id, dedupe_key) index on project_automation_runs
 * provides race-safe durable single-writer admission across server restarts.
 * Do not select unscoped receipts by a client-provided request UUID alone.
 */
export async function findP9ManualRunReceipt(
  ctx: TenantContext,
  projectId: number,
  workflowId: string,
  dedupeKey: string,
): Promise<ProjectAutomationRun | null> {
  const [row] = await getDb().select().from(projectAutomationRuns).where(and(
    runTenantFilter(ctx),
    eq(projectAutomationRuns.projectId, projectId),
    eq(projectAutomationRuns.workflowId, workflowId),
    eq(projectAutomationRuns.triggerType, "manual"),
    eq(projectAutomationRuns.dedupeKey, dedupeKey),
  )).limit(1);
  return row ?? null;
}

export async function completeP9Run(
  ctx: TenantContext,
  workflow: ProjectAutomationWorkflow,
  runId: string,
  input: { result?: P9WorkflowRunResult; error?: string; claimToken?: string | null },
): Promise<ProjectAutomationRun> {
  const now = new Date();
  const success = Boolean(input.result) && !input.error;
  const result = input.result ?? {
    summary: input.error || "Workflow failed.",
    changed: false,
    conditionMet: false,
    relevanceScore: 1,
    sourceRefs: [],
    engineRefs: [],
    artifactRefs: [],
    executionReceiptIds: [],
    output: {},
  };
  const [run] = await getDb().update(projectAutomationRuns).set({
    status: success ? "succeeded" : "failed",
    completedAt: now,
    leaseExpiresAt: null,
    summary: result.summary,
    changed: result.changed,
    conditionMet: result.conditionMet,
    relevanceScore: result.relevanceScore,
    sourceRefs: result.sourceRefs,
    engineRefs: result.engineRefs,
    artifactRefs: result.artifactRefs,
    executionReceiptIds: result.executionReceiptIds,
    output: result.output,
    error: success ? null : input.error || result.summary,
  }).where(and(eq(projectAutomationRuns.id, runId), runTenantFilter(ctx), eq(projectAutomationRuns.status, "running"))).returning();
  if (!run) throw new Error("Automation run not found or not owned by the requesting user.");

  const trigger = p9WorkflowTriggerSchema.parse(workflow.trigger);
  const scheduled = workflow.enabled ? nextP9ScheduledRun(trigger, now) : null;
  const failures = success ? 0 : workflow.consecutiveFailures + 1;
  // Auto-disable threshold adapted from approved OpenClaw src/cron/service/auto-disable.ts.
  // Only recurring scheduled definitions are paused; explicit owner recovery resets the failure streak.
  const pauseForFailures = !success && trigger.type === "schedule" && failures >= P9_RECURRING_FAILURE_PAUSE_LIMIT;
  const nextRunAt = scheduled && !pauseForFailures
    ? new Date(Math.max(scheduled.getTime(), now.getTime() + p9FailureBackoff(failures)))
    : null;
  const updateConditions = [
    eq(projectAutomationWorkflows.id, workflow.id),
    ...(input.claimToken ? [eq(projectAutomationWorkflows.claimToken, input.claimToken)] : []),
  ];
  await getDb().update(projectAutomationWorkflows).set({
    lastRunAt: now,
    lastSuccessAt: success ? now : workflow.lastSuccessAt,
    lastFailureAt: success ? workflow.lastFailureAt : now,
    consecutiveFailures: failures,
    ...(pauseForFailures ? { enabled: false } : {}),
    nextRunAt,
    claimToken: null,
    claimExpiresAt: null,
    updatedAt: now,
  }).where(and(...updateConditions));

  await appendLedgerEvent(ctx, {
    projectId: workflow.projectId,
    eventType: "execution.receipt",
    actorType: "system",
    receiptId: run.id,
    correlationId: workflow.id,
    causationId: run.id,
    payload: {
      workflowId: workflow.id,
      workflowRunId: run.id,
      status: success ? "succeeded" : "failed",
      pausedForConsecutiveFailures: pauseForFailures,
      changed: result.changed,
      conditionMet: result.conditionMet,
      relevanceScore: result.relevanceScore,
      sourceRefs: result.sourceRefs.slice(0, 100),
      engineRefs: result.engineRefs.slice(0, 100),
      artifactRefs: result.artifactRefs.slice(0, 100),
    },
  });
  await touchProjectActivity(ctx, workflow.projectId);
  return run;
}

export async function listP9Runs(
  ctx: TenantContext,
  projectId: number,
  workflowId?: string,
  limit = 50,
): Promise<ProjectAutomationRun[]> {
  await getProject(ctx, projectId);
  return getDb().select().from(projectAutomationRuns).where(and(
    runTenantFilter(ctx),
    eq(projectAutomationRuns.projectId, projectId),
    ...(workflowId ? [eq(projectAutomationRuns.workflowId, workflowId)] : []),
  )).orderBy(desc(projectAutomationRuns.startedAt)).limit(Math.min(Math.max(limit, 1), 200));
}

export async function latestSuccessfulP9Run(ctx: TenantContext, workflowId: string): Promise<ProjectAutomationRun | null> {
  const [row] = await getDb().select().from(projectAutomationRuns).where(and(
    runTenantFilter(ctx),
    eq(projectAutomationRuns.workflowId, workflowId),
    eq(projectAutomationRuns.status, "succeeded"),
  )).orderBy(desc(projectAutomationRuns.startedAt)).limit(1);
  return row ?? null;
}

export async function createP9Notification(
  ctx: TenantContext,
  workflow: ProjectAutomationWorkflow,
  runId: string,
  input: {
    result: P9WorkflowRunResult | null;
    error: string | null;
  },
): Promise<ProjectAutomationNotification | null> {
  await getProject(ctx, workflow.projectId);
  // The Home invalidation is an ephemeral hint, never the notification record.
  // Publish only after a committed, newly delivered notification; a retry that
  // finds the same run receipt must not rebroadcast it.
  const outcome = await getDb().transaction(async (tx) => {
    // The current policy read, cooldown check and insert share one workflow lock.
    // Run-start snapshots cannot override a later mute or race another completion.
    const [current] = await tx.select().from(projectAutomationWorkflows).where(and(
      workflowTenantFilter(ctx, workflow.id),
      eq(projectAutomationWorkflows.projectId, workflow.projectId),
    )).for("update").limit(1);
    if (!current) return null;
    const [existing] = await tx.select().from(projectAutomationNotifications).where(and(
      notificationTenantFilter(ctx),
      eq(projectAutomationNotifications.workflowId, current.id),
      eq(projectAutomationNotifications.runId, runId),
    )).limit(1);
    if (existing) return { row: existing, created: false };
    const [last] = await tx.select().from(projectAutomationNotifications).where(and(
      notificationTenantFilter(ctx),
      eq(projectAutomationNotifications.workflowId, current.id),
      eq(projectAutomationNotifications.status, "delivered"),
    )).orderBy(desc(projectAutomationNotifications.createdAt)).limit(1);
    const now = new Date();
    const decision = decideP9Notification({
      policy: p9NotificationPolicySchema.parse(current.notificationPolicy),
      status: input.error ? "failed" : "succeeded",
      result: input.result,
      lastDeliveredAt: last?.createdAt ?? null,
      now,
    });
    const materiality = input.result?.output;
    if (decision.status === "delivered" && materiality?.kind === "portfolio_materiality" && materiality.currentArtifact && typeof materiality.currentArtifact === "object") {
      const source = materiality.currentArtifact as Record<string, unknown>;
      // Same workflow lock serializes evidence admission even when two real runs completed concurrently.
      const [alreadyDelivered] = await tx.select({ id: projectAutomationNotifications.id }).from(projectAutomationNotifications)
        .innerJoin(projectAutomationRuns, eq(projectAutomationRuns.id, projectAutomationNotifications.runId))
        .where(and(notificationTenantFilter(ctx), eq(projectAutomationNotifications.workflowId, current.id),
          eq(projectAutomationNotifications.status, "delivered"),
          sql`${projectAutomationRuns.output}->>'actionHash' = ${String(materiality.actionHash)}`,
          sql`${projectAutomationRuns.output}->'currentArtifact'->>'contentHash' = ${String(source.contentHash)}`,
          sql`${projectAutomationRuns.output}->'currentArtifact'->>'version' = ${String(source.version)}`,
        )).limit(1);
      if (alreadyDelivered) decision.status = "suppressed";
    }
    const failurePause = input.error && !current.enabled &&
      current.consecutiveFailures >= P9_RECURRING_FAILURE_PAUSE_LIMIT &&
      p9WorkflowTriggerSchema.parse(current.trigger).type === "schedule";
    const body = failurePause
      ? `Workflow paused after ${current.consecutiveFailures} consecutive failures. Review the failure, then explicitly enable the workflow to resume future runs; failed actions are not replayed.\n${input.error}`
      : input.error || input.result?.summary || decision.explanation;
    const [row] = await tx.insert(projectAutomationNotifications).values({
      id: "workflow-notification:" + crypto.randomUUID(),
      workflowId: current.id,
      runId,
      projectId: current.projectId,
      ownerUserId: ctx.userId,
      organizationId: ctx.organizationId,
      channel: "in_app",
      status: decision.status,
      reason: decision.reason,
      title: p9NotificationTitle(current.name, decision.reason).slice(0, 500),
      body: body.slice(0, 20_000),
      relevanceScore: input.result?.relevanceScore ?? 1,
      createdAt: now,
    }).returning();
    return { row, created: true };
  });
  if (!outcome) return null;
  if (outcome.created && outcome.row.status === "delivered") {
    notifyDataChanged("notifications", { userId: ctx.userId });
  }
  return outcome.row;
}

export async function listP9Notifications(
  ctx: TenantContext,
  projectId: number,
  limit = 100,
): Promise<ProjectAutomationNotification[]> {
  await getProject(ctx, projectId);
  return getDb().select().from(projectAutomationNotifications).where(and(
    notificationTenantFilter(ctx),
    eq(projectAutomationNotifications.projectId, projectId),
  )).orderBy(desc(projectAutomationNotifications.createdAt)).limit(Math.min(Math.max(limit, 1), 500));
}

/** Current owner's delivered inbox across active Projects; not a tenant-wide broadcast. */
export async function listOwnedP9Notifications(ctx: TenantContext, limit = 100): Promise<ProjectAutomationNotification[]> {
  const rows = await getDb().select({ notification: projectAutomationNotifications })
    .from(projectAutomationNotifications)
    .innerJoin(projects, eq(projects.id, projectAutomationNotifications.projectId))
    .where(and(notificationTenantFilter(ctx),
      eq(projects.ownerUserId, ctx.userId), orgClause(projects.organizationId, ctx),
      eq(projects.status, "active"), isNull(projects.trashedAt),
      eq(projectAutomationNotifications.status, "delivered"), isNull(projectAutomationNotifications.readAt),
    )).orderBy(desc(projectAutomationNotifications.createdAt)).limit(Math.min(Math.max(limit, 1), 500));
  return rows.map(row => row.notification);
}

export async function markP9NotificationRead(
  ctx: TenantContext,
  projectId: number,
  notificationId: string,
): Promise<ProjectAutomationNotification> {
  await getProject(ctx, projectId);
  // Offline retries must be idempotent: preserve the first server-confirmed
  // read timestamp if a prior successful response was lost in transit.
  const [row] = await getDb().update(projectAutomationNotifications).set({
    readAt: sql<Date>`COALESCE(${projectAutomationNotifications.readAt}, NOW())`,
  }).where(and(
    notificationTenantFilter(ctx),
    eq(projectAutomationNotifications.projectId, projectId),
    eq(projectAutomationNotifications.id, notificationId),
  )).returning();
  if (!row) throw new Error("Automation notification not found or not owned by the requesting user.");
  return row;
}

export function parseP9StoredWorkflow(row: ProjectAutomationWorkflow): {
  trigger: ReturnType<typeof p9WorkflowTriggerSchema.parse>;
  action: ReturnType<typeof p9WorkflowActionSchema.parse>;
  notificationPolicy: ReturnType<typeof p9NotificationPolicySchema.parse>;
} {
  return {
    trigger: p9WorkflowTriggerSchema.parse(row.trigger),
    action: p9WorkflowActionSchema.parse(row.action),
    notificationPolicy: p9NotificationPolicySchema.parse(row.notificationPolicy),
  };
}

export function p9WorkflowInputFromRow(row: ProjectAutomationWorkflow): P9WorkflowDefinitionInput {
  return p9WorkflowDefinitionInputSchema.parse({
    schemaVersion: "1",
    name: row.name,
    description: row.description,
    template: row.template,
    trigger: row.trigger,
    action: row.action,
    notificationPolicy: row.notificationPolicy,
    sourceRefs: row.sourceRefs,
    engineRefs: row.engineRefs,
    artifactRefs: row.artifactRefs,
    enabled: row.enabled,
  });
}
