import assert from "node:assert/strict";
import test from "node:test";
import type {
  ManagedRuntimeInstallOptions,
  ManagedRuntimeOperationResult,
  ManagedRuntimeState,
  StrictProvisioningAuthority,
} from "./pythonRuntimeManager";
import * as runtimeUpgrade from "./safeManagedRuntimeUpgrade";

type UpgradeStatus = "already_current" | "upgraded" | "rollback_restored";
type UpgradeResult = {
  status: UpgradeStatus;
  state: ManagedRuntimeState;
  previousManifestVersion: string;
  targetManifestVersion: string;
  detail: string;
};
type UpgradeDependencies = {
  targetManifestVersion?: string;
  readState?: () => ManagedRuntimeState | null;
  installRuntime?: (
    packIds: string[],
    selectedReleasePackIds: string[],
    options: ManagedRuntimeInstallOptions,
  ) => Promise<ManagedRuntimeOperationResult>;
  rollbackRuntime?: () => Promise<ManagedRuntimeOperationResult>;
  validateActivatedRuntime?: (state: ManagedRuntimeState) => Promise<boolean> | boolean;
  currentPythonPath?: () => string | null;
};
type UpgradeFn = (
  options?: { strictProvisioningAuthority?: StrictProvisioningAuthority },
  dependencies?: UpgradeDependencies,
) => Promise<UpgradeResult>;

function state(
  manifestVersion: string,
  selectedPackIds: string[] = ["core", "forecasting"],
  selectedReleasePackIds: string[] = ["quant"],
): ManagedRuntimeState {
  return {
    manifestVersion,
    installedAt: "2026-10-15T00:00:00.000Z",
    runtimePath: "/tmp/lios-runtime/current",
    rollbackPath: "/tmp/lios-runtime/rollback-old",
    selectedPackIds,
    selectedReleasePackIds,
    packageOutput: "",
    installedSpecs: [],
    hashVerified: true,
    verificationWarnings: [],
  };
}

const authority: StrictProvisioningAuthority = {
  async provisionManagedRuntime() {
    return { packageOutput: "ok", installedPackages: {} };
  },
};

const upgrade = runtimeUpgrade.upgradeManagedRuntimeSafely as unknown as UpgradeFn;

test("SI-07.10 exposes one dedicated safe managed-runtime upgrade authority", () => {
  assert.equal(typeof runtimeUpgrade.upgradeManagedRuntimeSafely, "function");
});

test("already-current runtime is a no-op", async () => {
  let installs = 0;
  const current = state("1.1.0");
  const result = await upgrade(
    { strictProvisioningAuthority: authority },
    {
      targetManifestVersion: "1.1.0",
      readState: () => current,
      installRuntime: async () => {
        installs += 1;
        throw new Error("installer must not run");
      },
    },
  );

  assert.equal(result.status, "already_current");
  assert.equal(result.state, current);
  assert.equal(installs, 0);
});

test("runtime upgrade refuses an accidental manifest downgrade", async () => {
  let installs = 0;
  await assert.rejects(
    () => upgrade(
      { strictProvisioningAuthority: authority },
      {
        targetManifestVersion: "1.1.0",
        readState: () => state("2.0.0"),
        installRuntime: async () => {
          installs += 1;
          throw new Error("installer must not run for downgrade");
        },
      },
    ),
    /downgrade/i,
  );
  assert.equal(installs, 0);
});

test("upgrade preserves pack selections and forces strict verified provisioning", async () => {
  const current = state("1.0.0", ["core", "research-sec", "forecasting"], ["research", "quant"]);
  const upgraded = state("1.1.0", [...current.selectedPackIds], [...current.selectedReleasePackIds]);
  let receivedPackIds: string[] = [];
  let receivedReleasePackIds: string[] = [];
  let receivedOptions: ManagedRuntimeInstallOptions | undefined;

  const result = await upgrade(
    { strictProvisioningAuthority: authority },
    {
      targetManifestVersion: "1.1.0",
      readState: () => current,
      installRuntime: async (packIds, releasePackIds, options) => {
        receivedPackIds = packIds;
        receivedReleasePackIds = releasePackIds;
        receivedOptions = options;
        return { state: upgraded, detail: "activated" };
      },
      validateActivatedRuntime: () => true,
    },
  );

  assert.equal(result.status, "upgraded");
  assert.deepEqual(receivedPackIds, current.selectedPackIds);
  assert.deepEqual(receivedReleasePackIds, current.selectedReleasePackIds);
  assert.equal(receivedOptions?.isolationMode, "strict");
  assert.equal(receivedOptions?.requireVerified, true);
  assert.equal(receivedOptions?.strictProvisioningAuthority, authority);
});

test("upgrade fails closed before mutation when strict authority is missing", async () => {
  let installs = 0;
  await assert.rejects(
    () => upgrade(
      {},
      {
        targetManifestVersion: "1.1.0",
        readState: () => state("1.0.0"),
        installRuntime: async () => {
          installs += 1;
          throw new Error("installer must not run without authority");
        },
      },
    ),
    /authority/i,
  );
  assert.equal(installs, 0);
});

test("post-activation health failure restores the previous runtime", async () => {
  const previous = state("1.0.0");
  const candidate = state("1.1.0");
  let rollbacks = 0;

  const result = await upgrade(
    { strictProvisioningAuthority: authority },
    {
      targetManifestVersion: "1.1.0",
      readState: () => previous,
      installRuntime: async () => ({ state: candidate, detail: "activated" }),
      validateActivatedRuntime: () => false,
      rollbackRuntime: async () => {
        rollbacks += 1;
        return { state: previous, detail: "restored" };
      },
    },
  );

  assert.equal(result.status, "rollback_restored");
  assert.equal(result.state.manifestVersion, "1.0.0");
  assert.equal(rollbacks, 1);
});

