import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p12-attachment-db-"));
const blobDir = path.join(dataDir, "blobs");
process.env.LIMURIA_DATA_DIR = dataDir;
process.env.LIOS_ATTACHMENT_STORAGE_DIR = blobDir;

const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject, trashProject } = await import("./projectStore");
const { createProjectChat, getProjectChat, promoteQuickChatToProject, clearProjectChatMessages, trashProjectChat, permanentlyDeleteProjectChat } = await import("./projectChatStore");
const { createProjectResource, permanentlyDeleteProjectResource, setProjectResourceContextMode, trashProjectResource } = await import("./projectResourceStore");
const {
  ProjectAttachmentContextExcludedError,
  loadProjectAttachment,
  loadQuickChatAttachment,
  resolveQuickChatConversationAttachments,
  uploadQuickChatAttachment,
  ProjectAttachmentLimitError,
  ProjectAttachmentNotFoundError,
  resolveProjectConversationAttachments,
  uploadProjectChatAttachment,
} = await import("./projectAttachmentService");
const { PROJECT_ATTACHMENT_MAX_TEXT_CHARS, ProjectAttachmentStorageUnavailableError, readProjectAttachmentBlob, readQuickChatAttachmentBlob } = await import("./projectAttachmentStore");

test("Project attachments are Project/chat scoped, persist content references, and clean up on resource purge", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const [owner] = await getDb().insert(users).values({
    email: `p12-attachment-${crypto.randomUUID()}@example.com`,
    passwordHash: "test-hash",
    role: "internal_analyst",
    organizationId: null,
    name: "Attachment Owner",
  }).returning();
  const [other] = await getDb().insert(users).values({
    email: `p12-attachment-other-${crypto.randomUUID()}@example.com`,
    passwordHash: "test-hash",
    role: "internal_analyst",
    organizationId: null,
    name: "Other User",
  }).returning();
  const ownerContext = { userId: owner.id, organizationId: null, role: owner.role };
  const otherContext = { userId: other.id, organizationId: null, role: other.role };
  const project = await createProject(ownerContext, { name: "Attachment-isolated Project" });
  const chat = await createProjectChat(ownerContext, { scope: "project", projectId: project.id });
  const otherProject = await createProject(otherContext, { name: "Other Project" });
  const otherChat = await createProjectChat(otherContext, { scope: "project", projectId: otherProject.id });
  const text = Buffer.from("Revenue grew 8% year over year.", "utf8");
  const reference = await uploadProjectChatAttachment(ownerContext, project.id, chat.id, {
    bytes: text,
    originalName: "../quarterly-results.txt",
  });

  assert.equal(reference.fileName, "quarterly-results.txt");
  assert.equal(reference.sourceRef, `project-attachment:${reference.id}`);
  const loaded = await loadProjectAttachment(ownerContext, project.id, reference.id);
  assert.deepEqual(loaded.bytes, text);

  const officeCases = [
    ["contract.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["board-deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["operating-model.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ] as const;
  for (const [originalName, expectedMimeType] of officeCases) {
    const officeBytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`office-fixture:${originalName}`, "utf8")]);
    const officeReference = await uploadProjectChatAttachment(ownerContext, project.id, chat.id, {
      bytes: officeBytes,
      originalName,
    });
    assert.equal(officeReference.kind, "document");
    assert.equal(officeReference.mimeType, expectedMimeType);
    assert.equal(officeReference.fileName, originalName);
    const officeLoaded = await loadProjectAttachment(ownerContext, project.id, officeReference.id);
    assert.deepEqual(officeLoaded.bytes, officeBytes);
    assert.equal(officeLoaded.reference.mimeType, expectedMimeType);
  }

  const resolved = await resolveProjectConversationAttachments(ownerContext, project.id, [loaded.resource], [reference], true);
  assert.match(resolved[0]?.textContent ?? "", /Revenue grew 8%/);
  const noTransmission = await resolveProjectConversationAttachments(ownerContext, project.id, [loaded.resource], [reference], false);
  assert.equal(noTransmission[0]?.textContent, undefined);
  assert.equal(noTransmission[0]?.imageBase64, undefined);

  const excludedText = await setProjectResourceContextMode(ownerContext, loaded.resource.id, "excluded");
  await assert.rejects(
    () => resolveProjectConversationAttachments(ownerContext, project.id, [excludedText], [reference], true),
    ProjectAttachmentContextExcludedError,
    "excluded files must be rejected before content can be read, even when transmission is enabled",
  );
  const restoredText = await setProjectResourceContextMode(ownerContext, loaded.resource.id, "project");

  const longText = Buffer.from(`A${"x".repeat(PROJECT_ATTACHMENT_MAX_TEXT_CHARS + 64)}`, "utf8");
  const longReference = await uploadProjectChatAttachment(ownerContext, project.id, chat.id, {
    bytes: longText,
    originalName: "long-results.txt",
  });
  const longLoaded = await loadProjectAttachment(ownerContext, project.id, longReference.id);
  const longResolved = await resolveProjectConversationAttachments(ownerContext, project.id, [longLoaded.resource], [longReference], true);
  assert.deepEqual(longResolved[0]?.textTruncation, {
    reasons: ["character_limit"],
    maxCharacters: PROJECT_ATTACHMENT_MAX_TEXT_CHARS,
  }, "service boundary must preserve extraction truncation so prompts and receipts disclose omitted content");

  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const imageReference = await uploadProjectChatAttachment(ownerContext, project.id, chat.id, {
    bytes: imageBytes,
    originalName: "sensitive-chart.png",
  });
  const imageLoaded = await loadProjectAttachment(ownerContext, project.id, imageReference.id);
  const excludedImage = await setProjectResourceContextMode(ownerContext, imageLoaded.resource.id, "excluded");
  await assert.rejects(
    () => resolveProjectConversationAttachments(ownerContext, project.id, [excludedImage], [imageReference], true),
    ProjectAttachmentContextExcludedError,
    "excluded images must be rejected before base64 conversion",
  );

  await assert.rejects(() => loadProjectAttachment(otherContext, project.id, reference.id), /not owned/i);
  await assert.rejects(() => loadProjectAttachment(ownerContext, otherProject.id, reference.id), /not owned|not found/i);
  await assert.rejects(() => loadProjectAttachment(otherContext, otherProject.id, reference.id), ProjectAttachmentNotFoundError);
  await assert.rejects(() => uploadProjectChatAttachment(ownerContext, project.id, otherChat.id, {
    bytes: text,
    originalName: "cross-project.txt",
  }), ProjectAttachmentNotFoundError);

  const quotaProject = await createProject(ownerContext, { name: "Concurrent attachment quota" });
  const quotaChat = await createProjectChat(ownerContext, { scope: "project", projectId: quotaProject.id });
  await createProjectResource(ownerContext, {
    projectId: quotaProject.id,
    kind: "chat_attachment",
    label: "existing quota reservation",
    resourceRef: "test:quota-reservation",
    metadata: { byteLength: 96 * 1024 * 1024 },
  });
  const concurrentBytes = Buffer.alloc(3 * 1024 * 1024, 0x61);
  const concurrentUploads = await Promise.allSettled([
    uploadProjectChatAttachment(ownerContext, quotaProject.id, quotaChat.id, { bytes: concurrentBytes, originalName: "first.txt" }),
    uploadProjectChatAttachment(ownerContext, quotaProject.id, quotaChat.id, { bytes: concurrentBytes, originalName: "second.txt" }),
  ]);
  assert.equal(concurrentUploads.filter((result) => result.status === "fulfilled").length, 1);
  const rejectedUpload = concurrentUploads.find((result) => result.status === "rejected");
  assert.ok(rejectedUpload?.status === "rejected" && rejectedUpload.reason instanceof ProjectAttachmentLimitError);
  const storedQuotaBlobs = fs.readdirSync(path.join(blobDir, String(owner.id), String(quotaProject.id)))
    .filter((fileName) => fileName.endsWith(".blob"));
  assert.equal(storedQuotaBlobs.length, 1, "the quota-rejected upload must not leave an orphaned blob");


  // Quick Chat is a real durable owner, not a synthetic Project. Bytes use the existing blob provider.
  const quick = await createProjectChat(ownerContext, { scope: "quick" });
  const quickSibling = await createProjectChat(ownerContext, { scope: "quick" });
  const quickOwnedByOther = await createProjectChat(otherContext, { scope: "quick" });
  const quickText = Buffer.from("Quick Chat private research evidence.", "utf8");
  const quickRef = await uploadQuickChatAttachment(ownerContext, quick.id, { bytes: quickText, originalName: "../notes.txt" });
  assert.equal(quickRef.sourceRef, "quick-attachment:" + quickRef.id);
  assert.equal(quickRef.fileName, "notes.txt");
  assert.equal((await getProjectChat(ownerContext, quick.id)).projectId, null);
  const originalFiles = await listProjectResources(ownerContext, project.id);
  assert.equal(originalFiles.some(resource => (resource.metadata as { attachmentId?: string }).attachmentId === quickRef.id), false);
  assert.deepEqual((await loadQuickChatAttachment(ownerContext, quick.id, quickRef.id)).bytes, quickText);
  assert.match((await resolveQuickChatConversationAttachments(ownerContext, quick.id, [quickRef], true))[0]?.textContent ?? "", /Quick Chat private/);
  assert.equal((await resolveQuickChatConversationAttachments(ownerContext, quick.id, [quickRef], false))[0]?.textContent, undefined);
  await assert.rejects(() => loadQuickChatAttachment(otherContext, quick.id, quickRef.id), ProjectAttachmentNotFoundError);
  await assert.rejects(() => loadQuickChatAttachment(ownerContext, quickSibling.id, quickRef.id), ProjectAttachmentNotFoundError);
  await assert.rejects(() => resolveQuickChatConversationAttachments(ownerContext, quickSibling.id, [quickRef], true), ProjectAttachmentNotFoundError);
  await assert.rejects(() => resolveQuickChatConversationAttachments(ownerContext, quick.id, [{ ...quickRef, sha256: "0".repeat(64) }], true), ProjectAttachmentNotFoundError);
  await assert.rejects(() => resolveQuickChatConversationAttachments(ownerContext, quick.id, [quickRef, quickRef], true), ProjectAttachmentNotFoundError);
  await assert.rejects(() => uploadQuickChatAttachment(otherContext, quick.id, { bytes: quickText, originalName: "theft.txt" }), ProjectAttachmentNotFoundError);
  await assert.rejects(() => uploadQuickChatAttachment(ownerContext, quickOwnedByOther.id, { bytes: quickText, originalName: "theft.txt" }), ProjectAttachmentNotFoundError);
  await assert.rejects(() => uploadQuickChatAttachment(ownerContext, quick.id, { bytes: Buffer.from("bad"), originalName: "executable.exe" }), /Unsupported file type/);

  // Explicit promotion retains the chat-owned refs and does not turn them into ambient Project resources.
  const promoted = await promoteQuickChatToProject(ownerContext, quick.id, project.id);
  assert.equal(promoted.scope, "project");
  assert.equal(promoted.projectId, project.id);
  assert.deepEqual((await loadQuickChatAttachment(ownerContext, quick.id, quickRef.id)).bytes, quickText);
  assert.equal((await listProjectResources(ownerContext, project.id)).some(resource => resource.resourceRef === quickRef.sourceRef), false);
  await clearProjectChatMessages(ownerContext, quick.id);
  await assert.rejects(() => loadQuickChatAttachment(ownerContext, quick.id, quickRef.id), ProjectAttachmentNotFoundError);
  await assert.rejects(() => readQuickChatAttachmentBlob(owner.id, quick.id, quickRef.id), ProjectAttachmentStorageUnavailableError);

  const deleteRef = await uploadQuickChatAttachment(ownerContext, quickSibling.id, { bytes: quickText, originalName: "delete-me.txt" });
  await trashProjectChat(ownerContext, quickSibling.id);
  await permanentlyDeleteProjectChat(ownerContext, quickSibling.id);
  await assert.rejects(() => readQuickChatAttachmentBlob(owner.id, quickSibling.id, deleteRef.id), ProjectAttachmentStorageUnavailableError);

  await trashProjectResource(ownerContext, restoredText.id);
  await permanentlyDeleteProjectResource(ownerContext, restoredText.id);
  await assert.rejects(() => readProjectAttachmentBlob(owner.id, project.id, reference.id), ProjectAttachmentStorageUnavailableError);
  await trashProjectChat(ownerContext, chat.id);
  await trashProject(ownerContext, project.id);
});
