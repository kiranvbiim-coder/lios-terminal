// Written for LiOS, GM-10a: the donor has no dedicated test for output-coalescer.ts.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { TerminalOutputCoalescer } from "./output-coalescer";

const FRAME_BYTES = 64 * 1024;

function setup() {
  const frames: string[] = [];
  const coalescer = new TerminalOutputCoalescer((data) => frames.push(data));
  return { frames, coalescer };
}

describe("TerminalOutputCoalescer", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
  afterEach(() => mock.timers.reset());

  it("batches adjacent chunks into one frame after 4 ms", () => {
    const { frames, coalescer } = setup();
    coalescer.push("a");
    coalescer.push("b");
    coalescer.push("c");
    mock.timers.tick(3);
    assert.deepEqual(frames, []);
    assert.equal(coalescer.isEmpty, false);
    mock.timers.tick(1);
    assert.deepEqual(frames, ["abc"]);
    assert.equal(coalescer.isEmpty, true);
  });

  it("does not extend the window when more chunks arrive", () => {
    const { frames, coalescer } = setup();
    coalescer.push("a");
    mock.timers.tick(3);
    coalescer.push("b");
    mock.timers.tick(1);
    assert.deepEqual(frames, ["ab"]);
  });

  it("starts a fresh window after a flush", () => {
    const { frames, coalescer } = setup();
    coalescer.push("a");
    mock.timers.tick(4);
    coalescer.push("b");
    mock.timers.tick(4);
    assert.deepEqual(frames, ["a", "b"]);
  });

  it("flushNow emits immediately and cancels the timer", () => {
    const { frames, coalescer } = setup();
    coalescer.push("a");
    coalescer.push("b", { flushNow: true });
    assert.deepEqual(frames, ["ab"]);
    mock.timers.tick(100);
    assert.deepEqual(frames, ["ab"]);
  });

  it("emits a full 64 KiB frame immediately and keeps the remainder for the timer", () => {
    const { frames, coalescer } = setup();
    coalescer.push("a".repeat(FRAME_BYTES + 10));
    assert.equal(frames.length, 1);
    assert.equal(frames[0]?.length, FRAME_BYTES);
    mock.timers.tick(4);
    assert.equal(frames.length, 2);
    assert.equal(frames[1], "a".repeat(10));
  });

  it("never splits a multi-byte character across frames and loses nothing", () => {
    for (const unit of ["é", "€", "😀"]) {
      const { frames, coalescer } = setup();
      const input = unit.repeat(Math.ceil((FRAME_BYTES * 3) / Buffer.byteLength(unit)) + 1);
      coalescer.push(input);
      coalescer.flush();
      assert.ok(frames.length >= 3);
      for (const frame of frames) {
        assert.ok(Buffer.byteLength(frame) <= FRAME_BYTES, `${unit} frame within 64 KiB`);
        assert.ok(!frame.includes("�"));
        assert.equal(frame.length % unit.length, 0);
      }
      assert.equal(frames.join(""), input);
    }
  });

  it("flushes the pending frame before starting a new one when the next part does not fit", () => {
    const { frames, coalescer } = setup();
    coalescer.push("a".repeat(FRAME_BYTES - 1));
    coalescer.push("€");
    assert.equal(frames.length, 1);
    assert.equal(frames[0]?.length, FRAME_BYTES - 1);
    coalescer.flush();
    assert.equal(frames[1], "€");
  });

  it("dispose({ flush: true }) emits the buffered data at end of stream", () => {
    const { frames, coalescer } = setup();
    coalescer.push("tail");
    coalescer.dispose({ flush: true });
    assert.deepEqual(frames, ["tail"]);
    mock.timers.tick(100);
    assert.deepEqual(frames, ["tail"]);
  });

  it("dispose() and clear() discard buffered data and cancel the timer", () => {
    const { frames, coalescer } = setup();
    coalescer.push("lost");
    coalescer.dispose();
    coalescer.push("lost2");
    coalescer.clear();
    mock.timers.tick(100);
    assert.deepEqual(frames, []);
    assert.equal(coalescer.isEmpty, true);
  });

  it("flush on an empty coalescer emits nothing", () => {
    const { frames, coalescer } = setup();
    coalescer.flush();
    coalescer.push("");
    mock.timers.tick(100);
    assert.deepEqual(frames, []);
  });
});
