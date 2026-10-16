"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

function observation(overrides = {}) {
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

function runWriter(value) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p14-pack-writer-"));
  const input = path.join(directory, "observation.json");
  const output = path.join(directory, "evidence.json");
  fs.writeFileSync(input, JSON.stringify(value), "utf8");
  const supports = (value.sourceEvidence || []).map((name) => {
    const file = path.join(directory, path.basename(name));
    fs.writeFileSync(file, `support:${name}\n`, "utf8");
    return file;
  });
  const result = spawnSync(process.execPath, [
    path.resolve(__dirname, "write_p14_evidence.cjs"),
    "pack_lifecycle",
    output,
    "automated",
    "v1.0.0",
    input,
    ...supports,
  ], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    env: process.env,
  });
  return { directory, input, output, result };
}

test("canonical P14 writer refuses invalid pack lifecycle observations before writing evidence", () => {
  const run = runWriter(observation({ rollbackSucceeded: false }));
  try {
    assert.notEqual(run.result.status, 0);
    assert.match(run.result.stderr, /pack_lifecycle observation failed validation/i);
    assert.equal(fs.existsSync(run.output), false);
  } finally {
    fs.rmSync(run.directory, { recursive: true, force: true });
  }
});

test("canonical P14 writer accepts a valid pack lifecycle observation and hashes all bound support", () => {
  const run = runWriter(observation());
  try {
    assert.equal(run.result.status, 0, run.result.stderr || run.result.stdout);
    const evidence = JSON.parse(fs.readFileSync(run.output, "utf8"));
    assert.equal(evidence.category, "pack_lifecycle");
    assert.equal(evidence.status, "passed");
    assert.deepEqual(evidence.sourceArtifacts.map((item) => item.name), [
      "observation.json",
      "pack-install.json",
      "pack-retry.json",
      "pack-rollback.json",
    ]);
    for (const item of evidence.sourceArtifacts) assert.match(item.sha256, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(run.directory, { recursive: true, force: true });
  }
});
