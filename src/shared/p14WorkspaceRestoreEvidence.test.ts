import assert from "node:assert/strict";
import test from "node:test";
import { validateP14WorkspaceRestoreObservation } from "./p14WorkspaceRestoreEvidence";

function validObservation(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1",
    category: "workspace_restore",
    platform: "darwin",
    arch: "arm64",
    backupFormat: "lios-backup/1",
    archiveSha256: "a".repeat(64),
    archiveEncrypted: true,
    archiveVerified: true,
    preflightDigestsMatch: true,
    cleanProfileEstablished: true,
    restoreSucceeded: true,
    preflightTables: 12,
    rowsRestored: 42,
    filesRestored: 7,
    projectReopened: true,
    sessionReopened: true,
    artifactIntegrityVerified: true,
    continuityVerified: true,
    observedAt: "2026-10-16T05:10:00.000Z",
    sourceEvidence: ["backup-create.json", "restore-worker.json", "reopen-walkthrough.json"],
    ...overrides,
  };
}

test("P14 workspace restore accepts a verified packaged clean-profile restore and reopen journey", () => {
  const parsed = validateP14WorkspaceRestoreObservation(validObservation());
  assert.equal(parsed.category, "workspace_restore");
  assert.equal(parsed.backupFormat, "lios-backup/1");
  assert.equal(parsed.continuityVerified, true);
});

test("P14 workspace restore requires the canonical portable backup format and encrypted archive", () => {
  assert.throws(() => validateP14WorkspaceRestoreObservation(validObservation({ backupFormat: "zip" })), /backupFormat/i);
  assert.throws(() => validateP14WorkspaceRestoreObservation(validObservation({ archiveEncrypted: false })), /archiveEncrypted/i);
});

test("P14 workspace restore requires archive verification, digest preflight, clean profile and restore success", () => {
  for (const field of ["archiveVerified", "preflightDigestsMatch", "cleanProfileEstablished", "restoreSucceeded"] as const) {
    assert.throws(() => validateP14WorkspaceRestoreObservation(validObservation({ [field]: false })), new RegExp(field, "i"));
  }
});

test("P14 workspace restore requires nonnegative observed restore counts and at least one preflight table", () => {
  assert.throws(() => validateP14WorkspaceRestoreObservation(validObservation({ preflightTables: 0 })), /preflightTables/i);
  assert.throws(() => validateP14WorkspaceRestoreObservation(validObservation({ rowsRestored: -1 })), /rowsRestored/i);
  assert.throws(() => validateP14WorkspaceRestoreObservation(validObservation({ filesRestored: -1 })), /filesRestored/i);
});

test("P14 workspace restore requires Project, Session, Artifact and continuity verification after reopen", () => {
  for (const field of ["projectReopened", "sessionReopened", "artifactIntegrityVerified", "continuityVerified"] as const) {
    assert.throws(() => validateP14WorkspaceRestoreObservation(validObservation({ [field]: false })), new RegExp(field, "i"));
  }
});

test("P14 workspace restore mirrors supported packaged desktop targets", () => {
  assert.doesNotThrow(() => validateP14WorkspaceRestoreObservation(validObservation({ platform: "darwin", arch: "x64" })));
  assert.doesNotThrow(() => validateP14WorkspaceRestoreObservation(validObservation({ platform: "win32", arch: "x64" })));
  assert.throws(() => validateP14WorkspaceRestoreObservation(validObservation({ platform: "win32", arch: "arm64" })), /win32.*x64/i);
  assert.throws(() => validateP14WorkspaceRestoreObservation(validObservation({ platform: "linux", arch: "x64" })), /platform/i);
});

test("P14 workspace restore rejects malformed archive hashes, duplicate support identifiers and unknown fields", () => {
  assert.throws(() => validateP14WorkspaceRestoreObservation(validObservation({ archiveSha256: "abc" })), /sha256/i);
  assert.throws(() => validateP14WorkspaceRestoreObservation(validObservation({ sourceEvidence: [] })), /sourceEvidence/i);
  assert.throws(() => validateP14WorkspaceRestoreObservation(validObservation({ sourceEvidence: ["a.json", "a.json"] })), /duplicate/i);
  assert.throws(() => validateP14WorkspaceRestoreObservation({ ...validObservation(), invented: true }), /unsupported fields/i);
});
