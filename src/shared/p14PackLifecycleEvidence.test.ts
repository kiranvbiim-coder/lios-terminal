import assert from "node:assert/strict";
import test from "node:test";
import { validateP14PackLifecycleObservation } from "./p14PackLifecycleEvidence";

function validObservation(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1",
    category: "pack_lifecycle",
    platform: "darwin",
    arch: "arm64",
    packId: "lios.platform-proof",
    baselineVersion: "1.0.0",
    targetVersion: "1.1.0",
    baselineArtifactSha256: "a".repeat(64),
    targetArtifactSha256: "b".repeat(64),
    integrityVerified: true,
    baselineInstallObserved: true,
    baselineHealthVerified: true,
    baselineActivated: true,
    targetInstallObserved: true,
    targetHealthVerified: true,
    targetActivated: true,
    retryFailureObserved: true,
    retrySucceeded: true,
    rollbackExercised: true,
    rollbackSucceeded: true,
    rollbackVersion: "1.0.0",
    deactivateObserved: true,
    targetRemovalObserved: true,
    baselineRemovalObserved: true,
    finalPackAbsent: true,
    observedAt: "2026-10-16T02:30:00.000Z",
    sourceEvidence: ["pack-install.json", "pack-retry.json", "pack-rollback.json"],
    ...overrides,
  };
}

test("P14 pack lifecycle accepts a complete packaged install-update-retry-rollback-remove journey", () => {
  const parsed = validateP14PackLifecycleObservation(validObservation());
  assert.equal(parsed.category, "pack_lifecycle");
  assert.equal(parsed.targetVersion, "1.1.0");
  assert.equal(parsed.rollbackVersion, "1.0.0");
  assert.equal(parsed.finalPackAbsent, true);
});

test("P14 pack lifecycle requires a strictly newer target and different artifact identities", () => {
  assert.throws(() => validateP14PackLifecycleObservation(validObservation({ targetVersion: "1.0.0" })), /newer than baseline/i);
  assert.throws(() => validateP14PackLifecycleObservation(validObservation({ targetVersion: "0.9.0" })), /newer than baseline/i);
  assert.throws(() => validateP14PackLifecycleObservation(validObservation({ targetArtifactSha256: "a".repeat(64) })), /different/i);
});

test("P14 pack lifecycle requires real integrity, install, health and activation observations", () => {
  for (const field of [
    "integrityVerified",
    "baselineInstallObserved",
    "baselineHealthVerified",
    "baselineActivated",
    "targetInstallObserved",
    "targetHealthVerified",
    "targetActivated",
  ] as const) {
    assert.throws(() => validateP14PackLifecycleObservation(validObservation({ [field]: false })), new RegExp(field, "i"));
  }
});

test("P14 pack lifecycle requires an observed failure followed by successful retry", () => {
  assert.throws(() => validateP14PackLifecycleObservation(validObservation({ retryFailureObserved: false })), /retryFailureObserved/i);
  assert.throws(() => validateP14PackLifecycleObservation(validObservation({ retrySucceeded: false })), /retrySucceeded/i);
});

test("P14 pack lifecycle requires exercised rollback to the baseline version", () => {
  assert.throws(() => validateP14PackLifecycleObservation(validObservation({ rollbackExercised: false })), /rollbackExercised/i);
  assert.throws(() => validateP14PackLifecycleObservation(validObservation({ rollbackSucceeded: false })), /rollbackSucceeded/i);
  assert.throws(() => validateP14PackLifecycleObservation(validObservation({ rollbackVersion: "1.1.0" })), /rollback version.*baseline/i);
});

test("P14 pack lifecycle requires deactivation, both removals and final absence", () => {
  for (const field of ["deactivateObserved", "targetRemovalObserved", "baselineRemovalObserved", "finalPackAbsent"] as const) {
    assert.throws(() => validateP14PackLifecycleObservation(validObservation({ [field]: false })), new RegExp(field, "i"));
  }
});

test("P14 pack lifecycle mirrors supported packaged desktop targets", () => {
  assert.doesNotThrow(() => validateP14PackLifecycleObservation(validObservation({ platform: "darwin", arch: "x64" })));
  assert.doesNotThrow(() => validateP14PackLifecycleObservation(validObservation({ platform: "win32", arch: "x64" })));
  assert.throws(() => validateP14PackLifecycleObservation(validObservation({ platform: "win32", arch: "arm64" })), /win32.*x64/i);
  assert.throws(() => validateP14PackLifecycleObservation(validObservation({ platform: "linux", arch: "x64" })), /platform/i);
});

test("P14 pack lifecycle rejects malformed hashes and empty source evidence", () => {
  assert.throws(() => validateP14PackLifecycleObservation(validObservation({ baselineArtifactSha256: "abc" })), /sha256/i);
  assert.throws(() => validateP14PackLifecycleObservation(validObservation({ sourceEvidence: [] })), /sourceEvidence/i);
});
