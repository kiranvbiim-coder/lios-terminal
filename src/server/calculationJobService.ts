/**
 * Durable, restart-safe calculation job queue.
 *
 * Any engine that needs to run work outside the request/response cycle
 * (factor-risk snapshots, long-running valuation/Monte Carlo passes, etc.)
 * registers a runner for a `kind` via registerCalculationJobRunner() and
 * enqueues work with enqueueCalculationJob(). Every state transition is
 * persisted to the `calculation_jobs` table (shared/schema.ts) before this
 * module reports it, so a server restart never silently loses a queued or
 * in-flight job the way a plain in-memory queue would.
 *
 * Recovery model: each in-flight job is held by a lease (leaseOwner +
 * leaseExpiresAt), renewed by a heartbeat while it runs. On startup,
 * initializeCalculationJobService() requeues (or fails, once the retry
 * budget is exhausted) any "running" row whose lease has already expired --
 * that is the only reliable signal that the worker process which owned it
 * is gone, since a hard crash never gets a chance to mark its own row
 * failed. A periodic reaper repeats that same expired-lease sweep so a job
 * that crashes mid-heartbeat-interval is still reclaimed without a second
 * restart. Cancellation is cooperative: cancellationRequested is persisted
 * immediately, the local AbortController (if this process owns the job) is
 * aborted right away, and the next heartbeat catches it otherwise -- but a
 * job that has already reached a terminal status, or that is already
 * marked cancelled, never runs or restarts again.
 */
import crypto from "crypto";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { calculationJobs, type CalculationJob } from "@shared/schema";
import { getDb } from "./db";

export type CalculationJobStatus = CalculationJob["status"];
const TERMINAL_STATUSES: readonly CalculationJobStatus[] = ["succeeded", "failed", "cancelled"];

export interface CalculationJobRunContext {
  jobId: string;
  userId: number;
  organizationId: number | null;
  /** Aborts when cancellation is requested; pass straight through to fetch/child processes. */
  signal: AbortSignal;
  /** Persist bounded progress for UI polling and operational diagnostics. */
  reportProgress(progressPct: number): Promise<void>;
  /** Live DB read for runners that poll between synchronous chunks instead of using `signal`. */
  isCancellationRequested(): Promise<boolean>;
}

export type CalculationJobRunner<TInput = unknown, TResult = unknown> = (
  input: TInput,
  ctx: CalculationJobRunContext,
) => Promise<TResult>;

const runners = new Map<string, CalculationJobRunner>();
const readGuards = new Map<string, (job: CalculationJob, scope: CalculationJobScope) => Promise<void>>();

/** Registers the runner invoked for every job enqueued with this `kind`. Re-registering replaces it. */
export function registerCalculationJobRunner<TInput = unknown, TResult = unknown>(
  kind: string,
  runner: CalculationJobRunner<TInput, TResult>,
  options?: { authorizeRead: (job: CalculationJob, scope: CalculationJobScope) => Promise<void> },
): void {
  runners.set(kind, runner as CalculationJobRunner);
  if (options) readGuards.set(kind, options.authorizeRead);
  else readGuards.delete(kind);
}

/** Test-only state reset; not used by runtime code. */
export function resetCalculationJobRunnersForTests(): void {
  runners.clear();
  readGuards.clear();
}

// A single worker (this process) at a time -- the desktop terminal runs one
// server process against its own local PGlite file, so there is never a
// second writer to coordinate with, but the lease still records an owner id
// so recovery logic generalizes cleanly if a distributed worker is ever
// added later.
const WORKER_ID = crypto.randomUUID();
const LEASE_TTL_MS = 45_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const REAPER_INTERVAL_MS = 30_000;
const MAX_CONCURRENCY = Math.max(1, Math.min(Number(process.env.CALCULATION_JOB_CONCURRENCY) || 3, 16));
const MAX_RETENTION_DAYS = Math.max(1, Number(process.env.CALCULATION_JOB_RETENTION_DAYS) || 90);
const MAX_TERMINAL_JOBS_PER_OWNER = Math.max(1, Number(process.env.CALCULATION_JOB_MAX_PER_OWNER) || 200);

