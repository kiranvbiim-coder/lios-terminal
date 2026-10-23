import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chat = fs.readFileSync(path.join(clientRoot, "components", "terminal", "ProjectExperienceShell.tsx"), "utf8");
const sources = fs.readFileSync(path.join(clientRoot, "components", "terminal", "ChatSourcesControl.tsx"), "utf8");
const route = fs.readFileSync(path.join(clientRoot, "..", "..", "server", "projectRoutes.ts"), "utf8");
const runtime = fs.readFileSync(path.join(clientRoot, "..", "..", "server", "conversationRunService.ts"), "utf8");
const store = fs.readFileSync(path.join(clientRoot, "..", "..", "shared", "schemaProjects.ts"), "utf8");

test("regular Quick Chats attach files under the owning Chat, not a hidden Project", () => {
  assert.match(chat, /async function uploadProjectChatAttachment\(projectId: number \| null/);
  assert.match(chat, /\/api\/quick-chats\/\$\{chatId\}\/attachments/);
  assert.match(chat, /firstSendChatRef\.current = created\.id/);
  assert.match(chat, /if \(chatMode === "temporary"\) \{/);
  assert.doesNotMatch(chat, /Attachments are saved to a Project\. Open or create a Project chat/);
  assert.match(store, /attachmentManifest: jsonb\("attachment_manifest"\)/);
  assert.match(route, /app\.post\("\/api\/quick-chats\/:chatId\/attachments"/);
  assert.match(route, /app\.get\("\/api\/quick-chats\/:chatId\/attachments\/:attachmentId\/download"/);
});

test("Quick Chat files resolve through the existing governed runtime without widening source scope", () => {
  assert.match(runtime, /resolveQuickChatConversationAttachments/);
  assert.match(runtime, /quickScopedAttachments/);
  assert.match(runtime, /request\.transmissionPolicy\.allowResourceReferences/);
  assert.match(chat, /attachment\.sourceRef\?\.startsWith\("quick-attachment:"\)/);
  assert.match(sources, /item\.id === "my_data" \|\| item\.id === "files"/);
  assert.doesNotMatch(runtime, /File attachments are currently supported in Project chats only/);
});
