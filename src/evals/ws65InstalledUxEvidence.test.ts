import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WS64_SCENARIOS } from "./ws64ScenarioMatrix";
import { ws65InstalledUxReleaseReportSchema } from "./ws65InstalledUxEvidence";
import { validateWS65ReleaseBundle } from "./ws65InstalledUxValidator";

const sha = "a".repeat(64);
const commit = "b".repeat(40);
const categories = ["installer_log", "screen_recording", "screenreader_trace", "performance_trace", "run_receipt", "artifact_export", "source_provenance", "privacy_recovery"] as const;
const evidence = categories.map((kind, i) => ({ id: `e${i}`, name: `proof-${i}.txt`, sha256: sha, kind }));
const scenarioRuns = WS64_SCENARIOS.map(({ id, requiredManual }) => ({
  id, status: "passed", executedInInstalledClient: true,
  simulatedOrFixtureData: false, developerIntervention: false,
  gateProofs: requiredManual.map((gateId) => ({ gateId, evidenceIds: ["e1", "e2"] })),
}));
const valid = () => ({
  schemaVersion: "1", status: "passed", releaseTag: "v1.0.0", packageVersion: "1.0.0",
  generatedAt: "2026-10-25T10:00:00.000+05:30",
  build: { commitSha: commit, packaged: true, audience: "client", exactSignedReleaseCandidate: true },
  releaseOwner: { reviewer: "Test reviewer only", signedOffAt: "2026-10-25T10:00:00.000+05:30", signoffEvidenceSha256: sha },
  runs: (["macos", "windows"] as const).map((platform) => ({
    platform, arch: platform === "macos" ? "arm64" : "x64",
    osVersion: platform === "macos" ? "macOS test" : "Windows test",
    deviceProfile: "Synthetic test fixture only",
    installerSha256: sha, installedAppSha256: sha, signedPackageVerified: true,
    macNotarizationVerified: platform === "macos",
    cleanInstallCompleted: true, firstUseCompleted: true,
    keyboardOnlyCompleted: true, assistiveTechnology: platform === "macos" ? "voiceover" : "narrator",
    screenreaderWalkthroughCompleted: true, reducedMotionVerified: true,
    zoom200PercentVerified: true, testedViewportWidths: [320, 390, 768, 1440],
    unreconciledCriticalDefects: 0, evidence, scenarioRuns,
  })),
});
const validParsed = () => ws65InstalledUxReleaseReportSchema.parse(valid());

test("WS-65 synthetic contract fixture contains exactly seven scenarios on two target platforms", () => {
  const report = validParsed();
  assert.equal(report.runs.length, 2);
  assert.deepEqual(report.runs.map((item) => item.platform), ["macos", "windows"]);
  for (const run of report.runs) assert.equal(run.scenarioRuns.length, 7);
  // A schema parse is NOT proof this synthetic report happened in a real app.
});

test("WS-65 missing, duplicate or unproven gates never pass", () => {
  const missing = valid();
  missing.runs[0]!.scenarioRuns[0]!.gateProofs.pop();
  assert.equal(ws65InstalledUxReleaseReportSchema.safeParse(missing).success, false);
  const dupe = valid();
  dupe.runs[0]!.scenarioRuns[0]!.gateProofs[1]!.gateId = dupe.runs[0]!.scenarioRuns[0]!.gateProofs[0]!.gateId;
  assert.equal(ws65InstalledUxReleaseReportSchema.safeParse(dupe).success, false);
  const badRef = valid();
  badRef.runs[1]!.scenarioRuns[0]!.gateProofs[0]!.evidenceIds = ["nonexistent"];
  assert.equal(ws65InstalledUxReleaseReportSchema.safeParse(badRef).success, false);
  const duplicatePlatform = valid();
  duplicatePlatform.runs[1]!.platform = "macos";
  assert.equal(ws65InstalledUxReleaseReportSchema.safeParse(duplicatePlatform).success, false);
});

test("WS-65 denies simulated releases and OS accessibility shortcuts", () => {
  const cases: Array<(input: ReturnType<typeof valid>) => void> = [
    (v) => { v.runs[0]!.scenarioRuns[0]!.simulatedOrFixtureData = true; },
    (v) => { v.runs[0]!.scenarioRuns[0]!.developerIntervention = true; },
    (v) => { v.runs[0]!.scenarioRuns[0]!.executedInInstalledClient = false; },
    (v) => { v.runs[0]!.macNotarizationVerified = false; },
    (v) => { v.runs[1]!.assistiveTechnology = "voiceover"; },
    (v) => { v.runs[0]!.testedViewportWidths = [390, 768, 1440]; },
    (v) => { v.runs[0]!.unreconciledCriticalDefects = 1; },
    (v) => { v.runs[1]!.screenreaderWalkthroughCompleted = false; },
    (v) => { v.runs[1]!.evidence = v.runs[1]!.evidence.filter((item) => item.kind !== "performance_trace"); },
    (v) => { v.runs[0]!.evidence[0]!.name = "../steal.json"; },
    (v) => { v.build.commitSha = "invalid"; },
    (v) => { v.build.exactSignedReleaseCandidate = false; },
    (v) => { v.releaseTag = "v9.9.9"; },
    (v) => { v.releaseOwner.signoffEvidenceSha256 = "NO EVIDENCE"; },
  ];
  for (const mutate of cases) {
    const report = valid();
    mutate(report);
    assert.equal(ws65InstalledUxReleaseReportSchema.safeParse(report).success, false, mutate.toString());
  }
});

test("WS-65 missing or tampered evidence files never produce a source-only release PASS", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-ws65-negative-"));
  try {
    const reportPath = path.join(dir, "report.json");
    fs.writeFileSync(reportPath, JSON.stringify(valid()));
    const correct = crypto.createHash("sha256").update("original").digest("hex");
    fs.writeFileSync(path.join(dir, "signoff.txt"), "original");
    assert.notEqual(correct, sha);
    assert.throws(() => validateWS65ReleaseBundle({
      report: reportPath,
      evidenceDir: dir, flagshipReport: reportPath, p14EvidenceDir: dir,
      ownerSignoffFile: path.join(dir, "signoff.txt"),
      expectedCommit: commit, expectedPackageVersion: "1.0.0", expectedReleaseTag: "v1.0.0",
    }), /Owner sign-off file missing or does not match recorded SHA256/);
    const modified = valid(); modified.releaseOwner.signoffEvidenceSha256 = correct;
    fs.writeFileSync(reportPath, JSON.stringify(modified));
    assert.throws(() => validateWS65ReleaseBundle({
      report: reportPath,
      evidenceDir: dir, flagshipReport: reportPath, p14EvidenceDir: dir,
      ownerSignoffFile: path.join(dir, "signoff.txt"),
      expectedCommit: commit, expectedPackageVersion: "1.0.0", expectedReleaseTag: "v1.0.0",
    }), /ENOENT|Evidence is not a nonempty regular file/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
