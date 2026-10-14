import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFixedIncomeCreditRequest,
  FIXED_INCOME_CREDIT_WORKFLOWS,
  formatFixedIncomeCreditResult,
  formatFixedIncomeCreditValue,
  validateFixedIncomeCreditRequest,
} from "../components/panels/FixedIncomeCreditControls";
test("institutional FI catalog exposes every requested route and exact required fields", () => {
  const paths = FIXED_INCOME_CREDIT_WORKFLOWS.map((spec) => spec.path);
  assert.deepEqual(paths, [
    "fixed-income/spread-analytics",
    "fixed-income/key-rate-risk",
    "fixed-income/immunize-duration",
    "fixed-income/callable-oas",
    "fixed-income/floating-rate-note",
    "fixed-income/inflation-linked-bond",
    "fixed-income/credit-spread-curve",
    "credit/rating-migration",
    "credit/creditmetrics",
    "credit/stress-pd",
    "credit/covenant-headroom",
  ]);
  assert.deepEqual(FIXED_INCOME_CREDIT_WORKFLOWS.find((spec) => spec.path === "fixed-income/callable-oas")?.requiredFields, ["couponRatePct", "maturityYears", "flatRiskFreeRatePct", "marketPrice"]);
  assert.deepEqual(FIXED_INCOME_CREDIT_WORKFLOWS.find((spec) => spec.path === "credit/creditmetrics")?.requiredFields, ["exposures"]);
});

test("request adapter preserves manual provenance and requires private source binding", () => {
  const parameters = { referenceRatePct: 4.5, maturityYears: 3 };
  const privateImport = {
    provider: "vault",
    sourceReference: "vault://fi-2026-08",
    asOf: "2026-08-31T00:00:00.000Z",
    retrievedAt: "2026-08-31T00:01:00.000Z",
    snapshotId: "fi-2026-08",
    contentHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  };
  assert.deepEqual(buildFixedIncomeCreditRequest(parameters, "private", privateImport), {
    ...parameters,
    inputProvenance: { dataClassification: "cached", sourceBindings: [{ contractFamily: "fixed-income-credit", field: "manual-import", connectorId: "private-import", provider: "vault", priority: "manual_override", sourceReference: "vault://fi-2026-08", asOf: "2026-08-31T00:00:00.000Z", retrievedAt: "2026-08-31T00:01:00.000Z", freshness: "cached", snapshot: { id: "fi-2026-08", contentHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" }, transformations: [] }] },
  });
  assert.throws(() => buildFixedIncomeCreditRequest(parameters, "private"), /Private import requires/);
});

test("request validation rejects malformed curve, rating and credit simulation inputs", () => {
  assert.throws(() => validateFixedIncomeCreditRequest("fixed-income/credit-spread-curve", {
    maturitiesYears: [1, 3, 2], spreadsBps: [80, 120, 160], queryMaturitiesYears: [2],
  }), /maturitiesYears must be increasing/);
  assert.throws(() => validateFixedIncomeCreditRequest("credit/rating-migration", {
    ratings: ["A", "D"], transitionMatrix: [[0.99, 0.01]], currentDistribution: [1, 0],
  }), /dimensions must match/);
  assert.throws(() => validateFixedIncomeCreditRequest("credit/rating-migration", {
    ratings: ["A", "D"], transitionMatrix: [[0.8, 0.1], [0, 1]], currentDistribution: [1, 0],
  }), /row.*sum to 1/);
  assert.throws(() => validateFixedIncomeCreditRequest("credit/creditmetrics", {
    exposures: [{ name: "IssuerA", ead: 100, pdPct: 101, lgdPct: 40 }],
  }), /pdPct must be at most 100/);
});

test("known-answer values render with honest null and nested output handling", () => {
  assert.equal(formatFixedIncomeCreditValue(12.345678), "12.3457");
  assert.equal(formatFixedIncomeCreditValue(Number.NaN), "—");
  assert.equal(formatFixedIncomeCreditValue({ "1Y": 0.1234 }), '{"1Y":0.1234}');
  assert.deepEqual(formatFixedIncomeCreditResult("credit/stress-pd", { stressedPdPct: [2.5, 7.25] }), [{ label: "STRESSED PD", value: "[2.5,7.25]", unit: "%" }]);
});
