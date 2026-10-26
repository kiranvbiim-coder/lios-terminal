import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WS64_SCENARIOS } from "./ws64ScenarioMatrix";
import { validateWS65ReleaseBundle } from "./ws65InstalledUxValidator";
import { P14_RELEASE_EVIDENCE_CATEGORIES } from "../shared/p14ReleaseEvidence";

const at = "2026-10-25T10:00:00.000+05:30";
const commitSha = "b".repeat(40);
const digest = (data: string) => crypto.createHash("sha256").update(data).digest("hex");

function buildSyntheticFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-ws65-validator-test-"));
  const write = (name: string, data: string) => {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data, "utf8");
    return digest(data);
  };
  const evidenceKinds = [
    "installer_log", "screen_recording", "screenreader_trace", "performance_trace",
    "run_receipt", "artifact_export", "source_provenance", "privacy_recovery",
  ];
  const runs = (["macos", "windows"] as const).map((platform) => {
    const installerName = "signed-installer.bin";
    const installedAppName = "installed-executable.bin";
    const installerSha256 = write(`${platform}/${installerName}`, `TEST ONLY signed installer on ${platform}`);
    const installedAppSha256 = write(`${platform}/${installedAppName}`, `TEST ONLY executable on ${platform}`);
    const evidence = evidenceKinds.map((kind, index) => {
      const name = `proof-${index}.log`;
      return { id: `proof${index}`, kind, name, sha256: write(`${platform}/${name}`, `TEST ONLY ${kind} on ${platform}`) };
    });
    return {
      platform, arch: platform === "macos" ? "arm64" : "x64",
      osVersion: platform === "macos" ? "macOS synthetic" : "Windows synthetic",
      deviceProfile: "SYNTHETIC UNIT TEST - NOT A REAL DEVICE",
      installerName, installerSha256, installedAppName, installedAppSha256,
      signedPackageVerified: true, macNotarizationVerified: platform === "macos",
      cleanInstallCompleted: true, firstUseCompleted: true, keyboardOnlyCompleted: true,
      assistiveTechnology: platform === "macos" ? "voiceover" : "narrator",
      screenreaderWalkthroughCompleted: true, reducedMotionVerified: true, zoom200PercentVerified: true,
      testedViewportWidths: [320, 390, 768, 1440], unreconciledCriticalDefects: 0,
      evidence, scenarioRuns: WS64_SCENARIOS.map(({ id, requiredManual }) => ({
        id, status: "passed", executedInInstalledClient: true, simulatedOrFixtureData: false,
        developerIntervention: false,
        gateProofs: requiredManual.map((gateId) => ({ gateId, evidenceIds: ["proof1", "proof6"] })),
      })),
    };
  });
  const signoffEvidenceSha256 = write("reviewer-signoff.txt", "SYNTHETIC TEST - NOT A SIGNED REVIEW");
  const uxReport = {
    schemaVersion: "1", status: "passed", releaseTag: "v1.0.0", packageVersion: "1.0.0", generatedAt: at,
    build: { commitSha, packaged: true, audience: "client", exactSignedReleaseCandidate: true },
    releaseOwner: { reviewer: "Synthetic Test Reviewer", signedOffAt: at, signoffEvidenceSha256 },
    runs,
  };
  write("ws65-report.json", JSON.stringify(uxReport));
  const flagshipRun = (platform: "macos" | "windows") => ({
    platform, arch: platform === "macos" ? "arm64" : "x64", workflow: "valuation",
    cleanProfileLaunch: true, signedPackageVerified: true,
    notarizedPackageVerified: platform === "macos", installerVerified: true,
    authenticated: true, projectCreatedOrOpened: true,
    realUserOwnedAiCredential: true, nativeSecretCustody: "native_protected",
    aiProvider: "synthetic-provider", aiModel: "synthetic-model", providerVerificationPassed: true,
    credentialPersistedAcrossRelaunch: true, credentialMaterialLogged: false,
    realUserControlledDataSource: true, dataSourceAuthorized: true, financeQuestionSubmitted: true,
    deterministicExecutionObserved: true, aiSynthesisObserved: true, transmissionPolicyConfirmed: true,
    executionReceiptInspected: true, provenanceInspected: true, artifactKept: true,
    artifactRevisionApplied: true,
    export: { completed: true, format: "json", fileSha256: digest("synthetic exported bytes"), openedOutsideLios: true },
    desktopQuitCompleted: true, desktopRelaunchCompleted: true,
    projectReopened: true, chatReopened: true, artifactReopened: true,
    connectorOrProviderRevoked: true, revokedAccessFailsClosed: true,
    mockOrFixtureDataUsed: false, serviceOnlyExecution: false, developerInterventionRequired: false,
    evidenceRefs: [0, 1, 2].map((i) => ({ label: `synthetic${i}`, sha256: digest(`synthetic-reference-${i}`) })),
  });
  const flagshipReport = {
    schemaVersion: "1", status: "passed", releaseTag: "v1.0.0", packageVersion: "1.0.0",
    generatedAt: at, build: { commitSha, audience: "client", packaged: true, exactReleaseCandidate: true },
    runs: [flagshipRun("macos"), flagshipRun("windows")],
    notes: ["SYNTHETIC TEST DATA ONLY - this JSON is not release proof"],
  };
  const flagshipSha = write("flagship-release-report.json", JSON.stringify(flagshipReport));
  for (const category of P14_RELEASE_EVIDENCE_CATEGORIES) {
    const record = {
      schemaVersion: "1", category, status: "passed",
      releaseTag: "v1.0.0", packageVersion: "1.0.0", generatedAt: at,
      evidenceKind: "human_assisted", platform: "SYNTHETIC TEST ONLY",
      sourceArtifacts: [{
        name: category === "flagship" ? "flagship-release-report.json" : `synthetic-${category}.txt`,
        sha256: category === "flagship" ? flagshipSha : digest(`p14-${category}`),
      }],
      notes: ["SYNTHETIC TEST DATA ONLY"],
    };
    write(`p14/p14-${category.replaceAll("_", "-")}-evidence.json`, JSON.stringify(record));
  }
  return {
    dir,
    paths: {
      report: path.join(dir, "ws65-report.json"),
      evidenceDir: dir,
      flagshipReport: path.join(dir, "flagship-release-report.json"),
      p14EvidenceDir: path.join(dir, "p14"),
      ownerSignoffFile: path.join(dir, "reviewer-signoff.txt"),
      expectedReleaseTag: "v1.0.0", expectedCommit: commitSha, expectedPackageVersion: "1.0.0",
    },
  };
}

