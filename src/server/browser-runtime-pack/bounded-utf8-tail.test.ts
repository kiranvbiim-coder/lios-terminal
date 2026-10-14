// Ported from OpenClaw extensions/browser/src/browser/bounded-utf8-tail.test.ts
// (MIT, Copyright (c) 2026 OpenClaw Foundation), commit
// c074824a27c96d3983043f9eeb33823cd1772d8c. Vitest adapted to node:test.
import assert from "node:assert/strict";
import test from "node:test";
import { createBoundedUtf8Tail } from "./bounded-utf8-tail";

test("bounded UTF-8 tail keeps newest bytes across chunks", () => {
  const tail = createBoundedUtf8Tail(8);
  tail.append("older");
  tail.append("-newest");
  assert.equal(tail.text(), "r-newest");
});

test("bounded UTF-8 tail drops partial leading and trailing code points", () => {
  const leading = createBoundedUtf8Tail(5);
  leading.append(Buffer.from("old🦞new"));
  assert.equal(leading.text(), "new");
  const trailing = createBoundedUtf8Tail(1);
  trailing.append(Buffer.from([0xf0, 0x9f, 0x98, 0x80]));
  assert.equal(trailing.text(), "");
});

test("bounded UTF-8 tail replaces, clears and copies caller buffers", () => {
  const tail = createBoundedUtf8Tail(4);
  tail.append("old");
  tail.append("123456");
  assert.equal(tail.text(), "3456");
  tail.clear();
  assert.equal(tail.text(), "");
  const source = Buffer.from("test");
  tail.append(source);
  source.fill(0);
  assert.equal(tail.text(), "test");
});

test("bounded UTF-8 tail waits for split code points", () => {
  const tail = createBoundedUtf8Tail(4);
  const encoded = Buffer.from([0xf0, 0x9f, 0x98, 0x80]);
  tail.append(encoded.subarray(0, 1));
  assert.equal(tail.text(), "");
  tail.append(encoded.subarray(1));
  assert.equal(tail.text(), "😀");
});
