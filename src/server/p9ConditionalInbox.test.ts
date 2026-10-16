import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-conditional-inbox-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
process.env.LIOS_EXECUTION_ISOLATION = "strict";
delete process.env.DATABASE_URL;
const { initDb, closeDb, getDb } = await import("./db");
const { users, projectAutomationRuns, projectAutomationWorkflows } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createProjectChat } = await import("./projectChatStore");
const { createP9Workflow, getP9Workflow, replaceP9Workflow, setP9WorkflowEnabled, updateP9WorkflowEventCursorSystem } = await import("./p9AutomationStore");
const { enqueueP9ConditionalEvent, listPendingP9ConditionalEvents, recordP9ConditionalAttempt } = await import("./p9ConditionalInbox");
const { drainPendingP9ConditionalEvents, emitP9AutomationEvent } = await import("./p9AutomationService");

test("accepted conditional work survives restart and never blindly repeats an admitted action", { timeout: 120_000 }, async t => {
  await initDb();
  t.after(async () => { await closeDb(); fs.rmSync(root, { recursive: true, force: true }); });
  const [owner] = await getDb().insert(users).values({ name: "Conditional owner", email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", role: "internal_admin", organizationId: null }).returning();
  assert.ok(owner);
  const ctx = { userId: owner.id, organizationId: null, role: owner.role };
  const project = await createProject(ctx, { name: "Durable conditions" });
  const chat = await createProjectChat(ctx, { projectId: project.id, scope: "project", title: "Conditional diagnostic" });
  const definition = { name: "Owned conditional diagnostic", enabled: true, trigger: { type: "event" as const, eventType: "data_refresh" as const, filters: { symbol: "AAPL" } }, action: { kind: "conversation_rerun" as const, chatId: chat.id, request: { message: "LiOS doctor", executionMode: "deterministic_first" as const, sourceScope: "my_data" as const } }, notificationPolicy: { enabled: false } };
  const workflow = await createP9Workflow(ctx, project.id, definition);
  const event = { eventType: "data_refresh" as const, occurredAt: new Date().toISOString(), projectId: project.id, ownerUserId: owner.id, organizationId: null, sourceRef: "verification:owned-refresh", payload: { symbol: "AAPL" } };
  assert.equal(await enqueueP9ConditionalEvent(workflow, event, "event:restart-proof"), true);
  await updateP9WorkflowEventCursorSystem(workflow.id, { filingAccessionNumber: "observer-progress", pendingAutomationEvents: [] });
  await closeDb();
  await initDb();
  assert.equal((await listPendingP9ConditionalEvents())[0]?.entry.key, "event:restart-proof", "observer updates and database reopen must retain accepted delivery");
  await Promise.all([drainPendingP9ConditionalEvents(), drainPendingP9ConditionalEvents()]);
  const runs = await getDb().select().from(projectAutomationRuns).where(eq(projectAutomationRuns.workflowId, workflow.id));
  assert.deepEqual(runs.map(run => run.status), ["succeeded"]);
  assert.equal(runs[0]?.triggerType, "event");
  assert.ok(runs[0]?.executionReceiptIds.length, "real diagnostic execution must produce its receipt");
  assert.deepEqual(await listPendingP9ConditionalEvents(), []);
  assert.equal((await getP9Workflow(ctx, workflow.id)).eventCursor.filingAccessionNumber, "observer-progress");

  await t.test("a changed definition cannot consume events accepted for the former action", async () => {
    const current = await getP9Workflow(ctx, workflow.id);
    await enqueueP9ConditionalEvent(current, event, "event:old-definition");
    await replaceP9Workflow(ctx, workflow.id, { ...definition, trigger: { ...definition.trigger, filters: { symbol: "MSFT" } } });
    assert.deepEqual(await drainPendingP9ConditionalEvents(), { succeeded: 0, failed: 0 });
    assert.equal((await getDb().select().from(projectAutomationRuns).where(eq(projectAutomationRuns.workflowId, workflow.id))).length, 1);
    assert.deepEqual(await listPendingP9ConditionalEvents(), []);
  });
  await t.test("paused workflows do not dispatch and current denied owners cannot run pending work", async () => {
    await replaceP9Workflow(ctx, workflow.id, definition);
    await enqueueP9ConditionalEvent(await getP9Workflow(ctx, workflow.id), event, "event:permission-check");
    await setP9WorkflowEnabled(ctx, workflow.id, false);
    assert.deepEqual(await drainPendingP9ConditionalEvents(), { succeeded: 0, failed: 0 });
    await setP9WorkflowEnabled(ctx, workflow.id, true);
    await getDb().update(users).set({ active: false }).where(eq(users.id, owner.id));
    assert.deepEqual(await drainPendingP9ConditionalEvents(), { succeeded: 0, failed: 1 });
    assert.equal((await listPendingP9ConditionalEvents()).length, 1);
    await getDb().update(users).set({ active: true }).where(eq(users.id, owner.id));
    assert.deepEqual(await drainPendingP9ConditionalEvents(), { succeeded: 1, failed: 0 });
  });
  await t.test("normal event publication matches scope and retains canonical dedupe after restart", async () => {
    const wrong = await emitP9AutomationEvent({ ...event, payload: { symbol: "MSFT" } });
    assert.deepEqual(wrong, { matched: 0, executed: 0, failed: 0 });
    assert.deepEqual(await emitP9AutomationEvent(event), { matched: 1, executed: 1, failed: 0 });
    await closeDb();
    await initDb();
    assert.deepEqual(await emitP9AutomationEvent(event), { matched: 1, executed: 0, failed: 0 });
    const row = await getDb().select().from(projectAutomationWorkflows).where(eq(projectAutomationWorkflows.id, workflow.id));
    assert.deepEqual(row[0]?.eventCursor.pendingAutomationEvents, []);
  });
  await t.test("bounded inbox rejects excess bytes without dropping previously accepted work", async () => {
    const current = await getP9Workflow(ctx, workflow.id);
    const payload = Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`field${index}`, "x".repeat(10_000)]));
    await enqueueP9ConditionalEvent(current, event, "event:keep-before-overflow");
    await assert.rejects(enqueueP9ConditionalEvent(current, { ...event, payload }, "event:too-large"), /byte limit/);
    assert.deepEqual((await listPendingP9ConditionalEvents()).map(item => item.entry.key), ["event:keep-before-overflow"]);
    await drainPendingP9ConditionalEvents();
  });
  await t.test("attempted blocked workflows rotate out of the bounded batch so later work is reachable", async () => {
    for (let index = 0; index < 26; index += 1) {
      const candidate = await createP9Workflow(ctx, project.id, { ...definition, name: `Fair delivery ${index}` });
      await enqueueP9ConditionalEvent(candidate, event, `event:fairness-${index}`);
    }
    const first = await listPendingP9ConditionalEvents();
    assert.equal(first.length, 25);
    for (const item of first) await recordP9ConditionalAttempt(item.workflow.id);
    const next = await listPendingP9ConditionalEvents();
    assert.equal(first.some(item => item.workflow.id === next[0]?.workflow.id), false, "unattempted work must precede already attempted entries");
  });
});
