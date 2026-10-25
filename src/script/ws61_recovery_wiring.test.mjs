import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const shell = read("client/src/components/terminal/ProjectExperienceShell.tsx");
const run = read("client/src/lib/gateway/conversationRun.ts");
const trace = read("client/src/components/terminal/ConversationRuntimeTrace.tsx");
const artifact = read("client/src/components/terminal/ArtifactPane.tsx");

test("WS-61 active offline Chat preserves draft and staged attachments before any create or upload", () => {
  assert.match(shell, /data-testid="conversation-connection-recovery"/);
  assert.match(shell, /conversationSendAvailability\(/);
  assert.match(shell, /window\.addEventListener\("offline", refresh\)/);
  assert.match(shell, /!sendGate\.canSubmit/);
  const preflight = shell.indexOf("if (!sendGate.canSubmit)");
  const upload = shell.indexOf("uploadProjectChatAttachment(", preflight);
  assert.ok(preflight > 0 && upload > preflight);
  assert.match(shell, /disabled=\{busy \|\| !sendAvailability\.canSubmit/);
  assert.match(shell, /onChange=\{\(e\) => \{[\s\S]*?setInput\(next\)/);
});

test("WS-61 recovery does not silently start another request or clear staged files", () => {
  assert.match(run, /conversation\.start"[\s\S]*queueUntilReady: false/);
  assert.match(run, /const complete = \(terminalStatus: string\) => \{/);
  assert.match(run, /terminalStatus === "completed"/);
  assert.match(run, /run_status_unconfirmed/);
  const retry = shell.slice(shell.indexOf("onRetry={() => {"), shell.indexOf("onRetry={() => {") + 550);
  assert.match(retry, /setInput/);
  assert.match(retry, /unconfirmedRunRecoveryNotice\(\)/);
  assert.doesNotMatch(retry, /void send\(/);
  assert.match(trace, /trace-error-retry/);
  assert.match(trace, />Review request<\/button>/);
  assert.match(shell, /if \(result\.ok\) setPendingAttachmentRefs\(\[\]\)/);
});

test("WS-61 P4 existing encrypted draft and revision conflict path stays canonical", () => {
  assert.match(artifact, /useNativeArtifactDraftRecovery/);
  assert.match(artifact, /NativeDraftRecoveryNotice/);
  assert.match(artifact, /document-revision-conflict/);
  assert.match(artifact, /Local changes are retained/);
  assert.doesNotMatch(shell, /localStorage\.setItem\([^;]*draft/i);
});
