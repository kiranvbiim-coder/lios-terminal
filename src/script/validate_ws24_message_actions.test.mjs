import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = new URL("../client/src/", import.meta.url);
const read = path => fs.readFileSync(new URL(path, src), "utf8");
const shell = read("components/terminal/ProjectExperienceShell.tsx");
const actions = read("components/terminal/ChatMessageActions.tsx");
const policy = read("lib/chatMessageActions.ts");
const tests = read("lib/chatMessageActions.test.ts");

test("WS-24 reuse PR #115 original message actions instead of creating another message toolbar", () => {
  assert.match(shell, /import ChatMessageActions from "\.\/ChatMessageActions"/);
  assert.match(shell, /displayMessages\.map\(\(message\) =>/);
  assert.match(shell, /message\.role !== "system" && <ChatMessageActions/);
  assert.match(shell, /messageId=\{message\.id\}/);
  assert.match(actions, /data-testid="chat-message-actions"/);
  assert.match(actions, /role === "assistant" && onQuote/);
});

test("WS-24 original assistant-only quote remains a composer edit, never a send", () => {
  assert.match(shell, /setInput\(\(draft\) => quoteChatResponse\(draft, message\.content\)\)/);
  assert.match(policy, /export function quoteChatResponse/);
  assert.match(policy, /if \(draft\.includes\(block\)\) return draft/);
  assert.match(policy, /Follow up on this LiOS response/);
  assert.doesNotMatch(policy, /runConversation\(|apiRequest\(|fetch\(|runCommand\(/);
});

test("WS-24 original source text is sanitized on assistant copy and quote; user text untouched", () => {
  assert.match(policy, /if \(role === "user"\) return content/);
  assert.match(policy, /stripMachineDirectives\(content\)/);
  assert.match(actions, /visibleChatMessageText\(content, role\)/);
  assert.match(policy, /MAX_EXCERPT = 1200/);
  assert.match(tests, /WS-24 an action with no visible answer/);
});

test("WS-24 synchronous per-message clipboard lock prevents rapid duplicate writes", () => {
  assert.match(actions, /const copyInFlightRef = useRef<string \| null>\(null\)/);
  assert.match(actions, /if \(copyInFlightRef\.current === identity\) return/);
  assert.match(actions, /copyInFlightRef\.current = identity/);
  assert.match(actions, /if \(identityRef\.current === identity\) setCopyState/);
  assert.match(actions, /useEffect\(\(\) => \{ setCopyState\("idle"\); \}, \[content, role, messageId\]\)/);
  assert.match(actions, /min-h-10/);
  assert.match(policy, /await writeText\(text\)/);
});

test("WS-24 copy remains role-labeled and never claims success when write fails", () => {
  assert.match(actions, /aria-label=\{role === "assistant" \? "Copy LiOS answer" : "Copy your message"\}/);
  assert.match(actions, /aria-live="polite"/);
  assert.match(actions, /copyState === "failed"/);
  assert.match(policy, /catch \{\s*return false/);
  assert.match(actions, /Clipboard unavailable/);
});

test("WS-24 running request disables quote prefill so a settled run cannot stomp edits", () => {
  assert.match(shell, /quoteDisabled=\{busy\}/);
  assert.match(actions, /disabled=\{quoteDisabled\}/);
  assert.match(actions, /Finish the running request before quoting/);
  assert.match(actions, /data-testid="chat-message-quote"/);
});

test("WS-24 trace follow-ups and recovery slash suggestions are idempotent draft-only edits", () => {
  assert.match(policy, /export function stageChatFollowUp/);
  assert.match(shell, /onFollowUp=\{\(prompt\) => \{ setInput\(current => stageChatFollowUp\(current, prompt\)\)/);
  assert.match(shell, /setInput\(current => stageChatFollowUp\(current, action\)\)/);
  assert.match(shell, /Suggested slash action|suggested slash action|A suggested slash action/);
  assert.match(shell, /nothing was automatically sent|no command or model request was run/i);
  const recovery = shell.slice(shell.indexOf("onRecoveryAction={(action) =>"), shell.indexOf("onRetry=", shell.indexOf("onRecoveryAction={(action) =>")));
  assert.doesNotMatch(recovery, /void runCommand\(action\)|void send\(|runConversation\(/);
});

test("WS-24 preservation of current draft and no duplicated follow-up is executable", () => {
  assert.match(tests, /WS-24 quoting an answer twice/);
  assert.match(tests, /WS-24 a suggested follow-up is staged once/);
  assert.match(tests, /WS-24 slash recovery suggestion is plain staged text/);
  assert.match(policy, /if \(\`\\n\\n\$\{draft\.trim\(\)\}\\n\\n\`\.includes/);
});

test("WS-24 original next-workstream responsibility is explicit, not claimed merged", () => {
  const doc = fs.readFileSync(new URL("../../docs/ux/LIOS_WS24_MESSAGE_ACTIONS_2026-10-23.md", import.meta.url), "utf8");
  for (const pr of ["#115", "#139", "#145"]) assert.ok(doc.includes(pr));
  assert.match(doc, /200% zoom[\s\S]{0,95}NOT_RUN/);
  assert.match(doc, /VoiceOver\/Narrator[\s\S]{0,95}NOT_RUN/);
});
