// Ported from OpenClaw src/gateway/terminal/session-manager.output-ring.test.ts (MIT, Copyright (c) 2026 OpenClaw Foundation), commit c074824a27c96d3983043f9eeb33823cd1772d8c.
// LiOS (GM-10a): the donor drove TerminalSessionManager; these tests drive TerminalOutputRing directly (same assertions).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { surrogateSafeTail, TerminalOutputRing } from "./output-ring";

describe("TerminalOutputRing", () => {
  it("bounds buffered output by evicting whole head chunks", () => {
    const ring = new TerminalOutputRing(8);
    ring.push("abcd");
    ring.push("efgh");
    assert.equal(ring.snapshot(), "abcdefgh");
    ring.push("ijkl");
    assert.equal(ring.snapshot(), "efghijkl");

    for (let value = 0; value < 5_000; value += 1) {
      ring.push(String(value).padStart(4, "0"));
    }
    assert.equal(ring.snapshot(), "49984999");
    ring.push("tail");
    assert.equal(ring.snapshot(), "4999tail");
  });

  it("keeps only the tail of a single oversized chunk", () => {
    const ring = new TerminalOutputRing(8);
    ring.push("0123456789AB");
    assert.equal(ring.snapshot(), "456789AB");
  });

  it("does not retain a leading lone low surrogate from an oversized chunk", () => {
    const ring = new TerminalOutputRing(3);
    ring.push("ab😀cd");
    assert.equal(ring.snapshot(), "cd");
  });

  it("keeps a whole emoji when the cut falls just before it", () => {
    const ring = new TerminalOutputRing(4);
    ring.push("ab😀cd");
    assert.equal(ring.snapshot(), "😀cd");
  });

  it("snapshot is empty before any output and never exceeds the cap", () => {
    const ring = new TerminalOutputRing(5);
    assert.equal(ring.snapshot(), "");
    for (const chunk of ["😀😀", "x", "😀y😀z"]) {
      ring.push(chunk);
      assert.ok(ring.snapshot().length <= 5);
      assert.doesNotMatch(ring.snapshot(), /^[\uDC00-\uDFFF]/);
    }
  });
});

describe("surrogateSafeTail", () => {
  it("returns the plain tail when the cut is on a character boundary", () => {
    assert.equal(surrogateSafeTail("abcdef", 3), "def");
    assert.equal(surrogateSafeTail("ab😀", 2), "😀");
  });

  it("nudges forward one unit when the cut splits a surrogate pair", () => {
    assert.equal(surrogateSafeTail("a😀b", 2), "b");
  });

  it("returns the whole chunk when it already fits", () => {
    assert.equal(surrogateSafeTail("😀", 5), "😀");
  });
});
