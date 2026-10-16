import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateP14UpdateRollbackEvidenceFile } from "./validate_p14_update_rollback_evidence";

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

function withTempObservation(value: unknown, run: (file: string) => void) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p14-update-"));
  const file = path.join(directory, "observation.json");
  try {
    fs.writeFileSync(file, JSON.stringify(value), "utf8");
    run(file);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("P14 update/rollback file validator accepts a complete observation without rewriting it", () => {
  withTempObservation(validObservation(), (file) => {
    const before = fs.readFileSync(file, "utf8");
    const result = validateP14UpdateRollbackEvidenceFile(file);
    assert.equal(result.path, path.resolve(file));
    assert.equal(result.observation.targetVersion, "1.1.0");
    assert.equal(result.observation.recoveryOutcome, "retained_target");
    assert.equal(fs.readFileSync(file, "utf8"), before);
  });
});

test("P14 update/rollback file validator refuses missing paths and missing files", () => {
  assert.throws(() => validateP14UpdateRollbackEvidenceFile(""), /path is required/i);
  assert.throws(() => validateP14UpdateRollbackEvidenceFile("/definitely/not/present/observation.json"), /does not exist/i);
});

test("P14 update/rollback file validator refuses malformed JSON without claiming evidence", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p14-update-"));
  const file = path.join(directory, "observation.json");
  try {
    fs.writeFileSync(file, "{not-json", "utf8");
    assert.throws(() => validateP14UpdateRollbackEvidenceFile(file), /not valid JSON/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("P14 update/rollback file validator fails closed on an internally inconsistent observation", () => {
  withTempObservation(validObservation({ explicitInstallConfirmed: false }), (file) => {
    assert.throws(() => validateP14UpdateRollbackEvidenceFile(file), /explicitInstallConfirmed/i);
  });
});

test("P14 update/rollback validator is validation-only and retains the canonical evidence writer", () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts?: Record<string, string>;
  };
  assert.equal(packageJson.scripts?.["p14:evidence"], "node script/write_p14_evidence.cjs");

  const writer = fs.readFileSync(new URL("./write_p14_evidence.cjs", import.meta.url), "utf8");
  assert.match(writer, /update_rollback/);
  assert.doesNotMatch(
    fs.readFileSync(fileURLToPath(new URL("./validate_p14_update_rollback_evidence.ts", import.meta.url)), "utf8"),
    /writeFileSync|createHash|sourceArtifacts/,
    "the observation validator must not become a second P14 evidence writer",
  );
});
