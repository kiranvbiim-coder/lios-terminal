import assert from "node:assert/strict";
import test from "node:test";
import type { UnsignedModelAssuranceArtifact } from "@shared/modelAssurance";
import { evaluateAssuranceArtifactForDecision } from "./decisionAssuranceGate";
import {
  generateAssuranceSigningKeyPair,
  signModelAssuranceArtifact,
  verifyConfiguredModelAssuranceArtifact,
  verifyModelAssuranceArtifactSignature,
} from "./modelAssuranceIntegrity";

function unsignedArtifact(): UnsignedModelAssuranceArtifact {
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
    uncertainty: {
      quantified: true,
      method: "scenario+sensitivity",
      summary: "Base/bear/bull and WACC/g sensitivity.",
    },
    challenger: {
      required: true,
      passed: true,
      modelId: "valuation.dcf.challenger",
      artifactHash: "d".repeat(64),
    },
    deterministic: true,
    seed: null,
    createdAt: "2026-08-26T10:00:00.000Z",
  };
}

test("Ed25519 assurance signature verifies the exact canonical artifact", () => {
  const keys = generateAssuranceSigningKeyPair();
  const signed = signModelAssuranceArtifact(unsignedArtifact(), keys.privateKeyPem);
  const verification = verifyModelAssuranceArtifactSignature(signed, keys.publicKeyPem);
  assert.equal(verification.valid, true);
  assert.equal(verification.keyId, keys.keyId);
  assert.equal(verification.reason, null);
});

test("tampering with a signed assurance score is detected", () => {
  const keys = generateAssuranceSigningKeyPair();
  const signed = signModelAssuranceArtifact(unsignedArtifact(), keys.privateKeyPem);
  const tampered = { ...signed, score: 95 };
  const verification = verifyModelAssuranceArtifactSignature(tampered, keys.publicKeyPem);
  assert.equal(verification.valid, false);
  assert.match(verification.reason ?? "", /signature verification failed/i);
});

test("an artifact signed by another key is rejected", () => {
  const signer = generateAssuranceSigningKeyPair();
  const verifier = generateAssuranceSigningKeyPair();
  const signed = signModelAssuranceArtifact(unsignedArtifact(), signer.privateKeyPem);
  const verification = verifyModelAssuranceArtifactSignature(signed, verifier.publicKeyPem);
  assert.equal(verification.valid, false);
  assert.match(verification.reason ?? "", /does not match configured key/i);
});

test("configured verification fails closed without a public key", () => {
  const keys = generateAssuranceSigningKeyPair();
  const signed = signModelAssuranceArtifact(unsignedArtifact(), keys.privateKeyPem);
  const verification = verifyConfiguredModelAssuranceArtifact(signed, {});
  assert.equal(verification.valid, false);
  assert.match(verification.reason ?? "", /LIOS_ASSURANCE_PUBLIC_KEY is not configured/);
});

test("decision gate rejects a structurally valid but cryptographically tampered material artifact", () => {
  const previous = process.env.LIOS_ASSURANCE_PUBLIC_KEY;
  const keys = generateAssuranceSigningKeyPair();
  process.env.LIOS_ASSURANCE_PUBLIC_KEY = keys.publicKeyPem;
  try {
    const signed = signModelAssuranceArtifact(unsignedArtifact(), keys.privateKeyPem);
    const accepted = evaluateAssuranceArtifactForDecision(
      signed,
      "material_decision",
      "2026-08-26T12:00:00.000Z",
    );
    assert.equal(accepted.permitted, true);

    const tampered = { ...signed, score: 95 };
    const rejected = evaluateAssuranceArtifactForDecision(
      tampered,
      "material_decision",
      "2026-08-26T12:00:00.000Z",
    );
    assert.equal(rejected.permitted, false);
    assert.ok(rejected.reasonCodes.includes("ASSURANCE_SIGNATURE_INVALID"));
  } finally {
    if (previous === undefined) delete process.env.LIOS_ASSURANCE_PUBLIC_KEY;
    else process.env.LIOS_ASSURANCE_PUBLIC_KEY = previous;
  }
});
