import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";

/**
 * In-memory registry of Conversation Runtime runs (GM-08b).
 *
 * A run is started once and observed by any number of listeners (the Gateway connection that started it, the same
 * user's reloaded UI, an HTTP/SSE caller). Events are buffered so a late or reconnecting listener replays what it
 * missed. Active runs are never resumed: an app restart ends them; saved-chat execution history is retained by
 * the encrypted journal, not this registry. Finished runs are kept briefly for terminal-event replay.
 */

export interface RunEntry {
  seq: number;
  event: ConversationRuntimeEvent;
}

export interface RunSummary {
  /** Canonical execution-session identity; identical to requestId. */
  requestId: string;
  userId: number;
  projectId: number | null;
  chatId: number | null;
  startedAt: string;
  finished: boolean;
}

type Listener = (entry: RunEntry) => void;

interface Run extends RunSummary {
  entries: RunEntry[];
  nextSeq: number;
  listeners: Set<Listener>;
  expiry: ReturnType<typeof setTimeout> | null;
  controller: AbortController;
  inputHandler: ((input: string) => Promise<void>) | null;
  inputQueue: Promise<void>;
  /** Opt-in (L4): a `done: waiting_approval` keeps this run identity alive instead of finishing it. */
  pausable: boolean;
  paused: boolean;
  pausedTtlMs: number;
  pauseExpiry: ReturnType<typeof setTimeout> | null;
  /** Process-local, opaque to the registry, never serialized: the live state a paused run continues from (L3/L4). */
  pausePayload: unknown;
  /** Durable cancellation finalizer supplied by the run service for a paused run. */
  pauseCancelFinalizer: (() => Promise<void>) | null;
  cancellationPending: boolean;
}

export class ConversationRunConflictError extends Error {
  constructor(message = "A run with this id is already executing.") {
    super(message);
    this.name = "ConversationRunConflictError";
  }
}

export interface RunRegistryOptions {
  retainFinishedMs?: number;
  maxRunsPerUser?: number;
  maxBufferedEntries?: number;
  /** How long a paused (waiting for approval) run keeps its identity before it is cancelled. */
  pausedTtlMs?: number;
  now?: () => Date;
}

export class ConversationRunRegistry {
  private readonly runs = new Map<string, Run>();
  private readonly retainFinishedMs: number;
  private readonly maxRunsPerUser: number;
  private readonly maxBufferedEntries: number;
  private readonly pausedTtlMs: number;
  private readonly now: () => Date;