const queue: string[] = [];
const active = new Map<string, { controller: AbortController; heartbeat: NodeJS.Timeout } | null>();
let initialized = false;
let reaperHandle: NodeJS.Timeout | null = null;

function cloneJobRecord(job: CalculationJob): CalculationJob {
  // Defensive deep clone so a caller mutating a returned job (e.g. its
  // `result`/`input` object) can never corrupt what a later read sees --
  // every public read goes through this before leaving the module.
  return structuredClone(job);
}

export interface CalculationJobOwner {
  userId: number;
  organizationId: number | null;
}

export interface CalculationJobScope {
  userId: number;
  /** See jobs owned by anyone in this organization, not just `userId`'s own jobs. Route layer decides who gets this (e.g. internal_compliance). */
  includeOrganization?: boolean;
  organizationId?: number | null;
}

function scopeCondition(scope: CalculationJobScope) {
  if (scope.includeOrganization && scope.organizationId !== null && scope.organizationId !== undefined) {
    return or(eq(calculationJobs.ownerUserId, scope.userId), eq(calculationJobs.organizationId, scope.organizationId));
  }
  return eq(calculationJobs.ownerUserId, scope.userId);
}

export async function enqueueCalculationJob<TInput = unknown>(
  kind: string,
  input: TInput,
  owner: CalculationJobOwner,
  opts?: { maxRetries?: number },
): Promise<CalculationJob> {
  if (!runners.has(kind)) {
    throw new Error(`No calculation runner is registered for kind "${kind}".`);
  }
  const db = getDb();
  const [created] = await db.insert(calculationJobs).values({
    id: crypto.randomUUID(),
    kind,
    input: input as Record<string, unknown>,
    status: "queued",
    ownerUserId: owner.userId,
    organizationId: owner.organizationId,
    maxRetries: Math.max(0, opts?.maxRetries ?? 2),
  }).returning();
  queue.push(created.id);
  pump();
  return cloneJobRecord(created);
}

export async function getCalculationJob(id: string, scope: CalculationJobScope): Promise<CalculationJob | null> {
  const db = getDb();
  const [job] = await db.select().from(calculationJobs).where(and(eq(calculationJobs.id, id), scopeCondition(scope))).limit(1);
  if (job?.result != null) await readGuards.get(job.kind)?.(job, scope);
  return job ? cloneJobRecord(job) : null;
}

export async function listCalculationJobs(
  scope: CalculationJobScope,
  filters?: { kind?: string; status?: CalculationJobStatus[]; limit?: number },
): Promise<CalculationJob[]> {
  const db = getDb();
  const conditions = [scopeCondition(scope)];
  if (filters?.kind) conditions.push(eq(calculationJobs.kind, filters.kind));
  if (filters?.status?.length) conditions.push(inArray(calculationJobs.status, filters.status));
  const rows = await db.select().from(calculationJobs)
    .where(and(...conditions))
    .orderBy(desc(calculationJobs.queuedAt))
    .limit(Math.max(1, Math.min(filters?.limit ?? 100, 500)));
  for (const job of rows) if (job.result != null) await readGuards.get(job.kind)?.(job, scope);
  return rows.map(cloneJobRecord);
}

