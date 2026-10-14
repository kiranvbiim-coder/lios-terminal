// Ported from OpenClaw src/shared/bounded-buffer.test.ts (MIT, Copyright (c) 2026 OpenClaw Foundation), commit c074824a27c96d3983043f9eeb33823cd1772d8c.
// LiOS (GM-10a): vitest -> node:test; added capacity-edge, fit, and post-close cases.
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { BoundedBuffer } from "./bounded-buffer";

const length = (value: string) => value.length;

describe("BoundedBuffer", () => {
  it("latches after preserving the accepted prefix", () => {
    const buffer = new BoundedBuffer<string>(3, { mode: "latch" }, length);
    assert.deepEqual(["ab", "cd", "e"].map((value) => buffer.push(value)), [true, false, false]);
    assert.deepEqual(buffer.drain(), ["ab"]);
  });

  it("stays latched after drain", () => {
    const buffer = new BoundedBuffer<string>(3, { mode: "latch" }, length);
    buffer.push("abcd");
    buffer.drain();
    assert.equal(buffer.push("a"), false);
    assert.deepEqual(buffer.drain(), []);
  });

  it("accepts a value that exactly fills the capacity, then latches on the next", () => {
    const buffer = new BoundedBuffer<string>(4, { mode: "latch" }, length);
    assert.equal(buffer.push("ab"), true);
    assert.equal(buffer.push("cd"), true);
    assert.equal(buffer.push("e"), false);
    assert.deepEqual(buffer.drain(), ["ab", "cd"]);
  });

  it("defaults to counting one unit per value", () => {
    const buffer = new BoundedBuffer<string>(2, { mode: "latch" });
    assert.deepEqual(["x", "y", "z"].map((value) => buffer.push(value)), [true, true, false]);
  });

  it("drops every oldest value needed to fit a larger append", () => {
    const buffer = new BoundedBuffer<string>(8, { mode: "drop-oldest" }, length);
    assert.deepEqual(
      ["a", "bb", "ccc", "dddd"].map((value) => buffer.push(value)),
      [true, true, true, true],
    );
    assert.deepEqual(buffer.drain(), ["ccc", "dddd"]);
  });

  it("keeps everything when drop-oldest content exactly fits", () => {
    const buffer = new BoundedBuffer<string>(4, { mode: "drop-oldest" }, length);
    buffer.push("ab");
    buffer.push("cd");
    assert.deepEqual(buffer.drain(), ["ab", "cd"]);
  });

  it("drops the oversized value without a fit function", () => {
    const buffer = new BoundedBuffer<string>(3, { mode: "drop-oldest" }, length);
    buffer.push("a");
    assert.equal(buffer.push("toolong"), true);
    assert.deepEqual(buffer.drain(), []);
  });

  it("fits a single oversized value with the fit function and evicts older ones", () => {
    const buffer = new BoundedBuffer<string>(
      3,
      { mode: "drop-oldest", fit: (value, capacity) => value.slice(-capacity) },
      length,
    );
    buffer.push("a");
    buffer.push("toolong");
    assert.deepEqual(buffer.drain(), ["ong"]);
  });

  it("clears buffered values and fails closed", () => {
    const onOverflow = mock.fn();
    const buffer = new BoundedBuffer<string>(3, { mode: "fail-closed", onOverflow }, length);
    assert.deepEqual(["ab", "cd", "e"].map((value) => buffer.push(value)), [true, false, false]);
    assert.deepEqual(buffer.drain(), []);
    assert.equal(onOverflow.mock.callCount(), 1);
  });

  it("fail-closed rejects later pushes without calling onOverflow again", () => {
    const onOverflow = mock.fn();
    const buffer = new BoundedBuffer<string>(1, { mode: "fail-closed", onOverflow }, length);
    buffer.push("ab");
    buffer.push("a");
    assert.equal(onOverflow.mock.callCount(), 1);
    assert.deepEqual(buffer.drain(), []);
  });

  it("drains the retained FIFO after sustained overflow and can then be reused", () => {
    const buffer = new BoundedBuffer<number | undefined>(3, { mode: "drop-oldest" });
    for (let value = 0; value < 5_000; value += 1) {
      buffer.push(value);
    }
    buffer.push(undefined);
    assert.deepEqual(buffer.drain(), [4_998, 4_999, undefined]);
    assert.deepEqual(buffer.drain(), []);
    buffer.push(1);
    buffer.push(2);
    assert.deepEqual(buffer.drain(), [1, 2]);
  });
});
