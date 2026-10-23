import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../client/src/", import.meta.url);
const source = file => fs.readFileSync(new URL(file, root), "utf8");
const chat = source("components/terminal/ProjectExperienceShell.tsx");
const navigation = source("components/terminal/AuthenticatedNavigation.tsx");
const policy = source("lib/conversationSwitchPolicy.ts");
const store = source("lib/useProjects.ts");

const between = (first, last) => {
  const start = chat.indexOf(first);
  const end = chat.indexOf(last, start);
  assert.ok(start >= 0 && end > start, "Missing transition: " + first);
  return chat.slice(start, end);
};

test("WS-16 one canonical sidebar still owns New Chat, Recents, saved actions, Trash and account controls", () => {
  assert.match(chat, /<AuthenticatedNavigation section=\{section\}/);
  assert.match(chat, /onNewChat=\{\(\) => void newQuickChat\(\)\}/);
  assert.match(chat, /<NavItem/);
  assert.match(chat, /onAction=\{\(action, trigger\) => \{ lifecycleTrigger\.current = trigger \?\? null; void handleChatLifecycleAction\(chat, action\); \}\}/);
  assert.match(chat, /onTrash=\{\(\) => \{ setSection\("conversation"\); setShowLifecycleCenter\(true\)/);
  assert.match(navigation, /<Sheet open=\{open\} onOpenChange=\{setOpen\}>/);
  assert.match(navigation, /onSelect=\{\(\) => act\(props\.onTemporary\)\}/);
});

test("WS-16 draft guard includes text, staged files, uploaded refs, voice and dirty Artifact", () => {
  const block = between("const confirmConversationSwitch = async", "const openProject = async");
  assert.match(block, /hasUnsentConversationDraft\(\{ text: input, attachmentFiles: pendingAttachmentFiles\.length, attachmentRefs: pendingAttachmentRefs\.length, voiceTranscripts: voiceTranscripts\.length \}\)/);
  assert.match(block, /artifactDraftDirtyRef\.current/);
  assert.match(block, /Stop the current response before switching conversations/);
  assert.match(block, /if \(!answer\) return false/);
  assert.match(block, /if \(!deferDiscard\) discardConversationDraft\(\)/);
  assert.match(block, /chatCreationInFlightRef\.current && !allowPendingCreation/);
});

test("WS-16 Quick Chat creation never discards a draft before confirmed server creation", () => {
  const block = between("const newQuickChat = async", "const startTemporary = async");
  assert.match(block, /chatCreationInFlightRef\.current/);
  assert.match(block, /if \(!\(await confirmConversationSwitch\(true, true\)\)\) return/);
  assert.match(block, /const chat = await createQuickChat\(\)/);
  assert.ok(block.indexOf("discardConversationDraft()") > block.indexOf("await createQuickChat()"));
  assert.match(block, /await openChat\(chat, true\)/);
  assert.match(block, /finally \{[\s\S]*chatCreationInFlightRef\.current = false/);
});

test("WS-16 Project chat creation keeps draft until accepted by server and never allocates duplicate", () => {
  const block = between("const newProjectChat = async", "const newQuickChat = async");
  assert.match(block, /chatCreationInFlightRef\.current = true/);
  assert.match(block, /if \(!\(await confirmConversationSwitch\(true, true\)\)\)/);
  assert.match(block, /const chat = await createProjectChat\(projectId\)/);
  assert.ok(block.indexOf("discardConversationDraft()") > block.indexOf("await createProjectChat(projectId)"));
  assert.match(block, /setInput\(starterPrompt\.trim\(\)\)/);
  assert.match(block, /finally \{[\s\S]*chatCreationInFlightRef\.current = false/);
});

test("WS-16 prompt/new Project and promote Quick Chat keep draft until successful mutation", () => {
  const create = between("const createNewProject = async", "const chooseChatDestination");
  assert.match(create, /await confirmConversationSwitch\(true\)/);
  assert.ok(create.indexOf("discardConversationDraft()") > create.indexOf("await createProject("));
  const move = between("const chooseChatDestination", "const keepArtifact =");
  assert.match(move, /await confirmConversationSwitch\(true\)/);
  assert.ok(move.indexOf("discardConversationDraft()") > move.indexOf("await promoteQuickChat("));
});

test("WS-16 selected Chat archive/trash requires consent and clears only on success", () => {
  const archive = between('if (action === "archive" || action === "restore")', 'if (action === "save_to_project")');
  assert.match(archive, /const leavingActiveChat = action === "archive" && selection\.chatId === chat\.id/);
  assert.match(archive, /leavingActiveChat && !\(await confirmConversationSwitch\(true\)\)/);
  assert.ok(archive.indexOf("discardConversationDraft()") > archive.indexOf("await updateProjectChat("));
  assert.match(archive, /const leavingActiveChat = selection\.chatId === chat\.id/);
  assert.ok(archive.lastIndexOf("discardConversationDraft()") > archive.indexOf("await trashProjectChat("));
  assert.equal((archive.match(/setChatMode\(remainingChatMode\(chat\.projectId\)\)/g) ?? []).length, 2);
});

test("WS-16 active Project archive/trash preserves unsent text and restores Quick mode", () => {
  const change = between("const handleProjectLifecycleAction = async", "const newProjectChat = async");
  assert.match(change, /const leavingActiveProject = action === "archive" && selection\.projectId === project\.id/);
  assert.match(change, /const leavingActiveProject = selection\.projectId === project\.id/);
  assert.equal((change.match(/confirmConversationSwitch\(true\)/g) ?? []).length, 2);
  assert.ok(change.indexOf("discardConversationDraft()") > change.indexOf("await updateProject(project.id, { status:"));
  assert.ok(change.lastIndexOf("discardConversationDraft()") > change.indexOf("await trashProject(project.id)"));
  assert.equal((change.match(/setChatMode\("quick"\)/g) ?? []).length, 2);
});

test("WS-16 recent sidebar is deduped, limit-bounded and never shows errors as empty success", () => {
  assert.match(chat, /canonicalRecentChats\(allChatsQuery\.data \?\? \[\], quickChats\)/);
  assert.match(policy, /const unique = new Map<number, T>\(\)/);
  assert.match(policy, /if \(chat\.status !== "active" \|\| chat\.trashedAt\) continue/);
  assert.match(policy, /\.slice\(0, Math\.max\(0, limit\)\)/);
  assert.match(chat, /Could not refresh all recent conversations/);
  assert.match(chat, /allChatsQuery\.refetch\(\)/);
  assert.match(chat, /Loading recent chats/);
  assert.match(store, /export interface ProjectChat/);
});

test("WS-16 UI blocks rapid duplicate new-chat and editing during pending create", () => {
  assert.match(chat, /<AuthenticatedNavigation section=\{section\} account=\{account\} busy=\{busy \|\| creatingChat\}/);
  assert.match(chat, /disabled=\{busy \|\| creatingChat\}/);
  assert.match(chat, /disabled=\{busy \|\| creatingChat \|\| \(agentComposer\.enabled/);
  assert.match(chat, /ref=\{attachmentInputRef\}[\s\S]{0,60}disabled=\{creatingChat\}/);
  assert.match(chat, /disabled=\{creatingChat\} className="flex h-8 w-8/);
});

test("WS-16 source tests do not imply native acceptance or a merged PR", () => {
  const doc = fs.readFileSync(new URL("../../docs/ux/LIOS_WS16_DRAFT_SAFE_CONVERSATION_LIFECYCLE_2026-10-23.md", import.meta.url), "utf8");
  assert.match(doc, /#98/);
  assert.match(doc, /#102/);
  assert.match(doc, /#136/);
  assert.match(doc, /200% zoom[\s\S]{0,90}NOT_RUN/);
  assert.match(doc, /VoiceOver\/Narrator[\s\S]{0,90}NOT_RUN/);
});