export async function requestCalculationJobCancellation(id: string, scope: CalculationJobScope): Promise<CalculationJob | null> {
  const db = getDb();
  const existing = await getCalculationJob(id, scope);
  if (!existing) return null;

  if (existing.status === "queued") {
    const index = queue.indexOf(id);
    if (index >= 0) queue.splice(index, 1);
    const now = new Date();
    const [updated] = await db.update(calculationJobs).set({
      status: "cancelled", cancellationRequested: true, error: "Cancelled before execution began.",
      completedAt: now, updatedAt: now,
    }).where(and(eq(calculationJobs.id, id), eq(calculationJobs.status, "queued"))).returning();
    // A concurrent claim can win this race (status flipped to "running"
    // between our read above and this conditional update) -- fall through
    // to the running-row path below instead of assuming we won.
    if (updated) return cloneJobRecord(updated);
  }

  const [runningUpdate] = await db.update(calculationJobs).set({ cancellationRequested: true, updatedAt: new Date() })
    .where(and(eq(calculationJobs.id, id), eq(calculationJobs.status, "running"))).returning();
  if (runningUpdate) {
    // Abort immediately if this process owns the job; otherwise the next
    // heartbeat (<=HEARTBEAT_INTERVAL_MS) or the lease-expiry reaper
    // observes cancellationRequested and stops it.
    active.get(id)?.controller.abort(new DOMException("Cancelled by request.", "AbortError"));
    return cloneJobRecord(runningUpdate);
  }

  // Already terminal by the time we got here (finished, failed, or
  // cancelled by a concurrent caller) -- cancellation on a terminal job is
  // a no-op, never a restart.
  return getCalculationJob(id, scope);
}

async function heartbeatTick(id: string, controller: AbortController): Promise<void> {
  const db = getDb();
  const [row] = await db.select({ status: calculationJobs.status, cancellationRequested: calculationJobs.cancellationRequested })
    .from(calculationJobs).where(eq(calculationJobs.id, id)).limit(1);
  if (!row || row.status !== "running") return;
  if (row.cancellationRequested && !controller.signal.aborted) {
    controller.abort(new DOMException("Cancelled by request.", "AbortError"));
  }
  await db.update(calculationJobs).set({ leaseExpiresAt: new Date(Date.now() + LEASE_TTL_MS), updatedAt: new Date() })
    .where(and(eq(calculationJobs.id, id), eq(calculationJobs.status, "running")));
}

function isCooperativeCancellation(controller: AbortController, error: unknown): boolean {
  if (!controller.signal.aborted) return false;
  const reason = controller.signal.reason as { name?: string } | undefined;
  if (reason?.name === "AbortError") return true;
  return error instanceof Error && error.name === "AbortError";
}

async function executeJob(id: string): Promise<void> {
  const db = getDb();
  const now = new Date();
  const [claimed] = await db.update(calculationJobs).set({
    status: "running", leaseOwner: WORKER_ID, leaseExpiresAt: new Date(now.getTime() + LEASE_TTL_MS),
    startedAt: now, updatedAt: now,
  }).where(and(eq(calculationJobs.id, id), eq(calculationJobs.status, "queued"))).returning();
  if (!claimed) { active.delete(id); return; } // Already claimed, cancelled, or removed by a concurrent path.

  if (claimed.cancellationRequested) {
    const completedAt = new Date();
    await db.update(calculationJobs).set({
      status: "cancelled", error: "Cancelled before execution began.", completedAt, updatedAt: completedAt,
      leaseOwner: null, leaseExpiresAt: null,
    }).where(and(eq(calculationJobs.id, id), eq(calculationJobs.status, "running")));
    await pruneCalculationJobs().catch((err) => console.warn("[calculationJobService] prune failed:", err));
    active.delete(id);
    return;
  }

  const runner = runners.get(claimed.kind);
  if (!runner) {
    const completedAt = new Date();
    await db.update(calculationJobs).set({
      status: "failed", error: `No calculation runner is registered for kind "${claimed.kind}".`,
      completedAt, updatedAt: completedAt, leaseOwner: null, leaseExpiresAt: null,
    }).where(and(eq(calculationJobs.id, id), eq(calculationJobs.status, "running")));
    active.delete(id);
    return;
  }

  const controller = new AbortController();
  const heartbeat = setInterval(() => { void heartbeatTick(id, controller); }, HEARTBEAT_INTERVAL_MS);
  active.set(id, { controller, heartbeat });
  try {
    const ctx: CalculationJobRunContext = {
      jobId: id,
      userId: claimed.ownerUserId,
      organizationId: claimed.organizationId,
      signal: controller.signal,
      reportProgress: async (progressPct) => {
        const bounded = Math.max(0, Math.min(100, Math.round(progressPct)));
        await db.update(calculationJobs).set({ progressPct: bounded, updatedAt: new Date() })
          .where(and(
            eq(calculationJobs.id, id),
            eq(calculationJobs.status, "running"),
            eq(calculationJobs.leaseOwner, WORKER_ID),
          ));
      },
      isCancellationRequested: async () => {
        const [row] = await db.select({ cancellationRequested: calculationJobs.cancellationRequested })
          .from(calculationJobs).where(eq(calculationJobs.id, id)).limit(1);
        return row?.cancellationRequested ?? false;
      },
    };
    const result = await runner(claimed.input, ctx);
    const completedAt = new Date();
    await db.update(calculationJobs).set({
      status: "succeeded", result: result ?? null, progressPct: 100, completedAt, updatedAt: completedAt,
      leaseOwner: null, leaseExpiresAt: null,
    }).where(and(eq(calculationJobs.id, id), eq(calculationJobs.status, "running")));
  } catch (error) {
    const completedAt = new Date();
    const cancelled = isCooperativeCancellation(controller, error);
    const message = error instanceof Error ? error.message : "Calculation job failed.";
    await db.update(calculationJobs).set({
      status: cancelled ? "cancelled" : "failed",
      error: cancelled ? "Cancelled by request." : message.slice(0, 4000),
      completedAt, updatedAt: completedAt, leaseOwner: null, leaseExpiresAt: null,
    }).where(and(eq(calculationJobs.id, id), eq(calculationJobs.status, "running")));
  } finally {
    clearInterval(heartbeat);
    active.delete(id);
    await pruneCalculationJobs().catch((err) => console.warn("[calculationJobService] prune failed:", err));
    pump();
  }
}

