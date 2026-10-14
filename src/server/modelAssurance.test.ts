import assert from "node:assert/strict";
import test from "node:test";
import {
  assessModelAssurance,
  compareNumeric,
  reconcileProviderValues,
  scoreDataQuality,
} from "./modelAssurance";

const pristineData = {
  completeness: 1,
  freshness: 1,
  provenance: 1,
  providerAgreement: 1,
  revisionStability: 1,
  entitlement: 1,
  outlierIntegrity: 1,
};

test("institutional assurance requires strong independent validation", () => {
  const result = assessModelAssurance({
    modelId: "test.dcf",
    status: "validated",
    validationLevel: "known_answer",
    dataQuality: pristineData,
    evidence: [
      { kind: "known_answer", passed: true, independent: true },
      { kind: "cross_engine", passed: true, independent: true },
      { kind: "boundary", passed: true },
      { kind: "invariant", passed: true },
    ],
    deterministic: true,
    uncertaintyQuantified: true,
    independentChallengerPassed: true,
  });
  assert.equal(result.band, "institutional");
  assert.ok(result.score >= 93);
  assert.deepEqual(result.blockers, []);
});

test("critical evidence failure blocks a superficially strong model", () => {
  const result = assessModelAssurance({
    modelId: "test.bad-benchmark",
    status: "validated",
    validationLevel: "known_answer",
    dataQuality: pristineData,
    evidence: [
      { kind: "known_answer", passed: true, independent: true },
      { kind: "cross_engine", passed: false, independent: true },
    ],
    deterministic: true,
    uncertaintyQuantified: true,
    independentChallengerPassed: true,
  });
  assert.equal(result.band, "blocked");
  assert.ok(result.score <= 59);
  assert.ok(result.blockers.some((item) => item.includes("cross_engine")));
});

test("unresolved critical data conflicts cap data quality and block decisions", () => {
  const result = scoreDataQuality({ ...pristineData, unresolvedCriticalConflicts: 1 });
  assert.ok(result.score <= 0.49);
  assert.equal(result.blockers.length, 1);
});

test("numeric comparison uses combined absolute and relative tolerance", () => {
  const near = compareNumeric(100.0008, 100, { absolute: 0.0001, relative: 0.00001 });
  const far = compareNumeric(100.02, 100, { absolute: 0.0001, relative: 0.00001 });
  assert.equal(near.pass, true);
  assert.equal(far.pass, false);
  assert.ok(near.allowedError > 0.001);
});

test("provider reconciliation detects outliers and preserves consensus", () => {
  const result = reconcileProviderValues([
    { provider: "A", value: 100, asOf: "2026-08-26T10:00:00.000Z", confidence: 1, unit: "USD" },
    { provider: "B", value: 100.2, asOf: "2026-08-26T10:00:00.000Z", confidence: 1, unit: "USD" },
    { provider: "C", value: 99.9, asOf: "2026-08-26T10:00:00.000Z", confidence: 1, unit: "USD" },
    { provider: "bad", value: 175, asOf: "2026-08-26T10:00:00.000Z", confidence: 1, unit: "USD" },
  ], { referenceTime: "2026-08-26T10:00:00.000Z" });
  assert.deepEqual(result.outliers, ["bad"]);
  assert.ok(result.canonicalValue !== null && result.canonicalValue > 99.9 && result.canonicalValue < 100.2);
  assert.ok(result.agreementScore > 90);
});

test("provider reconciliation fails closed on inconsistent units", () => {
  const result = reconcileProviderValues([
    { provider: "A", value: 100, asOf: "2026-08-26T10:00:00.000Z", unit: "USD" },
    { provider: "B", value: 100, asOf: "2026-08-26T10:00:00.000Z", unit: "EUR" },
  ], { referenceTime: "2026-08-26T10:00:00.000Z" });
  assert.ok(result.blockers.some((item) => item.includes("inconsistent units")));
});

test("provider reconciliation is independent of observation order and wall clock", () => {
  const observations = [
    { provider: "A", value: 100, asOf: "2026-08-26T09:00:00.000Z", confidence: 0.9, unit: "USD" },
    { provider: "B", value: 101, asOf: "2026-08-26T10:00:00.000Z", confidence: 1, unit: "USD" },
    { provider: "C", value: 100.5, asOf: "2026-08-26T08:00:00.000Z", confidence: 0.8, unit: "USD" },
  ];
  const first = reconcileProviderValues(observations);
  const second = reconcileProviderValues([...observations].reverse());
  assert.deepEqual(first, second);
});

test("one provider cannot gain voting weight by sending duplicate historical observations", () => {
  const result = reconcileProviderValues([
    { provider: "A", value: 90, asOf: "2026-08-26T08:00:00.000Z", unit: "USD" },
    { provider: "A", value: 100, asOf: "2026-08-26T10:00:00.000Z", unit: "USD" },
    { provider: "B", value: 100, asOf: "2026-08-26T10:00:00.000Z", unit: "USD" },
  ]);
  assert.equal(result.canonicalValue, 100);
  assert.deepEqual(result.usedProviders, ["A", "B"]);
});
