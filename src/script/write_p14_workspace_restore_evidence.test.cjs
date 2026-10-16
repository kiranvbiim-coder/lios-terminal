"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const WRITER = path.resolve(__dirname, "write_p14_evidence.cjs");
const SRC_ROOT = path.resolve(__dirname, "..");

function observation(overrides = {}) {
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

function runWriter(value, supportNames = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p14-workspace-writer-"));
  const input = path.join(directory, "workspace-observation.json");
  const output = path.join(directory, "workspace-evidence.json");
  fs.writeFileSync(input, JSON.stringify(value), "utf8");
  const supports = supportNames.map((name) => {
    const file = path.join(directory, name);
    fs.writeFileSync(file, `support:${name}\n`, "utf8");
    return file;
  });
  const result = spawnSync(process.execPath, [
    WRITER,
    "workspace_restore",
    output,
    "automated",
    "v1.0.0",
    input,
    ...supports,
  ], { cwd: SRC_ROOT, encoding: "utf8", env: process.env });
  return { directory, input, output, supports, result };
}

test("canonical P14 writer refuses invalid workspace_restore observations", () => {
  const run = runWriter(observation({ cleanProfileEstablished: false }), ["backup-create.json", "restore-worker.json", "reopen-walkthrough.json"]);
  try {
    assert.notEqual(run.result.status, 0);
    assert.equal(fs.existsSync(run.output), false);
    assert.match(run.result.stderr, /workspace_restore observation failed validation/i);
  } finally {
    fs.rmSync(run.directory, { recursive: true, force: true });
  }
});

test("canonical P14 writer refuses observation support artifacts that are named but not supplied", () => {
  const run = runWriter(observation(), ["backup-create.json", "restore-worker.json"]);
  try {
    assert.notEqual(run.result.status, 0);
    assert.equal(fs.existsSync(run.output), false);
    assert.match(run.result.stderr, /support artifact.*reopen-walkthrough\.json/i);
  } finally {
    fs.rmSync(run.directory, { recursive: true, force: true });
  }
});

test("canonical P14 writer refuses path-like sourceEvidence aliases instead of collapsing them to basenames", () => {
  const value = observation({ sourceEvidence: ["backup-create.json", "nested/restore-worker.json", "reopen-walkthrough.json"] });
  const run = runWriter(value, ["backup-create.json", "restore-worker.json", "reopen-walkthrough.json"]);
  try {
    assert.notEqual(run.result.status, 0);
    assert.equal(fs.existsSync(run.output), false);
    assert.match(run.result.stderr, /sourceEvidence.*basename/i);
  } finally {
    fs.rmSync(run.directory, { recursive: true, force: true });
  }
});

test("canonical P14 writer hashes the observation and every named workspace restore support artifact", () => {
  const run = runWriter(observation(), ["backup-create.json", "restore-worker.json", "reopen-walkthrough.json"]);
  try {
    assert.equal(run.result.status, 0, run.result.stderr || run.result.stdout);
    const evidence = JSON.parse(fs.readFileSync(run.output, "utf8"));
    assert.equal(evidence.category, "workspace_restore");
    assert.equal(evidence.status, "passed");
    assert.deepEqual(evidence.sourceArtifacts.map((item) => item.name), [
      "workspace-observation.json",
      "backup-create.json",
      "restore-worker.json",
      "reopen-walkthrough.json",
    ]);
    for (const item of evidence.sourceArtifacts) assert.match(item.sha256, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(run.directory, { recursive: true, force: true });
  }
});
