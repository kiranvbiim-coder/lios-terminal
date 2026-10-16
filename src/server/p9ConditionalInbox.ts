import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { projectAutomationWorkflows, type ProjectAutomationWorkflow } from "@shared/schema";
import { p9AutomationEventSchema } from "@shared/p9AutomationContracts";
import { getDb } from "./db";
import { hashLedgerValue } from "./ledgerStore";

const entriesSchema = z.array(z.object({
  key: z.string(),
  definitionHash: z.string(),
  event: p9AutomationEventSchema,
})).max(128);
export type PendingP9Event = z.infer<typeof entriesSchema>[number];

function entries(workflow: ProjectAutomationWorkflow): PendingP9Event[] {
  return entriesSchema.parse(workflow.eventCursor.pendingAutomationEvents ?? []);
}

export function p9EventDefinitionHash(workflow: ProjectAutomationWorkflow): string {
  return hashLedgerValue({ trigger: workflow.trigger, action: workflow.action, sourceRefs: workflow.sourceRefs, engineRefs: workflow.engineRefs, artifactRefs: workflow.artifactRefs });
}

export async function enqueueP9ConditionalEvent(workflow: ProjectAutomationWorkflow, event: PendingP9Event["event"], key: string): Promise<boolean> {
  return getDb().transaction(async tx => {
    const [current] = await tx.select().from(projectAutomationWorkflows).where(eq(projectAutomationWorkflows.id, workflow.id)).for("update").limit(1);
    if (!current?.enabled || p9EventDefinitionHash(current) !== p9EventDefinitionHash(workflow)) return false;
    const pending = entries(current);
    if (pending.some(item => item.key === key)) return true;
    if (pending.length >= 128) throw new Error("Conditional workflow inbox is full; event was not accepted. Inspect pending work before publishing again.");
    pending.push({ key, event, definitionHash: p9EventDefinitionHash(current) });
    if (Buffer.byteLength(JSON.stringify(pending), "utf8") > 1_048_576) throw new Error("Conditional workflow inbox byte limit reached; event was not accepted.");
    await tx.update(projectAutomationWorkflows).set({ eventCursor: { ...current.eventCursor, pendingAutomationEvents: pending } }).where(eq(projectAutomationWorkflows.id, current.id));
    return true;
  });
}

export async function acknowledgeP9ConditionalEvent(workflowId: string, key: string): Promise<void> {
  await getDb().transaction(async tx => {
    const [current] = await tx.select().from(projectAutomationWorkflows).where(eq(projectAutomationWorkflows.id, workflowId)).for("update").limit(1);
    if (!current) return;
    await tx.update(projectAutomationWorkflows).set({ eventCursor: { ...current.eventCursor, pendingAutomationEvents: entries(current).filter(item => item.key !== key) } }).where(eq(projectAutomationWorkflows.id, workflowId));
  });
}

export async function listPendingP9ConditionalEvents(): Promise<Array<{ workflow: ProjectAutomationWorkflow; entry: PendingP9Event }>> {
  const rows = await getDb().select().from(projectAutomationWorkflows).where(and(
    eq(projectAutomationWorkflows.enabled, true),
    sql`jsonb_array_length(coalesce(${projectAutomationWorkflows.eventCursor}->'pendingAutomationEvents', '[]'::jsonb)) > 0`,
  )).orderBy(sql`coalesce(${projectAutomationWorkflows.eventCursor}->>'pendingAutomationAttemptedAt', '')`, projectAutomationWorkflows.id).limit(25);
  return rows.flatMap(workflow => {
    const entry = entries(workflow)[0];
    return entry ? [{ workflow, entry }] : [];
  });
}

export async function recordP9ConditionalAttempt(workflowId: string): Promise<void> {
  await getDb().update(projectAutomationWorkflows).set({
    eventCursor: sql`jsonb_set(${projectAutomationWorkflows.eventCursor}, '{pendingAutomationAttemptedAt}', ${JSON.stringify(new Date().toISOString())}::jsonb)`,
  }).where(eq(projectAutomationWorkflows.id, workflowId));
}
