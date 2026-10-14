// Adapted from OpenClaw packages/gateway-client/src/pending-request.ts (MIT, commit c074824a27c96d3983043f9eeb33823cd1772d8c), Copyright (c) 2026 OpenClaw Foundation.
import { GatewayAbortError, GatewayTimeoutError } from "./gatewayErrors";
import { clampTimerMs } from "./timeouts";

interface PendingEntry {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
}

export interface PendingRequestOptions {
  method: string;
  /** null disables the deadline. */
  timeoutMs: number | null;
  signal?: AbortSignal;
}

/**
 * Tracks in-flight requests. Ids are scoped to a generation so a response that arrives after a
 * reconnect can never settle a request of the newer connection; every entry settles exactly once.
 */
export class PendingRequests {
  private generation = 0;
  private counter = 0;
  private readonly entries = new Map<string, PendingEntry>();

  get size(): number {
    return this.entries.size;
  }

  create(options: PendingRequestOptions): { id: string; promise: Promise<unknown> } {
    const id = `${this.generation}-${++this.counter}`;
    const promise = new Promise<unknown>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = () => this.reject(id, new GatewayAbortError(options.method));
      const entry: PendingEntry = {
        method: options.method,
        resolve,
        reject,
        cleanup: () => {
          if (timer !== undefined) clearTimeout(timer);
          options.signal?.removeEventListener("abort", onAbort);
        },
      };
      this.entries.set(id, entry);
      if (options.signal?.aborted) {
        queueMicrotask(onAbort);
        return;
      }
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.timeoutMs !== null) {
        const ms = clampTimerMs(options.timeoutMs, 0);
        timer = setTimeout(() => this.reject(id, new GatewayTimeoutError(options.method, ms)), ms);
      }
    });
    return { id, promise };
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Returns false when the id is unknown or already settled (a late response is ignored). */
  resolve(id: string, value: unknown): boolean {
    const entry = this.take(id);
    entry?.resolve(value);
    return entry !== undefined;
  }

  reject(id: string, error: unknown): boolean {
    const entry = this.take(id);
    entry?.reject(error);
    return entry !== undefined;
  }

  /** Rejects everything in flight and starts a new id generation. */
  rejectAll(makeError: () => unknown): void {
    this.generation++;
    this.counter = 0;
    for (const id of [...this.entries.keys()]) this.reject(id, makeError());
  }

  private take(id: string): PendingEntry | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    this.entries.delete(id);
    entry.cleanup();
    return entry;
  }
}
