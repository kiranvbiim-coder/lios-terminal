import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("../components/terminal/ProjectExperienceShell.tsx", import.meta.url), "utf8");
const search = readFileSync(new URL("../components/terminal/WorkSearchDialog.tsx", import.meta.url), "utf8");
const bookmark = readFileSync(new URL("./conversationArtifactView.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../lios-product-experience.css", import.meta.url), "utf8");

test("saved-work search is accessible from both navigation and the Artifact directory", () => {
  assert.match(shell, /onSearch=\{requestWorkSearch\}/);
  assert.match(shell, /section === "library" && <button type="button" className="lios-section-action ml-3" onClick=\{requestWorkSearch\}>Search saved work<\/button>/);
  assert.match(shell, /Saved Artifacts from regular Chats are available through Search/);
  assert.match(shell, /section === "library" \? <ProjectArtifactsPanel/);
  assert.match(search, /Search chats, Projects, files and Artifacts/);
});

test("Quick Artifact search validates the authoritative owning Chat and Artifact before navigation", () => {
  assert.match(shell, /if \(result\.kind === "artifact" && result\.projectId === null && result\.chatId && result\.artifactId\)/);
  assert.match(shell, /matchesSavedSearchChat\(result, chat\)/);
  assert.match(shell, /detail\.artifact\.id !== result\.artifactId \|\| detail\.artifact\.projectId !== null \|\| detail\.artifact\.owningChatId !== chat\.id/);
  assert.match(shell, /selection\.chatId !== chat\.id && \(!\(await confirmConversationSwitch\(true\)\) \|\| !discardConversationDraft\(before\)\)/);
});

test("search selection preserves destination version without writing through source Chat", () => {
  const section = shell.match(/if \(selection\.chatId === chat\.id && chatMode === "quick"\) \{([\s\S]*?)\n      \} else \{([\s\S]*?)\n      \}\n      return await openChat\(chat, true\);/);
  assert.ok(section, "destination-scoped Quick Chat search branch exists");
  assert.match(section[1], /setConversationArtifactRef\(result\.artifactId\)/);
  assert.match(section[1], /setArtifactViewVersion\(detail\.version\.version\)/);
  assert.doesNotMatch(section[2], /setArtifactViewVersion/);
  assert.match(section[2], /rememberConversationArtifactView\(chat\.ownerUserId, null, chat\.id, \{/);
  assert.match(section[2], /revision: detail\.version\.version/);
  assert.match(bookmark, /conversationArtifactViewKey\(ownerId, projectId, chatId\)/);
});

test("History includes both Project and Quick chats and opens through normal switch review", () => {
  assert.match(shell, /const chats = canonicalRecentChats\(allChatsQuery\.data \?\? \[\], quickChats, Number\.MAX_SAFE_INTEGER\)/);
  assert.match(shell, /onClick=\{\(\) => openChat\(chat\)\}/);
  assert.match(shell, /const openChat = async \(chat: ProjectChat, confirmed = false\) => \{/);
  assert.match(shell, /selection\.chatId !== chat\.id && !\(await confirmConversationSwitch\(\)\)/);
  assert.match(shell, /setProjectHomeRequested\(false\)/);
});

test("clearing Project filter in Artifacts or Automations returns to a valid Quick Chat posture", () => {
  assert.match(shell, /<option value="">Choose a Project<\/option>/);
  assert.match(shell, /selection\.setChatId\(null\); selection\.setProjectId\(nextId\); setChatMode\(nextId === null \? "quick" : "project"\)/);
  assert.match(shell, /Choose a Project to manage its automations/);
});

test("a canceled or rejected search navigation remains open and preserves the draft", () => {
  assert.match(search, /const opened = await onSelect\(result\)/);
  assert.match(search, /if \(shouldCloseSearchAfterNavigation\(opened\)\) onClose\(\)/);
  assert.match(search, /else inputRef\.current\?\.focus\(\)/);
  assert.match(shell, /if \(selection\.chatId !== chat\.id && \(!\(await confirmConversationSwitch\(true\)\) \|\| !discardConversationDraft\(before\)\)\) return false/);
});

test("secondary navigation preserves active response, unsaved Artifact, and direct Chat return", () => {
  assert.match(shell, /onTrash=\{\(\) => \{\s*if \(busy \|\| busyRef\.current \|\| sendInFlightRef\.current \|\| chatCreationInFlightRef\.current \|\| projectCreationInFlightRef\.current \|\| artifactDraftDirtyRef\.current\)/);
  assert.match(shell, /onMigrate=\{\(\) => \{\s*if \(busy \|\| busyRef\.current \|\| sendInFlightRef\.current \|\| chatCreationInFlightRef\.current \|\| projectCreationInFlightRef\.current \|\| artifactDraftDirtyRef\.current\)/);
  assert.match(shell, /onClick=\{\(\) => \{ setSection\("conversation"\); setProjectHomeRequested\(false\); setShowLifecycleCenter\(false\); \}\}>Back to chat/);
});

test("History actions remain operable without hover on touch while desktop stays quiet", () => {
  assert.match(shell, /className="lios-history-action-menu opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"/);
  assert.match(styles, /@media \(hover: none\), \(pointer: coarse\) \{[\s\S]*\.terminal-root \.lios-history-action-menu,[\s\S]*opacity: 1 !important/);
});