test("pre-activation install failure is propagated without invoking a second rollback path", async () => {
  let rollbacks = 0;
  await assert.rejects(
    () => upgrade(
      { strictProvisioningAuthority: authority },
      {
        targetManifestVersion: "1.1.0",
        readState: () => state("1.0.0"),
        installRuntime: async () => {
          throw new Error("staging failed");
        },
        rollbackRuntime: async () => {
          rollbacks += 1;
          return { state: state("1.0.0"), detail: "unexpected" };
        },
      },
    ),
    /staging failed/i,
  );
  assert.equal(rollbacks, 0);
});

test("overlapping upgrades are refused and the guard releases after completion", async () => {
  const previous = state("1.0.0");
  const candidate = state("1.1.0");
  let releaseInstall!: (value: ManagedRuntimeOperationResult) => void;
  const pendingInstall = new Promise<ManagedRuntimeOperationResult>((resolve) => {
    releaseInstall = resolve;
  });

  const first = upgrade(
    { strictProvisioningAuthority: authority },
    {
      targetManifestVersion: "1.1.0",
      readState: () => previous,
      installRuntime: async () => pendingInstall,
      validateActivatedRuntime: () => true,
    },
  );
  await Promise.resolve();

  await assert.rejects(
    () => upgrade(
      { strictProvisioningAuthority: authority },
      {
        targetManifestVersion: "1.1.0",
        readState: () => previous,
        installRuntime: async () => ({ state: candidate, detail: "must not run" }),
        validateActivatedRuntime: () => true,
      },
    ),
    /in progress/i,
  );

  releaseInstall({ state: candidate, detail: "activated" });
  assert.equal((await first).status, "upgraded");

  const second = await upgrade(
    { strictProvisioningAuthority: authority },
    {
      targetManifestVersion: "1.1.0",
      readState: () => previous,
      installRuntime: async () => ({ state: candidate, detail: "activated again" }),
      validateActivatedRuntime: () => true,
    },
  );
  assert.equal(second.status, "upgraded");
});

test("SI-07.10 a rollback reporting the new candidate cannot claim restoration", async () => {
  const original = state("1.0.0");
  const candidate = state("1.1.0");
  let calls = 0;
  await assert.rejects(
    upgrade(
      { strictProvisioningAuthority: authority },
      {
        targetManifestVersion: "1.1.0",
        readState: () => original,
        installRuntime: async () => ({ state: candidate, detail: "activated" }),
        validateActivatedRuntime: () => false,
        rollbackRuntime: async () => {
          calls += 1;
          return { state: candidate, detail: "incorrectly reported restored" };
        },
      },
    ),
    (error: unknown) => error instanceof runtimeUpgrade.ManagedRuntimeUpgradeError
      && error.code === "rollback_failed",
  );
  assert.equal(calls, 1);
});

test("SI-07.10 rollback result alone is insufficient when disk still holds the candidate", async () => {
  const original = state("1.0.0");
  const candidate = state("1.1.0");
  let onDisk = original;
  await assert.rejects(
    upgrade(
      { strictProvisioningAuthority: authority },
      {
        targetManifestVersion: "1.1.0",
        readState: () => onDisk,
        installRuntime: async () => {
          onDisk = candidate;
          return { state: candidate, detail: "activated" };
        },
        validateActivatedRuntime: () => false,
        rollbackRuntime: async () => ({ state: original, detail: "claimed restored, but disk is unchanged" }),
      },
    ),
    (error: unknown) => error instanceof runtimeUpgrade.ManagedRuntimeUpgradeError
      && error.code === "rollback_failed",
  );
  assert.equal(onDisk, candidate);
});

test("SI-07.10 rollback verification rejects changed restored pack or hash evidence", async () => {
  const original = state("1.0.0", ["core", "forecasting"], ["quant"]);
  const candidate = state("1.1.0", [...original.selectedPackIds], [...original.selectedReleasePackIds]);
  const altered = { ...original, hashVerified: false, selectedReleasePackIds: ["research"] };
  await assert.rejects(
    upgrade(
      { strictProvisioningAuthority: authority },
      {
        targetManifestVersion: "1.1.0",
        readState: () => original,
        installRuntime: async () => ({ state: candidate, detail: "activated" }),
        validateActivatedRuntime: () => false,
        rollbackRuntime: async () => ({ state: altered, detail: "incomplete restoration" }),
      },
    ),
    (error: unknown) => error instanceof runtimeUpgrade.ManagedRuntimeUpgradeError
      && error.code === "rollback_failed",
  );
});

test("SI-07.10 post-upgrade validator refuses unverified persisted state and restores the original", async () => {
  const original = state("1.0.0");
  const candidate = state("1.1.0");
  let onDisk = original;
  let restores = 0;
  const result = await upgrade(
    { strictProvisioningAuthority: authority },
    {
      targetManifestVersion: "1.1.0",
      readState: () => onDisk,
      installRuntime: async () => {
        onDisk = { ...candidate, hashVerified: false };
        return { state: candidate, detail: "claimed verified" };
      },
      currentPythonPath: () => "/managed/current/bin/python3",
      rollbackRuntime: async () => {
        restores += 1;
        onDisk = original;
        return { state: original, detail: "restored" };
      },
    },
  );
  assert.equal(result.status, "rollback_restored");
  assert.equal(restores, 1);
  assert.equal(result.state.manifestVersion, "1.0.0");
});
