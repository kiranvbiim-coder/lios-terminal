import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ChatMessageActions from "./ChatMessageActions";
import { copyChatMessageText } from "@/lib/chatMessageActions";

const source = readFileSync(new URL("./ChatMessageActions.tsx", import.meta.url), "utf8");

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

test("a message change releases its own pending clipboard lock but not a newer message's lock", () => {
  assert.ok(source.includes("useEffect(()=>{"));
  assert.ok(source.includes("epoch.current++;"));
  assert.ok(source.includes("inFlight.current=false;"));
  assert.ok(source.includes("},[content,role]);"));
  assert.ok(source.includes("const generation=epoch.current;"));
  assert.ok(source.includes("if(epoch.current===generation)setState(ok?\"copied\":\"failed\");"));
  assert.ok(source.includes("if(epoch.current===generation)inFlight.current=false;"));
  assert.ok(!source.includes("finally {inFlight.current=false;}"));
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
  assert.ok(source.includes('aria-busy={state==="copying"}'));
  assert.ok(source.includes('state==="failed"?"Try copy again"'));
  assert.ok(source.includes('role="alert"'));
});
