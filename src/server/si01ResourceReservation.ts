import {
  evaluateLocalResourceAdmission,
  readLocalCapacitySnapshot,
  type LocalCapacitySnapshot,
  type LocalResourceAdmission,
  type LocalResourceRequest,
} from "./si01ResourceAdmission";

export class LocalResourceAdmissionError extends Error {
  readonly admission: LocalResourceAdmission;

  constructor(admission: LocalResourceAdmission) {
    super(`Local resource admission failed: ${admission.reason}: ${admission.detail}`);
    this.name = "LocalResourceAdmissionError";
    this.admission = admission;
  }
}

export interface LocalResourceReservation {
  readonly admission: LocalResourceAdmission;
  release(): void;
}

export type LocalCapacitySnapshotReader = (
  activeHeavyReservations: number,
) => LocalCapacitySnapshot;

/**
 * Process-local reservation authority for SI-01.13.
 *
 * Node executes acquire() synchronously, so capacity evaluation and the heavy
 * reservation increment are one event-loop atomic operation. Reservations are
 * intentionally not persisted: after app restart there can be no truthful
 * ownership claim over a prior process. The GM-10 supervisor owns release at
 * construction failure or proven native extinction.
 */
export class LocalResourceReservationPool {
  #activeHeavyReservations = 0;
  #reservedMemoryBytes = 0;
  #reservedDiskBytes = 0;

  constructor(
    private readonly snapshotReader: LocalCapacitySnapshotReader = (active) =>
      readLocalCapacitySnapshot(undefined, active),
  ) {}

  get activeHeavyReservations(): number {
    return this.#activeHeavyReservations;
  }

  get reservedMemoryBytes(): number {
    return this.#reservedMemoryBytes;
  }

  get reservedDiskBytes(): number {
    return this.#reservedDiskBytes;
  }

  acquire(request: LocalResourceRequest): LocalResourceReservation {
    // All workload classes consume memory/disk, not just heavy-job slots.
    // The process-local reservation ledger protects against back-to-back
    // admissions using the same OS free-capacity observation before native
    // allocations become visible in telemetry.
    const hardware = this.snapshotReader(this.#activeHeavyReservations);
    const capacity: LocalCapacitySnapshot = {
      ...hardware,
      freeMemoryBytes: Math.max(0, hardware.freeMemoryBytes - this.#reservedMemoryBytes),
      freeDiskBytes: hardware.freeDiskBytes === null
        ? null
        : Math.max(0, hardware.freeDiskBytes - this.#reservedDiskBytes),
    };
    const admission = evaluateLocalResourceAdmission(capacity, request);
    if (admission.state === "unavailable") {
      throw new LocalResourceAdmissionError(admission);
    }

    const memoryBytes = request.memoryBytes;
    const diskBytes = request.diskBytes;
    const ownsHeavySlot = request.workload === "heavy";
    // Acquiring a reservation is synchronous, so accounting and admission
    // remain atomic within this process's event loop.
    this.#reservedMemoryBytes += memoryBytes;
    this.#reservedDiskBytes += diskBytes;
    if (ownsHeavySlot) this.#activeHeavyReservations += 1;

    let released = false;
    return Object.freeze({
      admission,
      release: () => {
        if (released) return;
        released = true;
        this.#reservedMemoryBytes -= memoryBytes;
        this.#reservedDiskBytes -= diskBytes;
        if (ownsHeavySlot) this.#activeHeavyReservations -= 1;
      },
    });
  }
}

export type { LocalResourceRequest } from "./si01ResourceAdmission";
