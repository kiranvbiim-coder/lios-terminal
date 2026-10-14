/**
 * A wall-clock deadline that cannot be silently dropped.
 *
 * `AbortSignal.any([parent, AbortSignal.timeout(ms)])` holds its timeout signal only weakly. On some runtimes the
 * timeout signal can be garbage-collected before it fires, so a run's bounded-runtime budget never trips. This helper
 * owns an explicit timer that stays strongly referenced until `dispose()`, which callers must run in `finally`.
 */
export interface DeadlineSignal {
  readonly signal: AbortSignal;
  /** Stops the timer and detaches from the parent. Safe to call more than once. */
  dispose(): void;
}

export function deadlineSignal(parent: AbortSignal | undefined, ms: number): DeadlineSignal {
  const controller = new AbortController();
  if (parent?.aborted) {
    controller.abort(parent.reason);
    return { signal: controller.signal, dispose: () => undefined };
  }
  const onParentAbort = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
  }, ms);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}
