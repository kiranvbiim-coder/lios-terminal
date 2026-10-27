import test from "node:test";
import assert from "node:assert/strict";
import {
  TARGET_PACKAGE_NAMES, checkRegisteredDestination, buildDonorGapReport, loadDonorGapReport,
} from "./donor_gap_audit.mjs";

test("complete gap report preserves all 92 donors and does not equate a pinned donor with shipping", () => {
  const report = loadDonorGapReport();
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.baselineCount, 92);
  assert.equal(report.rows.length, 92);
  assert.equal(new Set(report.rows.map(row => row.id)).size, 92);
  assert.equal(Object.values(report.countsByStatus).reduce((a, b) => a + b, 0), 92);
  assert.equal(Object.values(report.countsByWorkGroup).reduce((a, b) => a + b, 0), 92);
  assert.equal(report.sourceFileAuditsComplete, 0);
  assert.equal(report.packagedAccepted, 0);
});

test("known installed components and missing runtime integrations are distinguished accurately", () => {
  const rows = new Map(loadDonorGapReport().rows.map(row => [row.id, row]));
  for (const id of ["dockview", "tiptap", "univer", "echarts", "duckdb"]) {
    assert.equal(rows.get(id).installedKnownPackages.length > 0, true, id + " has a locked declared package");
  }
  for (const id of ["assistant-ui", "tool-ui", "langgraphjs", "perspective", "polars"]) {
    assert.deepEqual(rows.get(id).installedKnownPackages, [], id + " is not an installed named Node donor");
    assert.equal(rows.get(id).packagedAccepted, false);
    assert.equal(rows.get(id).group, "import_or_finish_gap");
  }
  assert.equal(rows.get("openclaw").group, "import_or_finish_gap");
  assert.equal(rows.get("openclaw").sourcePathsRecorded > 0, true);
  assert.equal(rows.get("openclaw").sourceFileAuditComplete, false);
});

test("read-only gap audit keeps reference and blocked licenses out of import queue", () => {
  const rows = new Map(loadDonorGapReport().rows.map(row => [row.id, row]));
  for (const id of ["backtrader", "backtesting-py", "freqtrade", "vectorbt"]) {
    assert.equal(rows.get(id).group, "exclude_or_reference");
  }
  assert.equal(rows.get("ollama").group, "qualify_existing_integration");
  assert.equal(rows.get("openlineage").group, "qualify_existing_integration");
});

test("file and exact npm target checks never promote documentation to running code", () => {
  const present = name => name === "src/client/src/a.ts";
  assert.equal(checkRegisteredDestination("client/src/a.ts", {}, present, {}), "present");
  assert.equal(checkRegisteredDestination("client/src/missing.ts", {}, present, {}), "missing");
  assert.equal(checkRegisteredDestination("npm:@univerjs/presets@1.0.0-rc.0", {}, present,
    { "@univerjs/presets": "1.0.0-rc.0" }), "present");
  assert.equal(checkRegisteredDestination("npm:@univerjs/presets@1.0.0-rc.0", {}, present,
    { "@univerjs/presets": "1.0.0-rc.1" }), "missing");
  assert.equal(checkRegisteredDestination("../etc/passwd", {}, present, {}), "unverifiable");
  assert.equal(checkRegisteredDestination("src/../../etc/passwd", {}, present, {}), "unverifiable");
  assert.equal(checkRegisteredDestination("npm:bad", {}, present, {}), "unverifiable");
  assert.equal(Array.isArray(TARGET_PACKAGE_NAMES["assistant-ui"]), true);
});

test("report fails on drift in canonical status, donor count or declared source identity", () => {
  const good = {
    baseline: { donors: Array.from({ length: 92 }, (_, i) => ({
      id: `r${i}`, repository: `owner/repo${i}`, currentTruthStatus: "documented_only",
      canonicalOwner: "P4", declaredDecision: "adapt",
    })) },
    ledger: { baselineDonors: Array.from({ length: 92 }, (_, i) => ({
      id: `r${i}`, upstreamRepository: `owner/repo${i}`, baselineTruthStatus: "documented_only",
      priorityBand: "P2_DEPENDENCY_DRIVEN", sourcePin: null,
      registeredSourcePaths: [], fullPackageSourceAuditComplete: false,
      donorFullyExhausted: false, packagedShippingPointAccepted: false,
      ownerReviewGate: "review", nextExecutionPhase: "verify",
    })) },
    components: { components: [] },
  };
  assert.equal(buildDonorGapReport(good).baselineCount, 92);
  assert.throws(() => buildDonorGapReport({ ...good, ledger: { baselineDonors: [] } }), /complete canonical/);
  good.ledger.baselineDonors[0].baselineTruthStatus = "runtime_integrated";
  assert.throws(() => buildDonorGapReport(good), /Donor truth drift/);
});
