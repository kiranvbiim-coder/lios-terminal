import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ChatMessageActions from "../components/terminal/ChatMessageActions";
import { copyChatMessageText, quoteChatResponse, visibleChatMessageText } from "./chatMessageActions";

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
