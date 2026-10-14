import {
  installManagedRuntime,
  managedRuntimePythonPath,
  readManagedRuntimeState,
  rollbackManagedRuntime,
  type ManagedRuntimeOperationResult,
  type ManagedRuntimeState,
} from "./pythonRuntimeManager";
import {
  evaluateManagedRuntimeReadiness,
  type ManagedRuntimeReadiness,
} from "./provisioningReadiness";

export type ManagedRuntimeProvisioningAction = "none" | "install" | "repair";
export type ManagedRuntimeProvisioningErrorCode =
  | "unsupported"
  | "post_install_unready"
  | "rollback_failed";

export interface ManagedRuntimeReconcileInput {
  requiredPackIds?: readonly string[];
  selectedReleasePackIds?: readonly string[];
  platformKey?: string;
}

export interface ManagedRuntimeReconcileResult {
  action: ManagedRuntimeProvisioningAction;
  before: ManagedRuntimeReadiness;
  after: ManagedRuntimeReadiness;
  state: ManagedRuntimeState | null;
  detail: string;
}

export interface ManagedRuntimeReconcilerDependencies {
  readState: () => ManagedRuntimeState | null;
  pythonAvailable: () => boolean;
  install: (
    packIds: string[],
    selectedReleasePackIds: string[],
  ) => Promise<ManagedRuntimeOperationResult>;
  rollback: () => Promise<ManagedRuntimeOperationResult>;
}

export class ManagedRuntimeProvisioningError extends Error {
  readonly code: ManagedRuntimeProvisioningErrorCode;
  readonly readiness: ManagedRuntimeReadiness;
  readonly rollbackApplied: boolean;

  constructor(input: {
    code: ManagedRuntimeProvisioningErrorCode;
    message: string;
    readiness: ManagedRuntimeReadiness;
    rollbackApplied?: boolean;
    cause?: unknown;
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = "ManagedRuntimeProvisioningError";
    this.code = input.code;
    this.readiness = input.readiness;
    this.rollbackApplied = input.rollbackApplied ?? false;
  }
}

const defaultDependencies: ManagedRuntimeReconcilerDependencies = {
  readState: () => readManagedRuntimeState(),
  pythonAvailable: () => Boolean(managedRuntimePythonPath()),
  install: (packIds, selectedReleasePackIds) =>
    installManagedRuntime(packIds, selectedReleasePackIds, { requireVerified: true }),
  rollback: () => rollbackManagedRuntime(),
};

function readinessFor(
  dependencies: ManagedRuntimeReconcilerDependencies,
  requiredPackIds: readonly string[] | undefined,
  platformKey: string | undefined,
  state = dependencies.readState(),
): ManagedRuntimeReadiness {
  return evaluateManagedRuntimeReadiness({
    state,
    pythonAvailable: dependencies.pythonAvailable(),
    requiredPackIds,
    platformKey,
  });
}

/**
 * SI-01.16 governed reconciliation over the existing managed-runtime authority.
 *
 * This function does not implement installation itself. It classifies the
 * canonical runtime state, invokes pythonRuntimeManager only when mutation is
 * required, verifies the activated result, and restores the prior runtime if a
 * repair/install replacement of an existing runtime activates but still fails
 * the readiness/integrity contract.
 */
export async function reconcileManagedRuntime(
  input: ManagedRuntimeReconcileInput = {},
  dependencies: ManagedRuntimeReconcilerDependencies = defaultDependencies,
): Promise<ManagedRuntimeReconcileResult> {
  const previousState = dependencies.readState();
  const before = readinessFor(
    dependencies,
    input.requiredPackIds,
    input.platformKey,
    previousState,
  );

  if (before.ready) {
    return {
      action: "none",
      before,
      after: before,
      state: previousState,
      detail: "Managed runtime is already ready for the requested capability.",
    };
  }

  if (before.repairAction === "none") {
    throw new ManagedRuntimeProvisioningError({
      code: "unsupported",
      message: before.reasons.join(" ") || "Managed runtime is unavailable on this platform.",
      readiness: before,
    });
  }

  const action: ManagedRuntimeProvisioningAction = before.repairAction;
  const selectedReleasePackIds = input.selectedReleasePackIds
    ? [...input.selectedReleasePackIds]
    : [...(previousState?.selectedReleasePackIds ?? [])];

  const operation = await dependencies.install(
    [...new Set([...before.requiredPackIds, ...(previousState?.selectedPackIds ?? [])])],
    selectedReleasePackIds,
  );
  const after = readinessFor(
    dependencies,
    before.requiredPackIds,
    input.platformKey,
    operation.state,
  );

  if (after.ready) {
    return {
      action,
      before,
      after,
      state: operation.state,
      detail: operation.detail,
    };
  }

  if (previousState && operation.state.rollbackPath) {
    try {
      await dependencies.rollback();
    } catch (error) {
      throw new ManagedRuntimeProvisioningError({
        code: "rollback_failed",
        message: "Managed runtime replacement failed readiness checks and the previous runtime could not be restored.",
        readiness: after,
        rollbackApplied: false,
        cause: error,
      });
    }

    throw new ManagedRuntimeProvisioningError({
      code: "post_install_unready",
      message: "Managed runtime replacement failed readiness checks; the previous runtime was restored.",
      readiness: after,
      rollbackApplied: true,
    });
  }

  throw new ManagedRuntimeProvisioningError({
    code: "post_install_unready",
    message: "Managed runtime installation completed but did not satisfy the required integrity/readiness contract.",
    readiness: after,
    rollbackApplied: false,
  });
}
