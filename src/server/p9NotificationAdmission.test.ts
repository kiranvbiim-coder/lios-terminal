import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { eq } from "drizzle-orm";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-notification-admission-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;
const { initDb, closeDb, getDb } = await import("./db");
const { users, projects } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createP9Workflow, replaceP9Workflow, listP9Notifications, listOwnedP9Notifications, markP9NotificationRead } = await import("./p9AutomationStore");
const { executeP9Workflow } = await import("./p9AutomationService");

const definition = () => ({
  name: "Missing saved Chat alert",
  template: "custom" as const,
  enabled: true,
  trigger: { type: "manual" as const },
  // The real missing-Chat error occurs before any model or provider execution.
  action: { kind: "conversation_rerun" as const, chatId: 2_000_000_000, request: { message: "LiOS doctor" } },
  notificationPolicy: { enabled: true, channels: ["in_app"], notifyOn: ["failure"], minimumRelevanceScore: 0, cooldownMinutes: 60, suppressUnchanged: true },
});

test("workflow notifications honor current mute and serialize cooldown admission", { timeout: 120_000 }, async (t) => {
  await initDb();
  t.after(async () => { await closeDb(); fs.rmSync(root, { recursive: true, force: true }); });
  const [owner] = await getDb().insert(users).values({ name: "Notification owner", email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", role: "internal_admin", organizationId: null }).returning();
  const ctx = { userId: owner.id, organizationId: null, role: owner.role };
  const project = await createProject(ctx, { name: "Notification admission" });

  await t.test("muting after a run snapshot was captured suppresses its later failure notification", async () => {
    const input = definition();
    const captured = await createP9Workflow(ctx, project.id, input);
    await replaceP9Workflow(ctx, captured.id, { ...input, notificationPolicy: { ...input.notificationPolicy, enabled: false } });
    const outcome = await executeP9Workflow({ ctx, workflow: captured, triggerType: "manual" });
    assert.equal(outcome.run?.status, "failed");
    assert.equal(outcome.notification?.status, "suppressed", "a stale enabled snapshot must not override the owner's current mute");
    const persisted = (await listP9Notifications(ctx, project.id)).filter(row => row.workflowId === captured.id);
    assert.deepEqual(persisted.map(row => row.status), ["suppressed"]);
  });

  await t.test("concurrent completions produce one delivered alert inside the workflow cooldown", async () => {
    const workflow = await createP9Workflow(ctx, project.id, definition());
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => executeP9Workflow({ ctx, workflow, triggerType: "manual" })));
    assert.ok(outcomes.every(outcome => outcome.run?.status === "failed"));
    const notifications = (await listP9Notifications(ctx, project.id)).filter(row => row.workflowId === workflow.id);
    assert.equal(notifications.filter(row => row.status === "delivered").length, 1);
    assert.equal(notifications.filter(row => row.status === "suppressed").length, 5);
  });

  await t.test("one workflow's cooldown does not suppress an independent workflow", async () => {
    const first = await createP9Workflow(ctx, project.id, definition());
    const second = await createP9Workflow(ctx, project.id, definition());
    const outcomes = await Promise.all([first, second].map(workflow => executeP9Workflow({ ctx, workflow, triggerType: "manual" })));
    assert.deepEqual(outcomes.map(outcome => outcome.notification?.status), ["delivered", "delivered"]);
    assert.notEqual(outcomes[0]!.notification!.workflowId, outcomes[1]!.notification!.workflowId);
  });

  await t.test("owner inbox discovers an unopened Project and excludes other owners, read rows and archived Projects", async () => {
    const unopened = await createProject(ctx, { name:"Never selected by the client" });
    const workflow = await createP9Workflow(ctx, unopened.id, definition());
    const outcome = await executeP9Workflow({ ctx, workflow, triggerType:"manual" });
    assert.equal(outcome.notification?.status,"delivered");
    const id=outcome.notification!.id;
    assert.ok((await listOwnedP9Notifications(ctx)).some(row=>row.id===id));
    const [foreign]=await getDb().insert(users).values({name:"Another owner",email:crypto.randomUUID()+"@example.test",passwordHash:"unused",role:"internal_admin"}).returning();
    assert.equal((await listOwnedP9Notifications({userId:foreign.id,organizationId:null,role:foreign.role})).length,0);
    await getDb().update(projects).set({status:"archived"}).where(eq(projects.id,unopened.id));
    assert.equal((await listOwnedP9Notifications(ctx)).some(row=>row.id===id),false);
    await getDb().update(projects).set({status:"active"}).where(eq(projects.id,unopened.id));
    await markP9NotificationRead(ctx,unopened.id,id);
    assert.equal((await listOwnedP9Notifications(ctx)).some(row=>row.id===id),false);
  });
});
