import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("../components/terminal/ProjectExperienceShell.tsx", import.meta.url), "utf8");
const parent = readFileSync(new URL("../pages/Terminal.tsx", import.meta.url), "utf8");

test("normal Workbench expands the existing Chat origin rather than creating a second Chat", () => {
  assert.match(shell, /navigateWorkbench\(undefined, captureChatWorkbenchOrigin\(chatMode, selection\.projectId, selection\.chatId, symbol\)\)/);
  assert.match(parent, /chatWorkbenchOriginRef\.current = chatOrigin/);
  assert.match(parent, /setChatWorkbenchReturn\(current => \(\{ origin, request: \(current\?\.request \?\? 0\) \+ 1 \}\)\)/);
  assert.match(parent, /<ProjectExperienceShell[\s\S]*chatWorkbenchReturn=\{chatWorkbenchReturn\}/);
});

test("general Workbench return reviews an identity change instead of silently discarding drafts", () => {
  assert.match(shell, /reviewingChatReturn = useRef<number \| null>\(null\)/);
  assert.match(shell, /returnChangesChatIdentity\(\{ mode: chatMode, projectId: selection\.projectId, chatId: selection\.chatId \}, origin\)/);
  assert.match(shell, /reviewingChatReturn\.current === request/);
  assert.match(shell, /if \(!\(await confirmConversationSwitch\(\)\)\) \{\s*handledChatReturn\.current = request/);
  assert.match(shell, /if \(selection\.projectId !== origin\.projectId \|\| selection\.chatId !== origin\.chatId\) \{\s*selection\.setProjectId\(origin\.projectId\);\s*selection\.setChatId\(origin\.chatId\);\s*\} else \{\s*setChatMode\(origin\.mode\);/);
  assert.match(shell, /Your unsent work remains in this Chat\. You can reopen the originating conversation from History/);
});

test("Artifact return retains the saved exact version and reviews cross-conversation switches", () => {
  assert.match(parent, /returnFromArtifactWorkbench\(tabsState, handoff, context, dirty \|\| workbenchDirtyRef\.current\)/);
  assert.match(parent, /setWorkbenchReturn\(current => \(\{ context: result\.context, request: \(current\?\.request \?\? 0\) \+ 1, prompt \}\)\)/);
  assert.match(shell, /returnChangesChatIdentity\(\{ mode: chatMode, projectId: selection\.projectId, chatId: selection\.chatId \}, \{ mode: context\.projectId === null \? "quick" : "project", projectId: context\.projectId, chatId: context\.chatId \}\)/);
  assert.match(shell, /reviewingArtifactReturn\.current === request/);
  assert.match(shell, /if \(!\(await confirmConversationSwitch\(\)\)\) \{\s*handledWorkbenchReturn\.current = request/);
  assert.match(shell, /setConversationArtifactRef\(context\.artifactId\); setArtifactViewVersion\(context\.version\)/);
  assert.match(shell, /if \(prompt\) setInput\(current => stageUniversalChatQuestion\(current, prompt\)\)/);
});

test("draft review includes attachments, voice, personal finance and changed-draft fencing", () => {
  assert.match(shell, /if \(current\.input !== expected\.input \|\| current\.files !== expected\.files \|\| current\.attachments !== expected\.attachments \|\| current\.voice !== expected\.voice \|\| current\.personalFinance !== expected\.personalFinance/);
  assert.match(shell, /if \(!input\.trim\(\) && !pendingAttachmentFiles\.length && !pendingAttachmentRefs\.length && !voiceTranscripts\.length && !pendingPersonalFinance\) return true/);
  assert.match(shell, /requestLifecycle\(\{ title: "Leave this draft\?", detail: "Switching conversations clears the unsent draft/);
  assert.match(shell, /if \(!deferDiscard && !discardConversationDraft\(expected\)\) return false/);
});

test("the Chat shell stays mounted while existing Workbench renders and does not reset the composer", () => {
  assert.match(parent, /<div className=\{isProjectsSurface \? "h-full min-h-0" : "hidden"\} aria-hidden=\{!isProjectsSurface\}>/);
  assert.match(parent, /\{isProjectsSurface \? null : isExperienceHomeSurface\(experienceSurface\)/);
  assert.match(shell, /const \[input, setInput\] = useState/);
  assert.match(shell, /const draftSnapshot = \{ input, files: pendingAttachmentFiles/);
});
