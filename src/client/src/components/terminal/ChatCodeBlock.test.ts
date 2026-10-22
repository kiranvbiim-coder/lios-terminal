import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ChatCodeBlock, { copyChatCode } from "./ChatCodeBlock";
import ChatMarkdown from "./ChatMarkdown";

const render = (code: string, language?: string, streaming = false) =>
  renderToStaticMarkup(createElement(ChatCodeBlock, { code, language, streaming }));

test("completed chat code has a keyboard-accessible copy action and selectable code region", () => {
  const markup = render("const total = 3;\nconsole.log(total);", "typescript");
  assert.match(markup, /data-chat-code-block="true"/);
  assert.match(markup, /<button\b[^>]*type="button"[^>]*aria-label="Copy typescript code"[^>]*data-testid="chat-code-copy"/);
  assert.match(markup, />Copy code<\/button>/);
  assert.match(markup, /<pre\b[^>]*tabindex="0"[^>]*aria-label="typescript code"/);
  assert.match(markup, /<code data-language="typescript">const total = 3;\nconsole\.log\(total\);<\/code>/);
});

test("streaming snippets are labelled generating and cannot be copied prematurely", () => {
  const markup = render("incomplete", "python", true);
  assert.match(markup, /disabled=""/);
  assert.match(markup, /aria-label="Copy code after the answer finishes"/);
  assert.match(markup, /Generating…/);
  assert.doesNotMatch(markup, />Copied<\/button>/);
});

test("untrusted code and language remain escaped, inert text, never HTML", () => {
  const markup = render("<script>alert(1)</script>", "<img onerror=x>");
  assert.doesNotMatch(markup, /<script\b|<img\b|\sonerror=/i);
  assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(markup, /&lt;img onerror=x&gt;/);
});

test("copy writes exactly the selected code, preserving newlines and punctuation", async () => {
  const code = "select *\nfrom data where price < 100;\n";
  let written: string | undefined;
  const ok = await copyChatCode(async (text) => { written = text; }, code);
  assert.equal(ok, true);
  assert.equal(written, code);
});

test("clipboard absence or rejection is failure, not a misleading success", async () => {
  assert.equal(await copyChatCode(undefined, "secret"), false);
  assert.equal(await copyChatCode(async () => { throw new Error("permission denied"); }, "secret"), false);
});

test("every Chat Markdown fenced code path uses copy action without interfering with citations", () => {
  const markup = renderToStaticMarkup(createElement(ChatMarkdown, {
    text: "Here is an example:\n\n```js\nconst value = 1;\n```\n\nContinue.",
  }));
  assert.match(markup, /data-chat-code-block="true"/);
  assert.match(markup, /aria-label="Copy js code"/);
  assert.match(markup, /<code data-language="js">const value = 1;<\/code>/);
  assert.match(markup, /Continue\./);
  const incomplete = renderToStaticMarkup(createElement(ChatMarkdown, {
    text: "```js\nlet x = 1;",
    streaming: true,
  }));
  assert.match(incomplete, /Copy code after the answer finishes/);
  assert.match(incomplete, /disabled=""/);
});
