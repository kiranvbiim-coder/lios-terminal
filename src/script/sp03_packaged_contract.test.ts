import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  SP03_DEFAULT_REQUEST,
  SP03_DEFAULT_SUBJECT,
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

test("SP-03 canonical request encodes the Research Alpha truth contract", () => {
  assert.equal(SP03_DEFAULT_SUBJECT, "Microsoft Corporation");
  assert.match(SP03_DEFAULT_REQUEST, /real public-company topic/i);
  assert.match(SP03_DEFAULT_REQUEST, /canonical entity/i);
  assert.match(SP03_DEFAULT_REQUEST, /at least two materially independent permitted sources/i);
  assert.match(SP03_DEFAULT_REQUEST, /source\/provider identity/i);
  assert.match(SP03_DEFAULT_REQUEST, /retrieval time/i);
  assert.match(SP03_DEFAULT_REQUEST, /observation or as-of time/i);
  assert.match(SP03_DEFAULT_REQUEST, /entitlement posture/i);
  assert.match(SP03_DEFAULT_REQUEST, /observed facts/i);
  assert.match(SP03_DEFAULT_REQUEST, /sourced estimates or guidance/i);
  assert.match(SP03_DEFAULT_REQUEST, /explicit inference/i);
  assert.match(SP03_DEFAULT_REQUEST, /missing information/i);
  assert.match(SP03_DEFAULT_REQUEST, /contradictions/i);
  assert.match(SP03_DEFAULT_REQUEST, /evidence gaps/i);
  assert.match(SP03_DEFAULT_REQUEST, /stale evidence/i);
  assert.match(SP03_DEFAULT_REQUEST, /durable cited Research Artifact/i);
  assert.match(SP03_DEFAULT_REQUEST, /source refs and lineage/i);
  assert.match(SP03_DEFAULT_REQUEST, /do not substitute guessed content/i);
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

test("SP-03 contract remains aligned with the canonical shipping-point and Foundation rules", () => {
  const root = process.cwd();
  const shipping = fs.readFileSync(
    path.resolve(root, "../docs/technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md"),
    "utf8",
  );
  const foundation = fs.readFileSync(
    path.resolve(root, "../docs/technical/LIOS_FOUNDATION_LOCK_DONOR_EXECUTION_AMENDMENT.md"),
    "utf8",
  );

  for (const phrase of [
    "SP-03 — Research Alpha",
    "resolve a real public, private or no-ticker topic/entity",
    "provider/source identity",
    "entitlement posture",
    "contradictions, gaps, unknowns",
    "durable cited Research Artifact",
    "restart/reopen",
  ]) {
    const escaped = phrase.replace(/[.*+?^()|[\]\\]/g, "\\$&");
    assert.match(shipping, new RegExp(escaped, "i"));
  }

  assert.match(foundation, /priority is convergence\/qualification rather than indefinite new research subsystems/i);
  assert.match(foundation, /R-SP03 — Research Intelligence Journey/i);
});
