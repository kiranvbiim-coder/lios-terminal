import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import express from "express";
import test from "node:test";
import { nextP9CronRun } from "@shared/p9CronSchedule";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-workflow-management-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;
const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createP9Workflow, getP9Workflow } = await import("./p9AutomationStore");
const { listProjectLedgerEvents } = await import("./ledgerStore");
const { registerP9AutomationRoutes } = await import("./p9AutomationRoutes");

test("reviewed workflow mutations reject stale revisions and never record an unperformed delete", { timeout: 90_000 }, async t => {
  await initDb();
  const app = express();
  const server = createServer(app);
  t.after(async () => {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const [owner, stranger] = await getDb().insert(users).values([
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", name: "Review owner", role: "internal_analyst", organizationId: null },
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", name: "Other owner", role: "internal_analyst", organizationId: null },
  ]).returning();
  const ctx = { userId: owner.id, organizationId: null, role: owner.role };
  const project = await createProject(ctx, { name: "Reviewed workflows" });
  const otherProject = await createProject(ctx, { name: "Unrelated Project" });
  const definition = {
    name: "Reviewed provider monitor", enabled: false,
    trigger: { type: "schedule", schedule: { kind: "interval", everyMinutes: 60 } },
    action: { kind: "provider_health" }, notificationPolicy: { enabled: false },
  };
  const workflow = await createP9Workflow(ctx, project.id, definition);
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = Number(req.header("x-test-user-id"));
    const user = id === owner.id ? owner : id === stranger.id ? stranger : null;
    const authenticated = req as typeof req & { isAuthenticated: () => boolean; user?: Express.User };
    authenticated.isAuthenticated = () => user !== null;
    if (user) authenticated.user = user;
    next();
  });
  registerP9AutomationRoutes(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/projects`;
  const route = `${base}/${project.id}/automation/workflows/${workflow.id}`;
  const send = (url: string, method: string, body: unknown, userId = owner.id) => fetch(url, {
    method, headers: { "Content-Type": "application/json", "x-test-user-id": String(userId) }, body: JSON.stringify(body),
  });
  const revision = workflow.updatedAt.toISOString();
  const enabled = await send(`${route}/enabled`, "POST", { enabled: true, expectedUpdatedAt: revision });
  assert.equal(enabled.status, 200);
  const current = await getP9Workflow(ctx, workflow.id);
  assert.equal(current.enabled, true);
  assert.ok(current.nextRunAt);
  const ledgerBefore = await listProjectLedgerEvents(ctx, project.id);

  for (const [method, suffix, body] of [
    ["POST", "/enabled", { enabled: false, expectedUpdatedAt: revision }],
    ["PUT", "", { ...definition, name: "Stale overwrite", expectedUpdatedAt: revision }],
    ["DELETE", "", { expectedUpdatedAt: revision }],
  ] as const) {
    const rejected = await send(route + suffix, method, body);
    assert.equal(rejected.status, 409);
    assert.match((await rejected.json()).error, /changed since review/);
    const unchanged = await getP9Workflow(ctx, workflow.id);
    assert.equal(unchanged.enabled, true);
    assert.equal(unchanged.name, workflow.name);
    assert.equal(unchanged.updatedAt.toISOString(), current.updatedAt.toISOString());
  }
  assert.deepEqual(await listProjectLedgerEvents(ctx, project.id), ledgerBefore);
  assert.equal((await send(`${route}/enabled`, "POST", { enabled: false, expectedUpdatedAt: "invalid" })).status, 400);
  assert.equal((await send(`${route}/enabled`, "POST", { enabled: false }, stranger.id)).status, 404);
  assert.equal((await send(`${base}/${otherProject.id}/automation/workflows/${workflow.id}/enabled`, "POST", { enabled: false })).status, 404);

  const changed = await send(route, "PUT", { ...definition, enabled: true, trigger: { type: "schedule", schedule: { kind: "daily_utc", hour: 18, minute: 15 } }, expectedUpdatedAt: current.updatedAt.toISOString() });
  assert.equal(changed.status, 200);
  const edited = await getP9Workflow(ctx, workflow.id);
  assert.deepEqual(edited.trigger, { type: "schedule", schedule: { kind: "daily_utc", hour: 18, minute: 15 } });
  assert.deepEqual(edited.action, current.action);
  assert.deepEqual(edited.notificationPolicy, current.notificationPolicy);
  const cronTrigger = { type: "schedule", schedule: { kind: "cron", expression: "15 9 * * MON-FRI", timeZone: "America/New_York" } };
  const cronChanged = await send(route, "PUT", { ...definition, enabled: true, trigger: cronTrigger, expectedUpdatedAt: edited.updatedAt.toISOString() });
  assert.equal(cronChanged.status, 200);
  const zoned = await getP9Workflow(ctx, workflow.id);
  assert.deepEqual(zoned.trigger, cronTrigger);
  assert.equal(zoned.nextRunAt?.toISOString(), nextP9CronRun({
    kind: "cron", expression: "15 9 * * MON-FRI", timeZone: "America/New_York",
  }, zoned.updatedAt)?.toISOString());
  assert.deepEqual(zoned.action, current.action);
  assert.equal((await send(route, "PUT", { ...definition, enabled: true, trigger: cronTrigger, expectedUpdatedAt: current.updatedAt.toISOString() })).status, 409);
  assert.equal((await send(route, "PUT", { ...definition, trigger: { type: "schedule", schedule: { kind: "cron", expression: "* * * * *", timeZone: "UTC" } }, expectedUpdatedAt: zoned.updatedAt.toISOString() })).status, 400);
  assert.deepEqual((await getP9Workflow(ctx, workflow.id)).trigger, cronTrigger, "rejected recurrence cannot replace the reviewed schedule");
  assert.equal((await send(route, "PUT", { ...definition, trigger: cronTrigger, expectedUpdatedAt: zoned.updatedAt.toISOString() }, stranger.id)).status, 404);
  assert.equal((await send(`${base}/${otherProject.id}/automation/workflows/${workflow.id}`, "PUT", { ...definition, trigger: cronTrigger, expectedUpdatedAt: zoned.updatedAt.toISOString() })).status, 404);
  const removed = await send(route, "DELETE", { expectedUpdatedAt: zoned.updatedAt.toISOString() });
  assert.equal(removed.status, 200);
  await assert.rejects(getP9Workflow(ctx, workflow.id), /not found/);
  const deletedEvents = (await listProjectLedgerEvents(ctx, project.id)).filter(event => event.payload.workflowId === workflow.id && event.payload.action === "deleted");
  assert.equal(deletedEvents.length, 1);
});