function pump(): void {
  while (active.size < MAX_CONCURRENCY && queue.length) {
    const id = queue.shift()!;
    // Slot reserved the instant pump() decides to launch a job, before any
    // `await` -- executeJob's DB claim is asynchronous, so without this a
    // second pump() call (from a burst of concurrent enqueues) would see
    // `active` still not reflect this job and launch past MAX_CONCURRENCY.
    // Reserved with `null`; executeJob overwrites it with the real
    // controller/heartbeat once the claim resolves, or deletes it if the
    // claim fails/short-circuits before that point.
    active.set(id, null);
    void executeJob(id);
  }
}

// Reclaims a "running" row whose lease has already expired: cancelled jobs
// stay cancelled (never restart), jobs with retry budget left go back to
// "queued", and jobs that have exhausted it go straight to "failed" -- both
// outcomes record why in recoveryReason, distinct from a runner's own error.
async function recoverExpiredLease(job: CalculationJob): Promise<"cancelled" | "requeued" | "failed" | "skipped"> {
  const db = getDb();
  const now = new Date();
  if (job.cancellationRequested) {
    const [updated] = await db.update(calculationJobs).set({
      status: "cancelled", completedAt: now, updatedAt: now, leaseOwner: null, leaseExpiresAt: null,
      error: job.error ?? "Cancelled by request.",
      recoveryReason: "Cancellation was requested while running; applied during restart recovery instead of resuming.",
    }).where(and(eq(calculationJobs.id, job.id), eq(calculationJobs.status, "running"))).returning();
    return updated ? "cancelled" : "skipped";
  }
  if (job.retryCount < job.maxRetries) {
    const [updated] = await db.update(calculationJobs).set({
      status: "queued", retryCount: job.retryCount + 1, startedAt: null, updatedAt: now,
      leaseOwner: null, leaseExpiresAt: null,
      recoveryReason: `Requeued after worker restart: running lease expired without a heartbeat (attempt ${job.retryCount + 1} of ${job.maxRetries}).`,
    }).where(and(eq(calculationJobs.id, job.id), eq(calculationJobs.status, "running"))).returning();
    if (updated) queue.push(updated.id);
    return updated ? "requeued" : "skipped";
  }
  const [updated] = await db.update(calculationJobs).set({
    status: "failed", completedAt: now, updatedAt: now, leaseOwner: null, leaseExpiresAt: null,
    error: "Retry budget exhausted after repeated worker restarts while running.",
    recoveryReason: `Failed after worker restart: lease expired and the retry budget was exhausted (${job.maxRetries} attempt(s) used).`,
  }).where(and(eq(calculationJobs.id, job.id), eq(calculationJobs.status, "running"))).returning();
  return updated ? "failed" : "skipped";
}

