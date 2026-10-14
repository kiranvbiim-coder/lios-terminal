import test from "node:test";
import assert from "node:assert/strict";
import {
  advancedQuantInputProvenanceSchema,
  resolveAdvancedQuantInputProvenance,
} from "./quantModelRegistry";

const SOURCE_BINDING = {
  contractFamily: "market_data",
  field: "observations",
  connectorId: "market_snapshot_connector",
  provider: "Example Market Provider",
  priority: "primary" as const,
  sourceReference: "provider://market-snapshots/2026-08-30",
  asOf: "2026-08-30T12:00:00.000Z",
  retrievedAt: "2026-08-30T12:01:00.000Z",
  freshness: "current",
  snapshot: { id: "market-snapshot-20260830", contentHash: "a".repeat(64) },
  transformations: ["validated provider snapshot"],
};

test("legacy advanced quant input is transparently classified as manual", () => {
  const parameters = { iterations: 25 };
  const resolved = resolveAdvancedQuantInputProvenance(parameters);
  assert.equal(resolved.success, true);
  if (!resolved.success) return;
  assert.equal(resolved.data.dataClassification, "manual");
  assert.equal(resolved.data.declaration, "legacy_default");
  assert.deepEqual(resolved.data.manualInputs, parameters);
});

test("explicit manual provenance records the exact submitted inputs", () => {
  const parameters = { iterations: 25, tolerance: 0.01 };
  const resolved = resolveAdvancedQuantInputProvenance(parameters, {
    dataClassification: "manual",
    manualInputs: { tolerance: 0.01, iterations: 25 },
    transformations: [],
  });
  assert.equal(resolved.success, true);
  if (!resolved.success) return;
  assert.equal(resolved.data.declaration, "explicit");

  const mismatched = resolveAdvancedQuantInputProvenance(parameters, {
    dataClassification: "manual",
    manualInputs: { iterations: 24, tolerance: 0.01 },
    transformations: [],
  });
  assert.equal(mismatched.success, false);
});

test("source-bound live and cached provenance require immutable source snapshots", () => {
  for (const dataClassification of ["live", "cached"] as const) {
    const parsed = advancedQuantInputProvenanceSchema.safeParse({
      dataClassification,
      sourceBindings: [{ ...SOURCE_BINDING, freshness: dataClassification === "live" ? "current" : "cached" }],
      transformations: ["model input normalization"],
    });
    assert.equal(parsed.success, true, dataClassification);
  }

  const missingBinding = advancedQuantInputProvenanceSchema.safeParse({
    dataClassification: "live",
    transformations: [],
  });
  assert.equal(missingBinding.success, false);

  const missingSnapshot = advancedQuantInputProvenanceSchema.safeParse({
    dataClassification: "cached",
    sourceBindings: [{ ...SOURCE_BINDING, snapshot: undefined }],
    transformations: [],
  });
  assert.equal(missingSnapshot.success, false);
});

test("synthetic provenance remains explicitly labelled and strict", () => {
  const synthetic = resolveAdvancedQuantInputProvenance({ trials: 100 }, {
    dataClassification: "synthetic",
    syntheticContext: "experiment",
    transformations: ["generated experiment input"],
  });
  assert.equal(synthetic.success, true);
  if (!synthetic.success) return;
  assert.equal(synthetic.data.dataClassification, "synthetic");

  const unknownField = advancedQuantInputProvenanceSchema.safeParse({
    dataClassification: "synthetic",
    syntheticContext: "sample",
    transformations: [],
    untrackedOrigin: true,
  });
  assert.equal(unknownField.success, false);
});
