import test from "node:test";
import assert from "node:assert/strict";
import {
  validateHarvestingControls,
  validateDonorHarvestingClaim,
  validateForkHarvestingClaim,
  deriveSourceAuditStatus,
} from "./donor_harvesting_gate.mjs";

const controls = {
  schemaVersion: 1,
  sourceAuditStates: ["not_started", "metadata_reviewed", "partial_source_audit", "full_useful_package_audit"],
  forkReviewStates: ["not_applicable", "controlled_fork_reviewed", "ecosystem_screened", "material_forks_deep_reviewed"],
  forkDeltaDispositions: [
    "pending_capability_slice_review",
    "partial_source_imports_recorded_continue_capability_slice_review",
    "baseline_source_import_recorded_fork_delta_not_imported",
    "supplemental_source_import_recorded_fork_delta_not_imported",
  ],
  pathDispositions: [
    "DIRECT_REUSE", "IMPORT", "ADAPT", "REPURPOSE", "COMBINE", "GENERALIZE", "INNOVATE",
    "REFERENCE_VALIDATOR", "DEFER_WITH_TRIGGER", "EXCLUDE_DUPLICATE_AUTHORITY", "EXCLUDE_UNUSED_SCOPE",
    "EXCLUDE_RIGHTS_BLOCK", "EXCLUDE_SECURITY_RISK", "EXCLUDE_PLATFORM_MISMATCH", "REJECT_WITH_EVIDENCE",
  ],
  requiredExhaustionRecordFields: [
    "relevantDonorsInspected", "controlledForksInspected", "communityForkScreening", "upstreamTestsInspected",
    "crossDonorCompositionConsidered", "buildNewRemainder", "buildNewReason",
  ],
  forbiddenScratchBuildReasons: ["easier_to_rewrite", "different_domain", "not_designed_for_lios", "integration_is_difficult"],
};

test("controls define the canonical audit/fork vocabularies", () => {
  assert.doesNotThrow(() => validateHarvestingControls(controls));
  const bad = structuredClone(controls);
  bad.sourceAuditStates.pop();
  assert.throws(() => validateHarvestingControls(bad), /full_useful_package_audit/);
});

test("full useful-package audit requires complete path/mechanism/test disposition", () => {
  const row = {
    id: "demo",
    fullPackageSourceAuditComplete: true,
    donorFullyExhausted: false,
    sourceAuditStatus: "full_useful_package_audit",
    materialPathCount: 3,
    dispositionedMaterialPathCount: 2,
    mechanismsIdentified: ["replay"],
    mechanismsDispositioned: ["replay"],
    upstreamTestsReviewed: 2,
    upstreamTestsDispositioned: 2,
  };
  assert.throws(() => validateDonorHarvestingClaim(row, controls), /material path/);
  row.dispositionedMaterialPathCount = 3;
  assert.doesNotThrow(() => validateDonorHarvestingClaim(row, controls));
});

test("donor exhaustion requires a complete Donor Exhaustion Record and rejects shortcut reasons", () => {
  const row = {
    id: "demo",
    fullPackageSourceAuditComplete: true,
    donorFullyExhausted: true,
    sourceAuditStatus: "full_useful_package_audit",
    materialPathCount: 1,
    dispositionedMaterialPathCount: 1,
    mechanismsIdentified: ["parser"],
    mechanismsDispositioned: ["parser"],
    upstreamTestsReviewed: 1,
    upstreamTestsDispositioned: 1,
    donorExhaustionRecord: {
      relevantDonorsInspected: ["a"],
      controlledForksInspected: ["fork-a"],
      communityForkScreening: "screened",
      upstreamTestsInspected: ["tests/parser.test"],
      crossDonorCompositionConsidered: ["a+b"],
      buildNewRemainder: "LiOS adapter",
      buildNewReason: "integration_is_difficult",
    },
  };
  assert.throws(() => validateDonorHarvestingClaim(row, controls), /forbidden scratch-build reason/);
  row.donorExhaustionRecord.buildNewReason = "canonical LiOS authority adapter is product-specific and no donor owns that seam";
  assert.doesNotThrow(() => validateDonorHarvestingClaim(row, controls));
});

test("controlled fork review cannot claim imported or invented delta states", () => {
  const mirror = {
    id: "fork-a",
    deltaReviewStatus: "controlled_fork_reviewed",
    materialDeltaDisposition: "pending_capability_slice_review",
    rightsProvenanceGate: "exact_source_pin_and_path_rights_required_before_import",
    nextReviewTrigger: "when owning workstream selects a capability slice",
  };
  assert.doesNotThrow(() => validateForkHarvestingClaim(mirror, controls));
  mirror.materialDeltaDisposition = "imported";
  assert.throws(() => validateForkHarvestingClaim(mirror, controls), /invalid fork delta disposition/);
  mirror.materialDeltaDisposition = "invented_state";
  assert.throws(() => validateForkHarvestingClaim(mirror, controls), /invalid fork delta disposition/);
});

test("source audit status is derived conservatively when legacy rows lack explicit state", () => {
  assert.equal(
    deriveSourceAuditStatus({ fullPackageSourceAuditComplete: false, registeredSourcePaths: [], componentSubsystems: [] }, controls),
    "metadata_reviewed",
  );
  assert.equal(
    deriveSourceAuditStatus({ fullPackageSourceAuditComplete: false, registeredSourcePaths: ["x"], componentSubsystems: [] }, controls),
    "partial_source_audit",
  );
  assert.equal(
    deriveSourceAuditStatus({ fullPackageSourceAuditComplete: true, sourceAuditStatus: "full_useful_package_audit" }, controls),
    "full_useful_package_audit",
  );
});
