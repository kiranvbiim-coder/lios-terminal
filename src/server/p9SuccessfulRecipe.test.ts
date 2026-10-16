import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-successful-recipe-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
process.env.LIOS_EXECUTION_ISOLATION = "strict";
process.env.LIOS_CODEX_CLI_PATH = "/nonexistent/lios-offline-codex";
process.env.LIOS_CLAUDE_CLI_PATH = "/nonexistent/lios-offline-claude";
delete process.env.DATABASE_URL;
const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createProjectChat } = await import("./projectChatStore");
const { startProjectChatRun } = await import("./conversationRunService");
const { conversationRuns } = await import("./conversationRunRegistry");
const { createP9Workflow, getP9Workflow } = await import("./p9AutomationStore");
const { executeP9Workflow } = await import("./p9AutomationService");
const { uploadProjectChatAttachment, findProjectAttachmentResource } = await import("./projectAttachmentService");
const { archiveProjectResource } = await import("./projectResourceStore");

async function terminal(requestId: string, userId: number): Promise<ConversationRuntimeEvent> {
  const done = Promise.withResolvers<ConversationRuntimeEvent>();
  const subscription = conversationRuns.subscribe(requestId, userId, -1, ({ event }) => {
    if (event.type === "done") done.resolve(event);
  });
  assert.ok(subscription);
  try { return await done.promise; } finally { subscription.detach(); }
}

test("saved recipes bind successful canonical work and refuse changed or unrelated origins", { timeout: 120_000 }, async (t) => {
  await initDb();
  t.after(async () => { await closeDb(); fs.rmSync(root, { recursive: true, force: true }); });
  const [user] = await getDb().insert(users).values({ name: "Recipe owner", email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", role: "internal_admin", organizationId: null }).returning();
  const ctx = { userId: user.id, role: user.role, organizationId: null };
  const project = await createProject(ctx, { name: "Successful saved work" });
  const chat = await createProjectChat(ctx, { projectId: project.id, scope: "project", title: "Original successful work" });
  const request = { message: "LiOS doctor", executionMode: "deterministic_first", sourceScope: "my_data" } as const;
  const sourceRequestId = crypto.randomUUID();
  await startProjectChatRun(user, chat.id, { ...request, requestId: sourceRequestId });
  const result = await terminal(sourceRequestId, user.id);
  assert.equal(result.type === "done" ? result.status : null, "completed");
  const input = { name: "Saved runtime diagnosis recipe", template: "custom", enabled: false, trigger: { type: "manual" }, action: { kind: "conversation_rerun", chatId: chat.id, sourceRequestId, request }, notificationPolicy: { enabled: false } };
  const workflow = await createP9Workflow(ctx, project.id, input);
  const rerun = await executeP9Workflow({ ctx, workflow, triggerType: "manual" });
  assert.equal(rerun.run?.status, "succeeded", rerun.error ?? undefined);
  assert.match(String(rerun.result?.output.text), /runtime diagnosis/i);
  await assert.rejects(createP9Workflow(ctx, project.id, { ...input, action: { ...input.action, sourceRequestId: crypto.randomUUID() } }), /completed|owner-scoped/i);
  await assert.rejects(createP9Workflow(ctx, project.id, { ...input, action: { ...input.action, request: { ...request, message: "Run a different task" } } }), /differ|inputs|authority/i);
  const other = await createProjectChat(ctx, { projectId: project.id, scope: "project", title: "Unrelated Chat" });
  await assert.rejects(createP9Workflow(ctx, project.id, { ...input, action: { ...input.action, chatId: other.id } }), /completed|owner-scoped|owner/i);
  const otherProject = await createProject(ctx, { name: "Other recipe scope" });
  await assert.rejects(createP9Workflow(ctx, otherProject.id, input), /completed|owner-scoped|owner/i);
  const savedId = workflow.id;
  await closeDb();
  await initDb();
  const recovered = await getP9Workflow(ctx, savedId);
  assert.equal(recovered.action.kind === "conversation_rerun" ? recovered.action.sourceRequestId : null, sourceRequestId);
  const afterReopen = await executeP9Workflow({ ctx, workflow: recovered, triggerType: "manual" });
  assert.equal(afterReopen.run?.status, "succeeded", afterReopen.error ?? undefined);
  await t.test("attachment recipes keep exact completed identities and fail when the current source is removed", async () => {
    const attachedChat = await createProjectChat(ctx, { projectId: project.id, scope: "project", title: "Retained attachment recipe" });
    const reference = await uploadProjectChatAttachment(ctx, project.id, attachedChat.id, { bytes: Buffer.from("Owned recipe input"), originalName: "owned-input.txt" });
    const attachedSourceId = crypto.randomUUID();
    const attachedRequest = { ...request, attachments: [reference] };
    await startProjectChatRun(user, attachedChat.id, { ...attachedRequest, requestId: attachedSourceId });
    const completed = await terminal(attachedSourceId, user.id);
    assert.equal(completed.type === "done" ? completed.status : null, "completed");
    const attachedInput = { ...input, action: { kind: "conversation_rerun", chatId: attachedChat.id, sourceRequestId: attachedSourceId, request: attachedRequest } };
    const retained = await createP9Workflow(ctx, project.id, attachedInput);
    const rerun = await executeP9Workflow({ ctx, workflow: retained, triggerType: "manual" });
    assert.equal(rerun.run?.status, "succeeded", rerun.error ?? undefined);
    await assert.rejects(createP9Workflow(ctx, project.id, { ...attachedInput, action: { ...attachedInput.action, request: { ...attachedRequest, attachments: [{ ...reference, sha256: "0".repeat(64) }] } } }), /attachment|identit/i);
    const source = await findProjectAttachmentResource(ctx, project.id, reference.id);
    await archiveProjectResource(ctx, source.resource.id);
    const removed = await executeP9Workflow({ ctx, workflow: retained, triggerType: "manual" });
    assert.equal(removed.run?.status, "failed");
    assert.match(removed.error ?? "", /attachment|not found/i);
  });
});
