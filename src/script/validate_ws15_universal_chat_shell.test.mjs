import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const client = new URL("../client/src/", import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, client), "utf8");
const terminal = read("pages/Terminal.tsx");
const chat = read("components/terminal/ProjectExperienceShell.tsx");
const app = read("App.tsx");
const handoff = read("lib/universalChatHandoff.ts");
const entry = read("lib/projectEntry.ts");
const artifact = read("lib/artifactWorkbenchHandoff.ts");

test("WS-15 there is still exactly one signed-in Chat shell mounted across Workbench surface switches", () => {
  assert.equal((terminal.match(/<ProjectExperienceShell\b/g) ?? []).length, 1);
  assert.match(terminal, /className=\{isProjectsSurface \? "h-full min-h-0" : "hidden"\} aria-hidden=\{!isProjectsSurface\}/);
  assert.match(terminal, /<ProjectExperienceShell[\s\S]*?universalChatHandoff=\{universalChatHandoff\}/);
  assert.match(app, /const terminal = <Terminal session=\{session\}/);
  assert.match(app, /<Route path="\/">\{terminal\}<\/Route>/);
});

test("WS-15 client Ask LiOS always returns to Chat instead of instantiating AgentPanel", () => {
  const block = terminal.slice(terminal.indexOf("const handleAskLios = useCallback"), terminal.indexOf("const handleExploreField ="));
  assert.match(block, /if \(isClient\)/);
  assert.match(block, /if \(workbenchDirtyRef\.current\) return/);
  assert.match(block, /workbenchQuestionDraft\(initialQuestion, activePane\.view, symbol\)/);
  assert.match(block, /setUniversalChatHandoff\(current => \(\{ request:/);
  assert.match(block, /handleSurface\("projects"\)/);
  const clientBranch = block.split("if (isClient) {")[1].split("\n    if (activePane.view ===")[0];
  assert.doesNotMatch(clientBranch, /openViewInNewPane|handleNav\("agent"\)|runConversation|fetch\(/);
});

test("WS-15 original internal specialist can remain without a duplicated client engine", () => {
  const block = terminal.slice(terminal.indexOf("const handleAskLios = useCallback"), terminal.indexOf("const handleExploreField ="));
  assert.match(block, /if \(activePane\.view === "agent"\)/);
  assert.match(block, /handleNav\("agent"\)/);
  assert.match(terminal, /case "agent": content = <AgentPanel/);
  assert.match(terminal, /const isClient = runtimeAudience === "client"/);
});

test("WS-15 mounted Chat accepts an idempotent handoff and never auto-submits or opens a new Chat", () => {
  assert.match(chat, /universalChatHandoff\?: UniversalChatHandoff \| null/);
  assert.match(chat, /const handledUniversalChatHandoff = useRef<number \| null>\(null\)/);
  assert.match(chat, /handledUniversalChatHandoff\.current === universalChatHandoff\.request/);
  assert.match(chat, /setSection\("conversation"\)/);
  assert.match(chat, /setProjectHomeRequested\(false\)/);
  assert.match(chat, /setInput\(current => stageUniversalChatQuestion\(current, universalChatHandoff\.prompt\)\)/);
  const effect = chat.slice(chat.indexOf("if (!universalChatHandoff ||"), chat.indexOf("}, [universalChatHandoff])"));
  assert.doesNotMatch(effect, /runConversation|createQuickChat|createProjectChat|send\(/);
});

test("WS-15 Workbench still protects unsaved Artifact and gives mobile/keyboard-visible return", () => {
  assert.match(terminal, /data-testid="workbench-return-chat"/);
  assert.match(terminal, /aria-label="Return to Chat"/);
  assert.match(terminal, /disabled=\{workbenchDirty\}/);
  assert.match(terminal, /focus-visible:outline-2/);
  assert.match(terminal, /workbenchDirtyRef\.current\) handleSurface\("projects"\)/);
  assert.match(terminal, /Your original Chat and unsent draft remain available/);
});

test("WS-15 Workbench handoff still preserves saved Artifact identity and revision", () => {
  assert.match(chat, /navigateWorkbench\(\{ projectId: selection\.projectId, chatId: selection\.chatId, artifactId: conversationArtifactRef, version: displayed\.version \}\)/);
  assert.match(chat, /setConversationArtifactRef\(context\.artifactId\); setArtifactViewVersion\(context\.version\)/);
  assert.match(artifact, /if \(dirty \|\| context\.projectId !== handoff\.context\.projectId/);
  assert.match(artifact, /context\.artifactId !== handoff\.context\.artifactId/);
});

test("WS-15 one common entry mode and deliberate Project Home, no mandatory setup", () => {
  assert.match(entry, /return selection\.projectId \? "project" : "quick"/);
  assert.match(entry, /return input\.projectHomeRequested && input\.projectHomeAvailable \? "project-home" : "conversation"/);
  assert.match(chat, /onOpenEnvironment=\{onOpenEnvironment\}/);
  assert.match(chat, /<ChatSourcesControl scope=\{sourceScope\}/);
  assert.match(handoff, /Only authorized sources/);
});

test("WS-15 source tests do not substitute for real native client-side acceptance", () => {
  const doc = fs.readFileSync(new URL("../../docs/ux/LIOS_WS15_ONE_SIGNED_IN_CHAT_2026-10-23.md", import.meta.url), "utf8");
  assert.match(doc, /#102/);
  assert.match(doc, /#99/);
  assert.match(doc, /200% zoom[\s\S]{0,90}NOT_RUN/);
  assert.match(doc, /VoiceOver\/Narrator[\s\S]{0,90}NOT_RUN/);
});
