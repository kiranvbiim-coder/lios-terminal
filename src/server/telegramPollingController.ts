import type { TenantContext } from "./tenantContext";
import type { TelegramAdoptionResult } from "./telegramConnectionService";

export type TelegramPollingState = "polling" | "backoff" | "refused" | "provider_blocked" | "exhausted" | "stopped";
export interface TelegramPollingStatus {
  connectionId: number;
  state: TelegramPollingState;
  consecutiveFailures: number;
  /** Redacted classification only; never provider text, URL, token or exception message. */
  lastFailure: string | null;
  lastAdoptedAt: string | null;
}

export interface TelegramPollingTarget { context: TenantContext; connectionId: number }

export interface TelegramPollingControllerOptions {
  /** One authoritative poll+adopt cycle under CURRENT authority; throws a typed refusal when authority is gone. */
  cycle(target: TelegramPollingTarget, signal: AbortSignal): Promise<TelegramAdoptionResult>;
  /** Classifies a thrown cycle error: canonical authority revoked/conflicting content is terminal, not retryable. */
  isTerminalFailure(error: unknown): boolean;
  /** Test seam; production uses real timers. Must resolve false when aborted. */
  sleep?(ms: number, signal: AbortSignal): Promise<boolean>;
  now?(): number;
  maxConsecutiveFailures?: number;
  /** Failures reset only after this much continuous successful polling, so ready/crash loops cannot evade the ceiling. */
  stableSuccessMs?: number;
  /** Minimum spacing after a successful cycle; protects Home/provider even if a provider returns instantly. */
  minCycleIntervalMs?: number;
}

const BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 30_000;

function realSleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve(false);
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(true); }, ms);
    const onAbort = () => { clearTimeout(timer); resolve(false); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Home-owned lifecycle for enabled Telegram sources. It owns no authority and no provider state: each cycle re-reads
 * canonical owner/consent/credential authority, so disabling/revoking stops work without a controller-side grant.
 * Every async publication is fenced by an attempt token; stop() is synchronous admission closure followed by a joined drain.
 */
export class TelegramPollingController {
  private readonly minCycleMs: number;
  private readonly loops = new Map<number, { attempt: object; abort: AbortController; done: Promise<void>; status: TelegramPollingStatus }>();
  private closed = false;
  private stopping: Promise<void> | null = null;
  private readonly sleep: NonNullable<TelegramPollingControllerOptions["sleep"]>;
  private readonly now: () => number;
  private readonly maxFailures: number;
  private readonly stableMs: number;

  constructor(private readonly options: TelegramPollingControllerOptions) {
    this.sleep = options.sleep ?? realSleep;
    this.now = options.now ?? Date.now;
    this.minCycleMs = options.minCycleIntervalMs ?? 250;
    this.maxFailures = options.maxConsecutiveFailures ?? 5;
    this.stableMs = options.stableSuccessMs ?? 60_000;
  }

  /** Discovery is idempotent even after failure. Only an explicit recovery may replace a settled attempt. */
  start(target: TelegramPollingTarget): void {
    this.startAttempt(target, false);
  }

  /** Trusted Home recovery intent, never called by periodic discovery. Fresh cycle authority is still required. */
  restart(target: TelegramPollingTarget): void {
    this.startAttempt(target, true);
  }

  private startAttempt(target: TelegramPollingTarget, recover: boolean): void {
    if (this.closed) throw new Error("Telegram polling controller is stopped.");
    const existing = this.loops.get(target.connectionId);
    if (existing && (!recover || !["stopped", "refused", "provider_blocked", "exhausted"].includes(existing.status.state))) return;
    const attempt = {};
    const abort = new AbortController();
    const status: TelegramPollingStatus = { connectionId: target.connectionId, state: "polling", consecutiveFailures: 0, lastFailure: null, lastAdoptedAt: null };
    const previous = existing?.done ?? Promise.resolve();
    // Publish ownership before any asynchronous work so a concurrent stop joins this exact attempt.
    const entry = { attempt, abort, status, done: Promise.resolve() };
    entry.done = previous.then(() => this.run(target, entry));
    this.loops.set(target.connectionId, entry);
  }

  status(): TelegramPollingStatus[] {
    return [...this.loops.values()].map(entry => ({ ...entry.status }));
  }

  /** Cancels admission immediately, aborts in-flight cycles and joins every attempt. Never restarts anything. */
  stop(connectionId?: number): Promise<void> {
    if (connectionId === undefined) {
      this.closed = true;
      this.stopping ??= (async () => {
        const entries = [...this.loops.values()];
        for (const entry of entries) entry.abort.abort();
        await Promise.all(entries.map(entry => entry.done));
      })();
      return this.stopping;
    }
    const entry = this.loops.get(connectionId);
    if (!entry) return Promise.resolve();
    entry.abort.abort();
    return entry.done;
  }

  private async run(target: TelegramPollingTarget, entry: { attempt: object; abort: AbortController; status: TelegramPollingStatus }): Promise<void> {
    const { status } = entry;
    const current = () => !entry.abort.signal.aborted && this.loops.get(target.connectionId)?.attempt === entry.attempt;
    let stableSince: number | null = null;
    while (current()) {
      try {
        status.state = "polling";
        const result = await this.options.cycle(target, entry.abort.signal);
        if (!current()) break;
        if (result.kind === "adopted") {
          stableSince ??= this.now();
          if (result.adopted || result.edited) status.lastAdoptedAt = new Date(this.now()).toISOString();
          if (this.now() - stableSince >= this.stableMs) status.consecutiveFailures = 0;
          status.lastFailure = null;
          if (!(await this.sleep(this.minCycleMs, entry.abort.signal))) break;
          continue;
        }
        // A typed provider outcome is never replayed from here. Credential/conflict problems need explicit user repair.
        status.lastFailure = `provider_${result.code}`;
        if (result.code === "unauthorized" || result.code === "conflict") { status.state = "provider_blocked"; break; }
        stableSince = null;
        status.consecutiveFailures++;
        const hinted = result.retryAfterMs ?? 0;
        if (!(await this.backoff(status, hinted, entry.abort.signal))) break;
      } catch (error) {
        if (!current()) break;
        if (this.options.isTerminalFailure(error)) {
          status.state = "refused";
          status.lastFailure = error instanceof Error && "code" in error && error.code === "namespace_reconnect_required"
            ? "namespace_reconnect_required" : "authority_refused";
          break;
        }
        stableSince = null;
        status.consecutiveFailures++;
        status.lastFailure = "cycle_failed";
        if (!(await this.backoff(status, 0, entry.abort.signal))) break;
      }
      if (status.consecutiveFailures >= this.maxFailures) { status.state = "exhausted"; break; }
    }
    if (status.state === "polling" || status.state === "backoff") status.state = "stopped";
  }

  private async backoff(status: TelegramPollingStatus, hintMs: number, signal: AbortSignal): Promise<boolean> {
    if (status.consecutiveFailures >= this.maxFailures) { status.state = "exhausted"; return false; }
    status.state = "backoff";
    const exponential = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, status.consecutiveFailures - 1));
    return this.sleep(Math.max(exponential, Math.min(hintMs, 300_000)), signal);
  }
}
