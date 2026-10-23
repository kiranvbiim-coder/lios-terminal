import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = new URL("../client/src/", import.meta.url);
const read = p => fs.readFileSync(new URL(p, src), "utf8");
const shell = read("components/terminal/ProjectExperienceShell.tsx");
const staging = read("lib/fileAttachmentStaging.ts");
const uploader = read("lib/realFileAttachmentUpload.ts");
const server = fs.readFileSync(new URL("../server/projectRoutes.ts",import.meta.url),"utf8");
const runtime = fs.readFileSync(new URL("../shared/conversationRuntime.ts",import.meta.url),"utf8");

test("WS-19 reuses PR #100's actual authenticated Quick and Project endpoints", () => {
  assert.match(server, /app.post\("\/api\/projects\/:projectId\/chats\/:chatId\/attachments"/);
  assert.match(server, /app.post\("\/api\/quick-chats\/:chatId\/attachments"/);
  assert.match(server, /uploadQuickChatAttachment/);
  assert.match(uploader, /\/api\/quick-chats\/\$\{chatId\}\/attachments/);
  assert.match(uploader, /\/api\/projects\/\$\{projectId\}\/chats\/\$\{chatId\}\/attachments/);
  assert.doesNotMatch(uploader, /https?:\/\//);
});

test("WS-19 only server confirmation makes an attachment saved", () => {
  assert.match(uploader, /conversationAttachmentRefSchema\.safeParse\(candidate\)/);
  assert.match(uploader, /resolve\(parsed\.data\)/);
  assert.match(runtime, /export const conversationAttachmentRefSchema = z.object/);
  assert.match(uploader, /xhr.status < 200 \|\| xhr.status >= 300/);
  assert.match(uploader, /progressPercent\(event.loaded, event.total, event.lengthComputable\)/);
});

test("WS-19 true progress includes transfer and verification, never fabricated 100 percent", () => {
  assert.match(uploader, /xhr.upload.onprogress/);
  assert.match(uploader, /xhr.upload.onload = \(\) => onProgress\(\{ state: "verifying", percent: null \}\)/);
  assert.match(staging, /Math\.min\(99, Math\.floor\(loaded \/ total \* 100\)\)/);
  assert.match(shell, /<progress max=\{100\} value=\{uploadingAttachment.progress.percent \?\? undefined\}/);
  assert.match(shell, /Transfer progress is not confirmation of storage/);
});

test("WS-19 local staging deduplicates, limits five and rejects unsupported content", () => {
  assert.match(shell, /planAttachmentStage\(pendingAttachmentFiles, Array.from\(fileList\), pendingAttachmentRefs.length\)/);
  assert.match(staging, /const seen = new Set\(existing.map\(stagedFileKey\)\)/);
  assert.match(staging, /savedReferenceCount \+ staged.length >= 5/);
  assert.match(staging, /20 \* 1024 \* 1024/);
  assert.match(staging, /6 \* 1024 \* 1024/);
  assert.match(shell, /Temporary Chat does not retain files/);
});

test("WS-19 network/error copies are non-sensitive and failed file is staged for retry", () => {
  assert.match(uploader, /Attachment storage or the network is unavailable. The local file remains staged/);
  assert.match(uploader, /Your sign-in expired/);
  assert.doesNotMatch(uploader, /payload\.error|xhr\.responseText.*Error\(/);
  const area = shell.slice(shell.indexOf('if (pendingAttachmentFiles.length && !override?.continuationOf)'),shell.indexOf('if (!override?.continuationOf) setInput("")',shell.indexOf('if (pendingAttachmentFiles.length && !override?.continuationOf)')));
  assert.match(area, /await uploadRealChatAttachment/);
  assert.ok(area.indexOf('await uploadRealChatAttachment') < area.indexOf('setPendingAttachmentFiles('));
  assert.match(area, /setPendingAttachmentRefs\(attachmentsForRequest\)/);
});

test("WS-19 no attachment mutations during busy send; progress accessible", () => {
  assert.match(shell, /if \(busy\) \{ setLifecycleNotice\("Finish the current response before attaching more files/);
  assert.match(shell, /if \(busy\) return; \/\/ In-flight transport has an immutable attachment list/);
  assert.match(shell, /disabled=\{busy\} onClick=\{\(\) => removePendingAttachment\(key\)\}/);
  assert.match(shell, /disabled=\{busy\} onClick=\{\(\) => removePendingAttachment\(attachment.id\)\}/);
  assert.match(shell, /role="status" aria-live="polite"/);
  assert.match(shell, /aria-label="Attachment transfer progress"/);
});

test("WS-19 preserves file/voice/privacy restrictions, not a model source-permission grant", () => {
  assert.match(shell, /sourceScope === "web" && hasStagedAttachments/);
  assert.match(shell, /sourceScope === "files" && !hasStagedAttachments/);
  assert.match(shell, /chatMode === "temporary"/);
  assert.match(runtime, /textPreview: z.string\(\)\.max\(20_000\)\.nullable\(\)\.default\(null\)/); // existing strict attachment contract
  assert.match(server, /projectAttachmentUpload.single\("file"\)/);
});

test("WS-19 real browser/native acceptance and parent merge remains pending", () => {
  const doc=fs.readFileSync(new URL("../../docs/ux/LIOS_WS19_FILE_UPLOAD_UX_2026-10-23.md",import.meta.url),"utf8");
  assert.match(doc, /#100/);
  assert.match(doc, /#139/);
  assert.match(doc, /200% zoom[\s\S]{0,100}NOT_RUN/);
  assert.match(doc, /VoiceOver\/Narrator[\s\S]{0,100}NOT_RUN/);
});
