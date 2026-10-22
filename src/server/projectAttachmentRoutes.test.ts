import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import express from "express";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p12-attachment-routes-"));
process.env.LIMURIA_DATA_DIR = dataDir;
process.env.LIOS_ATTACHMENT_STORAGE_DIR = path.join(dataDir, "blobs");

const { closeDb, getDb, initDb } = await import("./db");
const { users } = await import("@shared/schema");
const { PROJECT_ATTACHMENT_MAX_FILE_BYTES } = await import("./projectAttachmentStore");
const { conversationAttachmentRefSchema } = await import("@shared/conversationRuntime");
const { createProject } = await import("./projectStore");
const { createProjectChat, getProjectChat, listProjectChatMessages } = await import("./projectChatStore");
const { listProjectResources, setProjectResourceContextMode } = await import("./projectResourceStore");
const { registerProjectRoutes } = await import("./projectRoutes");
const { registerProjectConversationRoutes } = await import("./projectConversationRoutes");

test("Project attachment HTTP routes enforce auth, file-only multipart, tenant scope, and safe downloads", { timeout: 60_000 }, async (t) => {
  await initDb();
  let server: Server | null = null;
  t.after(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    }
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const [owner] = await getDb().insert(users).values({
    email: `p12-route-owner-${crypto.randomUUID()}@example.com`,
    passwordHash: "test-hash",
    role: "internal_analyst",
    organizationId: null,
    name: "Attachment Route Owner",
  }).returning();
  const [other] = await getDb().insert(users).values({
    email: `p12-route-other-${crypto.randomUUID()}@example.com`,
    passwordHash: "test-hash",
    role: "internal_analyst",
    organizationId: null,
    name: "Other Attachment User",
  }).returning();
  const project = await createProject({ userId: owner.id, organizationId: null, role: owner.role }, { name: "HTTP attachment Project" });
  const chat = await createProjectChat({ userId: owner.id, organizationId: null, role: owner.role }, { scope: "project", projectId: project.id });

  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use((req, _res, next) => {
    const userId = Number(req.header("x-test-user-id"));
    const user = userId === owner.id ? owner : userId === other.id ? other : null;
    const authenticatedRequest = req as typeof req & { isAuthenticated: () => boolean; user?: Express.User };
    authenticatedRequest.isAuthenticated = () => user !== null;
    if (user) authenticatedRequest.user = user;
    next();
  });
  registerProjectRoutes(app);
  registerProjectConversationRoutes(app);
  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}/api/projects/${project.id}/chats/${chat.id}/attachments`;

  const unauthenticated = await fetch(endpoint, { method: "POST", body: attachmentForm("unauthenticated.txt", "private data") });
  assert.equal(unauthenticated.status, 401);

  const withExtraField = attachmentForm("field-flood.txt", "private data");
  withExtraField.append("extra", "not accepted by the file-only Project attachment endpoint");
  const fieldRejected = await fetch(endpoint, {
    method: "POST",
    headers: { "x-test-user-id": String(owner.id) },
    body: withExtraField,
  });
  assert.equal(fieldRejected.status, 400);
  assert.match((await fieldRejected.json() as { error: string }).error, /form fields|multipart sections/i);

  const unsupported = await fetch(endpoint, {
    method: "POST",
    headers: { "x-test-user-id": String(owner.id) },
    body: attachmentForm("unsupported.exe", "not an accepted Project attachment"),
  });
  assert.equal(unsupported.status, 400);
  assert.match((await unsupported.json() as { error: string }).error, /unsupported file type|unexpected upload field/i);

  const oversizedForm = new FormData();
  oversizedForm.append("file", new Blob([new Uint8Array(PROJECT_ATTACHMENT_MAX_FILE_BYTES + 1)]), "too-large.txt");
  const oversized = await fetch(endpoint, {
    method: "POST",
    headers: { "x-test-user-id": String(owner.id) },
    body: oversizedForm,
  });
  assert.equal(oversized.status, 413);
  assert.match((await oversized.json() as { error: string }).error, /exceeds the allowed size/i);

  const uploaded = await fetch(endpoint, {
    method: "POST",
    headers: { "x-test-user-id": String(owner.id) },
    body: attachmentForm("quarterly-results.txt", "Revenue grew 8% year over year."),
  });
  const uploadBody = await uploaded.text();
  assert.equal(uploaded.status, 201, uploadBody);
  const { attachment } = JSON.parse(uploadBody) as { attachment: { id: string; fileName: string } };
  assert.equal(attachment.fileName, "quarterly-results.txt");

  const officeUploaded = await fetch(endpoint, {
    method: "POST",
    headers: { "x-test-user-id": String(owner.id) },
    body: attachmentBinaryForm(
      "contract.docx",
      new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode("office-docx-fixture")]),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
  });
  const officeUploadBody = await officeUploaded.text();
  assert.equal(officeUploaded.status, 201, officeUploadBody);
  const { attachment: officeAttachment } = JSON.parse(officeUploadBody) as {
    attachment: { id: string; fileName: string; mimeType: string; kind: string };
  };
  assert.equal(officeAttachment.fileName, "contract.docx");
  assert.equal(officeAttachment.mimeType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(officeAttachment.kind, "document");

  const downloadUrl = `http://127.0.0.1:${address.port}/api/projects/${project.id}/attachments/${attachment.id}/download`;
  const crossTenant = await fetch(downloadUrl, { headers: { "x-test-user-id": String(other.id) } });
  assert.equal(crossTenant.status, 404);

  const downloaded = await fetch(downloadUrl, { headers: { "x-test-user-id": String(owner.id) } });
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get("content-type"), "application/octet-stream");
  assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
  assert.equal(downloaded.headers.get("cache-control"), "private, no-store");
  assert.match(downloaded.headers.get("content-disposition") ?? "", /filename\*=UTF-8''quarterly-results\.txt/);
  assert.equal(await downloaded.text(), "Revenue grew 8% year over year.");

  const imageUploaded = await fetch(endpoint, {
    method: "POST",
    headers: { "x-test-user-id": String(owner.id) },
    body: attachmentBinaryForm("sensitive-chart.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"),
  });
  const imageUploadBody = await imageUploaded.text();
  assert.equal(imageUploaded.status, 201, imageUploadBody);
  const { attachment: imageAttachment } = JSON.parse(imageUploadBody) as { attachment: { id: string } };
  const ownerContext = { userId: owner.id, organizationId: null, role: owner.role };
  const uploadedResources = await listProjectResources(ownerContext, project.id);
  const excludedTextResource = uploadedResources.find((resource) => (resource.metadata as { attachmentId?: string }).attachmentId === attachment.id);
  const excludedImageResource = uploadedResources.find((resource) => (resource.metadata as { attachmentId?: string }).attachmentId === imageAttachment.id);
  assert.ok(excludedTextResource && excludedImageResource, "both uploaded attachments should have Project resource records");
  await setProjectResourceContextMode(ownerContext, excludedTextResource.id, "excluded");
  await setProjectResourceContextMode(ownerContext, excludedImageResource.id, "excluded");

  const beforeExcludedAttachmentRequest = await listProjectChatMessages(ownerContext, chat.id);
  for (const excludedAttachment of [attachment, imageAttachment]) {
    const excludedResponse = await fetch(conversationUrlFor(address.port, chat.id), {
      method: "POST",
      headers: { "x-test-user-id": String(owner.id), "content-type": "application/json" },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        message: "Backtest AAPL",
        context: { symbol: "AAPL" },
        attachments: [excludedAttachment],
        transmissionPolicy: { allowResourceReferences: true },
      }),
    });
    const excludedBody = await excludedResponse.json() as { code?: string };
    assert.equal(excludedResponse.status, 409);
    assert.equal(excludedBody.code, "project_attachment_context_excluded");
  }
  const afterExcludedAttachmentRequest = await listProjectChatMessages(ownerContext, chat.id);
  assert.equal(afterExcludedAttachmentRequest.length, beforeExcludedAttachmentRequest.length, "excluded text/image requests must fail before chat persistence");

  const conversationUrl = conversationUrlFor(address.port, chat.id);
  const voiceTranscript = {
    schemaVersion: "1",
    transcriptId: crypto.randomUUID(),
    text: "Backtest AAPL",
    language: "en",
    durationMs: 900,
    providerId: "lios.voice.whisper-cpp",
    local: true,
    confidence: 0.98,
    audioSha256: "a".repeat(64),
    sourceRef: `audio-sha256:${"a".repeat(64)}`,
  };
  const voicePayload = (transcriptReviewed: boolean, requestId: string) => ({
    requestId,
    message: "Backtest AAPL",
    context: { symbol: "AAPL" },
    voiceReview: { transcripts: [voiceTranscript], transcriptReviewed },
  });
  const beforeVoiceReview = await listProjectChatMessages({ userId: owner.id, organizationId: null, role: owner.role }, chat.id);
  const unreviewedProjectVoice = await fetch(conversationUrl, {
    method: "POST",
    headers: { "x-test-user-id": String(owner.id), "content-type": "application/json" },
    body: JSON.stringify(voicePayload(false, crypto.randomUUID())),
  });
  assert.equal(unreviewedProjectVoice.status, 428);
  assert.equal((await unreviewedProjectVoice.json() as { code: string }).code, "voice_transcript_review_required");
  const afterRejectedProjectVoice = await listProjectChatMessages({ userId: owner.id, organizationId: null, role: owner.role }, chat.id);
  assert.equal(afterRejectedProjectVoice.length, beforeVoiceReview.length, "unreviewed transcript must be rejected before chat persistence");

  const reviewedProjectVoice = await fetch(conversationUrl, {
    method: "POST",
    headers: { "x-test-user-id": String(owner.id), "content-type": "application/json" },
    body: JSON.stringify(voicePayload(true, crypto.randomUUID())),
  });
  const reviewedProjectVoiceStream = await reviewedProjectVoice.text();
  assert.equal(reviewedProjectVoice.status, 200, reviewedProjectVoiceStream);
  assert.match(reviewedProjectVoiceStream, /approval_required/, "transcript review must not bypass normal action approval");
  const afterReviewedProjectVoice = await listProjectChatMessages({ userId: owner.id, organizationId: null, role: owner.role }, chat.id);
  assert.equal(afterReviewedProjectVoice.length, beforeVoiceReview.length + 1);
  assert.deepEqual(afterReviewedProjectVoice.at(-1)?.metadata?.voiceReview && (afterReviewedProjectVoice.at(-1)?.metadata?.voiceReview as { transcriptReviewed: boolean }).transcriptReviewed, true);

  const typedProjectRequest = await fetch(conversationUrl, {
    method: "POST",
    headers: { "x-test-user-id": String(owner.id), "content-type": "application/json" },
    body: JSON.stringify({ requestId: crypto.randomUUID(), message: "Backtest AAPL", context: { symbol: "AAPL" } }),
  });
  const typedProjectStream = await typedProjectRequest.text();
  assert.equal(typedProjectRequest.status, 200, typedProjectStream);
  assert.match(typedProjectStream, /approval_required/, "typed requests must keep the existing action-approval flow without a voice review receipt");
  const afterTypedProjectRequest = await listProjectChatMessages({ userId: owner.id, organizationId: null, role: owner.role }, chat.id);
  assert.equal(afterTypedProjectRequest.length, beforeVoiceReview.length + 2);
  assert.equal(afterTypedProjectRequest.at(-1)?.metadata?.voiceReview, undefined);


  // A normal user must be able to upload in a regular Quick Chat without any Project.
  const quick = await createProjectChat(ownerContext, { scope: "quick" });
  const otherQuick = await createProjectChat(ownerContext, { scope: "quick" });
  const quickEndpoint = `http://127.0.0.1:${address.port}/api/quick-chats/${quick.id}/attachments`;
  const privatePayload = "Quick private report: verified water-quality reading.";
  assert.equal((await fetch(quickEndpoint, { method: "POST", body: attachmentForm("notes.txt", privatePayload) })).status, 401);
  assert.equal((await fetch(quickEndpoint, {
    method: "POST", headers: { "x-test-user-id": String(other.id) }, body: attachmentForm("notes.txt", privatePayload),
  })).status, 404);
  const invalidQuickForm = attachmentForm("notes.txt", privatePayload);
  invalidQuickForm.append("projectId", String(project.id));
  assert.equal((await fetch(quickEndpoint, {
    method: "POST", headers: { "x-test-user-id": String(owner.id) }, body: invalidQuickForm,
  })).status, 400, "upload cannot smuggle a Project or other fields");
  const quickUpload = await fetch(quickEndpoint, {
    method: "POST", headers: { "x-test-user-id": String(owner.id) }, body: attachmentForm("notes.txt", privatePayload),
  });
  const quickBody = await quickUpload.text();
  assert.equal(quickUpload.status, 201, quickBody);
  const quickRef = conversationAttachmentRefSchema.parse((JSON.parse(quickBody) as { attachment: unknown }).attachment);
  assert.equal(quickRef.sourceRef, "quick-attachment:" + quickRef.id);
  assert.equal((await getProjectChat(ownerContext, quick.id)).projectId, null);
  const quickDownload = `http://127.0.0.1:${address.port}/api/quick-chats/${quick.id}/attachments/${quickRef.id}/download`;
  assert.equal((await fetch(quickDownload)).status, 401);
  assert.equal((await fetch(quickDownload, { headers: { "x-test-user-id": String(other.id) } })).status, 404);
  const siblingDownload = `http://127.0.0.1:${address.port}/api/quick-chats/${otherQuick.id}/attachments/${quickRef.id}/download`;
  assert.equal((await fetch(siblingDownload, { headers: { "x-test-user-id": String(owner.id) } })).status, 404);
  const quickDownloaded = await fetch(quickDownload, { headers: { "x-test-user-id": String(owner.id) } });
  assert.equal(quickDownloaded.status, 200);
  assert.equal(quickDownloaded.headers.get("cache-control"), "private, no-store");
  assert.equal(quickDownloaded.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await quickDownloaded.text(), privatePayload);

  // A legitimate owner can use this exact file in the same Quick Chat, with a normal governed action path.
  const ownerQuickRun = await fetch(conversationUrlFor(address.port, quick.id), {
    method: "POST",
    headers: { "x-test-user-id": String(owner.id), "content-type": "application/json" },
    body: JSON.stringify({
      requestId: crypto.randomUUID(), message: "Backtest AAPL",
      context: { symbol: "AAPL" }, sourceScope: "files", attachments: [quickRef],
      transmissionPolicy: { allowResourceReferences: true },
    }),
  });
  const ownerRunBody = await ownerQuickRun.text();
  assert.equal(ownerQuickRun.status, 200, ownerRunBody);
  const quickMessages = await listProjectChatMessages(ownerContext, quick.id);
  assert.equal(quickMessages.some(m => m.role === "user" && Array.isArray(m.metadata.attachments)
    && m.metadata.attachments.some((ref: unknown) => !!ref && typeof ref === "object" && "id" in ref && ref.id === quickRef.id)), true);

  // The runtime must reject another Chat's reference before saving a user message.
  const beforeQuickCrossScope = await listProjectChatMessages(ownerContext, otherQuick.id);
  const crossQuickRun = await fetch(conversationUrlFor(address.port, otherQuick.id), {
    method: "POST",
    headers: { "x-test-user-id": String(owner.id), "content-type": "application/json" },
    body: JSON.stringify({
      requestId: crypto.randomUUID(), message: "What does my private note say?",
      sourceScope: "files", attachments: [quickRef],
    }),
  });
  assert.equal(crossQuickRun.status, 404, await crossQuickRun.text());
  assert.equal((await listProjectChatMessages(ownerContext, otherQuick.id)).length, beforeQuickCrossScope.length);

  const temporaryUrl = `http://127.0.0.1:${address.port}/api/project-chat/temporary/respond`;
  const unreviewedTemporaryVoice = await fetch(temporaryUrl, {
    method: "POST",
    headers: { "x-test-user-id": String(owner.id), "content-type": "application/json" },
    body: JSON.stringify({ ...voicePayload(false, crypto.randomUUID()), history: [] }),
  });
  assert.equal(unreviewedTemporaryVoice.status, 428, await unreviewedTemporaryVoice.text());
  const reviewedTemporaryVoice = await fetch(temporaryUrl, {
    method: "POST",
    headers: { "x-test-user-id": String(owner.id), "content-type": "application/json" },
    body: JSON.stringify({ ...voicePayload(true, crypto.randomUUID()), history: [] }),
  });
  const reviewedTemporaryVoiceStream = await reviewedTemporaryVoice.text();
  assert.equal(reviewedTemporaryVoice.status, 200, reviewedTemporaryVoiceStream);
  assert.match(reviewedTemporaryVoiceStream, /approval_required/, "Temporary chat must keep the normal action approval gate");
});

function attachmentForm(fileName: string, text: string): FormData {
  const form = new FormData();
  form.append("file", new Blob([text], { type: "text/plain" }), fileName);
  return form;
}

function attachmentBinaryForm(fileName: string, bytes: Uint8Array, mimeType: string): FormData {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), fileName);
  return form;
}

function conversationUrlFor(port: number, chatId: number): string {
  return `http://127.0.0.1:${port}/api/project-chats/${chatId}/respond`;
}
