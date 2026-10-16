import { and, eq, isNull, lte, or } from "drizzle-orm";
import { projectAutomationRuns, projectAutomationWorkflows, users } from "@shared/schema";
import { p9WorkflowTriggerSchema } from "@shared/p9AutomationContracts";
import { getDb } from "./db";
import { appendLedgerEvent } from "./ledgerStore";
import { nextP9ScheduledRun } from "./p9AutomationEngine";

const RUN_LEASE_MS = 5 * 60_000;

export async function renewP9RunLease(runId: string, now = new Date()): Promise<boolean> {
  const [run] = await getDb().update(projectAutomationRuns).set({ leaseExpiresAt: new Date(now.getTime() + RUN_LEASE_MS) })
    .where(and(eq(projectAutomationRuns.id, runId), eq(projectAutomationRuns.status, "running"))).returning();
  return Boolean(run);
}

/** Reconcile abandoned receipts, never rerun an action whose external outcome may be unknown. */
export async function recoverInterruptedP9Runs(now = new Date()): Promise<number> {
  const db = getDb();
  const expired = () => or(
    lte(projectAutomationRuns.leaseExpiresAt, now),
    and(isNull(projectAutomationRuns.leaseExpiresAt), lte(projectAutomationRuns.startedAt, new Date(now.getTime() - RUN_LEASE_MS))),
  );
  const candidates = await db.select().from(projectAutomationRuns).where(and(eq(projectAutomationRuns.status, "running"), expired())).orderBy(projectAutomationRuns.startedAt).limit(100);
  let recovered = 0;
  for (const candidate of candidates) {
    const run = await db.transaction(async tx => {
      const [workflow] = await tx.select().from(projectAutomationWorkflows).where(eq(projectAutomationWorkflows.id, candidate.workflowId)).for("update").limit(1);
      if (!workflow) return null;
      if (candidate.triggerType === "schedule" && workflow.claimExpiresAt && workflow.claimExpiresAt > now) return null;
      const [interrupted] = await tx.update(projectAutomationRuns).set({
        status: "failed", completedAt: now, leaseExpiresAt: null,
        summary: "Workflow interrupted before a durable completion was recorded. Inspect retained work and receipts before explicitly running again.",
        error: "interrupted_outcome_unknown_no_automatic_replay",
      }).where(and(eq(projectAutomationRuns.id, candidate.id), eq(projectAutomationRuns.status, "running"), expired())).returning();
      if (!interrupted) return null;
      // Only the abandoned scheduled run owns its claim. Manual/event recovery must not disturb another scheduled action.
      await tx.update(projectAutomationWorkflows).set({
        lastRunAt: now, lastFailureAt: now, consecutiveFailures: workflow.consecutiveFailures + 1,
        ...(interrupted.triggerType === "schedule" && (!workflow.claimExpiresAt || workflow.claimExpiresAt <= now) ? {
          claimToken: null, claimExpiresAt: null,
          nextRunAt: workflow.enabled ? nextP9ScheduledRun(p9WorkflowTriggerSchema.parse(workflow.trigger), now) : null,
        } : {}),
      }).where(eq(projectAutomationWorkflows.id, workflow.id));
      return interrupted;
    });
    if (!run) continue;
    recovered += 1;
    const [owner] = await db.select({ role: users.role }).from(users).where(eq(users.id, run.ownerUserId)).limit(1);
    if (owner) await appendLedgerEvent({ userId: run.ownerUserId, organizationId: run.organizationId, role: owner.role }, {
      projectId: run.projectId, eventType: "execution.receipt", actorType: "system", receiptId: run.id,
      correlationId: run.workflowId, causationId: run.id,
      payload: { workflowId: run.workflowId, workflowRunId: run.id, status: "failed", recovery: "interrupted", outcomeKnown: false, automaticallyReplayed: false },
    });
  }
  return recovered;
}
