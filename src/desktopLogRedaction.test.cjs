"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { redactDesktopLogText } = require("./desktopLogRedaction.cjs");

test("desktop logs redact common credential shapes without erasing ordinary diagnostics", () => {
  const input = [
    "Authorization=Bearer abcdefghijklmnop",
    "OPENAI_API_KEY=sk-supersecretvalue",
    "password: hunter2-secret",
    "https://example.test/data?token=querysecret123&symbol=AAPL",
    "renderer failed at line 42",
  ].join(" | ");
  const output = redactDesktopLogText(input);
  assert.doesNotMatch(output, /abcdefghijklmnop|supersecretvalue|hunter2-secret|querysecret123/);
  assert.match(output, /renderer failed at line 42/);
  assert.match(output, /\[REDACTED\]/);
});

test("desktop redaction is safe for empty and non-string values", () => {
  assert.equal(redactDesktopLogText(null), "");
  assert.equal(redactDesktopLogText(42), "42");
});
