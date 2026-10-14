import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { dataRoot } from "./dataRoot";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

export type LocalResourceAdmissionState = "ready" | "degraded" | "unavailable";

export type LocalResourceReason =
  | "ok"
  | "memory_request_exceeds_home_fraction"
  | "insufficient_free_memory"
  | "insufficient_free_disk"
  | "heavy_job_capacity_exhausted"
  | "low_post_admission_memory"
  | "low_post_admission_disk"
  | "capacity_probe_unavailable";

export interface LocalCapacitySnapshot {
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  totalDiskBytes: number | null;
  freeDiskBytes: number | null;
  activeHeavyReservations: number;
}

export interface LocalResourceRequest {
  memoryBytes: number;
  diskBytes: number;
  workload: "light" | "standard" | "heavy";
}

export interface LocalResourceAdmission {
  state: LocalResourceAdmissionState;
  reason: LocalResourceReason;
  detail: string;
  limits: {
    maxSingleJobMemoryBytes: number;
    heavyJobMemoryBudgetBytes: number;
    maxConcurrentHeavyJobs: number;
    memorySafetyReserveBytes: number;
    diskSafetyReserveBytes: number | null;
  };
  projected: {
    freeMemoryAfterBytes: number;
    freeDiskAfterBytes: number | null;
  };
}

function safePositive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function deriveLocalResourceLimits(
  snapshot: Pick<LocalCapacitySnapshot, "totalMemoryBytes" | "freeMemoryBytes" | "totalDiskBytes" | "freeDiskBytes">,
) {
  const totalMemory = safePositive(snapshot.totalMemoryBytes, "totalMemoryBytes");
  const freeMemory = safePositive(snapshot.freeMemoryBytes, "freeMemoryBytes");
  if (totalMemory === 0 || freeMemory > totalMemory) {
    throw new Error("Memory capacity snapshot is invalid.");
  }

  // Keep a meaningful floor for the desktop/server itself. On a 16 GiB Mac
  // this reserves 2 GiB; on smaller machines it reserves at least 512 MiB.
  const memorySafetyReserveBytes = clamp(
    Math.floor(totalMemory * 0.125),
    512 * MIB,
    2 * GIB,
  );

  // A single LiOS job may never plan to consume more than 50% of physical
  // memory. Heavy jobs use a smaller hardware-aware default envelope.
  const maxSingleJobMemoryBytes = Math.floor(totalMemory * 0.5);
  const heavyJobMemoryBudgetBytes = clamp(
    Math.floor(totalMemory * 0.25),
    512 * MIB,
    4 * GIB,
  );
  const usableFreeMemory = Math.max(0, freeMemory - memorySafetyReserveBytes);
  const maxConcurrentHeavyJobs = Math.max(
    0,
    Math.min(4, Math.floor(usableFreeMemory / heavyJobMemoryBudgetBytes)),
  );

  let diskSafetyReserveBytes: number | null = null;
  if (snapshot.totalDiskBytes !== null && snapshot.freeDiskBytes !== null) {
    const totalDisk = safePositive(snapshot.totalDiskBytes, "totalDiskBytes");
    const freeDisk = safePositive(snapshot.freeDiskBytes, "freeDiskBytes");
    if (totalDisk === 0 || freeDisk > totalDisk) {
      throw new Error("Disk capacity snapshot is invalid.");
    }
    diskSafetyReserveBytes = clamp(
      Math.floor(totalDisk * 0.05),
      512 * MIB,
      10 * GIB,
    );
  }

  return Object.freeze({
    maxSingleJobMemoryBytes,
    heavyJobMemoryBudgetBytes,
    maxConcurrentHeavyJobs,
    memorySafetyReserveBytes,
    diskSafetyReserveBytes,
  });
}

