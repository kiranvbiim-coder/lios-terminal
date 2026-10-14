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