test("WS-65 validator validates syntactically complete synthetic receipts without claiming real observations", () => {
  const fixture = buildSyntheticFixture();
  try {
    const result = validateWS65ReleaseBundle(fixture.paths);
    assert.equal(result.status, "WS65_SUPPLIED_EVIDENCE_VALIDATED");
    assert.equal(result.platformCount, 2);
    assert.equal(result.scenarioRuns, 14);
    assert.equal(result.hashedArtifactsChecked, 16);
    assert.equal(result.p14CategoriesChecked, 14);
    assert.equal(result.p14TaskCount, 12);
    assert.equal(result.physicalObservationIndependentlyVerified, false, "a synthetically valid source fixture is never independent physical proof");
  } finally { fs.rmSync(fixture.dir, { recursive: true, force: true }); }
});

test("WS-65 validator refuses changed installed executable, missing category and unbound flagship", () => {
  const fixture = buildSyntheticFixture();
  try {
    const { paths, dir } = fixture;
    fs.appendFileSync(path.join(dir, "macos", "installed-executable.bin"), "\nTAMPERED");
    assert.throws(() => validateWS65ReleaseBundle(paths), /installed executable bytes do not match/);
    fs.writeFileSync(path.join(dir, "macos", "installed-executable.bin"), "TEST ONLY executable on macos");
    fs.unlinkSync(path.join(dir, "p14", "p14-narrator-evidence.json"));
    assert.throws(() => validateWS65ReleaseBundle(paths), /incomplete/);
    const p14Narrator = { schemaVersion: "1", category: "narrator", status: "passed", releaseTag: "v1.0.0",
      packageVersion: "1.0.0", generatedAt: at, evidenceKind: "human_assisted", platform: "SYNTHETIC TEST ONLY",
      sourceArtifacts: [{ name: "narrator.txt", sha256: digest("narrator") }] };
    fs.writeFileSync(path.join(dir, "p14", "p14-narrator-evidence.json"), JSON.stringify(p14Narrator));
    fs.appendFileSync(paths.flagshipReport, " ");
    assert.throws(() => validateWS65ReleaseBundle(paths), /cryptographically bound/);
  } finally { fs.rmSync(fixture.dir, { recursive: true, force: true }); }
});

test("WS-65 rejects evidence reached through a linked parent directory", t => {
  const fixture = buildSyntheticFixture();
  t.after(() => fs.rmSync(fixture.dir, { recursive: true, force: true }));
  const real = path.join(fixture.dir, "real-macos");
  fs.renameSync(path.join(fixture.dir, "macos"), real);
  fs.symlinkSync(real, path.join(fixture.dir, "macos"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => validateWS65ReleaseBundle(fixture.paths), /nonlinked directory/);
});