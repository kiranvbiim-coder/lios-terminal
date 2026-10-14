import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { calculationJobs, users, organizations } from "@shared/schema";

// db.ts freezes its PGLITE_DIR the instant it's first imported, including
// transitively through a static `import { ... } from "./calculationJobService"`
// at this file's own top level -- same isolation requirement documented in
// entityResolver.test.ts and financialStatementsConflictStore.test.ts.
// @shared/schema and drizzle-orm have no such side effect (no env reads, no
// ./db import), so only the two modules that actually touch ./db are
// deferred until after LIMURIA_DATA_DIR points at an isolated temp dir.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-calc-job-"));
process.env.LIMURIA_DATA_DIR = dataDir;
// Single in-process worker slot: with concurrency 1, a second enqueued job
// deterministically stays "queued" behind whatever the first job is doing,
// which is exactly the state the queued-cancellation and restart-recovery
// tests below need to set up without racing real timers.
process.env.CALCULATION_JOB_CONCURRENCY = "1";
process.env.CALCULATION_JOB_RETENTION_DAYS = "30";
process.env.CALCULATION_JOB_MAX_PER_OWNER = "3";

const {
  enqueueCalculationJob,
  getCalculationJob,
  listCalculationJobs,
  requestCalculationJobCancellation,
  registerCalculationJobRunner,
  resetCalculationJobRunnersForTests,
  pruneCalculationJobs,
  initializeCalculationJobService,
  shutdownCalculationJobServiceForTests,
} = await import("./calculationJobService");
const { initDb, closeDb, getDb } = await import("./db");

type Status = "queued" | "running" | "succeeded" | "failed" | "cancelled";
type Scope = { userId: number; includeOrganization?: boolean; organizationId?: number | null };

