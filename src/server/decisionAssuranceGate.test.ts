import assert from "node:assert/strict";
import test from "node:test";
import type { ModelAssuranceArtifact } from "@shared/modelAssurance";
import {
  criticalityForDecision,
  enforceDecisionAssurance,
  evaluateAssuranceArtifactForDecision,
  evaluateDecisionAssurance,
  DecisionAssuranceError,
} from "./decisionAssuranceGate";
import type { ModelAssuranceResult } from "./modelAssurance";

function assurance(overrides: Partial<ModelAssuranceResult> = {}): ModelAssuranceResult {
  return {
    modelId: "valuation.dcf",
    score: 96,
    band: "institutional",
    components: {
      validation: 98,
      dataQuality: 96,
      evidence: 95,
      reproducibility: 100,
    },
    blockers: [],
    warnings: [],
    ...overrides,
  };
}

function artifact(overrides: Partial<ModelAssuranceArtifact> = {}): ModelAssuranceArtifact {
  return {
    schemaVersion: "1.0",
    modelId: "valuation.dcf",
    modelVersion: "2.0.0",
    engineVersion: "quant-2026.08",
    riskTier: "tier_1_material",
    validationLevel: "known_answer",
    band: "institutional",
    score: 96,
    components: { validation: 98, dataQuality: 96, evidence: 95, reproducibility: 100 },
    inputSnapshotHash: "a".repeat(64),
    validationReportHash: "b".repeat(64),
    providerIds: ["sec", "market-primary"],
    evidence: [{
      kind: "known_answer",
      passed: true,
      independent: true,
      artifactHash: "c".repeat(64),
      validatedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2027-08-01T00:00:00.000Z",
      validator: "independent-reference-suite",
      referenceIds: ["golden-dcf-v2"],
    }],
    blockers: [],
    warnings: [],
    uncertainty: { quantified: true, method: "scenario+sensitivity", summary: "Base/bear/bull and WACC/g sensitivity." },
    challenger: { required: true, passed: true, modelId: "valuation.dcf.challenger", artifactHash: "d".repeat(64) },
    deterministic: true,
    seed: null,
    createdAt: "2026-08-26T10:00:00.000Z",
    ...overrides,
  };
}

test("material decisions require institutional assurance", () => {
  const result = evaluateDecisionAssurance(
    assurance({ band: "decision_grade", score: 92 }),
    "material_decision",
  );
  assert.equal(result.permitted, false);
  assert.ok(result.reasonCodes.includes("ASSURANCE_INSTITUTIONAL_REQUIRED"));
});

test("material decisions reject warnings even with a high score", () => {
  const result = evaluateDecisionAssurance(
    assurance({ warnings: ["Independent benchmark is near its expiry threshold"] }),
    "material_decision",
  );
  assert.equal(result.permitted, false);
  assert.ok(result.reasons.some((reason) => reason.includes("warning-free")));
});

test("client advisory requires decision-grade assurance", () => {
  const rejected = evaluateDecisionAssurance(
    assurance({ band: "review_required", score: 80 }),
    "client_advisory",
  );
  assert.equal(rejected.permitted, false);

  const accepted = evaluateDecisionAssurance(
    assurance({ band: "decision_grade", score: 90, components: { validation: 92, dataQuality: 90, evidence: 88, reproducibility: 100 } }),
    "client_advisory",
  );
  assert.equal(accepted.permitted, true);
});

test("a high headline score cannot hide a weak component", () => {
  const result = evaluateDecisionAssurance(
    assurance({
      band: "institutional",
      score: 96,
      components: { validation: 98, dataQuality: 98, evidence: 60, reproducibility: 100 },
    }),
    "material_decision",
  );
  assert.equal(result.permitted, false);
  assert.ok(result.reasonCodes.includes("ASSURANCE_COMPONENT_TOO_LOW"));
});

test("any unresolved blocker rejects every output including exploratory", () => {
  const result = evaluateDecisionAssurance(
    assurance({ band: "blocked", score: 59, blockers: ["Unresolved source conflict"] }),
    "exploratory",
  );
  assert.equal(result.permitted, false);
  assert.ok(result.reasonCodes.includes("ASSURANCE_HAS_BLOCKERS"));
});

test("materiality and client context map to server-controlled output criticality", () => {
  assert.equal(criticalityForDecision("routine", null), "internal_analysis");
  assert.equal(criticalityForDecision("routine", 42), "client_advisory");
  assert.equal(criticalityForDecision("material", null), "material_decision");
  assert.equal(criticalityForDecision("material", 42), "client_advisory");
  assert.equal(criticalityForDecision("critical", null), "material_decision");
  assert.equal(criticalityForDecision("critical", 42), "material_decision");
});

test("a complete institutional artifact passes a material-decision gate", () => {
  const result = evaluateAssuranceArtifactForDecision(
    artifact(),
    "material_decision",
    "2026-08-26T12:00:00.000Z",
  );
  assert.equal(result.permitted, true);
  assert.deepEqual(result.reasonCodes, []);
});

test("expired critical validation evidence blocks promotion", () => {
  const result = evaluateAssuranceArtifactForDecision(
    artifact({
      evidence: [{
        kind: "known_answer",
        passed: true,
        independent: true,
        artifactHash: "c".repeat(64),
        validatedAt: "2025-01-01T00:00:00.000Z",
        expiresAt: "2026-01-01T00:00:00.000Z",
        validator: "independent-reference-suite",
        referenceIds: ["golden-dcf-v2"],
      }],
    }),
    "material_decision",
    "2026-08-26T12:00:00.000Z",
  );
  assert.equal(result.permitted, false);
  assert.ok(result.reasonCodes.includes("ASSURANCE_EVIDENCE_EXPIRED"));
});

test("institutional label is rejected when its declared score is internally inconsistent", () => {
  const result = evaluateAssuranceArtifactForDecision(
    artifact({ score: 89 }),
    "material_decision",
    "2026-08-26T12:00:00.000Z",
  );
  assert.equal(result.permitted, false);
  assert.ok(result.reasonCodes.includes("ASSURANCE_INTERNAL_INCONSISTENCY"));
});

test("material assurance requires immutable validation and input artifacts", () => {
  const result = evaluateAssuranceArtifactForDecision(
    artifact({ inputSnapshotHash: null, validationReportHash: null }),
    "material_decision",
    "2026-08-26T12:00:00.000Z",
  );
  assert.equal(result.permitted, false);
  assert.ok(result.reasonCodes.includes("ASSURANCE_INPUT_SNAPSHOT_MISSING"));
  assert.ok(result.reasonCodes.includes("ASSURANCE_VALIDATION_ARTIFACT_MISSING"));
});

test("enforcement throws a stable machine-readable error", () => {
  assert.throws(
    () => enforceDecisionAssurance(
      assurance({ band: "research_only", score: 55 }),
      "client_advisory",
    ),
    (error: unknown) => {
      assert.ok(error instanceof DecisionAssuranceError);
      assert.equal(error.code, "LIOS_DECISION_ASSURANCE_REJECTED");
      assert.equal(error.statusCode, 422);
      assert.equal(error.gate.permitted, false);
      return true;
    },
  );
});
