import assert from "node:assert/strict";
import test from "node:test";
import {
  darwinAvailableMemoryBytes,
  deriveLocalResourceLimits,
  evaluateLocalResourceAdmission,
  type LocalCapacitySnapshot,
} from "./si01ResourceAdmission";

const GiB = 1024 * 1024 * 1024;

function snapshot(overrides: Partial<LocalCapacitySnapshot> = {}): LocalCapacitySnapshot {
  return {
    totalMemoryBytes: 16 * GiB,
    freeMemoryBytes: 10 * GiB,
    totalDiskBytes: 512 * GiB,
    freeDiskBytes: 200 * GiB,
    activeHeavyReservations: 0,
    ...overrides,
  };
}

test("Darwin allocatable capacity includes native reclaimable memory without reducing the admission reserve", () => {
  const output = `The system has ${8 * GiB} (524288 pages with a page size of 16384).\nSystem-wide memory free percentage: 60%`;
  const capacity = darwinAvailableMemoryBytes(output, 8 * GiB);
  assert.equal(capacity, Math.floor(8 * GiB * 0.59));
  const admitted = evaluateLocalResourceAdmission(
    snapshot({ totalMemoryBytes: 8 * GiB, freeMemoryBytes: capacity! }),
    { memoryBytes: 512 * 1024 * 1024, diskBytes: 0, workload: "standard" },
  );
  assert.notEqual(admitted.state, "unavailable");
  assert.equal(admitted.limits.memorySafetyReserveBytes, GiB);
  const pressured = darwinAvailableMemoryBytes(output.replace("60%", "10%"), 8 * GiB);
  assert.equal(evaluateLocalResourceAdmission(
    snapshot({ totalMemoryBytes: 8 * GiB, freeMemoryBytes: pressured! }),
    { memoryBytes: 512 * 1024 * 1024, diskBytes: 0, workload: "standard" },
  ).reason, "insufficient_free_memory");
});

test("malformed or foreign Darwin telemetry cannot grant capacity", () => {
  for (const output of [
    "",
    `The system has ${16 * GiB} bytes\nSystem-wide memory free percentage: 60%`,
    `The system has ${8 * GiB} bytes\nSystem-wide memory free percentage: 101%`,
    `The system has ${8 * GiB} bytes\nSystem-wide memory free percentage: -1%`,
    `The system has ${8 * GiB} bytes\nSystem-wide memory free percentage: unavailable`,
  ]) assert.equal(darwinAvailableMemoryBytes(output, 8 * GiB), null);
});

test("16 GiB Home derives bounded defaults without oversubscribing the machine", () => {
  const limits = deriveLocalResourceLimits(snapshot());
  assert.equal(limits.memorySafetyReserveBytes, 2 * GiB);
  assert.equal(limits.maxSingleJobMemoryBytes, 8 * GiB);
  assert.equal(limits.heavyJobMemoryBudgetBytes, 4 * GiB);
  assert.equal(limits.maxConcurrentHeavyJobs, 2);
  assert.equal(limits.diskSafetyReserveBytes, 10 * GiB);
});

test("resource admission refuses a single job larger than half physical memory", () => {
  const result = evaluateLocalResourceAdmission(snapshot(), {
    memoryBytes: 9 * GiB,
    diskBytes: 0,
    workload: "heavy",
  });
  assert.equal(result.state, "unavailable");
  assert.equal(result.reason, "memory_request_exceeds_home_fraction");
});

test("resource admission preserves memory and disk safety reserves", () => {
  const memory = evaluateLocalResourceAdmission(
    snapshot({ freeMemoryBytes: 3 * GiB }),
    { memoryBytes: 2 * GiB, diskBytes: 0, workload: "standard" },
  );
  assert.equal(memory.state, "unavailable");
  assert.equal(memory.reason, "insufficient_free_memory");

  const disk = evaluateLocalResourceAdmission(
    snapshot({ freeDiskBytes: 11 * GiB }),
    { memoryBytes: 256 * 1024 * 1024, diskBytes: 2 * GiB, workload: "standard" },
  );
  assert.equal(disk.state, "unavailable");
  assert.equal(disk.reason, "insufficient_free_disk");
});

test("heavy-job reservations refuse oversubscription instead of silently queuing/running", () => {
  const value = snapshot({ activeHeavyReservations: 2 });
  const result = evaluateLocalResourceAdmission(value, {
    memoryBytes: 1 * GiB,
    diskBytes: 0,
    workload: "heavy",
  });
  assert.equal(result.limits.maxConcurrentHeavyJobs, 2);
  assert.equal(result.state, "unavailable");
  assert.equal(result.reason, "heavy_job_capacity_exhausted");
});

test("near-reserve operations are explicit degraded admissions", () => {
  const result = evaluateLocalResourceAdmission(
    snapshot({ freeMemoryBytes: 5 * GiB }),
    { memoryBytes: 1.5 * GiB, diskBytes: 0, workload: "standard" },
  );
  assert.equal(result.state, "degraded");
  assert.equal(result.reason, "low_post_admission_memory");
});

test("normal local operation is admitted with projected secret-free capacity facts", () => {
  const result = evaluateLocalResourceAdmission(snapshot(), {
    memoryBytes: 512 * 1024 * 1024,
    diskBytes: 128 * 1024 * 1024,
    workload: "standard",
  });
  assert.equal(result.state, "ready");
  assert.equal(result.reason, "ok");
  assert.equal(result.projected.freeMemoryAfterBytes, 9.5 * GiB);
  assert.equal(result.projected.freeDiskAfterBytes, 199.875 * GiB);
});

test("unknown disk capacity fails closed when the operation declares disk demand", () => {
  const result = evaluateLocalResourceAdmission(
    snapshot({ totalDiskBytes: null, freeDiskBytes: null }),
    { memoryBytes: 512 * 1024 * 1024, diskBytes: 50 * GiB, workload: "standard" },
  );
  assert.equal(result.state, "unavailable");
  assert.equal(result.reason, "capacity_probe_unavailable");
  assert.equal(result.limits.diskSafetyReserveBytes, null);
  assert.equal(result.projected.freeDiskAfterBytes, null);

  const noDiskDemand = evaluateLocalResourceAdmission(
    snapshot({ totalDiskBytes: null, freeDiskBytes: null }),
    { memoryBytes: 512 * 1024 * 1024, diskBytes: 0, workload: "standard" },
  );
  assert.equal(noDiskDemand.state, "ready");
});

test("invalid capacity snapshots fail closed", () => {
  assert.throws(
    () => deriveLocalResourceLimits(snapshot({ freeMemoryBytes: 17 * GiB })),
    /Memory capacity snapshot is invalid/,
  );
  assert.throws(
    () => deriveLocalResourceLimits(snapshot({ freeDiskBytes: 513 * GiB })),
    /Disk capacity snapshot is invalid/,
  );
});
