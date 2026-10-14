import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectEvidenceTruth, formatProjectEvidenceTruthSummary } from "./projectEvidenceTruth";

test("published time can establish as-of while retrieval remains a separate clock", () => {
  const truth = buildProjectEvidenceTruth({
    now: new Date("2026-10-05T00:00:00Z"),
    observedAt: "2026-10-01T12:00:00Z",
    metadata: {
      retrievedAt: "2026-10-02T12:00:00Z",
      publishedAt: "2026-10-01T12:00:00Z",
      effectiveAt: null,
      originClass: "untrusted",
      evidenceKind: "claim",
    },
  });
  assert.deepEqual(truth.temporal, {
    observedAt: "2026-10-01T12:00:00Z",
    retrievedAt: "2026-10-02T12:00:00Z",
    publishedAt: "2026-10-01T12:00:00Z",
    effectiveAt: null,
    asOfAt: "2026-10-01T12:00:00Z",
    asOfBasis: "published_at",
    modelPeriod: null,
  });
  assert.equal(truth.sourceQuality.originClass, "untrusted");
  assert.equal(truth.sourceQuality.tier, "unverified_web");
  assert.equal(truth.sourceQuality.claimVerification, "not_verified_by_digest");
  assert.equal(truth.freshness.state, "fresh");
  assert.equal(truth.freshness.basis, "computed_horizon");
  assert.equal(truth.access.entitlement, "unknown");
  assert.ok(truth.unknowns.includes("effective_at"));
  assert.ok(truth.unknowns.includes("model_period"));
  assert.equal(truth.unknowns.includes("freshness"), false);
  assert.ok(truth.unknowns.includes("entitlement"));
  assert.match(formatProjectEvidenceTruthSummary(truth), /As-of published 2026-10-01T12:00:00Z/);
  assert.match(formatProjectEvidenceTruthSummary(truth), /retrieved 2026-10-02T12:00:00Z/);
  assert.equal(truth.knowledge.classification, "qualified");
  assert.equal(truth.knowledge.qualifiers.includes("freshness:unknown"), false);
  assert.ok(truth.knowledge.qualifiers.includes("entitlement:unknown"));
  assert.ok(truth.knowledge.qualifiers.includes("unknown:effective_at"));
  assert.equal(truth.knowledge.qualifiers.includes("unknown:model_period"), false);
});

test("declared effective, freshness, access and certainty states are preserved without flattening", () => {
  const truth = buildProjectEvidenceTruth({
    observedAt: "2026-09-30T00:00:00Z",
    metadata: {
      retrievedAt: "2026-10-02T12:00:00Z",
      publishedAt: "2026-10-01T12:00:00Z",
      effectiveAt: "2026-09-30T00:00:00Z",
      originClass: "first_party",
      evidenceKind: "filing",
      freshnessState: "stale",
      freshnessAssessedAt: "2026-10-02T12:00:00Z",
      freshnessReason: "Superseded by a later filing",
      availabilityState: "inaccessible",
      entitlementState: "unentitled",
      certaintyState: "disputed",
    },
  });
  assert.equal(truth.temporal.asOfAt, "2026-09-30T00:00:00Z");
  assert.equal(truth.temporal.asOfBasis, "effective_at");
  assert.deepEqual(truth.freshness, {
    state: "stale",
    basis: "declared",
    assessedAt: "2026-10-02T12:00:00Z",
    reason: "Superseded by a later filing",
  });
  assert.deepEqual(truth.access, { availability: "inaccessible", entitlement: "unentitled" });
  assert.equal(truth.certainty, "disputed");
  assert.equal(truth.unknowns.includes("freshness"), false);
  assert.equal(truth.unknowns.includes("entitlement"), false);
  assert.match(formatProjectEvidenceTruthSummary(truth), /freshness stale/);
  assert.match(formatProjectEvidenceTruthSummary(truth), /entitlement unentitled/);
  assert.equal(truth.knowledge.classification, "qualified");
  assert.deepEqual(truth.knowledge.qualifiers, [
    "certainty:disputed",
    "freshness:stale",
    "availability:inaccessible",
    "entitlement:unentitled",
  ]);
});

test("missing or unrecognized metadata remains explicit unknown rather than fabricated", () => {
  const truth = buildProjectEvidenceTruth({
    observedAt: null,
    metadata: { freshnessState: "probably-fresh", entitlementState: "maybe", availabilityState: "somewhere" },
  });
  assert.equal(truth.temporal.asOfAt, null);
  assert.equal(truth.temporal.asOfBasis, "unknown");
  assert.equal(truth.freshness.state, "unknown");
  assert.equal(truth.access.availability, "unknown");
  assert.equal(truth.access.entitlement, "unknown");
  assert.equal(truth.certainty, "unknown");
  for (const expected of ["observed_at", "retrieved_at", "published_at", "effective_at", "source_quality", "freshness", "availability", "entitlement", "certainty"]) {
    assert.ok(truth.unknowns.includes(expected), expected);
  }
  assert.equal(truth.knowledge.classification, "qualified");
  assert.ok(truth.knowledge.qualifiers.includes("certainty:unknown"));
  assert.ok(truth.knowledge.qualifiers.includes("unknown:source_quality"));
});

