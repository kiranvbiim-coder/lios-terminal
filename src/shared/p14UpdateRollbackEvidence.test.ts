import assert from "node:assert/strict";
import test from "node:test";
import { validateP14UpdateRollbackObservation } from "./p14UpdateRollbackEvidence";

function validObservation(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1",
    category: "update_rollback",
    platform: "darwin",
    arch: "arm64",
    baselineVersion: "1.0.0",
    targetVersion: "1.1.0",
    baselinePackageSha256: "a".repeat(64),
    targetPackageSha256: "b".repeat(64),
    updateDownloaded: true,
    explicitInstallConfirmed: true,
    installInitiated: true,
    restartObserved: true,
    postUpdateVersion: "1.1.0",
    migrationExercised: true,
    migrationSucceeded: true,
    continuityVerified: true,
    recoveryExercised: true,
    recoverySucceeded: true,
    recoveryOutcome: "retained_target",
    finalObservedVersion: "1.1.0",
    observedAt: "2026-10-15T16:00:00.000Z",
    sourceEvidence: ["signed-update-journey.json", "workspace-continuity.json"],
    ...overrides,
  };
}

test("P14 update/rollback observation accepts a complete N-to-N+1 retained-target journey", () => {
  const parsed = validateP14UpdateRollbackObservation(validObservation());
  assert.equal(parsed.category, "update_rollback");
  assert.equal(parsed.postUpdateVersion, "1.1.0");
  assert.equal(parsed.finalObservedVersion, "1.1.0");
});

test("P14 update/rollback observation rejects equal or backward target versions", () => {
  assert.throws(() => validateP14UpdateRollbackObservation(validObservation({ targetVersion: "1.0.0", postUpdateVersion: "1.0.0", finalObservedVersion: "1.0.0" })), /newer than baseline/i);
  assert.throws(() => validateP14UpdateRollbackObservation(validObservation({ targetVersion: "0.9.0", postUpdateVersion: "0.9.0", finalObservedVersion: "0.9.0" })), /newer than baseline/i);
});

test("P14 update/rollback observation requires download, explicit consent, install and restart facts", () => {
  for (const field of ["updateDownloaded", "explicitInstallConfirmed", "installInitiated", "restartObserved"] as const) {
    assert.throws(() => validateP14UpdateRollbackObservation(validObservation({ [field]: false })), new RegExp(field, "i"));
  }
});

test("P14 update/rollback observation requires the running post-update version to equal the target", () => {
  assert.throws(() => validateP14UpdateRollbackObservation(validObservation({ postUpdateVersion: "1.0.0" })), /post-update version.*target/i);
});

test("P14 update/rollback observation requires exercised successful migration and continuity", () => {
  assert.throws(() => validateP14UpdateRollbackObservation(validObservation({ migrationExercised: false })), /migrationExercised/i);
  assert.throws(() => validateP14UpdateRollbackObservation(validObservation({ migrationSucceeded: false })), /migrationSucceeded/i);
  assert.throws(() => validateP14UpdateRollbackObservation(validObservation({ continuityVerified: false })), /continuityVerified/i);
});

test("P14 update/rollback observation requires an exercised successful recovery path", () => {
  assert.throws(() => validateP14UpdateRollbackObservation(validObservation({ recoveryExercised: false })), /recoveryExercised/i);
  assert.throws(() => validateP14UpdateRollbackObservation(validObservation({ recoverySucceeded: false })), /recoverySucceeded/i);
});

test("P14 update/rollback observation enforces final version consistency for rollback and retained-target recovery", () => {
  assert.doesNotThrow(() => validateP14UpdateRollbackObservation(validObservation({ recoveryOutcome: "rolled_back", finalObservedVersion: "1.0.0" })));
  assert.throws(() => validateP14UpdateRollbackObservation(validObservation({ recoveryOutcome: "rolled_back", finalObservedVersion: "1.1.0" })), /final observed version.*baseline/i);
  assert.throws(() => validateP14UpdateRollbackObservation(validObservation({ recoveryOutcome: "retained_target", finalObservedVersion: "1.0.0" })), /final observed version.*target/i);
});

test("P14 update/rollback observation rejects malformed digests, unsupported targets and empty source evidence", () => {
  assert.throws(() => validateP14UpdateRollbackObservation(validObservation({ baselinePackageSha256: "abc" })), /sha256/i);
  assert.throws(() => validateP14UpdateRollbackObservation(validObservation({ platform: "linux" })), /platform/i);
  assert.throws(() => validateP14UpdateRollbackObservation(validObservation({ platform: "win32", arch: "arm64" })), /win32.*x64/i);
  assert.throws(() => validateP14UpdateRollbackObservation(validObservation({ sourceEvidence: [] })), /sourceEvidence/i);
});
