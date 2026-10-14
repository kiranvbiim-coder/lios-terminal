import assert from "node:assert/strict";
import test from "node:test";
import {
  P11_CONFORMANCE_CASES,
  P11ResourceGate,
  assertP11CapabilityEntitlement,
  evaluateP11Performance,
  evaluateP11UpstreamPromotion,
  expandP11ManagedPackIds,
  generateP11CycloneDxSbom,
  generateP11ThirdPartyNotices,
  publicP11CapabilityLabel,
  pythonPackEnvironmentPlan,
  validateP11CandidateInventory,
  validateP11ConformanceScalar,
} from "./p11Governance";

const candidates = [
  { id: "good", repository: "owner/good", observedCommit: "a".repeat(40), license: "MIT", decision: "library", pack: "finance", launch: true },
  { id: "blocked", repository: "owner/blocked", license: "GPL-3.0", decision: "reject", pack: "strategy-backtest", launch: false },
];

test("P11 governance rejects unresolved intake and enforces bundled pins", () => {
  assert.deepEqual(validateP11CandidateInventory({
    schemaVersion: "1",
    policy: { decisions: ["library", "vendor", "sidecar", "connector", "reference", "reject"], noAdaptLater: true },
    candidates,
  }), []);
  const errors = validateP11CandidateInventory({
    schemaVersion: "1",
    policy: { noAdaptLater: false },
    candidates: [{ ...candidates[0], decision: "adapt_later", bundled: true, observedCommit: undefined }],
  });
  assert.ok(errors.length >= 3);
});

test("P11 produces per-pack SBOM and notices without reference/reject candidates", () => {
  const sbom = generateP11CycloneDxSbom("finance", candidates);
  assert.equal(sbom.components.length, 1);
  assert.match(generateP11ThirdPartyNotices("finance", candidates), /MIT/);
});

test("P11 upstream promotion is fail-closed until every release gate passes", () => {
  const base = {
    exactPin: true,
    licenseReviewed: true,
    dependencyDiffReviewed: true,
    securityScanPassed: true,
    upstreamTestsPassed: true,
    liosConformancePassed: true,
    benchmarkPassed: true,
    sbomGenerated: true,
    noticesGenerated: true,
    signedCandidateBuilt: true,
  };
  assert.equal(evaluateP11UpstreamPromotion(base).approved, true);
  assert.deepEqual(evaluateP11UpstreamPromotion({ ...base, securityScanPassed: false }).missing, ["securityScanPassed"]);
});

test("P11 Python environments are isolated per pack and uv-first", () => {
  const plan = pythonPackEnvironmentPlan({
    rootDir: "/tmp/lios-pack-envs",
    packId: "lios.portfolio",
    packVersion: "1.2.3",
    pythonVersion: "3.12",
    uvAvailable: true,
    requirementsFile: "/tmp/portfolio.lock",
  });
  assert.equal(plan.isolated, true);
  assert.equal(plan.create.command, "uv");
  assert.match(plan.environmentDir, /lios\.portfolio/);
});

test("P11 resource gate enforces dataset/concurrency limits and releases slots", async () => {
  const gate = new P11ResourceGate({ maxConcurrency: 1, maxDatasetMb: 1, maxTimeoutSec: 1 });
  assert.rejects(() => gate.run({ datasetBytes: 2 * 1024 * 1024, execute: async () => 1 }), /dataset/i);
  const value = await gate.run({ datasetBytes: 1, execute: async () => 7 });
  assert.equal(value, 7);
  assert.equal(gate.snapshot().active, 0);
});

test("P11 commercial entitlement gates capability rather than donor dependency", () => {
  assert.doesNotThrow(() => assertP11CapabilityEntitlement({ requiredEntitlement: "capability:risk", grantedEntitlements: ["capability:risk"] }));
  assert.throws(() => assertP11CapabilityEntitlement({ requiredEntitlement: "capability:risk", grantedEntitlements: [] }), /entitlement/i);
  assert.equal(publicP11CapabilityLabel("portfolio.optimize.hrp"), "Advanced Portfolio Optimization");
});

test("P11 bridge maps hidden packs onto the existing managed runtime without a second installer", () => {
  const ids = expandP11ManagedPackIds(["lios.portfolio", "lios.research-documents"]);
  assert.ok(ids.includes("core"));
  assert.ok(ids.includes("optimization"));
  assert.ok(ids.includes("research-sec"));
  assert.ok(ids.includes("research-docs"));
});

test("P11 conformance corpus is explicit and validator never averages disagreements", () => {
  assert.ok(P11_CONFORMANCE_CASES.length >= 4);
  assert.equal(validateP11ConformanceScalar(1, 1, { absoluteTolerance: 0 }).state, "match");
  assert.equal(validateP11ConformanceScalar(1, 2, { absoluteTolerance: 0, relativeTolerance: 0 }).state, "discrepancy");
});

test("P11 performance budgets fail loudly when exceeded", () => {
  assert.deepEqual(evaluateP11Performance({
    baseInstallerIncrementMb: 1,
    packMetadataColdStartMs: 100,
    inProcessRouteWarmMs: 10,
    sidecarHandshakeMs: 1000,
    sidecarIdleMemoryMb: 128,
  }), []);
  assert.ok(evaluateP11Performance({
    baseInstallerIncrementMb: 6,
    packMetadataColdStartMs: 100,
    inProcessRouteWarmMs: 10,
    sidecarHandshakeMs: 1000,
    sidecarIdleMemoryMb: 128,
  }).length > 0);
});
