// Written for LiOS, GM-10a. Helpers for supervisor tests that spawn real child processes.
import { performance } from "node:perf_hooks";
import { createDeferredCore } from "./deferred";

export const IDLE_SCRIPT = "setInterval(() => {}, 1000)";

export function nodeArgv(script: string): string[] {
  return [process.execPath, "-e", script];
}

/** Collect streamed stdout and resolve a waiter as soon as the accumulated text matches. */
export function createOutputWatcher() {
  let text = "";
  const waiters: Array<{ pattern: RegExp; resolve: (match: RegExpMatchArray) => void }> = [];
  return {
    onStdout: (chunk: string) => {
      text += chunk;
      for (const waiter of waiters.splice(0)) {
        const match = text.match(waiter.pattern);
        if (match) {
          waiter.resolve(match);
        } else {
          waiters.push(waiter);
        }
      }
    },
    waitFor: (pattern: RegExp): Promise<RegExpMatchArray> => {
      const match = text.match(pattern);
      if (match) {
        return Promise.resolve(match);
      }
      const deferred = createDeferredCore<RegExpMatchArray>();
      waiters.push({ pattern, resolve: deferred.resolve });
      return deferred.promise;
    },
  };
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return false;
    }
    return true;
  }
}

/** Yield to the event loop until the kernel reports ESRCH; the orphan reaper has no event to await. */
export async function waitForPidGone(pid: number, budgetMs = 10_000): Promise<boolean> {
  const deadline = performance.now() + budgetMs;
  while (pidAlive(pid)) {
    if (performance.now() > deadline) {
      return false;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return true;
}
