import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = new URL("../client/src/", import.meta.url);
const read = path => fs.readFileSync(new URL(path, src), "utf8");
const shell = read("components/terminal/ProjectExperienceShell.tsx");
const selection = read("lib/useProjects.ts");
const boundary = read("lib/chatPersistenceBoundary.ts");
const server = fs.readFileSync(new URL("../server/conversationRunService.ts", import.meta.url), "utf8");
const p1 = read("lib/p1Shell.ts");

test("WS-25 saved Quick and Project Chat retain authenticated server persistence", () => {
  assert.match(selection,/export async function createQuickChat/);
  assert.match(selection,/apiRequest\("POST", "\/api\/quick-chats"/);
  assert.match(selection,/export async function createProjectChat/);
  assert.match(selection,/apiRequest\("POST", \`\/api\/projects\/\$\{projectId\}\/chats\`/);
  assert.match(selection,/export function useQuickChats/);
  assert.match(selection,/export function useProjectChatMessages/);
  assert.match(p1,/resolveComposerPersistenceTarget/);
  assert.match(shell,/createProjectChat\(selection\.projectId\)/);
  assert.match(shell,/createQuickChat\(\)/);
});

test("WS-25 Temporary selection clears both saved owner identities after draft consent", () => {
  const area = shell.slice(shell.indexOf("const startTemporary = async"),shell.indexOf("const currentWorkspaceRuntimeContext",shell.indexOf("const startTemporary = async")));
  assert.match(area,/await confirmConversationSwitch\(true\)/);
  assert.match(area,/selectionForTemporaryChat\(\)/);
  assert.ok(area.indexOf("await confirmConversationSwitch(true)") < area.indexOf("discardConversationDraft()"));
  assert.match(area,/selection\.setChatId\(ephemeral.chatId\)/);
  assert.match(area,/selection\.setProjectId\(ephemeral.projectId\)/);
  assert.match(area,/setChatMode\("temporary"\)/);
  assert.match(area,/setTemporaryMessages\(\[\]\)/);
  assert.match(area,/temporaryWorkingContextRef\.current = null/);
});

test("WS-25 Temporary sends never include stale selected saved Project Artifact or selection text", () => {
  assert.match(shell,/context: contextForChatMode\(chatMode, context\)/);
  assert.match(boundary,/return mode === "temporary" \? undefined : context/);
  assert.match(shell,/sourceScope: effectiveSourceScope/);
  assert.match(shell,/const effectiveSourceScope = sourceScopeForChatMode\(chatMode, sourceScope\)/);
  assert.match(boundary,/return mode === "temporary" \? "auto" : scope/);
});

test("WS-25 Temporary never reads saved Chat messages or stores ephemeral history", () => {
  assert.match(shell,/useProjectChatMessages\(savedChatIdForMode\(chatMode, selection.chatId\)\)/);
  assert.match(boundary,/return mode === "temporary" \? null : chatId/);
  const area = shell.slice(shell.indexOf('if (chatMode === "temporary") {',shell.indexOf("const send = async")),shell.indexOf('} else {',shell.indexOf('if (chatMode === "temporary") {',shell.indexOf("const send = async"))));
  assert.match(area,/chatId: null/);
  assert.match(area,/history: temporaryMessages\.map/);
  assert.match(area,/temporaryWorkingContextRef\.current/);
  assert.doesNotMatch(area,/createQuickChat\(|createProjectChat\(|addProjectChatMessage\(/);
});

test("WS-25 backend Temporary user-owned run has no Project resources or Chat write", () => {
  const area = server.slice(server.indexOf("export async function startTemporaryRun"),server.indexOf("return conversationRuns.start",server.indexOf("export async function startTemporaryRun"))+1250);
  assert.match(area,/scope: "temporary", projectId: null, chatId: null/);
  assert.match(area,/projectId: null,\s*chatId: null/);
  assert.match(area,/scope: "temporary"/);
  assert.match(area,/resources: \[\]/);
  assert.match(area,/restoreWorkingContext\(clientContext, owner\)/);
  assert.match(area,/Temporary chats do not retain file attachments/);
  assert.doesNotMatch(area,/addProjectChatMessage\(/);
});

test("WS-25 Temporary clears the prior saved-work link but leaves unrelated hashes untouched", () => {
  assert.match(selection,/shouldClearSavedChatAddress\(selection, Boolean\(parseLiosAddress\(window\.location\.hash\)\)\)/);
  assert.match(selection,/window\.history\.replaceState\(window\.history\.state, "", window\.location\.pathname \+ window\.location\.search\)/);
  assert.match(boundary,/next\.projectId === null && next\.chatId === null && currentHashIsLiosAddress/);
});

test("WS-25 draft and file-confirmation guard from WS-16 remains authoritative", () => {
  assert.match(shell,/confirmConversationSwitch = async \(deferDiscard = false, allowPendingCreation = false\)/);
  assert.match(shell,/Finish creating the new Chat before switching saved work/);
  assert.match(shell,/if \(!deferDiscard\) discardConversationDraft\(\)/);
  assert.match(shell,/discardConversationDraft\(\);\s*invalidate\(null, chat\.id\)/);
  assert.match(shell,/const chat = await createProjectChat\(projectId\);\s*discardConversationDraft\(\)/);
});

test("WS-25 saved Quick and Project messages remain distinct from Temporary display", () => {
  assert.match(shell,/chatMode === "temporary" \? temporaryMessages : persistedMessages/);
  assert.match(shell,/chatMode === "temporary" \? "Temporary chat" : activeChat\?\.title/);
  assert.match(shell,/chatMode === "temporary" && <span[^>]*>Not saved<\/span>/);
  assert.match(shell,/setChatMode\(chat\.scope === "quick" \? "quick" : "project"\)/);
});

test("WS-25 source tests do not substitute for actual reboot, tenant and native acceptance", () => {
  const doc = fs.readFileSync(new URL("../../docs/ux/LIOS_WS25_CHAT_PERSISTENCE_BOUNDARIES_2026-10-23.md", import.meta.url),"utf8");
  for (const id of ["#100","#102","#137","#139"]) assert.ok(doc.includes(id));
  assert.match(doc,/200% zoom[\s\S]{0,90}NOT_RUN/);
  assert.match(doc,/VoiceOver\/Narrator[\s\S]{0,90}NOT_RUN/);
});
