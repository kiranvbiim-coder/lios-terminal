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

  constructor(
    private readonly snapshotReader: LocalCapacitySnapshotReader = (active) =>
      readLocalCapacitySnapshot(undefined, active),
  ) {}

  get activeHeavyReservations(): number {
    return this.#activeHeavyReservations;
  }

  acquire(request: LocalResourceRequest): LocalResourceReservation {
    const admission = evaluateLocalResourceAdmission(
      this.snapshotReader(this.#activeHeavyReservations),
      request,
    );
    if (admission.state === "unavailable") {
      throw new LocalResourceAdmissionError(admission);
    }

    const ownsHeavySlot = request.workload === "heavy";
    if (ownsHeavySlot) {
      this.#activeHeavyReservations += 1;
    }

    let released = false;
    return Object.freeze({
      admission,
      release: () => {
        if (released) return;
        released = true;
        if (!ownsHeavySlot) return;
        this.#activeHeavyReservations = Math.max(0, this.#activeHeavyReservations - 1);
      },
    });
  }
}

export type { LocalResourceRequest } from "./si01ResourceAdmission";
