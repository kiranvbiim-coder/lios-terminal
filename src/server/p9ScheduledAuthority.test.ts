import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-scheduled-authority-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;
const { initDb, closeDb, getDb } = await import("./db");
const { users, projectAutomationRuns } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createProjectChat } = await import("./projectChatStore");
const { createP9Workflow, setP9WorkflowEnabled } = await import("./p9AutomationStore");
const { executeP9Workflow, runDueP9Workflows, runP9FilingObserverCycle } = await import("./p9AutomationService");
const { getRequestIdentity } = await import("./requestContext");

test("scheduled automation rechecks pause and isolates an owner authority denial", { timeout: 120_000 }, async (t) => {
  await initDb();
  t.after(async () => { await closeDb(); fs.rmSync(root, { recursive: true, force: true }); });
  const owners = await getDb().insert(users).values([0, 1].map(index => ({ name: `Scheduler owner ${index}`, email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", role: "internal_admin" as const, organizationId: null }))).returning();
  const workflows = [];
  for (const owner of owners) {
    const ctx = { userId: owner.id, organizationId: null, role: owner.role };
    const project = await createProject(ctx, { name: `Owner ${owner.id} scheduled work` });
    const chat = await createProjectChat(ctx, { projectId: project.id, scope: "project", title: "Scheduled diagnostic" });
    const workflow = await createP9Workflow(ctx, project.id, { name: "Scheduled diagnostic", template: "custom", enabled: true, trigger: { type: "schedule", schedule: { kind: "interval", everyMinutes: 5 } }, action: { kind: "conversation_rerun", chatId: chat.id, request: { message: "LiOS doctor", executionMode: "deterministic_first", sourceScope: "my_data" } }, notificationPolicy: { enabled: false } });
    workflows.push({ workflow, ctx });
  }
  await t.test("pausing after a due snapshot was captured admits no scheduled run", async () => {
    const { workflow, ctx } = workflows[0]!;
    await setP9WorkflowEnabled(ctx, workflow.id, false);
    const result = await executeP9Workflow({ workflow, triggerType: "schedule" });
    assert.equal(result.run, null);
    assert.equal((await getDb().select().from(projectAutomationRuns).where(eq(projectAutomationRuns.workflowId, workflow.id))).length, 0);
    await setP9WorkflowEnabled(ctx, workflow.id, true);
  });
  await t.test("a disabled owner does not prevent the next eligible scheduled workflow from producing its receipt", async () => {
    await getDb().update(users).set({ active: false }).where(eq(users.id, owners[0]!.id));
    const result = await runDueP9Workflows(new Date(Date.now() + 6 * 60_000));
    assert.equal(result.claimed, 2);
    assert.equal(result.failed, 1);
    assert.equal(result.succeeded, 1);
    const denied = await getDb().select().from(projectAutomationRuns).where(eq(projectAutomationRuns.workflowId, workflows[0]!.workflow.id));
    assert.equal(denied.length, 0);
    const eligible = await getDb().select().from(projectAutomationRuns).where(eq(projectAutomationRuns.workflowId, workflows[1]!.workflow.id));
    assert.deepEqual(eligible.map(run => run.status), ["succeeded"], "the eligible owner runs a real deterministic diagnostic without AI");
  });
  await t.test("filing observation refuses disabled owners before source access and carries the eligible owner's identity", async () => {
    for (const { workflow, ctx } of workflows) {
      await createP9Workflow(ctx, workflow.projectId, { name: "Owner-bound filing observation", enabled: true, trigger: { type: "event", eventType: "filing", filters: { symbol: "AAPL" } }, action: workflow.action, notificationPolicy: { enabled: false } });
    }
    const observedOwners: Array<number | null | undefined> = [];
    const result = await runP9FilingObserverCycle({ filings: async () => { observedOwners.push(getRequestIdentity()?.userId); return []; } });
    assert.deepEqual(observedOwners, [owners[1]!.id], "no source call for a disabled owner, and no ambient/unowned credential context");
    assert.equal(result.failed, 1);
    assert.equal(result.observed, 0, "empty fixture source is not invented filing evidence");
  });
});
