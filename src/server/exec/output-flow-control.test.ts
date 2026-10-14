// Written for LiOS, GM-10a: the donor has no dedicated test for output-flow-control.ts.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { TerminalBackend } from "./backend";
import { TerminalOutputController } from "./output-flow-control";

const HIGH = 4 * 1024 * 1024;
const LOW = 512 * 1024;
const REASSERT_MS = 5_000;

type Emitted = { connIds: readonly string[]; data: string; seq: number };

function setup() {
  const calls: string[] = [];
  const backend: Pick<TerminalBackend, "pause" | "resume"> = {
    pause: () => void calls.push("pause"),
    resume: () => void calls.push("resume"),
  };
  const state = { connIds: ["c1"] as readonly string[], buffered: new Map<string, number>(), now: 1_000_000 };
  const recorded: string[] = [];
  const emitted: Emitted[] = [];
  const controller = new TerminalOutputController({
    backend,
    getConnIds: () => state.connIds,
    getBufferedAmount: (connId) => state.buffered.get(connId),
    record: (chunk) => recorded.push(chunk),
    emit: (connIds, data, seq) => emitted.push({ connIds, data, seq }),
    now: () => state.now,
  });
  return { calls, state, recorded, emitted, controller };
}

describe("TerminalOutputController", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "setInterval"] }));
  afterEach(() => mock.timers.reset());

  it("records every chunk and tracks the cumulative UTF-16 end offset", () => {
    const { controller, recorded, state } = setup();
    state.connIds = [];
    controller.push("ab");
    controller.push("😀");
    assert.deepEqual(recorded, ["ab", "😀"]);
    assert.equal(controller.endOffset, 4);
  });

  it("does not emit when nobody is attached", () => {
    const { controller, emitted } = setup();
    controller.dispose();
    const detached = setup();
    detached.state.connIds = [];
    detached.controller.push("x");
    mock.timers.tick(100);
    assert.deepEqual(detached.emitted, []);
    assert.deepEqual(emitted, []);
  });

  it("batches non-interactive output behind the coalescing window", () => {
    const { controller, emitted } = setup();
    controller.push("a");
    controller.push("b");
    assert.deepEqual(emitted, []);
    mock.timers.tick(4);
    assert.deepEqual(emitted, [{ connIds: ["c1"], data: "ab", seq: 2 }]);
  });

  it("flushes small output immediately within 100 ms of user input (interactive fast path)", () => {
    const { controller, emitted, state } = setup();
    controller.noteInput();
    state.now += 100;
    controller.push("echo");
    assert.deepEqual(emitted.map((e) => e.data), ["echo"]);
  });

  it("does not use the fast path after the input window or for large chunks", () => {
    const { controller, emitted, state } = setup();
    controller.noteInput();
    state.now += 101;
    controller.push("late");
    assert.deepEqual(emitted, []);
    mock.timers.tick(4);
    assert.equal(emitted.length, 1);

    controller.noteInput();
    controller.push("x".repeat(1025));
    assert.equal(emitted.length, 1);
    mock.timers.tick(4);
    assert.equal(emitted.length, 2);
  });

  it("does not use the fast path when input was never noted", () => {
    const { controller, emitted } = setup();
    controller.push("a");
    assert.deepEqual(emitted, []);
  });

  it("pauses the backend at the high-water mark and resumes at the low-water mark", () => {
    const { controller, calls, state } = setup();
    state.buffered.set("c1", HIGH - 1);
    controller.push("a");
    assert.deepEqual(calls, []);

    state.buffered.set("c1", HIGH);
    controller.push("b");
    mock.timers.tick(4);
    assert.deepEqual(calls, ["pause"]);

    // Between the marks: hysteresis keeps the backend paused.
    state.buffered.set("c1", LOW + 1);
    controller.push("c");
    mock.timers.tick(4);
    assert.deepEqual(calls, ["pause"]);

    state.buffered.set("c1", LOW);
    controller.push("d");
    mock.timers.tick(4);
    assert.deepEqual(calls, ["pause", "resume"]);
    controller.dispose();
  });

  it("uses the most backed-up recipient", () => {
    const { controller, calls, state } = setup();
    state.connIds = ["c1", "c2", "c3"];
    state.buffered.set("c1", 0);
    state.buffered.set("c2", HIGH);
    controller.push("a");
    assert.deepEqual(calls, ["pause"]);
    controller.dispose();
  });

  it("re-asserts the desired state every 5 s while paused", () => {
    const { controller, calls, state } = setup();
    state.buffered.set("c1", HIGH);
    controller.push("a");
    assert.deepEqual(calls, ["pause"]);
    mock.timers.tick(REASSERT_MS - 1);
    assert.deepEqual(calls, ["pause"]);
    mock.timers.tick(1);
    assert.deepEqual(calls, ["pause", "pause"]);
    mock.timers.tick(REASSERT_MS);
    assert.deepEqual(calls, ["pause", "pause", "pause"]);
    controller.dispose();
  });

  it("re-asserts resume if the pressure cleared without a push", () => {
    const { controller, calls, state } = setup();
    state.buffered.set("c1", HIGH);
    controller.push("a");
    mock.timers.tick(4); // coalescer flush sees the pressure still high
    state.buffered.set("c1", 0);
    mock.timers.tick(REASSERT_MS - 4);
    assert.deepEqual(calls, ["pause", "resume"]);
    controller.dispose();
  });

  it("resumes on the reassert tick when the recipient's buffer is no longer observable", () => {
    const { controller, calls, state } = setup();
    state.buffered.set("c1", HIGH);
    controller.push("a");
    mock.timers.tick(4);
    state.buffered.delete("c1");
    mock.timers.tick(REASSERT_MS - 4);
    assert.deepEqual(calls, ["pause", "resume"]);
    controller.dispose();
  });

  it("reconcileRecipients reacts to a changed recipient set immediately", () => {
    const { controller, calls, state } = setup();
    state.buffered.set("c1", HIGH);
    controller.push("a");
    state.connIds = ["c2"];
    state.buffered.set("c2", 0);
    controller.reconcileRecipients();
    assert.deepEqual(calls, ["pause", "resume"]);
    controller.dispose();
  });

  it("dispose resumes a paused backend and stops the reassert timer", () => {
    const { controller, calls, state } = setup();
    state.buffered.set("c1", HIGH);
    controller.push("a");
    controller.dispose();
    assert.deepEqual(calls, ["pause", "resume"]);
    mock.timers.tick(REASSERT_MS * 3);
    assert.deepEqual(calls, ["pause", "resume"]);
  });

  it("dispose({ flush: true }) emits pending output, plain dispose drops it", () => {
    const flushed = setup();
    flushed.controller.push("a");
    flushed.controller.dispose({ flush: true });
    assert.deepEqual(flushed.emitted.map((e) => e.data), ["a"]);

    const dropped = setup();
    dropped.controller.push("a");
    dropped.controller.dispose();
    mock.timers.tick(100);
    assert.deepEqual(dropped.emitted, []);
  });

  it("swallows a throwing backend and retries on the next reassert tick", () => {
    const { controller, state } = setup();
    let attempts = 0;
    const flaky = new TerminalOutputController({
      backend: {
        pause() {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("native failure");
          }
        },
        resume() {},
      },
      getConnIds: () => state.connIds,
      getBufferedAmount: () => HIGH,
      record: () => {},
      emit: () => {},
    });
    flaky.push("a");
    assert.equal(attempts, 1);
    mock.timers.tick(REASSERT_MS);
    assert.equal(attempts, 2);
    flaky.dispose();
    controller.dispose();
  });

  it("resetOwnership drops pending output, resumes, and moves emittedOffset to endOffset", () => {
    const { controller, calls, emitted, state } = setup();
    state.buffered.set("c1", HIGH);
    controller.push("abc");
    controller.resetOwnership();
    mock.timers.tick(4);
    assert.deepEqual(emitted, []);
    assert.deepEqual(calls, ["pause", "resume"]);
    state.buffered.set("c1", 0);
    controller.push("de");
    mock.timers.tick(4);
    assert.deepEqual(emitted.map((e) => [e.data, e.seq]), [["de", 5]]);
    controller.dispose();
  });

  describe("attach offsets", () => {
    it("emits seq as the cumulative end offset of each frame", () => {
      const { controller, emitted, state } = setup();
      state.connIds = [];
      controller.push("ab"); // detached output: counted, not emitted
      state.connIds = ["c1"];
      controller.prepareViewerAttach();
      controller.push("cd");
      mock.timers.tick(4);
      controller.push("é😀");
      mock.timers.tick(4);
      assert.deepEqual(emitted.map((e) => [e.data, e.seq]), [["cd", 4], ["é😀", 7]]);
      assert.equal(controller.endOffset, 7);
    });

    it("a reattaching client replays a snapshot and skips frames at or below its offset: no gaps, no duplicates", () => {
      const { controller, emitted, recorded } = setup();
      controller.push("one-");
      mock.timers.tick(4);
      controller.push("two-");
      mock.timers.tick(4);
      // Client reconnects: pending "three-" is flushed to old viewers first,
      // the snapshot is taken at endOffset, then live frames continue after it.
      controller.push("three-");
      controller.prepareViewerAttach();
      const snapshot = recorded.join("");
      const snapshotOffset = controller.endOffset;
      assert.equal(snapshot.length, snapshotOffset);
      controller.push("four");
      mock.timers.tick(4);

      const received = [snapshot];
      for (const frame of emitted) {
        if (frame.seq > snapshotOffset) {
          received.push(frame.data);
        }
      }
      assert.equal(received.join(""), "one-two-three-four");
      const last = emitted.at(-1);
      assert.equal(last?.seq, controller.endOffset);
      assert.equal(last?.data, "four");
      assert.equal(last?.seq === snapshotOffset + "four".length, true);
    });

    it("prepareViewerAttach flushes pending frames to existing viewers before advancing the offset", () => {
      const { controller, emitted } = setup();
      controller.push("pending");
      controller.prepareViewerAttach();
      assert.deepEqual(emitted.map((e) => [e.data, e.seq]), [["pending", 7]]);
      mock.timers.tick(100);
      assert.equal(emitted.length, 1);
    });
  });
});