export function evaluateLocalResourceAdmission(
  snapshot: LocalCapacitySnapshot,
  request: LocalResourceRequest,
): LocalResourceAdmission {
  const memoryBytes = safePositive(request.memoryBytes, "memoryBytes");
  const diskBytes = safePositive(request.diskBytes, "diskBytes");
  const limits = deriveLocalResourceLimits(snapshot);
  const freeMemoryAfterBytes = snapshot.freeMemoryBytes - memoryBytes;
  const freeDiskAfterBytes =
    snapshot.freeDiskBytes === null ? null : snapshot.freeDiskBytes - diskBytes;

  const result = (
    state: LocalResourceAdmissionState,
    reason: LocalResourceReason,
    detail: string,
  ): LocalResourceAdmission => Object.freeze({
    state,
    reason,
    detail,
    limits,
    projected: Object.freeze({
      freeMemoryAfterBytes,
      freeDiskAfterBytes,
    }),
  });

  if (memoryBytes > limits.maxSingleJobMemoryBytes) {
    return result(
      "unavailable",
      "memory_request_exceeds_home_fraction",
      "Requested memory exceeds the maximum safe single-job fraction of this Home.",
    );
  }

  if (freeMemoryAfterBytes < limits.memorySafetyReserveBytes) {
    return result(
      "unavailable",
      "insufficient_free_memory",
      "Starting this operation would consume the Home's memory safety reserve.",
    );
  }

  if (
    diskBytes > 0 &&
    (freeDiskAfterBytes === null || limits.diskSafetyReserveBytes === null)
  ) {
    return result(
      "unavailable",
      "capacity_probe_unavailable",
      "Disk capacity could not be proven for an operation that requires local disk space.",
    );
  }

  if (
    freeDiskAfterBytes !== null &&
    limits.diskSafetyReserveBytes !== null &&
    freeDiskAfterBytes < limits.diskSafetyReserveBytes
  ) {
    return result(
      "unavailable",
      "insufficient_free_disk",
      "Starting this operation would consume the Home's disk safety reserve.",
    );
  }

  if (
    request.workload === "heavy" &&
    snapshot.activeHeavyReservations >= limits.maxConcurrentHeavyJobs
  ) {
    return result(
      "unavailable",
      "heavy_job_capacity_exhausted",
      "All hardware-aware heavy-job reservations are already in use.",
    );
  }

  if (freeMemoryAfterBytes < limits.memorySafetyReserveBytes * 2) {
    return result(
      "degraded",
      "low_post_admission_memory",
      "Operation fits, but the Home will have limited free memory afterwards.",
    );
  }

  if (
    freeDiskAfterBytes !== null &&
    limits.diskSafetyReserveBytes !== null &&
    freeDiskAfterBytes < limits.diskSafetyReserveBytes * 2
  ) {
    return result(
      "degraded",
      "low_post_admission_disk",
      "Operation fits, but the Home will have limited free disk afterwards.",
    );
  }

  return result("ready", "ok", "Local capacity satisfies the requested preflight.");
}

/** Darwin's free-page count excludes reclaimable capacity; use its read-only kernel pressure query. */
export function darwinAvailableMemoryBytes(output: string, totalMemoryBytes: number): number | null {
  const physical = /^The system has (\d+) /m.exec(output);
  const free = /^System-wide memory free percentage: (\d+)%$/m.exec(output);
  if (!physical || !free || Number(physical[1]) !== totalMemoryBytes) return null;
  const percentage = Number(free[1]);
  if (!Number.isSafeInteger(percentage) || percentage < 0 || percentage > 100) return null;
  // The native query rounds to an integer percentage. Subtract one point before applying the unchanged safety reserve.
  return Math.floor(totalMemoryBytes * Math.max(0, percentage - 1) / 100);
}

function availableMemoryBytes(totalMemoryBytes: number): number {
  const freePages = os.freemem();
  if (process.platform !== "darwin") return freePages;
  // Fixed system telemetry, not a user/model-selected command; no inherited loader variables or shell.
  const query = spawnSync("/usr/bin/memory_pressure", ["-Q"], {
    encoding: "utf8", timeout: 1_000, maxBuffer: 16 * 1024,
    env: { LANG: "C", LC_ALL: "C" },
  });
  if (query.status !== 0 || query.error) return freePages;
  return darwinAvailableMemoryBytes(query.stdout, totalMemoryBytes) ?? freePages;
}

export function readLocalCapacitySnapshot(
  root = dataRoot(),
  activeHeavyReservations = 0,
): LocalCapacitySnapshot {
  safePositive(activeHeavyReservations, "activeHeavyReservations");
  const totalMemoryBytes = os.totalmem();
  const freeMemoryBytes = availableMemoryBytes(totalMemoryBytes);
  let totalDiskBytes: number | null = null;
  let freeDiskBytes: number | null = null;

  try {
    const target = fs.existsSync(root) ? root : path.dirname(root);
    const stat = fs.statfsSync(target);
    totalDiskBytes = Number(stat.blocks) * Number(stat.bsize);
    freeDiskBytes = Number(stat.bavail) * Number(stat.bsize);
    if (!Number.isSafeInteger(totalDiskBytes) || !Number.isSafeInteger(freeDiskBytes)) {
      totalDiskBytes = null;
      freeDiskBytes = null;
    }
  } catch {
    // Disk preflight becomes unknown. Callers that require a hard storage
    // guarantee must still ask an ExecutionBackend that advertises storage.
    totalDiskBytes = null;
    freeDiskBytes = null;
  }

  return Object.freeze({
    totalMemoryBytes,
    freeMemoryBytes,
    totalDiskBytes,
    freeDiskBytes,
    activeHeavyReservations,
  });
}
