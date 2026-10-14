import assert from "node:assert/strict";
import test from "node:test";
import { runGoldenValidation, stableJson, validationDigest, type GoldenCase } from "./modelValidationHarness";

const context = {
  modelVersion: "1.0.0",
  engineVersion: "quant-2026.08",
  dataSnapshotHash: "snapshot-abc",
  providerIds: ["provider-b", "provider-a"],
  deterministic: true,
};

const dcfCase: GoldenCase = {
  id: "dcf-basic",
  modelId: "valuation.dcf",
  input: { revenue: 100, margin: 0.2, multiple: 10 },
  expected: {
    enterpriseValue: { expected: 200, tolerance: { absolute: 1e-9, relative: 1e-9 } },
  },
  invariants: [
    {
      id: "positive-ev",
      description: "Enterprise value must remain positive for this positive cash-generating fixture",
      check: (outputs) => outputs.enterpriseValue > 0,
    },
  ],
};

test("golden validation passes an exact known answer and emits evidence", async () => {
  const report = await runGoldenValidation("valuation.dcf", [dcfCase], context, (input) => {
    const value = input as { revenue: number; margin: number; multiple: number };
    return { enterpriseValue: value.revenue * value.margin * value.multiple };
  });
  assert.equal(report.pass, true);
  assert.equal(report.passedCases, 1);
  assert.equal(report.evidence.kind, "known_answer");
  assert.equal(report.evidence.passed, true);
  assert.equal(report.cases[0].outputResults[0].pass, true);
});

test("tolerance breach fails the case and evidence", async () => {
  const report = await runGoldenValidation("valuation.dcf", [dcfCase], context, () => ({ enterpriseValue: 201 }));
  assert.equal(report.pass, false);
  assert.equal(report.evidence.passed, false);
  assert.equal(report.cases[0].outputResults[0].pass, false);
});

test("missing and non-finite outputs fail closed but still create an auditable failure digest", async () => {
  const twoOutputs: GoldenCase = {
    ...dcfCase,
    expected: {
      enterpriseValue: { expected: 200, tolerance: { absolute: 0, relative: 0 } },
      equityValue: { expected: 150, tolerance: { absolute: 0, relative: 0 } },
    },
  };
  const report = await runGoldenValidation("valuation.dcf", [twoOutputs], context, () => ({ enterpriseValue: Number.NaN }));
  assert.equal(report.pass, false);
  assert.deepEqual(report.cases[0].missingOutputs, ["equityValue"]);
  assert.deepEqual(report.cases[0].unexpectedNonFiniteOutputs, ["enterpriseValue"]);
  assert.match(report.cases[0].outputHash, /^[a-f0-9]{64}$/);
  assert.match(report.cases[0].resultHash, /^[a-f0-9]{64}$/);
});

test("validation digests are stable across object key and provider order", async () => {
  assert.equal(stableJson({ b: 2, a: { d: 4, c: 3 } }), stableJson({ a: { c: 3, d: 4 }, b: 2 }));
  assert.equal(validationDigest({ b: 2, a: 1 }), validationDigest({ a: 1, b: 2 }));

  const first = await runGoldenValidation("valuation.dcf", [dcfCase], context, () => ({ enterpriseValue: 200 }));
  const second = await runGoldenValidation(
    "valuation.dcf",
    [dcfCase],
    { ...context, providerIds: ["provider-a", "provider-b"] },
    () => ({ enterpriseValue: 200 }),
  );
  assert.equal(first.contextHash, second.contextHash);
  assert.equal(first.reportHash, second.reportHash);
});

test("model or engine version change changes the validation digest", async () => {
  const first = await runGoldenValidation("valuation.dcf", [dcfCase], context, () => ({ enterpriseValue: 200 }));
  const second = await runGoldenValidation(
    "valuation.dcf",
    [dcfCase],
    { ...context, engineVersion: "quant-2026.09" },
    () => ({ enterpriseValue: 200 }),
  );
  assert.notEqual(first.contextHash, second.contextHash);
  assert.notEqual(first.reportHash, second.reportHash);
});

test("stochastic validation requires an explicit reproducibility seed", async () => {
  await assert.rejects(
    runGoldenValidation(
      "valuation.dcf",
      [dcfCase],
      { ...context, deterministic: false, seed: null },
      () => ({ enterpriseValue: 200 }),
    ),
    /explicit seed/,
  );
});

test("canonical validation payload rejects ambiguous non-JSON values", () => {
  assert.throws(() => stableJson({ value: undefined }), /undefined at \$\.value/);
  assert.throws(() => stableJson({ value: Number.POSITIVE_INFINITY }), /non-finite number/);
  assert.throws(() => stableJson({ value: 10n }), /bigint/);
  assert.throws(() => stableJson({ value: () => 1 }), /function/);
  assert.throws(() => stableJson({ value: Symbol("x") }), /symbol/);
  assert.throws(() => stableJson({ value: new Date("2026-08-26T00:00:00.000Z") }), /serialize dates explicitly/);
});

test("canonical validation payload rejects class instances and circular references", () => {
  class Wrapper {
    constructor(readonly value: number) {}
  }
  assert.throws(() => stableJson({ wrapped: new Wrapper(1) }), /unsupported object type Wrapper/);

  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.throws(() => stableJson(circular), /circular reference/);
});

test("negative zero canonicalizes to ordinary zero", () => {
  assert.equal(stableJson({ value: -0 }), stableJson({ value: 0 }));
  assert.equal(validationDigest({ value: -0 }), validationDigest({ value: 0 }));
});
