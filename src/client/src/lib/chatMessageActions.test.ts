import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ChatMessageActions from "../components/terminal/ChatMessageActions";
import { copyChatMessageText, quoteChatResponse, stageChatFollowUp, visibleChatMessageText } from "./chatMessageActions";

const here = path.dirname(fileURLToPath(import.meta.url));
const shell = fs.readFileSync(path.join(here, "../components/terminal/ProjectExperienceShell.tsx"), "utf8");

test("copying assistant answers excludes hidden machine directives, but keeps real cited prose", () => {
  const response = "Evidence [1]. <<NAVIGATE:chart>>\n\nNext observation.";
  const visible = visibleChatMessageText(response, "assistant");
  assert.match(visible, /Evidence \[1\]\./);
  assert.match(visible, /Next observation/);
  assert.doesNotMatch(visible, /NAVIGATE|<</);
  assert.equal(visibleChatMessageText("literal << text", "user"), "literal << text");
});

test("the quote prefill is bounded, does not send, and retains the user's previous draft", () => {
  const previous = "My unfinished question";
  const quoted = quoteChatResponse(previous, "A key finding. <<NAVIGATE:chart>>\nSupporting fact.");
  assert.ok(quoted.startsWith(previous + "\n\n"));
  assert.match(quoted, /Follow up on this LiOS response:/);
  assert.match(quoted, /> A key finding/);
  assert.match(quoted, /> Supporting fact/);
  assert.doesNotMatch(quoted, /NAVIGATE/);
  assert.ok(quoted.endsWith("\n\n"));
  assert.equal(quoteChatResponse(previous, "<<NAVIGATE:chart>>"), previous);
  const huge = quoteChatResponse("", "A".repeat(20000));
  assert.ok(huge.length < 1350);
  assert.match(huge, /…/);
});

test("clipboard success requires a successful awaited write; denial/absence is failure", async () => {
  let copied: string | undefined;
  const ok = await copyChatMessageText(async (value) => { copied = value; }, "response\n[1]");
  assert.equal(ok, true);
  assert.equal(copied, "response\n[1]");
  assert.equal(await copyChatMessageText(undefined, "hello"), false);
  assert.equal(await copyChatMessageText(async () => {}, ""), false);
  assert.equal(await copyChatMessageText(async () => { throw new Error("not allowed"); }, "hello"), false);
});

test("assistant action row offers copy plus deliberate draft-only quote", () => {
  const html = renderToStaticMarkup(createElement(ChatMessageActions, {
    content: "Useful answer", role: "assistant", onQuote: () => {},
  }));
  assert.match(html, /role="group" aria-label="LiOS answer actions"/);
  assert.match(html, /data-testid="chat-message-copy"/);
  assert.match(html, /aria-label="Copy LiOS answer"/);
  assert.match(html, /data-testid="chat-message-quote"/);
  assert.match(html, /Quote to follow up/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /<script/i);
});

test("user messages can be copied but cannot be quoted as an assistant response", () => {
  const html = renderToStaticMarkup(createElement(ChatMessageActions, {
    content: "My message", role: "user",
  }));
  assert.match(html, /aria-label="Copy your message"/);
  assert.doesNotMatch(html, /data-testid="chat-message-quote"/);
  assert.equal(renderToStaticMarkup(createElement(ChatMessageActions, { content: "", role: "assistant" })), "");
});

test("existing signed-in shell uses actions for persisted and temporary messages, never internal system role", () => {
  assert.match(shell, /displayMessages\.map\(\(message\) =>/);
  assert.match(shell, /message\.role !== "system" && <ChatMessageActions/);
  assert.match(shell, /content=\{message\.content\}/);
  assert.match(shell, /quoteChatResponse\(draft, message\.content\)/);
  assert.match(shell, /setInput\(\(draft\) => quoteChatResponse/);
  assert.match(shell, /composerRef\.current\?\.focus\(\)/);
});

test("WS-24 quoting an answer twice preserves exactly one staged quote", () => {
  const first = quoteChatResponse("My unfinished draft", "Revenue increased.\n<<NAVIGATE:chart>>");
  const second = quoteChatResponse(first, "Revenue increased.\n<<NAVIGATE:chart>>");
  assert.equal(second, first);
  assert.equal((second.match(/Follow up on this LiOS response:/g) ?? []).length, 1);
  assert.doesNotMatch(second, /NAVIGATE/);
});

test("WS-24 different quoted answers append once each and preserve original draft", () => {
  const original = "My own question";
  const one = quoteChatResponse(original, "First answer");
  const two = quoteChatResponse(one, "Second answer");
  assert.match(two, /^My own question\n\n/);
  assert.equal((two.match(/Follow up on this LiOS response:/g) ?? []).length, 2);
  assert.equal(quoteChatResponse(two, "First answer"), two);
});

test("WS-24 an action with no visible answer must not add an empty quote", () => {
  const current = "Unsaved text";
  assert.equal(quoteChatResponse(current, "<<WORKSPACE_OPEN:x>>"), current);
});

test("WS-24 a suggested follow-up is staged once, not auto-sent, and retains existing typing", () => {
  const text = stageChatFollowUp("My unsent draft", "Compare the assumptions");
  assert.equal(text, "My unsent draft\n\nCompare the assumptions\n\n");
  assert.equal(stageChatFollowUp(text, "Compare the assumptions"), text);
  assert.equal(stageChatFollowUp("", "  "), "");
});

test("WS-24 a repeated suggestion already at beginning stays unchanged", () => {
  const text = stageChatFollowUp("", "Compare portfolio weights");
  const other = stageChatFollowUp(text, "Discuss my risk");
  assert.equal(stageChatFollowUp(other, "Compare portfolio weights"), other);
  assert.match(other, /^Compare portfolio weights\n\nDiscuss my risk\n\n$/);
});

test("WS-24 slash recovery suggestion is plain staged text, not invoked as a command", () => {
  const draft = "Please compare valuations";
  const result = stageChatFollowUp(draft, "/connect-source");
  assert.equal(result, "Please compare valuations\n\n/connect-source\n\n");
  assert.equal(stageChatFollowUp(result, "/connect-source"), result);
});

test("WS-24 clipboard copy is unchanged by quote and follow-up staging", async () => {
  let sent = "";
  const quote = quoteChatResponse("", "Net income +14%");
  assert.equal(await copyChatMessageText(async value => { sent = value; }, quote), true);
  assert.equal(sent, quote);
  assert.equal(await copyChatMessageText(async () => { throw Error("denied"); }, quote), false);
});
