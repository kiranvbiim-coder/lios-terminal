import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createModelInputLineage, assertModelInputOrganization } from "./modelInputLineage";

describe("model input lineage", () => {
  const hash = "d".repeat(64);
  it("maps dataset sources to model cells", () => {
    const lineage = createModelInputLineage({ organizationId: 3, modelId: "m1", datasetVersionId: "dv1", sourceCellRefs: ["Income!B12"], targetCellRefs: ["DCF!B14"], inputHash: hash, createdByUserId: 7 });
    assert.deepEqual(lineage.sourceCellRefs, ["Income!B12"]);
    assert.deepEqual(lineage.targetCellRefs, ["DCF!B14"]);
  });
  it("deduplicates lineage references", () => {
    const lineage = createModelInputLineage({ organizationId: 3, modelId: "m1", datasetVersionId: "dv1", transformationNodeIds: ["t1", "t1"], sourceCellRefs: ["A1", "A1"], targetCellRefs: ["B1", "B1"], inputHash: hash, createdByUserId: 7 });
    assert.deepEqual(lineage.transformationNodeIds, ["t1"]);
    assert.deepEqual(lineage.sourceCellRefs, ["A1"]);
  });
  it("rejects cross-tenant model lineage", () => {
    assert.throws(() => assertModelInputOrganization({ organizationId: 2 }, 3), /TENANT_BOUNDARY_VIOLATION/);
  });
});
