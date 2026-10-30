import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { nextP9CronRun } from "@shared/p9CronSchedule";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-scheduled-authority-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;
const { initDb, closeDb, getDb } = await import("./db");
const { users, projectAutomationRuns, projectAutomationWorkflows, sourceConnections } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createProjectChat } = await import("./projectChatStore");
const { claimDueP9Workflows, createP9Workflow, getP9Workflow, replaceP9Workflow, setP9WorkflowEnabled } = await import("./p9AutomationStore");
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
  await t.test("D4 refuses P13 package references removed before scheduled execution", async () => {
    const { workflow, ctx } = workflows[1]!;
    const pinned = await createP9Workflow(ctx, workflow.projectId, {
      name: "Signed plugin dependency requires current installation",
      template: "custom", enabled: true, trigger: { type: "manual" },
      action: workflow.action, engineRefs: ["plugin:uninstalled.fixture"],
      notificationPolicy: { enabled: false },
    });
    const outcome = await executeP9Workflow({ workflow: pinned, triggerType: "manual" });
    assert.equal(outcome.run?.status, "failed", "missing installed plugin blocks the run before other work");
    assert.match(outcome.error ?? "", /plugin dependency is not currently installed/);
    assert.equal(outcome.result, null);
  });
  await t.test("D4 P9 revalidates the installed P13 publisher key, not cached installation trust", async () => {
    const { workflow, ctx } = workflows[1]!;
    const { getP13PluginRuntimeHost } = await import("./p13PluginRuntime");
    const { computePluginPackageDigest, signPluginManifest } = await import("./p13PluginTrust");
    const { liosPluginManifestV1Schema } = await import("@shared/pluginSdk");
    const host = getP13PluginRuntimeHost();
    const id = "org.lios.p9d4test";
    const keyId = "publisher.p9.d4";
    const pair = crypto.generateKeyPairSync("ed25519");
    host.trustStore.trustKey(keyId, pair.publicKey);
    const unsigned = liosPluginManifestV1Schema.parse({
      apiVersion: "1", id, name: "P9 signed evidence dependency",
      version: "1.0.0", publisher: "P9 test",
      lios: { sdkVersion: "1", minVersion: "1.0.0", maxVersion: null },
      runtime: { kind: "declarative", entrypoint: null },
      dependencies: [], permissions: [], connectors: [], tools: [],
      artifacts: [{ id: "chart", componentId: id + ".chart", name: "Read-only chart",
        capabilities: [], artifactKinds: ["chart"] }],
      agents: [], skills: [], integrity: null, signer: null,
    });
    const observedPackageDigest = computePluginPackageDigest(Buffer.from("D4 audited signed fixture"));
    host.installDeclarativePlugin({
      manifest: signPluginManifest(unsigned, keyId, pair.privateKey, observedPackageDigest),
      observedPackageDigest,
    });
    try {
      const pinned = await createP9Workflow(ctx, workflow.projectId, {
        name: "Signed package dependency", template: "custom", enabled: true,
        trigger: { type: "manual" }, action: workflow.action,
        engineRefs: ["plugin:" + id], notificationPolicy: { enabled: false },
      });
      const first = await executeP9Workflow({ workflow: pinned, triggerType: "manual" });
      assert.equal(first.run?.status, "succeeded", "current signature and installed package satisfy dependency admission");
      host.trustStore.revokeKey(keyId);
      const revoked = await executeP9Workflow({ workflow: pinned, triggerType: "manual" });
      assert.equal(revoked.run?.status, "failed", "revoked publisher must block a new background run");
      assert.match(revoked.error ?? "", /lacks current signed package trust/);
      assert.equal(revoked.result, null);
      assert.equal(host.plugins.remove(id), true);
      const uninstalled = await executeP9Workflow({ workflow: pinned, triggerType: "manual" });
      assert.equal(uninstalled.run?.status, "failed", "removed package cannot satisfy a saved reference");
      assert.match(uninstalled.error ?? "", /plugin dependency is not currently installed/);
      assert.equal(uninstalled.result, null);
    } finally {
      host.plugins.remove(id);
    }
  });
  await t.test("pausing after a due snapshot was captured admits no scheduled run", async () => {
    const { workflow, ctx } = workflows[0]!;
    await setP9WorkflowEnabled(ctx, workflow.id, false);
    const result = await executeP9Workflow({ workflow, triggerType: "schedule" });
    assert.equal(result.run, null);
    assert.equal((await getDb().select().from(projectAutomationRuns).where(eq(projectAutomationRuns.workflowId, workflow.id))).length, 0);
    await setP9WorkflowEnabled(ctx, workflow.id, true);
  });
  await t.test("zoned cron cold reopen claims one overdue slot and executes canonical provider health without AI", async () => {
    const { workflow, ctx } = workflows[1]!;
    const schedule = { kind: "cron" as const, expression: "*/5 * * * *", timeZone: "America/New_York" };
    let cron = await createP9Workflow(ctx, workflow.projectId, {
      name: "Zoned provider health", enabled: false, trigger: { type: "schedule", schedule },
      action: { kind: "provider_health" }, notificationPolicy: { enabled: false },
    });
    assert.equal(cron.nextRunAt, null);
    cron = await setP9WorkflowEnabled(ctx, cron.id, true, cron.updatedAt.toISOString());
    assert.equal(cron.nextRunAt?.getTime(), nextP9CronRun(schedule, cron.updatedAt)?.getTime());
    const overdue = new Date(Date.now() - 7 * 86_400_000);
    await getDb().update(projectAutomationWorkflows).set({ nextRunAt: overdue }).where(eq(projectAutomationWorkflows.id, cron.id));
    await closeDb();
    await initDb();
    cron = await getP9Workflow(ctx, cron.id);
    assert.deepEqual(cron.trigger, { type: "schedule", schedule });
    const now = new Date();
    const batches = await Promise.all([claimDueP9Workflows(now), claimDueP9Workflows(now)]);
    const claims = batches.flat().filter(item => item.workflow.id === cron.id);
    assert.equal(claims.length, 1, "the canonical claim excludes a second worker, not one run per missed slot");
    const claim = claims[0]!;
    const outcome = await executeP9Workflow({
      workflow: claim.workflow, triggerType: "schedule",
      triggerDetail: { dueAt: claim.workflow.nextRunAt!.toISOString() }, claimToken: claim.claimToken,
    });
    assert.equal(outcome.run?.status, "succeeded");
    assert.equal(outcome.error, null);
    assert.ok(outcome.result);
    assert.deepEqual(outcome.run?.executionReceiptIds, [], "a local health snapshot must not invent an engine or AI receipt");
    cron = await getP9Workflow(ctx, cron.id);
    assert.equal(cron.claimToken, null);
    assert.equal(cron.nextRunAt?.getTime(), nextP9CronRun(schedule, outcome.run!.completedAt!)?.getTime());
    assert.ok(cron.nextRunAt && cron.nextRunAt > now);
    assert.equal((await claimDueP9Workflows(new Date())).some(item => item.workflow.id === cron.id), false, "missed slots are not replayed");
    const runs = await getDb().select().from(projectAutomationRuns).where(eq(projectAutomationRuns.workflowId, cron.id));
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.triggerDetail.dueAt, overdue.toISOString());
    await assert.rejects(getP9Workflow(workflows[0]!.ctx, cron.id), /not found|not owned/);
    await closeDb();
    await initDb();
    const retained = await getP9Workflow(ctx, cron.id);
    assert.equal(retained.nextRunAt?.getTime(), cron.nextRunAt?.getTime());
    assert.deepEqual(await runDueP9Workflows(), { claimed: 0, succeeded: 0, failed: 0 });
    await setP9WorkflowEnabled(ctx, cron.id, false);
  });
  await t.test("invalid persisted cron refuses action admission without starving another due owner workflow", async () => {
    const { workflow, ctx } = workflows[1]!;
    const definition = {
      name: "Persisted cron admission", enabled: true,
      trigger: { type: "schedule", schedule: { kind: "cron", expression: "*/5 * * * *", timeZone: "UTC" } },
      action: { kind: "provider_health" }, notificationPolicy: { enabled: false },
    };
    const broken = await createP9Workflow(ctx, workflow.projectId, definition);
    const healthy = await createP9Workflow(ctx, workflow.projectId, { ...definition, name: "Healthy following cron" });
    const due = new Date(Date.now() - 60_000);
    await getDb().update(projectAutomationWorkflows).set({
      trigger: { type: "schedule", schedule: { kind: "cron", expression: "0 9 31 FEB *", timeZone: "UTC" } },
      nextRunAt: due,
    }).where(eq(projectAutomationWorkflows.id, broken.id));
    await getDb().update(projectAutomationWorkflows).set({ nextRunAt: due }).where(eq(projectAutomationWorkflows.id, healthy.id));
    const persisted = await getP9Workflow(ctx, broken.id);
    await assert.rejects(executeP9Workflow({ workflow: persisted, triggerType: "schedule" }), /no finite future occurrence/);
    assert.deepEqual(await runDueP9Workflows(), { claimed: 2, succeeded: 1, failed: 1 });
    assert.equal((await getDb().select().from(projectAutomationRuns).where(eq(projectAutomationRuns.workflowId, broken.id))).length, 0);
    await assert.rejects(setP9WorkflowEnabled(ctx, broken.id, true), /no finite future occurrence/);
    assert.equal((await setP9WorkflowEnabled(ctx, broken.id, false)).enabled, false, "a corrupt definition can still be paused explicitly");
    await setP9WorkflowEnabled(ctx, healthy.id, false);
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
  await t.test("a restart backlog runs a bounded few per claim and persists strictly later staggered times without touching edits", async () => {
    const { workflow, ctx } = workflows[0]!;
    const created = [];
    for (let i = 0; i < 12; i++) {
      created.push(await createP9Workflow(ctx, workflow.projectId, { name: `Backlog ${i}`, enabled: true,
        trigger: { type: "schedule", schedule: { kind: "interval", everyMinutes: 5 } }, action: { kind: "provider_health" }, notificationPolicy: { enabled: false } }));
    }
    const ids = new Set(created.map(item => item.id));
    // Far older than any earlier fixture row, so these sort first and the cap applies to them.
    for (const [i, item] of created.entries()) {
      await getDb().update(projectAutomationWorkflows).set({ nextRunAt: new Date(Date.now() - 30 * 86_400_000 + i) }).where(eq(projectAutomationWorkflows.id, item.id));
    }
    const now = new Date();
    const first = (await claimDueP9Workflows(now)).filter(item => ids.has(item.workflow.id));
    assert.equal(first.length, 5, "only the bounded backlog slice is claimed");
    const rows = await getDb().select().from(projectAutomationWorkflows);
    const deferred = created.filter(item => !first.some(claim => claim.workflow.id === item.id))
      .map(item => rows.find(row => row.id === item.id)!).sort((a, b) => a.nextRunAt!.getTime() - b.nextRunAt!.getTime());
    assert.equal(deferred.length, 7);
    deferred.forEach((row, index) => {
      assert.equal(row.nextRunAt!.getTime(), now.getTime() + (index + 1) * 5_000);
      assert.equal(row.claimToken, null, "a deferred schedule is not claimed or run");
      assert.equal(row.enabled, true);
    });
    assert.equal((await claimDueP9Workflows(new Date(now.getTime() + 1_000))).some(item => deferred.some(row => row.id === item.workflow.id)), false,
      "deferred schedules are not immediately due");
    for (const item of created) await setP9WorkflowEnabled(ctx, item.id, false);
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
