const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const SRC_ROOT = path.resolve(__dirname, "..");
const WRITER = path.join(__dirname, "write_p14_evidence.cjs");

function validObservation(overrides = {}) {
  return {
    schemaVersion: "1",
    category: "update_rollback",
    platform: "darwin",
    arch: "arm64",
    baselineVersion: "0.9.0",
    targetVersion: "1.0.0",
    baselinePackageSha256: "a".repeat(64),
    targetPackageSha256: "b".repeat(64),
    updateDownloaded: true,
    explicitInstallConfirmed: true,
    installInitiated: true,
    restartObserved: true,
    postUpdateVersion: "1.0.0",
    migrationExercised: true,
    migrationSucceeded: true,
    continuityVerified: true,
    recoveryExercised: true,
    recoverySucceeded: true,
    recoveryOutcome: "retained_target",
    finalObservedVersion: "1.0.0",
    observedAt: "2026-10-15T16:00:00.000Z",
    sourceEvidence: ["signed-update-journey.json", "workspace-continuity.json"],
    ...overrides,
  };
}

function runWriter(observation) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p14-writer-"));
  const input = path.join(directory, "update-observation.json");
  const output = path.join(directory, "update-evidence.json");
  fs.writeFileSync(input, JSON.stringify(observation), "utf8");
  const result = spawnSync(process.execPath, [
    WRITER,
    "update_rollback",
    output,
    "automated",
    "v1.0.0",
    input,
  ], {
    cwd: SRC_ROOT,
    encoding: "utf8",
    env: process.env,
  });
  return { directory, input, output, result };
}

test("canonical P14 writer refuses invalid update_rollback observations", () => {
  const run = runWriter(validObservation({ explicitInstallConfirmed: false }));
  try {
    assert.notEqual(run.result.status, 0);
    assert.equal(fs.existsSync(run.output), false);
    assert.match(run.result.stderr, /update_rollback observation failed validation/i);
  } finally {
    fs.rmSync(run.directory, { recursive: true, force: true });
  }
});

test("canonical P14 writer accepts a validated update_rollback observation and hashes it", () => {
  const run = runWriter(validObservation());
  try {
    assert.equal(run.result.status, 0, run.result.stderr || run.result.stdout);
    const evidence = JSON.parse(fs.readFileSync(run.output, "utf8"));
    assert.equal(evidence.category, "update_rollback");
    assert.equal(evidence.status, "passed");
    assert.equal(evidence.sourceArtifacts.length, 1);
    assert.equal(evidence.sourceArtifacts[0].name, "update-observation.json");
    assert.match(evidence.sourceArtifacts[0].sha256, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(run.directory, { recursive: true, force: true });
  }
});
