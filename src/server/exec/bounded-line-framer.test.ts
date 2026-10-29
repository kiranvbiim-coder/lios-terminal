// Adapted from OpenClaw src/process/bounded-line-framer.test.ts, MIT, Copyright (c) 2026 OpenClaw Foundation.
// Pin c074824a27c96d3983043f9eeb33823cd1772d8c: Vitest assertions ported to node:test, same two cases.
import assert from "node:assert/strict";
import test from "node:test";
import { createBoundedLineFramer } from "./bounded-line-framer";

test("preserves bytes, empty lines, and CR across arbitrary chunk boundaries", () => {
  const lines = [Buffer.from("漢😀\r"), Buffer.alloc(0), Buffer.from([0xff])];
  const wire = Buffer.concat(lines.flatMap(line => [line, Buffer.from("\n")]));
  const framer = createBoundedLineFramer(8, "line too long");
  const received: Buffer[] = [];
  for (const byte of wire) received.push(...framer.push(Buffer.from([byte])));
  assert.deepEqual(received, lines);
});

test("does not inspect a later oversized frame after its consumer retires", () => {
  const framer = createBoundedLineFramer(4, "line too long");
  const received: Buffer[] = [];
  for (const line of framer.push(Buffer.from("done\noversized"))) { received.push(line); break; }
  assert.deepEqual(received, [Buffer.from("done")]);
});
