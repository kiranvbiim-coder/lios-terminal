import assert from "node:assert/strict";
import test from "node:test";
import { MANAGED_RUNTIME_MANIFEST } from "./runtimeManifest";
import { evaluateManagedRuntimeReadiness } from "./provisioningReadiness";
import type { ManagedRuntimeState } from "./pythonRuntimeManager";

function state(overrides: Partial<ManagedRuntimeState> = {}): ManagedRuntimeState {
  return {
    manifestVersion: MANAGED_RUNTIME_MANIFEST.manifestVersion,
    installedAt: "2026-10-04T00:00:00.000Z",
    runtimePath: "/user-owned/lios/python-runtimes/current",
    rollbackPath: null,
    selectedPackIds: ["core"],
    selectedReleasePackIds: [],
    packageOutput: "",
    installedSpecs: [],
    hashVerified: true,
    verificationWarnings: [],
    ...overrides,
  };
}

const supportedPlatform = MANAGED_RUNTIME_MANIFEST.supportedPlatforms[0]!;

test("managed runtime readiness fails closed when runtime is absent", () => {
  const result = evaluateManagedRuntimeReadiness({
    state: null,
    pythonAvailable: false,
    platformKey: supportedPlatform,
    requiredPackIds: ["core"],
  });
  assert.equal(result.state, "missing");
  assert.equal(result.ready, false);
  assert.equal(result.repairAction, "install");
});

test("managed runtime readiness rejects unsupported platforms and stale manifest versions", () => {
  assert.equal(evaluateManagedRuntimeReadiness({
    state: null,
    pythonAvailable: false,
    platformKey: "unsupported-arch",
    requiredPackIds: ["core"],
  }).state, "unsupported");

  const stale = evaluateManagedRuntimeReadiness({
    state: state({ manifestVersion: "0.0.0" }),
    pythonAvailable: true,
    platformKey: supportedPlatform,
    requiredPackIds: ["core"],
  });
  assert.equal(stale.state, "incompatible");
  assert.equal(stale.repairAction, "repair");
});

test("managed runtime readiness requires the requested packs and a live managed Python executable", () => {
  const missingPack = evaluateManagedRuntimeReadiness({
    state: state(),
    pythonAvailable: true,
    platformKey: supportedPlatform,
    requiredPackIds: ["core", "fixed-income"],
  });
  assert.equal(missingPack.state, "missing");
  assert.deepEqual(missingPack.missingPackIds, ["fixed-income"]);
  assert.equal(missingPack.repairAction, "install");

  const missingPython = evaluateManagedRuntimeReadiness({
    state: state(),
    pythonAvailable: false,
    platformKey: supportedPlatform,
    requiredPackIds: ["core"],
  });
  assert.equal(missingPython.state, "corrupt");
  assert.equal(missingPython.repairAction, "repair");
});

test("managed runtime readiness never treats warnings or unhashed release state as SP-ready", () => {
  const warned = evaluateManagedRuntimeReadiness({
    state: state({ verificationWarnings: ["numpy is missing"] }),
    pythonAvailable: true,
    platformKey: supportedPlatform,
    requiredPackIds: ["core"],
  });
  assert.equal(warned.state, "integrity_failed");
  assert.equal(warned.ready, false);
  assert.equal(warned.repairAction, "repair");

  const unhashed = evaluateManagedRuntimeReadiness({
    state: state({ hashVerified: false }),
    pythonAvailable: true,
    platformKey: supportedPlatform,
    requiredPackIds: ["core"],
  });
  assert.equal(unhashed.state, "unverified");
  assert.equal(unhashed.ready, false);
  assert.equal(unhashed.repairAction, "repair");
});

test("managed runtime is ready only when platform, manifest, packs, executable and integrity all match", () => {
  const result = evaluateManagedRuntimeReadiness({
    state: state({ selectedPackIds: ["core", "fixed-income"] }),
    pythonAvailable: true,
    platformKey: supportedPlatform,
    requiredPackIds: ["fixed-income", "core", "core"],
  });
  assert.equal(result.state, "ready");
  assert.equal(result.ready, true);
  assert.deepEqual(result.requiredPackIds, ["core", "fixed-income"]);
  assert.deepEqual(result.missingPackIds, []);
  assert.equal(result.repairAction, "none");
});
