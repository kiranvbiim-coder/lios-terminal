// Ported from OpenClaw src/process/pipe-output.test.ts (MIT, Copyright (c) 2026 OpenClaw Foundation), commit c074824a27c96d3983043f9eeb33823cd1772d8c.
// LiOS (GM-10a): vitest -> node:test (mock.fn, loops instead of it.each).
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { PassThrough, Writable } from "node:stream";
import { pipeProcessOutput } from "./pipe-output";

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("pipeProcessOutput", () => {
  for (const ending of ["dispose", "destination close", "destination error", "source close"]) {
    it(`releases destination listeners after ${ending} without owning the destination lifetime`, async () => {
      const source = new PassThrough();
      const destination = new PassThrough();
      const reportError = mock.fn();
      const dispose = pipeProcessOutput(source, destination, reportError);
      source.write("diagnostic");
      assert.equal(destination.read()?.toString(), "diagnostic");
      const failure = new Error("diagnostic destination failed");
      if (ending === "dispose") {
        dispose();
      } else if (ending === "destination close") {
        destination.destroy();
      } else if (ending === "destination error") {
        destination.destroy(failure);
      } else {
        source.destroy();
      }
      await nextTurn();
      assert.equal(destination.listenerCount("drain"), 0);
      assert.equal(destination.listenerCount("error"), 0);
      assert.equal(destination.listenerCount("close"), 0);
      assert.deepEqual(
        reportError.mock.calls.map((call) => call.arguments),
        ending === "destination error" ? [[failure]] : [],
      );
      if (ending === "dispose" || ending === "source close") {
        assert.equal(destination.destroyed, false);
        assert.equal(destination.writableEnded, false);
      }
      dispose();
      source.destroy();
      destination.destroy();
    });
  }

  for (const ending of ["close", "error", "finish", "unpipe"]) {
    it(`drains a backpressured source after destination ${ending}`, async () => {
      const source = new PassThrough({ highWaterMark: 8 });
      let finishWrite: (() => void) | undefined;
      const destination = new Writable({
        autoDestroy: false,
        highWaterMark: 8,
        write(_chunk, _encoding, callback) {
          finishWrite = callback;
        },
      });
      const dispose = pipeProcessOutput(source, destination, () => {});
      try {
        source.write(Buffer.alloc(1024));
        assert.equal(source.isPaused(), true);
        source.end(Buffer.alloc(1024));
        if (ending === "finish") {
          destination.end();
          finishWrite?.();
          finishWrite = undefined;
        } else if (ending === "unpipe") {
          source.unpipe(destination);
        } else {
          destination.destroy(ending === "error" ? new Error("destination failed") : undefined);
        }
        await nextTurn();
        assert.equal(source.readableEnded, true);
      } finally {
        finishWrite?.();
        dispose();
        source.destroy();
        destination.destroy();
      }
    });
  }

  it("does not end the destination when the source ends", async () => {
    const source = new PassThrough();
    const destination = new PassThrough();
    pipeProcessOutput(source, destination, () => {});
    source.end("last");
    await nextTurn();
    assert.equal(destination.read()?.toString(), "last");
    assert.equal(destination.writableEnded, false);
    destination.destroy();
  });
});
