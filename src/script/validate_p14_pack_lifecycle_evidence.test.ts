import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateP14PackLifecycleEvidenceFile } from "./validate_p14_pack_lifecycle_evidence";

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

function withTempObservation(value: unknown, run: (file: string) => void) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p14-pack-"));
  const file = path.join(directory, "observation.json");
  try {
    fs.writeFileSync(file, JSON.stringify(value), "utf8");
    run(file);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("P14 pack lifecycle file validator accepts a complete observation without rewriting it", () => {
  withTempObservation(validObservation(), (file) => {
    const before = fs.readFileSync(file, "utf8");
    const result = validateP14PackLifecycleEvidenceFile(file);
    assert.equal(result.path, path.resolve(file));
    assert.equal(result.observation.packId, "lios.platform-proof");
    assert.equal(result.observation.rollbackVersion, "1.0.0");
    assert.equal(fs.readFileSync(file, "utf8"), before);
  });
});

test("P14 pack lifecycle file validator refuses missing paths, missing files and malformed JSON", () => {
  assert.throws(() => validateP14PackLifecycleEvidenceFile(""), /path is required/i);
  assert.throws(() => validateP14PackLifecycleEvidenceFile("/definitely/not/present/pack-observation.json"), /does not exist/i);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p14-pack-"));
  const file = path.join(directory, "observation.json");
  try {
    fs.writeFileSync(file, "{not-json", "utf8");
    assert.throws(() => validateP14PackLifecycleEvidenceFile(file), /not valid JSON/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("P14 pack lifecycle file validator fails closed on an incomplete lifecycle", () => {
  withTempObservation(validObservation({ rollbackSucceeded: false }), (file) => {
    assert.throws(() => validateP14PackLifecycleEvidenceFile(file), /rollbackSucceeded/i);
  });
});

test("P14 pack lifecycle validator remains read-only and the existing P14 writer remains canonical", () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts?: Record<string, string> };
  assert.equal(packageJson.scripts?.["p14:evidence"], "node script/write_p14_evidence.cjs");
  const validator = fs.readFileSync(fileURLToPath(new URL("./validate_p14_pack_lifecycle_evidence.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(validator, /writeFileSync|createHash|sourceArtifacts/);
});
