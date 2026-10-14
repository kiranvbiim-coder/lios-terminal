import assert from "node:assert/strict";
import test from "node:test";
import { MANAGED_RUNTIME_MANIFEST } from "./runtimeManifest";
import type { ManagedRuntimeState } from "./pythonRuntimeManager";
import {
  ManagedRuntimeProvisioningError,
  reconcileManagedRuntime,
  type ManagedRuntimeReconcilerDependencies,
} from "./managedRuntimeReconciler";

function state(overrides: Partial<ManagedRuntimeState> = {}): ManagedRuntimeState {
  return {
    manifestVersion: MANAGED_RUNTIME_MANIFEST.manifestVersion,
    installedAt: "2026-10-04T00:00:00.000Z",
    runtimePath: "/user-owned/lios/python-runtimes/current",
    rollbackPath: null,
    selectedPackIds: ["core"],
    selectedReleasePackIds: ["core"],
    packageOutput: "",
    installedSpecs: [],
    hashVerified: true,
    verificationWarnings: [],
    ...overrides,
  };
}

function deps(input: {
  currentState: ManagedRuntimeState | null;
  pythonAvailable?: boolean;
  installedState?: ManagedRuntimeState;
  rollbackError?: Error;
  installError?: Error;
}) {
  let installCalls = 0;
  let rollbackCalls = 0;
  let installPackIds: string[] = [];
  let releasePackIds: string[] = [];
  let currentState = input.currentState;
  let pythonAvailable = input.pythonAvailable ?? Boolean(currentState);

  const dependencies: ManagedRuntimeReconcilerDependencies = {
    readState: () => currentState,
    pythonAvailable: () => pythonAvailable,
    install: async (packIds, selectedReleasePackIds) => {
      installCalls += 1;
      installPackIds = [...packIds];
      releasePackIds = [...selectedReleasePackIds];
      if (input.installError) throw input.installError;
      const installed = input.installedState ?? state({
        selectedPackIds: [...packIds],
        selectedReleasePackIds: [...selectedReleasePackIds],
        rollbackPath: currentState ? "/user-owned/lios/python-runtimes/rollback-previous" : null,
      });
      currentState = installed;
      pythonAvailable = true;
      return { state: installed, detail: "installed" };
    },
    rollback: async () => {
      rollbackCalls += 1;
      if (input.rollbackError) throw input.rollbackError;
      const restored = input.currentState;
      if (!restored) throw new Error("No previous runtime.");
      currentState = restored;
      pythonAvailable = true;
      return { state: restored, detail: "rolled back" };
    },
  };

  return {
    dependencies,
    stats: () => ({ installCalls, rollbackCalls, installPackIds, releasePackIds }),
  };
}

const platformKey = MANAGED_RUNTIME_MANIFEST.supportedPlatforms[0]!;

test("reconciler is a no-op when the required runtime is already ready", async () => {
  const fixture = deps({ currentState: state() });
  const result = await reconcileManagedRuntime({ requiredPackIds: ["core"], platformKey }, fixture.dependencies);
  assert.equal(result.action, "none");
  assert.equal(result.after.ready, true);
  assert.equal(fixture.stats().installCalls, 0);
  assert.equal(fixture.stats().rollbackCalls, 0);
});

test("reconciler installs a missing required runtime through the canonical installer", async () => {
  const fixture = deps({ currentState: null, pythonAvailable: false });
  const result = await reconcileManagedRuntime({ requiredPackIds: ["core"], platformKey }, fixture.dependencies);
  assert.equal(result.action, "install");
  assert.equal(result.after.ready, true);
  assert.deepEqual(fixture.stats().installPackIds, ["core"]);
  assert.equal(fixture.stats().rollbackCalls, 0);
});

