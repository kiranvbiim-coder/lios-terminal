import assert from "node:assert/strict";

const REQUIRED_AUDIT_STATES = [
  "not_started",
  "metadata_reviewed",
  "partial_source_audit",
  "full_useful_package_audit",
];
const REQUIRED_FORK_STATES = [
  "not_applicable",
  "controlled_fork_reviewed",
  "ecosystem_screened",
  "material_forks_deep_reviewed",
];

export function validateHarvestingControls(controls) {
  assert.equal(controls.schemaVersion, 1, "harvesting controls schemaVersion must be 1");
  for (const state of REQUIRED_AUDIT_STATES) {
    assert.ok(controls.sourceAuditStates?.includes(state), `missing source audit state ${state}`);
  }
  for (const state of REQUIRED_FORK_STATES) {
    assert.ok(controls.forkReviewStates?.includes(state), `missing fork review state ${state}`);
  }
  assert.ok(Array.isArray(controls.pathDispositions) && controls.pathDispositions.includes("REJECT_WITH_EVIDENCE"));
  assert.ok(Array.isArray(controls.forkDeltaDispositions) && controls.forkDeltaDispositions.length >= 4);
  assert.ok(Array.isArray(controls.requiredExhaustionRecordFields) && controls.requiredExhaustionRecordFields.length >= 7);
  assert.ok(Array.isArray(controls.forbiddenScratchBuildReasons) && controls.forbiddenScratchBuildReasons.length >= 4);
  return controls;
}

export function deriveSourceAuditStatus(row, controls) {
  if (row.sourceAuditStatus) {
    assert.ok(controls.sourceAuditStates.includes(row.sourceAuditStatus), `${row.id ?? "donor"} invalid sourceAuditStatus`);
    return row.sourceAuditStatus;
  }
  if (row.fullPackageSourceAuditComplete) return "full_useful_package_audit";
  if ((row.registeredSourcePaths?.length ?? 0) > 0 || (row.componentSubsystems?.length ?? 0) > 0) return "partial_source_audit";
  return "metadata_reviewed";
}

function assertCountPair(row, identifiedField, dispositionedField, label) {
  const identified = row[identifiedField];
  const dispositioned = row[dispositionedField];
  assert.ok(Number.isSafeInteger(identified) && identified >= 0, `${row.id} ${label} identified count required`);
  assert.ok(Number.isSafeInteger(dispositioned) && dispositioned >= 0, `${row.id} ${label} dispositioned count required`);
  assert.equal(dispositioned, identified, `${row.id} ${label} disposition must be complete`);
}

export function validateDonorHarvestingClaim(row, controls) {
  const auditStatus = deriveSourceAuditStatus(row, controls);
  if (row.forkReviewStatus !== undefined) {
    assert.ok(controls.forkReviewStates.includes(row.forkReviewStatus), `${row.id} invalid forkReviewStatus`);
  }

  if (!row.fullPackageSourceAuditComplete) {
    assert.notEqual(auditStatus, "full_useful_package_audit", `${row.id} cannot claim full useful-package audit without completion flag`);
  } else {
    assert.equal(auditStatus, "full_useful_package_audit", `${row.id} full audit must use full_useful_package_audit state`);
    assertCountPair(row, "materialPathCount", "dispositionedMaterialPathCount", "material path");
    assert.ok(Array.isArray(row.mechanismsIdentified), `${row.id} mechanismsIdentified required`);
    assert.ok(Array.isArray(row.mechanismsDispositioned), `${row.id} mechanismsDispositioned required`);
    assert.deepEqual(
      [...row.mechanismsDispositioned].sort(),
      [...row.mechanismsIdentified].sort(),
      `${row.id} mechanism disposition must be complete`,
    );
    assertCountPair(row, "upstreamTestsReviewed", "upstreamTestsDispositioned", "upstream test");
  }

  if (row.donorFullyExhausted) {
    assert.equal(row.fullPackageSourceAuditComplete, true, `${row.id} exhaustion requires full useful-package audit`);
    const record = row.donorExhaustionRecord;
    assert.ok(record && typeof record === "object", `${row.id} Donor Exhaustion Record required`);
    for (const field of controls.requiredExhaustionRecordFields) {
      const value = record[field];
      assert.ok(
        value !== undefined && value !== null && (!(typeof value === "string") || value.trim().length > 0),
        `${row.id} exhaustion record missing ${field}`,
      );
    }
    const normalized = String(record.buildNewReason)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
    assert.ok(
      !controls.forbiddenScratchBuildReasons.includes(normalized),
      `${row.id} forbidden scratch-build reason: ${record.buildNewReason}`,
    );
  }

  return { auditStatus, exhausted: Boolean(row.donorFullyExhausted) };
}

export function validateForkHarvestingClaim(mirror, controls) {
  assert.ok(controls.forkReviewStates.includes(mirror.deltaReviewStatus), `${mirror.id} invalid fork delta review state`);
  assert.ok(
    typeof mirror.materialDeltaDisposition === "string" && mirror.materialDeltaDisposition.length > 0,
    `${mirror.id} materialDeltaDisposition required`,
  );
  assert.ok(
    controls.forkDeltaDispositions.includes(mirror.materialDeltaDisposition),
    `${mirror.id} invalid fork delta disposition`,
  );
  assert.ok(
    typeof mirror.rightsProvenanceGate === "string" && mirror.rightsProvenanceGate.length > 20,
    `${mirror.id} rightsProvenanceGate required`,
  );
  assert.ok(
    typeof mirror.nextReviewTrigger === "string" && mirror.nextReviewTrigger.length > 20,
    `${mirror.id} nextReviewTrigger required`,
  );
  return true;
}
