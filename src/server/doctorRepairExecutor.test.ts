import assert from "node:assert/strict";
import test from "node:test";
import {
  DoctorRepairExecutionRefusedError,
  executeManagedRuntimeRepair,
  type DoctorRepairExecutionDependencies,
} from "./doctorRepairExecutor";
import type { ManagedRuntimeReadiness } from "./provisioningReadiness";
import type {
  ManagedRuntimeInstallOptions,
  ManagedRuntimeOperationResult,
  ManagedRuntimeState,
  StrictProvisioningAuthority,
} from "./pythonRuntimeManager";

function readiness(overrides: Partial<ManagedRuntimeReadiness> = {}): ManagedRuntimeReadiness {
  return {
    state: "missing",
    ready: false,
    repairAction: "install",
    requiredPackIds: ["core"],
    missingPackIds: ["core"],
    reasons: ["Managed runtime is not installed."],
    ...overrides,
  };
}

function operationResult(): ManagedRuntimeOperationResult {
  const state: ManagedRuntimeState = {
    manifestVersion: "1.0.0",
    installedAt: "2026-10-15T00:00:00.000Z",
    runtimePath: "/managed/current",
    rollbackPath: null,
    selectedPackIds: ["core"],
    selectedReleasePackIds: ["quant"],
    packageOutput: "provisioned",
    installedSpecs: [],
    hashVerified: true,
    verificationWarnings: [],
  };
  return { state, detail: "Managed Python runtime installed and activated." };
}

function dependencies(
  current: ManagedRuntimeReadiness,
  selectedReleasePackIds: readonly string[] = [],
  installCalls: Array<{
    packIds: string[];
    selectedReleasePackIds: string[];
    options: ManagedRuntimeInstallOptions;
  }> = [],
): DoctorRepairExecutionDependencies {
  return {
    readCurrentRuntimeContext() {
      return { readiness: current, selectedReleasePackIds };
    },
    async installManagedRuntime(packIds, releasePackIds, options) {
      installCalls.push({
        packIds: [...packIds],
        selectedReleasePackIds: [...releasePackIds],
        options,
      });
      return operationResult();
    },
  };
}

test("SI-07 Doctor repair executor refuses mutation without explicit confirmation before reading runtime state", async () => {
  let reads = 0;
  const deps: DoctorRepairExecutionDependencies = {
    readCurrentRuntimeContext() {
      reads += 1;
      return { readiness: readiness(), selectedReleasePackIds: [] };
    },
    async installManagedRuntime() {
      assert.fail("install must not execute without confirmation");
    },
  };

  await assert.rejects(
    executeManagedRuntimeRepair({ confirmed: false, isolationMode: "legacy-host" }, deps),
    (error: unknown) => error instanceof DoctorRepairExecutionRefusedError
      && error.code === "confirmation_required",
  );
  assert.equal(reads, 0);
});

test("SI-07 Doctor repair executor rechecks current state and refuses a repair that is no longer required", async () => {
  const calls: unknown[] = [];
  const deps = dependencies(readiness({
    state: "ready",
    ready: true,
    repairAction: "none",
    missingPackIds: [],
    reasons: [],
  }), [], calls as never[]);

  await assert.rejects(
    executeManagedRuntimeRepair({ confirmed: true, isolationMode: "legacy-host" }, deps),
    (error: unknown) => error instanceof DoctorRepairExecutionRefusedError
      && error.code === "no_repair_required",
  );
  assert.equal(calls.length, 0);
});

test("SI-07 Doctor repair executor refuses unsupported platforms rather than inventing a repair", async () => {
  const calls: unknown[] = [];
  const deps = dependencies(readiness({
    state: "unsupported",
    ready: false,
    repairAction: "none",
    reasons: ["Current platform is not supported by the managed runtime manifest."],
  }), [], calls as never[]);

  await assert.rejects(
    executeManagedRuntimeRepair({ confirmed: true, isolationMode: "legacy-host" }, deps),
    (error: unknown) => error instanceof DoctorRepairExecutionRefusedError
      && error.code === "unsupported_platform",
  );
  assert.equal(calls.length, 0);
});

test("SI-07 Doctor repair executor keeps strict mode blocked when no governed provisioning authority is composed", async () => {
  const calls: unknown[] = [];
  const deps = dependencies(readiness(), [], calls as never[]);

  await assert.rejects(
    executeManagedRuntimeRepair({ confirmed: true, isolationMode: "strict" }, deps),
    (error: unknown) => error instanceof DoctorRepairExecutionRefusedError
      && error.code === "strict_provisioning_authority_missing",
  );
  assert.equal(calls.length, 0);
});

