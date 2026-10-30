import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ChatMessageActions from "./ChatMessageActions";
import { copyChatMessageText } from "@/lib/chatMessageActions";


test("Chat message actions are keyboard-discernible, 44px and role appropriate", () => {
  const answer = renderToStaticMarkup(createElement(ChatMessageActions, {
    content: "Visible answer", role: "assistant", onQuote: () => undefined,
  }));
  assert.ok(answer.includes('aria-label="LiOS answer actions"'));
  assert.ok(answer.includes('aria-label="Copy LiOS answer"'));
  assert.ok(answer.includes("Quote to follow up"));
  assert.ok((answer.match(/min-h-11/g) ?? []).length >= 2);
  assert.ok(answer.includes("focus-visible:outline"));
  const user = renderToStaticMarkup(createElement(ChatMessageActions, {
    content: "My message", role: "user",
  }));
  assert.ok(user.includes('aria-label="Copy your message"'));
  assert.ok(!user.includes("Quote to follow up"));
});

test("machine-only response exposes no copyable message actions", () => {
  const html = renderToStaticMarkup(createElement(ChatMessageActions, {
    content: "<<NAVIGATE:chart>>", role: "assistant",
  }));
  assert.equal(html, "");
});


test("copy stays pending until resolved, explicitly reports denial and never reports false success", async () => {
  let settle!: () => void;
  const delayed = new Promise<void>(resolve => { settle = resolve; });
  let resolved = false;
  const request = copyChatMessageText(async text => {
    assert.equal(text, "Visible answer");
    await delayed;
  }, "Visible answer").then(result => { resolved = true; return result; });
  await Promise.resolve();
  assert.equal(resolved, false);
  settle();
  assert.equal(await request, true);
  assert.equal(await copyChatMessageText(async () => { throw Error("clipboard denied"); }, "Visible answer"), false);
  assert.equal(await copyChatMessageText(undefined, "Visible answer"), false);
});