  constructor(options: RunRegistryOptions = {}) {
    this.retainFinishedMs = options.retainFinishedMs ?? 10 * 60_000;
    this.maxRunsPerUser = options.maxRunsPerUser ?? 20;
    this.maxBufferedEntries = options.maxBufferedEntries ?? 2_000;
    this.pausedTtlMs = options.pausedTtlMs ?? 30 * 60_000;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Registers a run and executes it in the background. `execute` receives `emit`; whatever it throws is converted
   * into a terminal error + done event so every listener always sees the run end.
   */
  start(
    input: { requestId: string; userId: number; projectId: number | null; chatId: number | null },
    execute: (emit: (event: ConversationRuntimeEvent) => void, signal: AbortSignal) => Promise<void>,
    options: { pausable?: boolean } = {},
  ): RunSummary {
    const existing = this.runs.get(input.requestId);
    if (existing && (existing.userId !== input.userId || !existing.finished)) throw new ConversationRunConflictError();
    if (existing) this.drop(existing);
    this.evictFinishedOverLimit(input.userId);

    const run: Run = {
      ...input,
      startedAt: this.now().toISOString(),
      finished: false,
      entries: [],
      nextSeq: 0,
      listeners: new Set(),
      expiry: null,
      controller: new AbortController(),
      inputHandler: null,
      inputQueue: Promise.resolve(),
      pausable: options.pausable === true,
      paused: false,
      pausedTtlMs: this.pausedTtlMs,
      pauseExpiry: null,
      pausePayload: undefined,
      pauseCancelFinalizer: null,
      cancellationPending: false,
    };
    this.runs.set(run.requestId, run);
    this.launch(run, execute);
    return this.summary(run);
  }

  /**
   * Continues a paused run under the same requestId, owner scope, buffered events and cancellation tree (SI-02 L4).
   * Returns false when the run is unknown, not paused, owned by someone else, or already finished/expired. Paused runs
   * never survive a restart: this registry is in memory and recovery marks the journal record interrupted.
   */
  resumeScoped(
    requestId: string,
    owner: { userId: number; projectId: number | null; chatId: number | null },
    execute: (emit: (event: ConversationRuntimeEvent) => void, signal: AbortSignal) => Promise<void>,
  ): boolean {
    const run = this.runs.get(requestId);
    if (!run || run.finished || !run.paused || !this.ownedBy(run, owner)) return false;
    this.clearPause(run);
    run.paused = false;
    run.pausePayload = undefined;
    run.pauseCancelFinalizer = null;
    this.launch(run, execute);
    return true;
  }

  /**
   * Stages the live continuation payload immediately before the executor publishes
   * done:waiting_approval. It remains unreadable until the registry has actually
   * entered the paused state, preventing an attach-after-event race.
   */
  stagePauseScoped(
    requestId: string,
    owner: { userId: number; projectId: number | null; chatId: number | null },
    payload: unknown,
    cancelFinalizer: (() => Promise<void>) | null = null,
  ): boolean {
    const run = this.runs.get(requestId);
    if (
      !run
      || run.finished
      || !run.pausable
      || run.paused
      || !this.ownedBy(run, owner)
      || payload === null
      || payload === undefined
      || run.pausePayload !== undefined
    ) return false;
    run.pausePayload = payload;
    run.pauseCancelFinalizer = cancelFinalizer;
    return true;
  }

  /** Owner-scoped live pause state + the exact canonical run cancellation signal. */
  getPausedPayloadScoped<T = unknown>(
    requestId: string,
    owner: { userId: number; projectId: number | null; chatId: number | null },
  ): { payload: T; signal: AbortSignal } | null {
    const run = this.runs.get(requestId);
    if (!run || run.finished || !run.paused || !this.ownedBy(run, owner) || run.pausePayload === undefined) return null;
    return { payload: run.pausePayload as T, signal: run.controller.signal };
  }

  /** Compatibility wrapper for callers that need only the live payload. */
  readPauseScoped<T = unknown>(requestId: string, owner: { userId: number; projectId: number | null; chatId: number | null }): T | null {
    return this.getPausedPayloadScoped<T>(requestId, owner)?.payload ?? null;
  }

  /** The canonical run cancellation signal of a live (running or paused) owned run; the one a lease must bind to. */
  signalScoped(requestId: string, owner: { userId: number; projectId: number | null; chatId: number | null }): AbortSignal | null {
    const run = this.runs.get(requestId);
    return run && !run.finished && this.ownedBy(run, owner) ? run.controller.signal : null;
  }

  private launch(
    run: Run,
    execute: (emit: (event: ConversationRuntimeEvent) => void, signal: AbortSignal) => Promise<void>,
  ): void {
    const emit = (event: ConversationRuntimeEvent) => {
      if (run.finished) return;
      if (event.type === "done" && event.status === "waiting_approval" && run.pausable) {
        this.append(run, event);
        this.pause(run);
        return;
      }
      this.append(run, event);
      if (event.type === "done") this.finish(run);
    };
    void execute(emit, run.controller.signal)
      .catch((error: unknown) => {
        const at = this.now().toISOString();
        // The runtime usually reports its own failure before throwing; do not show the same failure twice.
        if (!run.entries.some((entry) => entry.event.type === "error")) {
          emit({ type: "error", requestId: run.requestId, at, code: "request_failed", message: error instanceof Error ? error.message : "Conversation Runtime failed." });
        }
        emit({ type: "done", requestId: run.requestId, at, status: "failed" });
      })
      .finally(() => {
        // A paused run intentionally returned without `done`; a runtime that returned without one otherwise must still end.
        if (run.paused) return;
        emit({ type: "done", requestId: run.requestId, at: this.now().toISOString(), status: "failed" });
      });
  }

  private pause(run: Run): void {
    run.paused = true;
    run.inputHandler = null;
    run.pauseExpiry = setTimeout(() => this.abortRun(run), run.pausedTtlMs);
    run.pauseExpiry.unref?.();
  }

  private clearPause(run: Run): void {
    if (run.pauseExpiry) clearTimeout(run.pauseExpiry);
    run.pauseExpiry = null;
  }

  /**
   * Aborts the run's cancellation tree. For a paused run there is no live
   * executor, so the registry invokes the run-service durable cancellation
   * finalizer before exposing done:cancelled.
   */
  private abortRun(run: Run): void {
    run.controller.abort();
    if (!run.paused || run.finished || run.cancellationPending) return;

    this.clearPause(run);
    run.paused = false;
    run.cancellationPending = true;
    run.pausePayload = undefined;
    const finalize = run.pauseCancelFinalizer;
    run.pauseCancelFinalizer = null;

    const publishCancelled = () => {
      if (run.finished) return;
      run.cancellationPending = false;
      this.append(run, { type: "done", requestId: run.requestId, at: this.now().toISOString(), status: "cancelled" });
      this.finish(run);
    };

    if (!finalize) {
      publishCancelled();
      return;
    }

    void finalize().then(
      publishCancelled,
      () => {
        if (run.finished) return;
        run.cancellationPending = false;
        this.append(run, {
          type: "error",
          requestId: run.requestId,
          at: this.now().toISOString(),
          code: "execution_journal_failed",
          message: "Paused execution cancellation could not be durably persisted.",
        });
        this.append(run, { type: "done", requestId: run.requestId, at: this.now().toISOString(), status: "failed" });
        this.finish(run);
      },
    );
  }

  /**
   * Attaches a listener. Entries after `afterSeq` are replayed synchronously before the listener is registered, so
   * nothing is missed or duplicated. Returns null when the run is unknown or belongs to another user.
   */
  subscribe(requestId: string, userId: number, afterSeq: number, listener: Listener): { detach: () => void; status: "running" | "finished"; lastSeq: number; run: RunSummary } | null {
    const run = this.runs.get(requestId);
    if (!run || run.userId !== userId) return null;
    for (const entry of run.entries) if (entry.seq > afterSeq) listener(entry);
    const lastSeq = run.nextSeq - 1;
    if (!run.finished) run.listeners.add(listener);
    return {
      detach: () => run.listeners.delete(listener),
      status: run.finished ? "finished" : "running",
      lastSeq,
      run: this.summary(run),
    };
  }

  subscribeScoped(
    requestId: string,
    owner: { userId: number; projectId: number | null; chatId: number | null },
    afterSeq: number,
    listener: Listener,
  ): { detach: () => void; status: "running" | "finished"; lastSeq: number; run: RunSummary } | null {
    const run = this.runs.get(requestId);
    if (!run || !this.ownedBy(run, owner)) return null;
    return this.subscribe(requestId, owner.userId, afterSeq, listener);
  }

  getScoped(
    requestId: string,
    owner: { userId: number; projectId: number | null; chatId: number | null },
  ): RunSummary | null {
    const run = this.runs.get(requestId);
    return run && this.ownedBy(run, owner) ? this.summary(run) : null;
  }

  /** Owner-only cancellation for entry points that carry no Project/Chat scope (HTTP). */
  cancel(requestId: string, userId: number): boolean {
    const run = this.runs.get(requestId);
    if (!run || run.finished || run.cancellationPending || run.userId !== userId) return false;
    this.abortRun(run);
    return true;
  }

  /** The same owner-scoped registry controls secondary-surface command cancellation. */
  cancelScoped(
    requestId: string,
    owner: { userId: number; projectId: number | null; chatId: number | null },
  ): boolean {
    const run = this.runs.get(requestId);
    if (!run || run.finished || run.cancellationPending || !this.ownedBy(run, owner)) return false;
    this.abortRun(run);
    return true;
  }

  /** Controlled input remains owned by this scoped run; no second session registry. */
  setInputHandlerScoped(
    requestId: string,
    owner: { userId: number; projectId: number | null; chatId: number | null },
    handler: ((input: string) => Promise<void>) | null,
  ): boolean {
    const run = this.runs.get(requestId);
    if (!run || run.finished || !this.ownedBy(run, owner)) return false;
    run.inputHandler = handler;
    return true;
  }

  writeInputScoped(
    requestId: string,
    owner: { userId: number; projectId: number | null; chatId: number | null },
    input: string,
  ): Promise<void> {
    const run = this.runs.get(requestId);
    if (!run || run.finished || !this.ownedBy(run, owner) || !run.inputHandler) {
      return Promise.reject(new Error("That execution session does not accept input in the requested Project/Chat scope."));
    }
    if (typeof input !== "string" || input.length < 1 || input.length > 128 || /[\0\r\n]/u.test(input)) {
      return Promise.reject(new Error("Terminal input must be one bounded, single-line value."));
    }
    const handler = run.inputHandler;
    const write = run.inputQueue.then(() => {
      if (run.finished || run.inputHandler !== handler) {
        throw new Error("That execution session no longer accepts input.");
      }
      return handler(input);
    });
    run.inputQueue = write.then(() => undefined, () => undefined);
    return write;
  }

  active(userId: number): RunSummary[] {
    return [...this.runs.values()].filter((run) => run.userId === userId && !run.finished).map((run) => this.summary(run));
  }

  get(requestId: string, userId: number): RunSummary | null {
    const run = this.runs.get(requestId);
    return run && run.userId === userId ? this.summary(run) : null;
  }

  private ownedBy(
    run: Run,
    owner: { userId: number; projectId: number | null; chatId: number | null },
  ): boolean {
    return run.userId === owner.userId
      && run.projectId === owner.projectId
      && run.chatId === owner.chatId;
  }

  private append(run: Run, event: ConversationRuntimeEvent): void {
    // Text events carry the full text so far, so an older one is superseded by the next and need not be replayed.
    if (event.type === "text") run.entries = run.entries.filter((entry) => entry.event.type !== "text");
    const entry: RunEntry = { seq: run.nextSeq++, event };
    run.entries.push(entry);
    if (run.entries.length > this.maxBufferedEntries) run.entries.splice(0, run.entries.length - this.maxBufferedEntries);
    for (const listener of run.listeners) {
      try {
        listener(entry);
      } catch {
        // A failing observer must never end or corrupt the run for the others.
        run.listeners.delete(listener);
      }
    }
  }

  private finish(run: Run): void {
    run.finished = true;
    run.cancellationPending = false;
    run.pausePayload = undefined;
    run.pauseCancelFinalizer = null;
    run.inputHandler = null;
    run.listeners.clear();
    run.expiry = setTimeout(() => this.drop(run), this.retainFinishedMs);
    run.expiry.unref?.();
  }

  private drop(run: Run): void {
    if (run.expiry) clearTimeout(run.expiry);
    if (this.runs.get(run.requestId) === run) this.runs.delete(run.requestId);
  }

  private evictFinishedOverLimit(userId: number): void {
    const own = [...this.runs.values()].filter((run) => run.userId === userId);
    if (own.length < this.maxRunsPerUser) return;
    for (const run of own) {
      if (run.finished) this.drop(run);
    }
    if ([...this.runs.values()].filter((run) => run.userId === userId).length >= this.maxRunsPerUser) {
      throw new ConversationRunConflictError("Too many conversation runs are executing. Wait for one to finish or cancel it.");
    }
  }

  private summary(run: Run): RunSummary {
    return {
      requestId: run.requestId,
      userId: run.userId,
      projectId: run.projectId,
      chatId: run.chatId,
      startedAt: run.startedAt,
      finished: run.finished,
    };
  }
}

export const conversationRuns = new ConversationRunRegistry();
