import assert from "node:assert/strict";
import test from "node:test";
import {
  SP03_PACKAGED_CHECK_IDS,
  hasCompleteSp03CheckSet,
  type Sp03PackagedCheck,
} from "./sp03_packaged_contract";

test("SP-03 packaged contract has stable unique check ids", () => {
  assert.deepEqual(SP03_PACKAGED_CHECK_IDS, [
    "sp03.signin",
    "sp03.project_chat",
    "sp03.canonical_identity",
    "sp03.multi_source_evidence",
    "sp03.rights_freshness_asof",
    "sp03.contradictions_gaps_unknowns",
    "sp03.truth_classification",
    "sp03.research_artifact",
    "sp03.lineage_inspection",
    "sp03.no_fake_success",
    "sp03.restart_reopen",
  ]);
  assert.equal(new Set(SP03_PACKAGED_CHECK_IDS).size, SP03_PACKAGED_CHECK_IDS.length);
});


test("SP-03 evidence passes only when every required check passes exactly once", () => {
  const checks: Sp03PackagedCheck[] = SP03_PACKAGED_CHECK_IDS.map((id) => ({
    id,
    pass: true,
    detail: id,
  }));
  assert.equal(hasCompleteSp03CheckSet(checks), true);
  assert.equal(hasCompleteSp03CheckSet(checks.slice(1)), false);

  const failed = checks.map((check) =>
    check.id === "sp03.no_fake_success" ? { ...check, pass: false } : check
  );
  assert.equal(hasCompleteSp03CheckSet(failed), false);

  const duplicate = [...checks.slice(0, -1), checks[0]];
  assert.equal(hasCompleteSp03CheckSet(duplicate), false);
});

