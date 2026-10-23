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
const { users, projectAutomationRuns, projectAutomationWorkflows, sourceConnections } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createProjectChat } = await import("./projectChatStore");
const { createP9Workflow, replaceP9Workflow, setP9WorkflowEnabled } = await import("./p9AutomationStore");
const { p9WorkflowActionSchema } = await import("@shared/p9AutomationContracts");
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
  await t.test("D4 stores and scheduler reject historical approvals, including legacy rows", async () => {
    const { workflow, ctx } = workflows[1]!;
    const saved = p9WorkflowActionSchema.parse(workflow.action);
    assert.equal(saved.kind, "conversation_rerun");
    if (saved.kind !== "conversation_rerun") return;

    for (const request of [
      { ...saved.request, approvals: [{ action: "AIDirectEstimate" as const, scope: "once" as const }] },
      { ...saved.request, aiDirectApproved: true },
    ]) {
      const candidate = { ...saved, request };
      const raw = {
        name: "Must not store approval", template: "custom", enabled: true,
        trigger: { type: "schedule", schedule: { kind: "interval", everyMinutes: 5 } },
        action: candidate, notificationPolicy: { enabled: false },
      };
      await assert.rejects(createP9Workflow(ctx, workflow.projectId, raw),
        /cannot reuse conversation approvals/);
      await assert.rejects(replaceP9Workflow(ctx, workflow.id, raw),
        /cannot reuse conversation approvals/);
    }

    const legacyAction = {
      ...saved,
      request: {
        ...saved.request,
        approvals: [{ action: "AIDirectEstimate" as const, scope: "once" as const }],
      },
    };
    await getDb().update(projectAutomationWorkflows).set({ action: legacyAction })
      .where(eq(projectAutomationWorkflows.id, workflow.id));
    try {
      const [legacy] = await getDb().select().from(projectAutomationWorkflows)
        .where(eq(projectAutomationWorkflows.id, workflow.id));
      assert.ok(legacy);
      const denied = await executeP9Workflow({ workflow: legacy, triggerType: "manual" });
      assert.equal(denied.run?.status, "failed");
      assert.match(denied.error ?? "", /cannot reuse conversation approvals/);
      assert.equal(denied.result, null);
    } finally {
      await getDb().update(projectAutomationWorkflows).set({ action: saved })
        .where(eq(projectAutomationWorkflows.id, workflow.id));
    }
  });
  await t.test("D4 P9 live MCP source rights are checked again on every attempted research rerun", async () => {
    const { workflow, ctx } = workflows[1]!;
    const [source] = await getDb().insert(sourceConnections).values({
      userId: ctx.userId, organizationId: ctx.organizationId,
      connectorId: "mcp", name: "Scheduled source authority fixture", sourceType: "mcp",
      config: {
        endpoint: "https://example.test/mcp", projectId: workflow.projectId,
        aiTransmission: "allow", aiUsageRights: "cleared",
        allowedToolIds: "quotes.read",
      },
      credentialRef: null, status: "configured",
    }).returning();
    assert.ok(source);
    const pinned = await createP9Workflow(ctx, workflow.projectId, {
      name: "Pinned source safe diagnostic", template: "custom", enabled: true,
      trigger: { type: "manual" },
      action: workflow.action,
      sourceRefs: ["mcp-server:source:" + source.id, "mcp-tool:quotes.read"],
      notificationPolicy: { enabled: false },
    });
    const accepted = await executeP9Workflow({ workflow: pinned, triggerType: "manual" });
    assert.equal(accepted.run?.status, "succeeded", "normal authorized workflow retains existing deterministic operation");
    await getDb().update(sourceConnections).set({ status: "invalid" }).where(eq(sourceConnections.id, source.id));
    const denied = await executeP9Workflow({ workflow: pinned, triggerType: "manual" });
    assert.equal(denied.run?.status, "failed", "revoked MCP identity must block a saved workflow");
    assert.match(denied.error ?? "", /revoked or outside current owner authority/);
    assert.equal(denied.result, null, "revoked connection never yields a successful P9 result");
    await getDb().update(sourceConnections).set({ status: "configured",
      config: { ...source.config, aiUsageRights: "unknown" },
    }).where(eq(sourceConnections.id, source.id));
    const rightsDenied = await executeP9Workflow({ workflow: pinned, triggerType: "manual" });
    assert.equal(rightsDenied.run?.status, "failed");
    assert.match(rightsDenied.error ?? "", /no current owner-declared AI release rights/);
  });
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
    assert.deepEqual(eligible.filter(run => run.triggerType === "schedule").map(run => run.status), ["succeeded"],
      "only the due scheduled run counts for scheduler admission; the earlier deliberately failed manual authority probe retains its audit receipt");
    assert.equal(eligible.filter(run => run.triggerType === "manual" && run.status === "failed").length, 1,
      "the legacy-approval rejection must remain an actual failed P9 run in the durable history");
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
  await t.test("provider exceptions never disclose upstream detail in automation observer logs", async () => {
    const secret = "PRIVATE_PROVIDER_DETAIL_DO_NOT_LOG_20261016";
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.map(value => String(value)).join(" ")); };
    try {
      let calls = 0;
      const result = await runP9FilingObserverCycle({
        filings: async () => {
          calls += 1;
          throw new Error(`Provider rejected sensitive credential: ${secret}`);
        },
      });
      assert.equal(calls, 1, "disabled owner never invokes provider source");
      assert.equal(result.failed, 2, "denied owner and failing provider count as failures");
      assert.equal(result.observed, 0, "failed fetch cannot become a successful observation");
      assert.ok(!warnings.join("\n").includes(secret), "server logs must not contain provider failure or credential bytes");
    } finally {
      console.warn = originalWarn;
    }
  });
});