test("SI-07 Doctor repair executor delegates a confirmed strict install through the governed authority and preserves release packs", async () => {
  const calls: Array<{
    packIds: string[];
    selectedReleasePackIds: string[];
    options: ManagedRuntimeInstallOptions;
  }> = [];
  const authority: StrictProvisioningAuthority = {
    async provisionManagedRuntime() {
      return { packageOutput: "", installedPackages: {} };
    },
  };
  const deps = dependencies(readiness(), ["quant"], calls);

  const result = await executeManagedRuntimeRepair({
    confirmed: true,
    isolationMode: "strict",
    strictProvisioningAuthority: authority,
  }, deps);

  assert.equal(result.plan.executionStatus, "authority_available");
  assert.equal(result.plan.action, "install_managed_runtime");
  assert.equal(result.operation.detail, "Managed Python runtime installed and activated.");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.packIds, ["core"]);
  assert.deepEqual(calls[0]?.selectedReleasePackIds, ["quant"]);
  assert.equal(calls[0]?.options.isolationMode, "strict");
  assert.equal(calls[0]?.options.strictProvisioningAuthority, authority);
  assert.equal(calls[0]?.options.requireVerified, false);
});

test("SI-07 Doctor repair executor forces verified artifacts for governed repair states", async () => {
  const calls: Array<{
    packIds: string[];
    selectedReleasePackIds: string[];
    options: ManagedRuntimeInstallOptions;
  }> = [];
  const deps = dependencies(readiness({
    state: "unverified",
    ready: false,
    repairAction: "repair",
    missingPackIds: [],
    reasons: ["Installed runtime was not verified against release-artifact package hashes."],
  }), ["research"], calls);

  const result = await executeManagedRuntimeRepair({ confirmed: true, isolationMode: "legacy-host" }, deps);

  assert.equal(result.plan.action, "repair_managed_runtime");
  assert.equal(result.plan.requiresVerifiedArtifacts, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.packIds, ["core"]);
  assert.deepEqual(calls[0]?.selectedReleasePackIds, ["research"]);
  assert.equal(calls[0]?.options.requireVerified, true);
});

test("SI-07 Doctor repair executor prevents overlapping runtime mutations and releases the guard", async () => {
  let releaseInstall!: () => void;
  let startedInstall!: () => void;
  let reads = 0;
  let installs = 0;
  const pausedInstall = new Promise<void>((resolve) => { releaseInstall = resolve; });
  const started = new Promise<void>((resolve) => { startedInstall = resolve; });
  const deps: DoctorRepairExecutionDependencies = {
    readCurrentRuntimeContext() {
      reads += 1;
      return { readiness: readiness(), selectedReleasePackIds: ["quant"] };
    },
    async installManagedRuntime() {
      installs += 1;
      startedInstall();
      await pausedInstall;
      return operationResult();
    },
  };
  const first = executeManagedRuntimeRepair({ confirmed: true, isolationMode: "legacy-host" }, deps);
  await started;
  await assert.rejects(
    executeManagedRuntimeRepair({ confirmed: true, isolationMode: "legacy-host" }, deps),
    (error: unknown) => error instanceof DoctorRepairExecutionRefusedError
      && error.code === "repair_in_progress",
  );
  assert.equal(reads, 1, "overlapping confirmation cannot re-enter current-state evaluation");
  assert.equal(installs, 1, "only one install reaches the canonical runtime manager");
  releaseInstall();
  await first;
  await executeManagedRuntimeRepair({ confirmed: true, isolationMode: "legacy-host" }, deps);
  assert.equal(installs, 2, "a completed install releases the guard for a fresh explicit request");
});

test("SI-07 Doctor repair executor releases the guard after a failed installer", async () => {
  const error = new Error("simulated runtime installer failure");
  let attempts = 0;
  const deps: DoctorRepairExecutionDependencies = {
    readCurrentRuntimeContext() {
      return { readiness: readiness(), selectedReleasePackIds: [] };
    },
    async installManagedRuntime() {
      attempts += 1;
      if (attempts === 1) throw error;
      return operationResult();
    },
  };
  await assert.rejects(
    executeManagedRuntimeRepair({ confirmed: true, isolationMode: "legacy-host" }, deps),
    (caught: unknown) => caught === error,
  );
  const retry = await executeManagedRuntimeRepair({ confirmed: true, isolationMode: "legacy-host" }, deps);
  assert.equal(retry.plan.action, "install_managed_runtime");
  assert.equal(attempts, 2);
});

test("SI-07 Doctor repair executor obeys server strict-mode policy over requested legacy-host mode", async () => {
  const original = process.env.LIOS_EXECUTION_ISOLATION;
  process.env.LIOS_EXECUTION_ISOLATION = "strict";
  const calls: unknown[] = [];
  try {
    const deps = dependencies(readiness(), [], calls as never[]);
    await assert.rejects(
      executeManagedRuntimeRepair({ confirmed: true, isolationMode: "legacy-host" }, deps),
      (error: unknown) => error instanceof DoctorRepairExecutionRefusedError
        && error.code === "strict_provisioning_authority_missing",
    );
    assert.deepEqual(calls, [], "strict policy cannot be downgraded to the legacy provisioning path");
  } finally {
    if (original === undefined) delete process.env.LIOS_EXECUTION_ISOLATION;
    else process.env.LIOS_EXECUTION_ISOLATION = original;
  }
});