// This project's tests run under plain `node:test` on Node 20 (no
// Promise.withResolvers -- added in Node 22 -- and no fake-timer library
// such as vitest's), so a controllable gate is built with the executor form
// and cross-test synchronization polls a real, DB-persisted condition
// instead of guessing a sleep duration.
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function waitForStatus(id: string, statuses: Status[], scope: Scope, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await getCalculationJob(id, scope);
    if (job && statuses.includes(job.status)) return job;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for job ${id} to reach one of ${statuses.join(",")} (last: ${job?.status})`);
    // Polling a real DB-persisted status, not a guessed fixed delay -- the
    // job runs on a fire-and-forget queue by design (see
    // calculationJobService.ts's enqueueCalculationJob), so there is no
    // promise this test can `await` directly without changing that contract.
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("durable calculation job service", async (t) => {
  await initDb();
  t.after(async () => {
    await shutdownCalculationJobServiceForTests();
    resetCalculationJobRunnersForTests();
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const db = getDb();
  const [userA] = await db.insert(users).values({ email: "calc-job-a@example.test", passwordHash: "test", role: "internal_analyst", name: "Owner A" }).returning();
  const [userB] = await db.insert(users).values({ email: "calc-job-b@example.test", passwordHash: "test", role: "internal_analyst", name: "Owner B" }).returning();
  const [orgOne] = await db.insert(organizations).values({ name: "Org One", slug: "calc-job-org-one" }).returning();
  const [orgTwo] = await db.insert(organizations).values({ name: "Org Two", slug: "calc-job-org-two" }).returning();
  const scopeA: Scope = { userId: userA.id };
  const scopeB: Scope = { userId: userB.id };

  await t.test("succeeded terminal state persists result, progress, and cloned reads", async () => {
    let reportedProgress = 0;
    registerCalculationJobRunner("terminal-success", async (input: { x: number }, ctx) => {
      await ctx.reportProgress(42);
      reportedProgress = 42;
      return { doubled: input.x * 2 };
    });
    const created = await enqueueCalculationJob("terminal-success", { x: 21 }, { userId: userA.id, organizationId: null });
    const finished = await waitForStatus(created.id, ["succeeded"], scopeA);
    assert.equal(finished.status, "succeeded");
    assert.equal(reportedProgress, 42);
    assert.equal(finished.progressPct, 100);
    assert.deepEqual(finished.result, { doubled: 42 });
    assert.equal(finished.error, null);

    const first = await getCalculationJob(created.id, scopeA);
    // Mutating the returned row's result must never corrupt a later read
    // (clone-on-read) -- the cast documents the shape this test itself
    // produced above, not an unchecked assumption about external input.
    const firstResult = first!.result as { doubled: number };
    firstResult.doubled = -1;
    const second = await getCalculationJob(created.id, scopeA);
    assert.deepEqual(second!.result, { doubled: 42 });
  });

  await t.test("failed terminal state records the runner's error message", async () => {
    registerCalculationJobRunner("terminal-failure", async () => { throw new Error("division by zero in risk model"); });
    const created = await enqueueCalculationJob("terminal-failure", {}, { userId: userA.id, organizationId: null });
    const finished = await waitForStatus(created.id, ["failed"], scopeA);
    assert.equal(finished.status, "failed");
    assert.equal(finished.error, "division by zero in risk model");
    assert.equal(finished.result, null);
  });

  await t.test("burst enqueue never exceeds configured concurrency even when jobs are enqueued concurrently", async () => {
    let concurrentRunners = 0;
    let peakConcurrentRunners = 0;
    registerCalculationJobRunner("burst-block", async () => {
      concurrentRunners += 1;
      peakConcurrentRunners = Math.max(peakConcurrentRunners, concurrentRunners);
      // Yield without a real timer so overlapping invocations (if the
      // concurrency guard fails) actually overlap in this run instead of
      // finishing before the next one starts.
      await Promise.resolve().then(() => Promise.resolve());
      concurrentRunners -= 1;
      return { ok: true };
    });

    // Three concurrent enqueues (not sequential awaits) is the shape that
    // raced pump() against executeJob's async DB claim before the slot was
    // reserved synchronously: each enqueueCalculationJob call pushes onto
    // the queue and calls pump() right after its own insert resolves, and
    // without a synchronous reservation several pump() calls could each
    // see the concurrency slot as free before any of them had actually
    // claimed a job.
    const created = await Promise.all(
      Array.from({ length: 3 }, (_, i) => enqueueCalculationJob("burst-block", { i }, { userId: userA.id, organizationId: null })),
    );
    for (const job of created) await waitForStatus(job.id, ["succeeded"], scopeA);

    assert.ok(
      peakConcurrentRunners <= Number(process.env.CALCULATION_JOB_CONCURRENCY),
      `peak concurrent runners ${peakConcurrentRunners} exceeded configured concurrency ${process.env.CALCULATION_JOB_CONCURRENCY}`,
    );
  });

  await t.test("cancelling a queued job before it is claimed marks it cancelled without ever running the runner", async () => {
    const blockGate = deferred<void>();
    let runnerInvocations = 0;
    registerCalculationJobRunner("queued-block", async () => { runnerInvocations += 1; await blockGate.promise; return { ok: true }; });
    registerCalculationJobRunner("queued-cancel-target", async () => { throw new Error("must never run: cancelled while still queued"); });

    const blocker = await enqueueCalculationJob("queued-block", {}, { userId: userA.id, organizationId: null });
    await waitForStatus(blocker.id, ["running"], scopeA);
    const target = await enqueueCalculationJob("queued-cancel-target", {}, { userId: userA.id, organizationId: null });
    const stillQueued = await getCalculationJob(target.id, scopeA);
    assert.equal(stillQueued!.status, "queued", "concurrency=1 with the blocker running must leave the second job queued");

    const cancelled = await requestCalculationJobCancellation(target.id, scopeA);
    assert.equal(cancelled!.status, "cancelled");
    assert.equal(cancelled!.error, "Cancelled before execution began.");

    blockGate.resolve();
    await waitForStatus(blocker.id, ["succeeded"], scopeA);
    assert.equal(runnerInvocations, 1, "the cancelled-while-queued job's runner must never have been invoked");
  });

  await t.test("cancelling a running job aborts its signal and the job settles as cancelled, idempotently", async () => {
    const reachedRunning = deferred<void>();
    registerCalculationJobRunner("running-cancel", async (_input, ctx) => {
      reachedRunning.resolve();
      await new Promise<void>((_resolve, reject) => {
        ctx.signal.addEventListener("abort", () => reject(new DOMException("Cancelled by request.", "AbortError")));
      });
    });
    const created = await enqueueCalculationJob("running-cancel", {}, { userId: userA.id, organizationId: null });
    await reachedRunning.promise;
    await waitForStatus(created.id, ["running"], scopeA);

    const firstCancel = await requestCalculationJobCancellation(created.id, scopeA);
    assert.equal(firstCancel!.status, "running", "cancellation is cooperative -- the row flips to cancelled once the runner observes the abort");
    assert.equal(firstCancel!.cancellationRequested, true);

    const finished = await waitForStatus(created.id, ["cancelled"], scopeA);
    assert.equal(finished.status, "cancelled");

    const secondCancel = await requestCalculationJobCancellation(created.id, scopeA);
    assert.equal(secondCancel!.status, "cancelled", "cancelling an already-terminal job is a no-op, not an error");
  });

  await t.test("cancelling an already-succeeded job is a no-op and never resurrects it", async () => {
    registerCalculationJobRunner("already-done", async () => ({ ok: true }));
    const created = await enqueueCalculationJob("already-done", {}, { userId: userA.id, organizationId: null });
    await waitForStatus(created.id, ["succeeded"], scopeA);
    const result = await requestCalculationJobCancellation(created.id, scopeA);
    assert.equal(result!.status, "succeeded");
  });

  await t.test("owner isolation: a different user cannot read, list, or cancel another owner's job", async () => {
    registerCalculationJobRunner("owner-isolated", async () => ({ ok: true }));
    const created = await enqueueCalculationJob("owner-isolated", {}, { userId: userA.id, organizationId: null });
    await waitForStatus(created.id, ["succeeded"], scopeA);

    assert.equal(await getCalculationJob(created.id, scopeB), null);
    const listedByB = await listCalculationJobs(scopeB, { kind: "owner-isolated" });
    assert.equal(listedByB.length, 0);
    assert.equal(await requestCalculationJobCancellation(created.id, scopeB), null);

    const listedByA = await listCalculationJobs(scopeA, { kind: "owner-isolated" });
    assert.equal(listedByA.length, 1);
    assert.equal(listedByA[0].id, created.id);
  });

  await t.test("organization isolation: only a compliance-style scope for the matching org sees another owner's org-scoped job", async () => {
    registerCalculationJobRunner("org-scoped", async () => ({ ok: true }));
    const created = await enqueueCalculationJob("org-scoped", {}, { userId: userA.id, organizationId: orgOne.id });
    await waitForStatus(created.id, ["succeeded"], scopeA);

    // userB, no organization widening at all -- must not see it despite being a valid internal user.
    assert.equal(await getCalculationJob(created.id, scopeB), null);

    // userB scoped to the *wrong* organization must still not see it.
    const wrongOrgScope: Scope = { userId: userB.id, includeOrganization: true, organizationId: orgTwo.id };
    assert.equal(await getCalculationJob(created.id, wrongOrgScope), null);

    // userB scoped to the *matching* organization (e.g. an internal_compliance
    // reviewer looking at orgOne's jobs) can see it despite not owning it.
    const rightOrgScope: Scope = { userId: userB.id, includeOrganization: true, organizationId: orgOne.id };
    const viaOrg = await getCalculationJob(created.id, rightOrgScope);
    assert.equal(viaOrg!.id, created.id);
    const listedViaOrg = await listCalculationJobs(rightOrgScope, { kind: "org-scoped" });
    assert.equal(listedViaOrg.length, 1);
  });

  await t.test("retention prunes terminal jobs beyond the per-owner cap, keeping the most recent", async () => {
    registerCalculationJobRunner("retention-cap", async () => ({ ok: true }));
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const created = await enqueueCalculationJob("retention-cap", { i }, { userId: userA.id, organizationId: null });
      await waitForStatus(created.id, ["succeeded"], scopeA);
      // Force distinct completedAt ordering (real-clock timestamps within
      // the same test can otherwise collide at millisecond resolution).
      await db.update(calculationJobs).set({ completedAt: new Date(Date.now() + i) }).where(eq(calculationJobs.id, created.id));
      ids.push(created.id);
    }
    // Retention already ran automatically after each job's own completion
    // (see calculationJobService.ts's executeJob finally block), so the cap
    // is already converged before any explicit call here -- a fresh call
    // must therefore be idempotent (nothing left to prune).
    const totalForOwner = await db.select({ id: calculationJobs.id }).from(calculationJobs).where(eq(calculationJobs.ownerUserId, userA.id));
    assert.equal(totalForOwner.length, 3, "automatic post-completion pruning must already cap this owner's terminal rows at CALCULATION_JOB_MAX_PER_OWNER");
    const { prunedByRetention } = await pruneCalculationJobs();
    assert.equal(prunedByRetention, 0, "an explicit prune after automatic pruning already converged should have nothing left to do");
    const remaining = await listCalculationJobs(scopeA, { kind: "retention-cap", limit: 50 });
    assert.equal(remaining.length, 3, "at most CALCULATION_JOB_MAX_PER_OWNER terminal rows should survive for this kind");
    const survivingIds = new Set(remaining.map((job) => job.id));
    assert.ok(survivingIds.has(ids[4]) && survivingIds.has(ids[3]) && survivingIds.has(ids[2]), "the most recently completed jobs must be the ones retained");
    assert.ok(!survivingIds.has(ids[0]) && !survivingIds.has(ids[1]), "the oldest completed jobs must have been pruned");
  });

  await t.test("retention prunes terminal jobs past the age cutoff but never touches queued/running jobs", async () => {
    registerCalculationJobRunner("retention-age", async () => ({ ok: true }));
    const aged = await enqueueCalculationJob("retention-age", {}, { userId: userA.id, organizationId: null });
    await waitForStatus(aged.id, ["succeeded"], scopeA);
    const ancient = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await db.update(calculationJobs).set({ completedAt: ancient }).where(eq(calculationJobs.id, aged.id));

    const fresh = await enqueueCalculationJob("retention-age", {}, { userId: userA.id, organizationId: null });
    await waitForStatus(fresh.id, ["succeeded"], scopeA);

    // A queued row with an old queuedAt must never be pruned by age -- only
    // completedAt on terminal rows drives age-based retention.
    const [neverStarted] = await db.insert(calculationJobs).values({
      id: crypto.randomUUID(), kind: "retention-age", input: {}, status: "queued",
      ownerUserId: userA.id, queuedAt: ancient,
    }).returning();

    await pruneCalculationJobs();
    assert.equal(await getCalculationJob(aged.id, scopeA), null, "a terminal job past the retention window must be pruned");
    assert.ok(await getCalculationJob(fresh.id, scopeA), "a recent terminal job must survive");
    assert.ok(await getCalculationJob(neverStarted.id, scopeA), "a non-terminal job must never be pruned regardless of age");

    // Clean up the never-started fixture row directly -- it has no runner
    // awaited by this test and would otherwise dangle in "queued" forever.
    await db.delete(calculationJobs).where(eq(calculationJobs.id, neverStarted.id));
  });

  await t.test("restart recovery resumes a job that was persisted as queued but never claimed before the crash", async () => {
    registerCalculationJobRunner("restart-resume-queued", async () => ({ recovered: true }));
    const [inserted] = await db.insert(calculationJobs).values({
      id: crypto.randomUUID(), kind: "restart-resume-queued", input: {}, status: "queued", ownerUserId: userA.id,
    }).returning();

    await shutdownCalculationJobServiceForTests();
    await initializeCalculationJobService();

    const finished = await waitForStatus(inserted.id, ["succeeded"], scopeA);
    assert.deepEqual(finished.result, { recovered: true });
  });

  await t.test("restart recovery requeues a running job whose lease expired, with an explicit recovery reason", async () => {
    registerCalculationJobRunner("restart-requeue", async () => ({ recovered: true }));
    const [inserted] = await db.insert(calculationJobs).values({
      id: crypto.randomUUID(), kind: "restart-requeue", input: {}, status: "running",
      ownerUserId: userA.id, leaseOwner: "stale-worker-from-a-previous-process",
      leaseExpiresAt: new Date(Date.now() - 60_000), startedAt: new Date(Date.now() - 90_000),
      retryCount: 0, maxRetries: 2,
    }).returning();

    await shutdownCalculationJobServiceForTests();
    await initializeCalculationJobService();

    const finished = await waitForStatus(inserted.id, ["succeeded"], scopeA);
    assert.equal(finished.retryCount, 1);
    assert.match(finished.recoveryReason ?? "", /Requeued after worker restart/);
    assert.deepEqual(finished.result, { recovered: true });
  });

  await t.test("restart recovery fails a running job outright once its retry budget is exhausted", async () => {
    const [inserted] = await db.insert(calculationJobs).values({
      id: crypto.randomUUID(), kind: "restart-exhausted", input: {}, status: "running",
      ownerUserId: userA.id, leaseOwner: "stale-worker-from-a-previous-process",
      leaseExpiresAt: new Date(Date.now() - 60_000), startedAt: new Date(Date.now() - 90_000),
      retryCount: 2, maxRetries: 2,
    }).returning();

    await shutdownCalculationJobServiceForTests();
    await initializeCalculationJobService();

    const job = await waitForStatus(inserted.id, ["failed"], scopeA);
    assert.match(job.error ?? "", /Retry budget exhausted/);
    assert.match(job.recoveryReason ?? "", /retry budget was exhausted/);
  });

  await t.test("restart recovery never resumes a job that had a cancellation request in flight -- it settles cancelled", async () => {
    const [inserted] = await db.insert(calculationJobs).values({
      id: crypto.randomUUID(), kind: "restart-cancelled", input: {}, status: "running",
      ownerUserId: userA.id, leaseOwner: "stale-worker-from-a-previous-process",
      leaseExpiresAt: new Date(Date.now() - 60_000), startedAt: new Date(Date.now() - 90_000),
      cancellationRequested: true, retryCount: 0, maxRetries: 2,
    }).returning();

    await shutdownCalculationJobServiceForTests();
    await initializeCalculationJobService();

    const job = await waitForStatus(inserted.id, ["cancelled"], scopeA, 2000);
    assert.match(job.recoveryReason ?? "", /Cancellation was requested while running/);

    // Prove it truly never restarts: run a second recovery pass (as a
    // second server restart would) and confirm it is left alone.
    await shutdownCalculationJobServiceForTests();
    await initializeCalculationJobService();
    const stillCancelled = await getCalculationJob(inserted.id, scopeA);
    assert.equal(stillCancelled!.status, "cancelled");
  });
});
