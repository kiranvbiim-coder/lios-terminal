import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateP14WorkspaceRestoreEvidenceFile } from "./validate_p14_workspace_restore_evidence";

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

function withTempObservation(value: unknown, run: (file: string) => void) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p14-workspace-"));
  const file = path.join(directory, "observation.json");
  try {
    fs.writeFileSync(file, JSON.stringify(value), "utf8");
    run(file);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("P14 workspace restore file validator accepts a complete observation without rewriting it", () => {
  withTempObservation(validObservation(), (file) => {
    const before = fs.readFileSync(file, "utf8");
    const result = validateP14WorkspaceRestoreEvidenceFile(file);
    assert.equal(result.path, path.resolve(file));
    assert.equal(result.observation.backupFormat, "lios-backup/1");
    assert.equal(result.observation.projectReopened, true);
    assert.equal(fs.readFileSync(file, "utf8"), before);
  });
});

test("P14 workspace restore file validator refuses missing paths, files and malformed JSON", () => {
  assert.throws(() => validateP14WorkspaceRestoreEvidenceFile(""), /path is required/i);
  assert.throws(() => validateP14WorkspaceRestoreEvidenceFile("/definitely/not/present/workspace-observation.json"), /does not exist/i);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p14-workspace-"));
  const file = path.join(directory, "observation.json");
  try {
    fs.writeFileSync(file, "{not-json", "utf8");
    assert.throws(() => validateP14WorkspaceRestoreEvidenceFile(file), /not valid JSON/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("P14 workspace restore file validator fails closed on incomplete clean-profile continuity", () => {
  withTempObservation(validObservation({ sessionReopened: false }), (file) => {
    assert.throws(() => validateP14WorkspaceRestoreEvidenceFile(file), /sessionReopened/i);
  });
});

