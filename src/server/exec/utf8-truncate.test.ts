// Ported from OpenClaw src/utils/utf8-truncate.test.ts (MIT, Copyright (c) 2026 OpenClaw Foundation), commit c074824a27c96d3983043f9eeb33823cd1772d8c.
// LiOS (GM-10a): vitest it.each -> node:test loops; same cases.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { truncateUtf8Prefix, truncateUtf8Suffix } from "./utf8-truncate";

describe("UTF-8 byte truncation", () => {
  for (const { value, maxBytes, expected } of [
    { value: "abcé", maxBytes: 4, expected: "abc" },
    { value: "abc✓", maxBytes: 5, expected: "abc" },
    { value: "abc😀", maxBytes: 6, expected: "abc" },
    { value: "abc😀", maxBytes: 4, expected: "abc" },
    { value: "😀", maxBytes: 4, expected: "😀" },
    { value: "abc", maxBytes: 3, expected: "abc" },
    { value: "éé", maxBytes: 3, expected: "é" },
  ]) {
    it(`keeps a valid prefix for ${value} at ${maxBytes} bytes`, () => {
      const result = truncateUtf8Prefix(value, maxBytes);
      assert.equal(result, expected);
      assert.ok(Buffer.byteLength(result) <= maxBytes);
      assert.ok(!result.includes("�"));
    });
  }

  for (const { value, maxBytes, expected } of [
    { value: "éabc", maxBytes: 4, expected: "abc" },
    { value: "✓abc", maxBytes: 5, expected: "abc" },
    { value: "😀abc", maxBytes: 6, expected: "abc" },
    { value: "😀", maxBytes: 4, expected: "😀" },
    { value: "abc", maxBytes: 3, expected: "abc" },
    { value: "éé", maxBytes: 3, expected: "é" },
  ]) {
    it(`keeps a valid suffix for ${value} at ${maxBytes} bytes`, () => {
      const result = truncateUtf8Suffix(value, maxBytes);
      assert.equal(result, expected);
      assert.ok(Buffer.byteLength(result) <= maxBytes);
      assert.ok(!result.includes("�"));
    });
  }

  it("returns an empty string for a non-positive limit", () => {
    assert.equal(truncateUtf8Prefix("value", 0), "");
    assert.equal(truncateUtf8Suffix("value", -1), "");
  });

  for (const { value, maxBytes, prefix, suffix } of [
    { value: "abc😀", maxBytes: 4.5, prefix: "abc�", suffix: "c😀" },
    { value: "\ud800x", maxBytes: 4, prefix: "\ud800x", suffix: "\ud800x" },
    { value: "\ud800x", maxBytes: 3, prefix: "�", suffix: "x" },
    { value: "\ud800x", maxBytes: Number.NaN, prefix: "", suffix: "�x" },
    { value: "\udc00", maxBytes: Infinity, prefix: "\udc00", suffix: "\udc00" },
    { value: "aj", maxBytes: 2 ** -52, prefix: "", suffix: "j" },
    { value: "éj", maxBytes: 2 ** -52, prefix: "", suffix: "" },
    { value: "abcdefghij", maxBytes: 1 + 2 ** -51, prefix: "a", suffix: "j" },
  ]) {
    it(`preserves conversion and fractional limits for ${JSON.stringify(value)} at ${maxBytes} bytes`, () => {
      assert.equal(truncateUtf8Prefix(value, maxBytes), prefix);
      assert.equal(truncateUtf8Suffix(value, maxBytes), suffix);
    });
  }
});
