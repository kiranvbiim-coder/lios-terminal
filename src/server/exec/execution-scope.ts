import { AsyncLocalStorage } from "node:async_hooks";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { getProcessSupervisor } from "./index";
import { createExecutionJournal } from "./execution-journal";
import type { ExecutionJournal, ExecutionOwner } from "./execution-journal";
import { StorageIntegrityError } from "../storageProvider";

interface ConversationExecutionScope {
  requestId: string;
  scopeKey: string;
  controller: AbortController;
  closed: boolean;
  detach: (() => void) | null;
  /** Cancel hooks still running; the scope joins them before the caller may persist a terminal result. */
  pending: Set<Promise<void>>;
}

/** A cancel hook that hangs cannot hold a run open forever; the join is bounded and says so. */
const CANCEL_HOOK_JOIN_MS = 30_000;

export function createSafeConversationCancellationReason(): DOMException {
  return new DOMException("Conversation execution cancelled.", "AbortError");
}

// Async ownership only: conversationRuns remains the sole active-run registry.
const scopes = new AsyncLocalStorage<ConversationExecutionScope>();
let journal: Promise<ExecutionJournal> | null = null;

/** Initialization errors stay visible to every caller; there is no plaintext or memory fallback. */
export function getConversationExecutionJournal(): Promise<ExecutionJournal> {
  return journal ??= createExecutionJournal();
}

/** Called once at server startup, before any run can be admitted. Recovery never executes a command. */
export async function recoverConversationExecutions(): Promise<void> {
  await (await getConversationExecutionJournal()).recoverInterrupted();
}

export async function withConversationExecutionScope<T>(requestId: string, execute: () => Promise<T>): Promise<T> {
  const supervisor = getProcessSupervisor();
  const scope: ConversationExecutionScope = {
    requestId, scopeKey: `conversation:${requestId}`, controller: new AbortController(), closed: false, detach: null, pending: new Set(),
  };
  const close = supervisor.acquireScopeCleanup(scope.scopeKey);
  return scopes.run(scope, async () => {
    try {
      return await execute();
    } finally {
      scope.closed = true;
      scope.controller.abort(createSafeConversationCancellationReason());
      scope.detach?.();
      await joinCancelHooks(scope);
      // Join real descendant cleanup before the caller can persist/emit a terminal result.
      await close();
    }
  });
}

async function joinCancelHooks(scope: ConversationExecutionScope): Promise<void> {
  if (scope.pending.size === 0) return;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), CANCEL_HOOK_JOIN_MS); timer.unref?.(); });
  const outcome = await Promise.race([Promise.allSettled([...scope.pending]).then(() => "done" as const), timeout]);
  clearTimeout(timer);
  if (outcome === "timeout") console.warn(`[execution-scope] cancel cleanup for ${scope.scopeKey} did not finish within ${CANCEL_HOOK_JOIN_MS}ms.`);
}

/** Bind the runtime's existing controller, so both Gateway and HTTP cancellation reach subprocesses. */
export function bindConversationExecutionSignal(requestId: string, signal: AbortSignal): void {
  const scope = scopes.getStore();
  if (!scope || scope.requestId !== requestId) return;
  const abort = () => {
    scope.controller.abort(createSafeConversationCancellationReason());
    getProcessSupervisor().cancelScope(scope.scopeKey, "manual-cancel");
  };
  signal.addEventListener("abort", abort, { once: true });
  scope.detach = () => signal.removeEventListener("abort", abort);
  if (signal.aborted) abort();
}

/** Aborts `target` when `source` aborts (immediately if it already has). Returns a detach function. */
export function linkAbortSignal(source: AbortSignal | undefined, target: AbortController): () => void {
  if (!source) return () => undefined;
  if (source.aborted) {
    target.abort(createSafeConversationCancellationReason());
    return () => undefined;
  }
  const abort = () => target.abort(createSafeConversationCancellationReason());
  source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}

/** Cancellation signal of the current conversation scope, or undefined outside one. Never throws. */
export function currentConversationSignal(): AbortSignal | undefined {
  const scope = scopes.getStore();
  return scope && !scope.closed ? scope.controller.signal : undefined;
}

/**
 * Child node of the cancellation tree: `hook` runs when the current conversation scope is cancelled (or closes while
 * the hook is still registered), so brokers, MCP calls and jobs started under a run stop with it. Returns the
 * unregister function; callers unregister once their own work has finished. Outside a scope this is a no-op.
 */
