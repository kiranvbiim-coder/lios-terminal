import assert from "node:assert/strict";
import test from "node:test";
import {
  LocalResourceAdmissionError,
  LocalResourceReservationPool,
} from "./si01ResourceReservation";
import type { LocalCapacitySnapshot } from "./si01ResourceAdmission";

const GiB = 1024 * 1024 * 1024;

function capacity(activeHeavyReservations: number): LocalCapacitySnapshot {
  return {
    totalMemoryBytes: 8 * GiB,
    freeMemoryBytes: 4 * GiB,
    totalDiskBytes: 256 * GiB,
    freeDiskBytes: 100 * GiB,
    activeHeavyReservations,
  };
}

const heavy = { memoryBytes: 1 * GiB, diskBytes: 0, workload: "heavy" as const };

test("atomic heavy reservation admits exactly one job at capacity one", () => {
  const pool = new LocalResourceReservationPool((active) => capacity(active));
  const first = pool.acquire(heavy);
  assert.equal(pool.activeHeavyReservations, 1);
  assert.throws(
    () => pool.acquire(heavy),
    (error: unknown) => error instanceof LocalResourceAdmissionError
      && error.admission.reason === "heavy_job_capacity_exhausted",
  );
  first.release();
  assert.equal(pool.activeHeavyReservations, 0);
});

test("reservation release is idempotent and cannot inflate capacity", () => {
  const pool = new LocalResourceReservationPool((active) => capacity(active));
  const reservation = pool.acquire(heavy);
  reservation.release();
  reservation.release();
  assert.equal(pool.activeHeavyReservations, 0);

  const again = pool.acquire(heavy);
  assert.equal(pool.activeHeavyReservations, 1);
  assert.throws(() => pool.acquire(heavy), LocalResourceAdmissionError);
  again.release();
});

test("light and standard admissions do not consume heavy reservation slots", () => {
  const pool = new LocalResourceReservationPool((active) => capacity(active));
  const light = pool.acquire({ memoryBytes: 256 * 1024 * 1024, diskBytes: 0, workload: "light" });
  const standard = pool.acquire({ memoryBytes: 512 * 1024 * 1024, diskBytes: 0, workload: "standard" });
  assert.equal(pool.activeHeavyReservations, 0);
  light.release();
  standard.release();
  assert.equal(pool.activeHeavyReservations, 0);
});

test("a fresh process-local pool starts with no stale reservations", () => {
  const firstPool = new LocalResourceReservationPool((active) => capacity(active));
  firstPool.acquire(heavy);
  assert.equal(firstPool.activeHeavyReservations, 1);

  const restartedPool = new LocalResourceReservationPool((active) => capacity(active));
  assert.equal(restartedPool.activeHeavyReservations, 0);
  const admitted = restartedPool.acquire(heavy);
  admitted.release();
});

test("unavailable hardware admission throws before a reservation is consumed", () => {
  const pool = new LocalResourceReservationPool((active) => ({
    ...capacity(active),
    freeMemoryBytes: Math.floor(1.5 * GiB),
  }));
  assert.throws(
    () => pool.acquire(heavy),
    (error: unknown) => error instanceof LocalResourceAdmissionError
      && error.admission.reason === "insufficient_free_memory",
  );
  assert.equal(pool.activeHeavyReservations, 0);
});

test("SI-07.18 all admitted standard jobs reserve memory before the OS reflects allocations", () => {
  const pool = new LocalResourceReservationPool((active) => capacity(active));
  const memoryJob = { memoryBytes: 1 * GiB, diskBytes: 0, workload: "standard" as const };
  const first = pool.acquire(memoryJob);
  const second = pool.acquire(memoryJob);
  const third = pool.acquire(memoryJob);
  assert.equal(pool.reservedMemoryBytes, 3 * GiB);
  assert.equal(pool.activeHeavyReservations, 0);
  assert.throws(
    () => pool.acquire(memoryJob),
    (error: unknown) => error instanceof LocalResourceAdmissionError
      && error.admission.reason === "insufficient_free_memory",
    "cumulative reservations may never consume the safety floor",
  );
  second.release();
  assert.equal(pool.reservedMemoryBytes, 2 * GiB);
  const replacement = pool.acquire(memoryJob);
  assert.equal(pool.reservedMemoryBytes, 3 * GiB);
  for (const job of [first, second, third, replacement]) job.release();
  assert.equal(pool.reservedMemoryBytes, 0);
});

