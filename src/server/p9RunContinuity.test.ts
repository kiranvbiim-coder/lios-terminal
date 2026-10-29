import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-run-continuity-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;
const { initDb, closeDb, getDb } = await import("./db");
const { users, projectAutomationRuns, projectAutomationWorkflows } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { beginP9Run, completeP9Run, createP9Workflow, getP9Workflow } = await import("./p9AutomationStore");
const { recoverInterruptedP9Runs, renewP9RunLease } = await import("./p9RunContinuity");

test("automation interruption ends stale running status without replaying an unknown action", { timeout: 120_000 }, async t => {
  await initDb();
  t.after(async () => { await closeDb(); fs.rmSync(root, { recursive: true, force: true }); });
  const [owner] = await getDb().insert(users).values({ name: "Recovery owner", email: `${crypto.randomUUID()}@example.test`, passwordHash: "verification-only", role: "internal_admin", organizationId: null }).returning();
  assert.ok(owner);
  const ctx = { userId: owner.id, organizationId: null, role: owner.role };
  const project = await createProject(ctx, { name: "Interrupted recurring work" });
  const workflow = await createP9Workflow(ctx, project.id, { name: "Recovery diagnostic", enabled: true, trigger: { type: "schedule", schedule: { kind: "interval", everyMinutes: 5 } }, action: { kind: "project_what_changed" }, notificationPolicy: { enabled: false } });
  const interrupted = await beginP9Run(ctx, workflow, "schedule", { dueAt: new Date().toISOString() }, "event:interrupted");
  assert.ok(interrupted);
  const expiredAt = new Date(Date.now() - 1_000);
  await getDb().update(projectAutomationRuns).set({ leaseExpiresAt: expiredAt }).where(eq(projectAutomationRuns.id, interrupted.id));
  await getDb().update(projectAutomationWorkflows).set({ claimToken: "abandoned-claim", claimExpiresAt: expiredAt, nextRunAt: expiredAt }).where(eq(projectAutomationWorkflows.id, workflow.id));
  await closeDb();
  await initDb();
  const now = new Date();
  assert.equal(await recoverInterruptedP9Runs(now), 1);
  const [recovered] = await getDb().select().from(projectAutomationRuns).where(eq(projectAutomationRuns.id, interrupted.id));
  assert.equal(recovered?.status, "failed");
  assert.equal(recovered?.error, "interrupted_outcome_unknown_no_automatic_replay");
  assert.deepEqual(recovered?.executionReceiptIds, [], "recovery cannot invent an engine execution receipt");
  const current = await getP9Workflow(ctx, workflow.id);
  assert.equal(current.claimToken, null);
  assert.ok(current.nextRunAt && current.nextRunAt > now, "only a future schedule occurrence is eligible, not a replay of the abandoned action");
  assert.equal(await beginP9Run(ctx, current, "event", {}, "event:interrupted"), null, "canonical idempotency remains reserved for the interrupted action");
  await assert.rejects(completeP9Run(ctx, current, interrupted.id, { error: "late completion" }), /not found|not owned/);
  assert.equal(await recoverInterruptedP9Runs(), 0, "terminal reconciliation is idempotent");

  await t.test("renewed work remains live and a later lease expiry is recoverable", async () => {
    const live = await beginP9Run(ctx, current, "manual", {});
    assert.ok(live);
    const future = new Date(Date.now() + 4 * 60_000);
    assert.equal(await renewP9RunLease(live.id, future), true);
    assert.equal(await recoverInterruptedP9Runs(new Date(future.getTime() + 60_000)), 0);
    assert.equal(await recoverInterruptedP9Runs(new Date(future.getTime() + 6 * 60_000)), 1);
    assert.equal(await renewP9RunLease(live.id), false, "a terminal interrupted action cannot be resurrected");
  });
  await t.test("pre-migration running work is reconciled after the conservative grace interval", async () => {
    const legacy = await beginP9Run(ctx, current, "manual", {});
    assert.ok(legacy);
    await getDb().update(projectAutomationRuns).set({ leaseExpiresAt: null, startedAt: new Date(Date.now() - 6 * 60_000) }).where(eq(projectAutomationRuns.id, legacy.id));
    assert.equal(await recoverInterruptedP9Runs(), 1);
  });
  await t.test("a current scheduled claim protects its action even if its separate run renewal was delayed", async () => {
    const active = await getP9Workflow(ctx, workflow.id);
    const scheduled = await beginP9Run(ctx, active, "schedule", {});
    assert.ok(scheduled);
    const observedAt = new Date();
    const claimExpiresAt = new Date(observedAt.getTime() + 60_000);
    await getDb().update(projectAutomationRuns).set({ leaseExpiresAt: new Date(observedAt.getTime() - 1_000) }).where(eq(projectAutomationRuns.id, scheduled.id));
    await getDb().update(projectAutomationWorkflows).set({ claimToken: "live-scheduled-claim", claimExpiresAt }).where(eq(projectAutomationWorkflows.id, workflow.id));
    assert.equal(await recoverInterruptedP9Runs(observedAt), 0);
    assert.equal(await recoverInterruptedP9Runs(new Date(claimExpiresAt.getTime() + 1)), 1);
    const reconciled = await getP9Workflow(ctx, workflow.id);
    assert.ok(reconciled.nextRunAt && reconciled.nextRunAt > claimExpiresAt);
  });
  await t.test("repeated failures delay only future runs and a known success resets the delay", async () => {
    const definition = { name: "Backoff diagnostic", enabled: true, trigger: { type: "schedule" as const, schedule: { kind: "interval" as const, everyMinutes: 5 } }, action: { kind: "project_what_changed" as const }, notificationPolicy: { enabled: false } };
    let recurring = await createP9Workflow(ctx, project.id, definition);
    for (let failures = 1; failures <= 5; failures++) {
      const attempt = await beginP9Run(ctx, recurring, "schedule", {});
      assert.ok(attempt);
      const completed = await completeP9Run(ctx, recurring, attempt.id, { error: "controlled source unavailable" });
      recurring = await getP9Workflow(ctx, recurring.id);
      const expected = failures >= 5 ? 60 : failures === 4 ? 15 : 5;
      assert.equal(recurring.nextRunAt!.getTime() - completed.completedAt!.getTime(), expected * 60_000);
      assert.equal(recurring.consecutiveFailures, failures);
      assert.equal(completed.status, "failed");
    }
    const retry = await beginP9Run(ctx, recurring, "manual", {});
    assert.ok(retry);
    const completed = await completeP9Run(ctx, recurring, retry.id, { result: {
      summary: "Known diagnostic success", changed: false, conditionMet: false, relevanceScore: 0,
      sourceRefs: [], engineRefs: [], artifactRefs: [], executionReceiptIds: [], output: {},
    } });
    recurring = await getP9Workflow(ctx, recurring.id);
    assert.equal(recurring.consecutiveFailures, 0);
    assert.equal(recurring.nextRunAt!.getTime() - completed.completedAt!.getTime(), 5 * 60_000);
    const daily = await createP9Workflow(ctx, project.id, { ...definition, name: "Later normal schedule", trigger: { type: "schedule", schedule: { kind: "interval", everyMinutes: 1440 } } });
    const dailyAttempt = await beginP9Run(ctx, daily, "schedule", {});
    assert.ok(dailyAttempt);
    const failedDaily = await completeP9Run(ctx, { ...daily, consecutiveFailures: 5 }, dailyAttempt.id, { error: "controlled failure" });
    assert.equal((await getP9Workflow(ctx, daily.id)).nextRunAt!.getTime() - failedDaily.completedAt!.getTime(), 1440 * 60_000);
  });
});