test("reconciler repairs a corrupt runtime and preserves its release-pack selection", async () => {
  const current = state({
    selectedPackIds: ["core", "fixed-income"],
    selectedReleasePackIds: ["core", "quant"],
  });
  const fixture = deps({ currentState: current, pythonAvailable: false });
  const result = await reconcileManagedRuntime({ requiredPackIds: ["core"], platformKey }, fixture.dependencies);
  assert.equal(result.action, "repair");
  assert.equal(result.after.ready, true);
  assert.deepEqual(fixture.stats().installPackIds, ["core", "fixed-income"]);
  assert.deepEqual(fixture.stats().releasePackIds, ["core", "quant"]);
});

test("reconciler keeps already-provisioned Core offline without invoking an installer", async () => {
  const fixture = deps({ currentState: state(), installError: new Error("network unavailable") });
  const result = await reconcileManagedRuntime({ requiredPackIds: ["core"], platformKey }, fixture.dependencies);
  assert.equal(result.action, "none");
  assert.equal(fixture.stats().installCalls, 0);
});

test("failed offline repair leaves the existing runtime selected and never rolls it back", async () => {
  const previous = state({ hashVerified: false, selectedPackIds: ["core", "fixed-income"] });
  const fixture = deps({ currentState: previous, installError: new Error("network unavailable") });
  await assert.rejects(
    reconcileManagedRuntime({ requiredPackIds: ["core"], platformKey }, fixture.dependencies),
    /network unavailable/,
  );
  assert.equal(fixture.dependencies.readState(), previous);
  assert.deepEqual(fixture.stats().installPackIds, ["core", "fixed-income"]);
  assert.equal(fixture.stats().rollbackCalls, 0);
});

test("reconciler refuses unsupported platforms without mutating runtime state", async () => {
  const fixture = deps({ currentState: null, pythonAvailable: false });
  await assert.rejects(
    reconcileManagedRuntime({ requiredPackIds: ["core"], platformKey: "unsupported-arch" }, fixture.dependencies),
    (error: unknown) => error instanceof ManagedRuntimeProvisioningError && error.code === "unsupported",
  );
  assert.equal(fixture.stats().installCalls, 0);
  assert.equal(fixture.stats().rollbackCalls, 0);
});

test("fresh install with no platform wheel hashes remains explicitly unverified", async () => {
  const fixture = deps({
    currentState: null,
    pythonAvailable: false,
    installedState: state({ hashVerified: false }),
  });
  await assert.rejects(
    reconcileManagedRuntime({ requiredPackIds: ["core"], platformKey }, fixture.dependencies),
    (error: unknown) => error instanceof ManagedRuntimeProvisioningError
      && error.code === "post_install_unready"
      && error.readiness.state === "unverified"
      && !error.rollbackApplied,
  );
  assert.equal(fixture.stats().rollbackCalls, 0);
});

test("reconciler rolls back an existing runtime when replacement remains unverified", async () => {
  const current = state({ hashVerified: false });
  const fixture = deps({
    currentState: current,
    installedState: state({
      hashVerified: false,
      rollbackPath: "/user-owned/lios/python-runtimes/rollback-previous",
    }),
  });

  await assert.rejects(
    reconcileManagedRuntime({ requiredPackIds: ["core"], platformKey }, fixture.dependencies),
    (error: unknown) =>
      error instanceof ManagedRuntimeProvisioningError
      && error.code === "post_install_unready"
      && error.rollbackApplied === true,
  );
  assert.equal(fixture.stats().installCalls, 1);
  assert.equal(fixture.stats().rollbackCalls, 1);
});

test("reconciler surfaces rollback failure separately from readiness failure", async () => {
  const current = state({ hashVerified: false });
  const fixture = deps({
    currentState: current,
    installedState: state({
      verificationWarnings: ["unexpected package"],
      rollbackPath: "/user-owned/lios/python-runtimes/rollback-previous",
    }),
    rollbackError: new Error("rollback failed"),
  });

  await assert.rejects(
    reconcileManagedRuntime({ requiredPackIds: ["core"], platformKey }, fixture.dependencies),
    (error: unknown) => error instanceof ManagedRuntimeProvisioningError && error.code === "rollback_failed",
  );
  assert.equal(fixture.stats().rollbackCalls, 1);
});