export function onConversationScopeCancel(hook: (reason: unknown) => void | Promise<void>): () => void {
  const scope = scopes.getStore();
  if (!scope || scope.closed) return () => undefined;
  const signal = scope.controller.signal;
  const run = () => {
    const task: Promise<void> = Promise.resolve()
      .then(() => hook(createSafeConversationCancellationReason()))
      .catch(() => undefined);
    scope.pending.add(task);
    void task.finally(() => scope.pending.delete(task));
  };
  if (signal.aborted) {
    run();
    return () => undefined;
  }
  signal.addEventListener("abort", run, { once: true });
  return () => signal.removeEventListener("abort", run);
}

/** Internal command admission inherits canonical ownership even if a producer supplies another scope key. */
export function currentConversationExecutionScope(): { scopeKey: string; signal: AbortSignal } | null {
  const scope = scopes.getStore();
  if (!scope) return null;
  if (scope.closed) throw new Error("Conversation execution scope is closed.");
  return { scopeKey: scope.scopeKey, signal: scope.controller.signal };
}

export class ConversationJournalError extends Error {
  constructor(error: unknown) {
    super("Encrypted conversation execution journal is unavailable.", { cause: error });
    this.name = "ConversationJournalError";
  }
}

/** Runtime text is cumulative, not chunks. Only the new suffix is appended to retained output. */
export class ConversationExecutionTranscript {
  private text = "";
  private reportedFailure = false;
  private persistenceFailure: ConversationJournalError | null = null;

  constructor(private readonly journal: ExecutionJournal, private readonly id: string) {}

  private async append(channel: "stdout" | "stderr", chunk: string): Promise<void> {
    if (!chunk) return;
    try {
      await this.journal.append(this.id, channel, chunk);
    } catch (error) {
      this.persistenceFailure = new ConversationJournalError(error);
      throw this.persistenceFailure;
    }
  }

  async recordText(text: string): Promise<void> {
    if (!text) return;
    const chunk = text.startsWith(this.text) ? text.slice(this.text.length) : `\n${text}`;
    await this.append("stdout", chunk);
    this.text = text;
  }

  async recordEvent(event: ConversationRuntimeEvent): Promise<void> {
    if (this.persistenceFailure) throw this.persistenceFailure;
    if (event.type === "text") await this.recordText(event.text);
    if (event.type === "error") {
      await this.append("stderr", `${event.message}\n`);
      this.reportedFailure = true;
    }
    if (event.type === "data_gap") {
      await this.append("stderr", `${event.gap.message}\n`);
      this.reportedFailure = true;
    }
  }

  async recordFailure(error: unknown): Promise<void> {
    if (!this.reportedFailure) {
      await this.append("stderr", `${error instanceof Error ? error.message : "Conversation Runtime failed."}\n`);
      this.reportedFailure = true;
    }
  }

  /** Durably pauses an agent run whose ledger has a call waiting for approval. The record stays open, not terminal. */
  async pauseForApproval(): Promise<void> {
    if (this.persistenceFailure) throw this.persistenceFailure;
    try {
      await this.journal.markWaitingApproval(this.id);
    } catch (error) {
      throw new ConversationJournalError(error);
    }
  }

  async interruptForReconciliation(): Promise<void> {
    if (this.persistenceFailure) throw this.persistenceFailure;
    try {
      await this.journal.markAgentReconciliationRequired(this.id);
    } catch (error) {
      throw new ConversationJournalError(error);
    }
  }

  /**
   * Durable end of an explicit user Stop on an agent run. A run that already holds a valid owner-bound checkpoint and no
   * outcome-unknown dispatch is parked as `interrupted` (explicitly resumable by its owner); anything else is the ordinary
   * terminal `cancelled`. The caller emits `done:cancelled` either way.
   */
  async finishCancelled(owner: ExecutionOwner): Promise<void> {
    if (this.persistenceFailure) throw this.persistenceFailure;
    try {
      await this.journal.interruptCheckpointed(this.id, owner);
      return;
    } catch (error) {
      if (!(error instanceof StorageIntegrityError)) throw new ConversationJournalError(error);
    }
    await this.finish("cancelled");
  }

  async finish(status: "completed" | "cancelled" | "failed"): Promise<void> {
    if (status !== "failed" && this.persistenceFailure) throw this.persistenceFailure;
    try {
      // A conversation has no single process exit code; do not invent one.
      await this.journal.finish(this.id, status, null);
    } catch (error) {
      throw new ConversationJournalError(error);
    }
  }
}
