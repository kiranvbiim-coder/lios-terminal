// Adapted from OpenClaw src/process/supervisor/adapters/child-stdin.ts (MIT, Copyright (c) 2026 OpenClaw Foundation), commit c074824a27c96d3983043f9eeb33823cd1772d8c.
// LiOS (GM-10a) modifications: import specifier only (types from ./types).
import type { Writable } from "node:stream";
import type { ManagedRunStdin } from "./types";

/** Expose the native child pipe's observable stdin lifecycle. */
export function createManagedChildStdin(
  stream: Writable | null | undefined,
): ManagedRunStdin | undefined {
  if (!stream) {
    return undefined;
  }
  let ended = stream.writableEnded || stream.writableFinished;
  let destroyed = stream.destroyed;
  stream.once("finish", () => {
    ended = true;
  });
  stream.once("close", () => {
    ended = true;
    destroyed = true;
  });
  stream.once("error", () => {
    destroyed = true;
  });
  return {
    get destroyed() {
      return destroyed || stream.destroyed;
    },
    get writable() {
      return !destroyed && !ended && stream.writable;
    },
    get writableEnded() {
      return ended || stream.writableEnded;
    },
    get writableFinished() {
      return stream.writableFinished;
    },
    write(data, callback) {
      if (destroyed || ended || !stream.writable) {
        callback?.(new Error("stdin is not writable"));
        return;
      }
      try {
        stream.write(data, callback);
      } catch (error) {
        callback?.(error instanceof Error ? error : new Error(String(error)));
      }
    },
    end() {
      ended = true;
      try {
        stream.end();
      } catch {
        // Closing an already-failed child pipe is best effort.
      }
    },
    destroy() {
      ended = true;
      destroyed = true;
      try {
        stream.destroy();
      } catch {
        // Destroying an already-failed child pipe is best effort.
      }
    },
  };
}
