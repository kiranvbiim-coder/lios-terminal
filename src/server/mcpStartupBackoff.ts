// Adapted from OpenClaw src/agents/mcp-startup-backoff.ts (MIT, Copyright (c) 2026 OpenClaw Foundation),
// c074824a27c96d3983043f9eeb33823cd1772d8c. LiOS: per-Home bounded state, no donor singleton/error text,
// first failure waits 15s without the donor signal-owner exception, then doubles to10min. Startup only, never tool replay.

type Startup = { failures: number; retryAt: number; pending?: Promise<void> };
const CAPACITY = 1024;

export class McpStartupBackoffError extends Error {
  constructor(readonly retryAt: number | null) {
    super(retryAt === null ? "MCP startup admission is at capacity." : "MCP server startup is cooling down; retry after the indicated time.");
    this.name = "McpStartupBackoffError";
  }
}

function waitForStartup(pending: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error("MCP startup cancelled."));
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(new Error("MCP startup cancelled.")); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    void pending.then(() => { cleanup(); resolve(); }, () => { cleanup(); resolve(); });
  });
}

/** Delays/refuses startup only; owns no client, credentials, invocation or approval. Healthy clients remain separate. */
export class McpStartupBackoff {
  private readonly states = new Map<string, Startup>();
  constructor(private readonly now: () => number = Date.now) {}

  async connect(key: string, signal: AbortSignal, connect: () => Promise<void>): Promise<void> {
    while (this.states.get(key)?.pending) await waitForStartup(this.states.get(key)!.pending!, signal);
    if (signal.aborted) throw new Error("MCP startup cancelled.");
    let state = this.states.get(key);
    if (state && state.retryAt > this.now()) throw new McpStartupBackoffError(state.retryAt);
    if (!state) {
      // Retire only expired, inactive entries; never bypass another server's live cooldown to admit a new key.
      for (const [oldKey, old] of this.states) {
        if (this.states.size < CAPACITY) break;
        if (!old.pending && old.retryAt <= this.now()) this.states.delete(oldKey);
      }
      if (this.states.size >= CAPACITY) throw new McpStartupBackoffError(null);
      state = { failures: 0, retryAt: 0 };
      this.states.set(key, state);
    }
    const owned = state;
    const pending = Promise.resolve().then(async () => {
      if (signal.aborted) throw new Error("MCP startup cancelled.");
      await connect();
    });
    owned.pending = pending;
    try {
      await pending;
      if (signal.aborted) throw new Error("MCP startup cancelled.");
      if (this.states.get(key) === owned) this.states.delete(key);
    } catch {
      if (signal.aborted) {
        if (this.states.get(key) === owned) this.states.delete(key);
        throw new Error("MCP startup cancelled.");
      }
      owned.failures = Math.min(owned.failures + 1, 7);
      owned.retryAt = this.now() + Math.min(600_000, 15_000 * 2 ** (owned.failures - 1));
      throw new McpStartupBackoffError(owned.retryAt);
    } finally {
      owned.pending = undefined;
    }
  }
}

export const homeMcpStartupBackoff = new McpStartupBackoff();
