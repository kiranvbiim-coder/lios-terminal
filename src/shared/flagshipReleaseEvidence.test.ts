import assert from "node:assert/strict";
import test from "node:test";
import { flagshipReleaseReportSchema } from "./flagshipReleaseEvidence";

const hash = "a".repeat(64);
const commit = "b".repeat(40);

function run(platform: "macos" | "windows") {
  return {
    platform,
    arch: platform === "macos" ? "arm64" : "x64",
    workflow: "valuation" as const,
    cleanProfileLaunch: true as const,
    signedPackageVerified: true as const,
    notarizedPackageVerified: platform === "macos",
    installerVerified: true as const,
    authenticated: true as const,
    projectCreatedOrOpened: true as const,
    realUserOwnedAiCredential: true as const,
    nativeSecretCustody: "native_protected" as const,
    aiProvider: "provider",
    aiModel: "model",
    providerVerificationPassed: true as const,
    credentialPersistedAcrossRelaunch: true as const,
    credentialMaterialLogged: false as const,
    realUserControlledDataSource: true as const,
    dataSourceAuthorized: true as const,
    financeQuestionSubmitted: true as const,
    deterministicExecutionObserved: true as const,
    aiSynthesisObserved: true as const,
    transmissionPolicyConfirmed: true as const,
    executionReceiptInspected: true as const,
    provenanceInspected: true as const,
    artifactKept: true as const,
    artifactRevisionApplied: true as const,
    export: {
      completed: true as const,
      format: "xlsx" as const,
      fileSha256: hash,
      openedOutsideLios: true as const,
    },
    desktopQuitCompleted: true as const,
    desktopRelaunchCompleted: true as const,
    projectReopened: true as const,
    chatReopened: true as const,
    artifactReopened: true as const,
    connectorOrProviderRevoked: true as const,
    revokedAccessFailsClosed: true as const,
    mockOrFixtureDataUsed: false as const,
    serviceOnlyExecution: false as const,
    developerInterventionRequired: false as const,
    evidenceRefs: [
      { label: "screen recording", sha256: hash },
      { label: "sanitized execution trace", sha256: hash },
      { label: "exported workbook", sha256: hash },
    ],
  };
}

function report() {
  return {
    schemaVersion: "1" as const,
    status: "passed" as const,
    releaseTag: "v1.0.0",
    packageVersion: "1.0.0",
    generatedAt: "2026-10-01T00:00:00+00:00",
    build: {
      commitSha: commit,
      audience: "client" as const,
      packaged: true as const,
      exactReleaseCandidate: true as const,
    },
    runs: [run("macos"), run("windows")],
    notes: [],
  };
}

test("packaged flagship report requires both complete client platform journeys", () => {
  const parsed = flagshipReleaseReportSchema.parse(report());
  assert.equal(parsed.runs.length, 2);
});

test("service-only or fixture-backed proof cannot satisfy flagship release", () => {
  const serviceOnly = report();
  serviceOnly.runs[0] = { ...serviceOnly.runs[0], serviceOnlyExecution: true } as never;
  assert.throws(() => flagshipReleaseReportSchema.parse(serviceOnly));

  const fixtures = report();
  fixtures.runs[1] = { ...fixtures.runs[1], mockOrFixtureDataUsed: true } as never;
  assert.throws(() => flagshipReleaseReportSchema.parse(fixtures));
});

test("release proof requires revocation fail-closed and relaunch continuity", () => {
  const revoked = report();
  revoked.runs[0] = { ...revoked.runs[0], revokedAccessFailsClosed: false } as never;
  assert.throws(() => flagshipReleaseReportSchema.parse(revoked));

  const relaunch = report();
  relaunch.runs[1] = { ...relaunch.runs[1], artifactReopened: false } as never;
  assert.throws(() => flagshipReleaseReportSchema.parse(relaunch));
});

test("macOS packaged flagship proof requires notarization", () => {
  const value = report();
  value.runs[0] = { ...value.runs[0], notarizedPackageVerified: false };
  assert.throws(() => flagshipReleaseReportSchema.parse(value));
});

test("one platform cannot stand in for both supported desktop platforms", () => {
  const value = report();
  value.runs = [run("macos"), run("macos")];
  assert.throws(() => flagshipReleaseReportSchema.parse(value));
});
