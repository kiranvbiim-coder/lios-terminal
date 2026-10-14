// Adapted from OpenClaw src/process/supervisor/adapters/child.test.ts decoder subscription/disposal cases
// (MIT, Copyright (c) 2026 OpenClaw Foundation), commit c074824a27c96d3983043f9eeb33823cd1772d8c.
// LiOS adds known-answer UTF-8 split/EOF tests; awaited-consumer donor tests are not applicable to the child-only contract.
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import { it } from "node:test";
import { onDecodedOutput } from "./decoded-output";

it("owns independent decoders and delivers raw bytes before decoded split UTF-8", async () => {
  const source = new PassThrough();
  const first: string[] = [];
  const second: string[] = [];
  const ordered: string[] = [];
  const raw: Buffer[] = [];
  const a = onDecodedOutput(source, (chunk) => { first.push(chunk); ordered.push("text"); }, (chunk) => { raw.push(chunk); ordered.push("raw"); });
  const b = onDecodedOutput(source, (chunk) => second.push(chunk));
  const bytes = Buffer.from("A🙂éZ");
  for (const byte of bytes) { source.write(Buffer.from([byte])); }
  source.end();
  await finished(source);
  assert.equal(first.join(""), "A🙂éZ");
  assert.equal(second.join(""), "A🙂éZ");
  assert.deepEqual(Buffer.concat(raw), bytes);
  assert.deepEqual(ordered.slice(0, 2), ["raw", "text"]);
  a();
  b();
  assert.equal(source.listenerCount("data"), 0);
});

it("flushes an incomplete decoder sequence exactly once across end and close", async () => {
  const source = new PassThrough();
  const text: string[] = [];
  const unsubscribe = onDecodedOutput(source, (chunk) => text.push(chunk));
  source.end(Buffer.from([0xf0, 0x9f]));
  await finished(source);
  source.emit("close");
  assert.deepEqual(text, ["�"]);
  unsubscribe();
});

it("does not emit a decoder tail or a queued copied listener after unsubscribe", () => {
  const source = new PassThrough();
  const text: string[] = [];
  const unsubscribe = onDecodedOutput(source, (chunk) => text.push(chunk));
  source.write(Buffer.from([0xe2]));
  const copiedData = source.listeners("data")[0];
  const copiedClose = source.listeners("close")[0];
  unsubscribe();
  copiedData(Buffer.from("late"));
  copiedClose();
  assert.deepEqual(text, []);
  assert.equal(source.listenerCount("data"), 0);
  source.destroy();
});

it("retains other stream owners when one subscriber detaches", async () => {
  const source = new PassThrough();
  let first = "";
  let second = "";
  const detachFirst = onDecodedOutput(source, (chunk) => { first += chunk; });
  const detachSecond = onDecodedOutput(source, (chunk) => { second += chunk; });
  source.write("before");
  detachFirst();
  source.end("after");
  await finished(source);
  assert.equal(first, "before");
  assert.equal(second, "beforeafter");
  detachSecond();
});

it("fences decoded delivery when the raw observer revokes its own subscription", () => {
  const source = new PassThrough();
  let seen = "";
  const unsubscribe = onDecodedOutput(source, (chunk) => { seen += chunk; }, () => unsubscribe());
  source.write("revoked");
  assert.equal(seen, "");
  source.destroy();
});