test("SI-07.18 cumulative disk reservations preserve disk safety even across light and standard jobs", () => {
  const pool = new LocalResourceReservationPool((active) => capacity(active));
  const first = pool.acquire({ memoryBytes: 0, diskBytes: 45 * GiB, workload: "light" });
  const second = pool.acquire({ memoryBytes: 0, diskBytes: 45 * GiB, workload: "standard" });
  assert.equal(pool.reservedDiskBytes, 90 * GiB);
  assert.throws(
    () => pool.acquire({ memoryBytes: 0, diskBytes: 1 * GiB, workload: "standard" }),
    (error: unknown) => error instanceof LocalResourceAdmissionError
      && error.admission.reason === "insufficient_free_disk",
  );
  first.release();
  assert.equal(pool.reservedDiskBytes, 45 * GiB);
  const another = pool.acquire({ memoryBytes: 0, diskBytes: 1 * GiB, workload: "standard" });
  another.release();
  second.release();
  assert.equal(pool.reservedDiskBytes, 0);
});

test("SI-07.18 heavy admissions see byte reservations made by lighter workloads", () => {
  const pool = new LocalResourceReservationPool((active) => capacity(active));
  const standard = pool.acquire({ memoryBytes: Math.floor(2.5 * GiB), diskBytes: 0, workload: "standard" });
  assert.equal(pool.reservedMemoryBytes, Math.floor(2.5 * GiB));
  assert.throws(
    () => pool.acquire({ memoryBytes: 0, diskBytes: 0, workload: "heavy" }),
    (error: unknown) => error instanceof LocalResourceAdmissionError
      && error.admission.reason === "heavy_job_capacity_exhausted",
  );
  standard.release();
  const heavyJob = pool.acquire({ memoryBytes: 1 * GiB, diskBytes: 2 * GiB, workload: "heavy" });
  assert.equal(pool.activeHeavyReservations, 1);
  assert.equal(pool.reservedMemoryBytes, 1 * GiB);
  assert.equal(pool.reservedDiskBytes, 2 * GiB);
  heavyJob.release();
  assert.deepEqual([pool.activeHeavyReservations, pool.reservedMemoryBytes, pool.reservedDiskBytes], [0, 0, 0]);
});

test("SI-07.18 released reservations are idempotent and isolated from mutated request objects", () => {
  const pool = new LocalResourceReservationPool((active) => capacity(active));
  const request = { memoryBytes: 512 * 1024 * 1024, diskBytes: 1 * GiB, workload: "standard" as const };
  const reservation = pool.acquire(request);
  request.memoryBytes = 0;
  request.diskBytes = 0;
  reservation.release();
  reservation.release();
  assert.equal(pool.reservedMemoryBytes, 0);
  assert.equal(pool.reservedDiskBytes, 0);
  assert.equal(pool.activeHeavyReservations, 0);
});

test("SI-07.18 failed admission has no side effects and a new pool has no ghost byte claims", () => {
  const pool = new LocalResourceReservationPool((active) => capacity(active));
  const existing = pool.acquire({ memoryBytes: 2 * GiB, diskBytes: 45 * GiB, workload: "standard" });
  const before = [pool.reservedMemoryBytes, pool.reservedDiskBytes, pool.activeHeavyReservations];
  assert.throws(() => pool.acquire({ memoryBytes: 2 * GiB, diskBytes: 1 * GiB, workload: "standard" }), LocalResourceAdmissionError);
  assert.deepEqual([pool.reservedMemoryBytes, pool.reservedDiskBytes, pool.activeHeavyReservations], before);
  const restarted = new LocalResourceReservationPool((active) => capacity(active));
  assert.deepEqual([restarted.reservedMemoryBytes, restarted.reservedDiskBytes, restarted.activeHeavyReservations], [0, 0, 0]);
  existing.release();
  assert.deepEqual([pool.reservedMemoryBytes, pool.reservedDiskBytes], [0, 0]);
});
