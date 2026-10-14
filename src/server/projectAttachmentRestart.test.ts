import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p12-restart-"));
const blobDir = path.join(dataDir, "blobs");
const previousDataDir = process.env.LIMURIA_DATA_DIR;
const previousBlobDir = process.env.LIOS_ATTACHMENT_STORAGE_DIR;
process.env.LIMURIA_DATA_DIR = dataDir;
process.env.LIOS_ATTACHMENT_STORAGE_DIR = blobDir;

const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const {
  addProjectChatMessage,
  createProjectChat,
  listProjectChatMessages,
} = await import("./projectChatStore");
const { listProjectResources } = await import("./projectResourceStore");
const {
  loadProjectAttachment,
  resolveProjectConversationAttachments,
  uploadProjectChatAttachment,
} = await import("./projectAttachmentService");
const {
  ProjectAttachmentStorageUnavailableError,
} = await import("./projectAttachmentStore");
const {
  ProjectAttachmentContentError,
} = await import("./projectAttachmentContent");

test("P12 Project attachments survive restart and fail closed on storage corruption/failure", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb().catch(() => undefined);
    if (previousDataDir === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = previousDataDir;
    if (previousBlobDir === undefined) delete process.env.LIOS_ATTACHMENT_STORAGE_DIR;
    else process.env.LIOS_ATTACHMENT_STORAGE_DIR = previousBlobDir;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const [owner] = await getDb().insert(users).values({
    email: `p12-restart-${crypto.randomUUID()}@example.com`,
    passwordHash: "test-hash",
    role: "internal_analyst",
    organizationId: null,
    name: "P12 Restart Owner",
  }).returning();
  const ctx = { userId: owner.id, organizationId: null, role: owner.role };
  const project = await createProject(ctx, { name: "P12 restart persistence" });
  const chat = await createProjectChat(ctx, { scope: "project", projectId: project.id });

  const bytes = Buffer.from("Revenue grew 8% and margin expanded 120 bps.", "utf8");
  const reference = await uploadProjectChatAttachment(ctx, project.id, chat.id, {
    bytes,
    originalName: "quarterly-results.txt",
  });
  await addProjectChatMessage(ctx, chat.id, {
    role: "user",
    content: "Analyze the attached results.",
    metadata: {
      runtimeRequestId: crypto.randomUUID(),
      attachments: [{
        id: reference.id,
        kind: reference.kind,
        sourceRef: reference.sourceRef,
        fileName: reference.fileName,
        mimeType: reference.mimeType,
        sha256: reference.sha256,
        byteLength: reference.byteLength,
      }],
    },
  });

  const beforeRestart = await loadProjectAttachment(ctx, project.id, reference.id);
  assert.deepEqual(beforeRestart.bytes, bytes);

  await closeDb();
  await initDb();

  const reopenedResources = await listProjectResources(ctx, project.id);
  const reopened = await loadProjectAttachment(ctx, project.id, reference.id);
  assert.deepEqual(reopened.bytes, bytes, "attachment blob must survive database restart");
  assert.equal(reopened.reference.sha256, reference.sha256, "reopened resource must retain immutable attachment identity");

  const reopenedMessages = await listProjectChatMessages(ctx, chat.id);
  assert.equal(reopenedMessages.length, 1);
  const persistedAttachments = (reopenedMessages[0]?.metadata as {
    attachments?: Array<{ id?: string; sha256?: string; fileName?: string }>;
  }).attachments ?? [];
  assert.deepEqual(persistedAttachments.map((item) => ({
    id: item.id,
    sha256: item.sha256,
    fileName: item.fileName,
  })), [{
    id: reference.id,
    sha256: reference.sha256,
    fileName: reference.fileName,
  }], "saved chat message must retain governed attachment references across restart");

  const resolved = await resolveProjectConversationAttachments(
    ctx,
    project.id,
    reopenedResources,
    [reference],
    true,
  );
  assert.match(resolved[0]?.textContent ?? "", /margin expanded 120 bps/);

  const attachmentPath = path.join(blobDir, String(owner.id), String(project.id), `${reference.id}.blob`);
  fs.writeFileSync(attachmentPath, Buffer.from("tampered after restart", "utf8"));
  await assert.rejects(
    () => resolveProjectConversationAttachments(ctx, project.id, reopenedResources, [reference], true),
    ProjectAttachmentContentError,
    "corrupted persisted blobs must fail integrity checks instead of reaching the model",
  );

  fs.writeFileSync(attachmentPath, bytes);
  const resourceCountBeforeFailure = (await listProjectResources(ctx, project.id)).length;
  const blockedRoot = path.join(dataDir, "blocked-storage-root");
  fs.writeFileSync(blockedRoot, "not-a-directory");
  process.env.LIOS_ATTACHMENT_STORAGE_DIR = blockedRoot;
  await assert.rejects(
    () => uploadProjectChatAttachment(ctx, project.id, chat.id, {
      bytes: Buffer.from("storage failure fixture"),
      originalName: "storage-failure.txt",
    }),
    ProjectAttachmentStorageUnavailableError,
  );
  process.env.LIOS_ATTACHMENT_STORAGE_DIR = blobDir;
  assert.equal(
    (await listProjectResources(ctx, project.id)).length,
    resourceCountBeforeFailure,
    "failed storage writes must not leave orphaned Project Resource metadata",
  );
});