test("fully explicit verified fresh available entitled evidence is known", () => {
  const truth = buildProjectEvidenceTruth({
    observedAt: "2026-10-01T12:00:00Z",
    metadata: {
      retrievedAt: "2026-10-01T12:05:00Z",
      publishedAt: "2026-10-01T11:00:00Z",
      effectiveAt: "2026-10-01T10:00:00Z",
      originClass: "first_party",
      evidenceKind: "filing",
      modelPeriod: "FY2026Q4",
      freshnessState: "fresh",
      freshnessAssessedAt: "2026-10-01T12:05:00Z",
      availabilityState: "available",
      entitlementState: "entitled",
      certaintyState: "verified",
    },
  });
  assert.deepEqual(truth.unknowns, []);
  assert.deepEqual(truth.knowledge, {
    classification: "known",
    qualifiers: [],
  });
  assert.match(formatProjectEvidenceTruthSummary(truth), /knowledge known/);
});


test("freshness computes only from supported horizons when no producer state exists", () => {
  const stale = buildProjectEvidenceTruth({
    now: new Date("2026-10-06T00:00:00Z"),
    observedAt: "2026-01-01T00:00:00Z",
    metadata: { evidenceKind: "claim", originClass: "untrusted" },
  });
  assert.equal(stale.freshness.state, "stale");
  assert.equal(stale.freshness.basis, "computed_horizon");
  assert.match(stale.freshness.reason ?? "", /90d horizon for claim/);
  assert.equal(stale.unknowns.includes("freshness"), false);

  const noHorizon = buildProjectEvidenceTruth({
    now: new Date("2026-10-06T00:00:00Z"),
    observedAt: "2026-01-01T00:00:00Z",
    metadata: { evidenceKind: "document" },
  });
  assert.equal(noHorizon.freshness.state, "unknown");
  assert.equal(noHorizon.freshness.basis, "none");
  assert.ok(noHorizon.unknowns.includes("freshness"));

  const declared = buildProjectEvidenceTruth({
    now: new Date("2026-10-06T00:00:00Z"),
    observedAt: "2026-01-01T00:00:00Z",
    metadata: { evidenceKind: "claim", freshnessState: "fresh" },
  });
  assert.equal(declared.freshness.state, "fresh");
  assert.equal(declared.freshness.basis, "declared");
});

test("source tier and model period remain explicit and conservative", () => {
  assert.equal(
    buildProjectEvidenceTruth({ metadata: { sourceTier: "first_party", originClass: "untrusted" } }).sourceQuality.tier,
    "first_party",
  );
  assert.equal(
    buildProjectEvidenceTruth({ metadata: { sourceTier: "gold_standard" } }).sourceQuality.tier,
    "unknown",
  );
  assert.equal(buildProjectEvidenceTruth({ metadata: { evidenceKind: "filing" } }).sourceQuality.tier, "regulatory_filing");
  assert.equal(buildProjectEvidenceTruth({ metadata: { originClass: "owner" } }).sourceQuality.tier, "owner_provided");

  const withPeriod = buildProjectEvidenceTruth({ metadata: { modelPeriod: "FY2025Q4" } });
  assert.equal(withPeriod.temporal.modelPeriod, "FY2025Q4");
  assert.equal(withPeriod.unknowns.includes("model_period"), false);
  assert.equal(buildProjectEvidenceTruth({ metadata: {} }).temporal.modelPeriod, null);
});

test("source quality never upgrades claim verification or certainty", () => {
  for (const [originClass, tier] of [
    ["authority", "authority"],
    ["first_party", "first_party"],
    ["secondary", "secondary_publication"],
    ["community", "community"],
  ] as const) {
    const truth = buildProjectEvidenceTruth({ metadata: { originClass } });
    assert.equal(truth.sourceQuality.tier, tier);
    assert.equal(truth.certainty, "unknown");
    assert.equal(truth.sourceQuality.claimVerification, "not_verified_by_digest");
    assert.ok(truth.unknowns.includes("certainty"));
  }
  const ordinaryWeb = buildProjectEvidenceTruth({
    metadata: { originClass: "untrusted", sourceUrl: "https://www.sec.gov/" },
  });
  assert.equal(
    ordinaryWeb.sourceQuality.tier,
    "unverified_web",
    "an official-looking URL alone does not upgrade captured source quality",
  );
});