async function sweepExpiredLeases(): Promise<number> {
  const db = getDb();
  const now = new Date();
  const orphaned = await db.select().from(calculationJobs).where(and(
    eq(calculationJobs.status, "running"),
    lt(calculationJobs.leaseExpiresAt, now),
  ));
  for (const job of orphaned) {
    // Never touch a row this same process is actively heartbeating -- only
    // rows with no live lease owner in this process are orphaned.
    if (active.has(job.id)) continue;
    await recoverExpiredLease(job);
  }
  return orphaned.length;
}

export async function pruneCalculationJobs(): Promise<{ prunedByAge: number; prunedByRetention: number }> {
  const db = getDb();
  const cutoff = new Date(Date.now() - MAX_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const agedOut = await db.delete(calculationJobs).where(and(
    inArray(calculationJobs.status, TERMINAL_STATUSES as CalculationJobStatus[]),
    lt(calculationJobs.completedAt, cutoff),
  )).returning();

  const owners = await db.selectDistinct({ ownerUserId: calculationJobs.ownerUserId }).from(calculationJobs)
    .where(inArray(calculationJobs.status, TERMINAL_STATUSES as CalculationJobStatus[]));
  let prunedByRetention = 0;
  for (const { ownerUserId } of owners) {
    const rows = await db.select({ id: calculationJobs.id }).from(calculationJobs)
      .where(and(eq(calculationJobs.ownerUserId, ownerUserId), inArray(calculationJobs.status, TERMINAL_STATUSES as CalculationJobStatus[])))
      .orderBy(desc(calculationJobs.completedAt));
    if (rows.length > MAX_TERMINAL_JOBS_PER_OWNER) {
      const excessIds = rows.slice(MAX_TERMINAL_JOBS_PER_OWNER).map((row) => row.id);
      if (excessIds.length) {
        await db.delete(calculationJobs).where(inArray(calculationJobs.id, excessIds));
        prunedByRetention += excessIds.length;
      }
    }
  }
  return { prunedByAge: agedOut.length, prunedByRetention };
}

export async function initializeCalculationJobService(): Promise<void> {
  if (initialized) return;
  initialized = true;
  await sweepExpiredLeases();
  const db = getDb();
  const queued = await db.select({ id: calculationJobs.id }).from(calculationJobs)
    .where(eq(calculationJobs.status, "queued")).orderBy(calculationJobs.queuedAt);
  for (const row of queued) if (!queue.includes(row.id)) queue.push(row.id);
  pump();
  await pruneCalculationJobs().catch((err) => console.warn("[calculationJobService] prune failed:", err));
  if (!reaperHandle) {
    reaperHandle = setInterval(() => { void sweepExpiredLeases().catch((err) => console.warn("[calculationJobService] lease sweep failed:", err)); }, REAPER_INTERVAL_MS);
    reaperHandle.unref?.();
  }
}

export function calculationJobRuntimeStatus() {
  return {
    workerId: WORKER_ID,
    concurrency: MAX_CONCURRENCY,
    active: active.size,
    queued: queue.length,
    registeredKinds: Array.from(runners.keys()),
    retention: { maxDays: MAX_RETENTION_DAYS, maxTerminalPerOwner: MAX_TERMINAL_JOBS_PER_OWNER },
  };
}

/** Test-only: stops the reaper timer and aborts in-flight jobs so a test process can exit cleanly. Not used by runtime code. */
export async function shutdownCalculationJobServiceForTests(): Promise<void> {
  if (reaperHandle) { clearInterval(reaperHandle); reaperHandle = null; }
  for (const [id, runtime] of Array.from(active)) {
    if (!runtime) continue;
    const { controller, heartbeat } = runtime;
    clearInterval(heartbeat);
    controller.abort(new DOMException("Service shutting down.", "AbortError"));
  }
  active.clear();
  queue.length = 0;
  initialized = false;
}
