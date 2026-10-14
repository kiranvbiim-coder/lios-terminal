import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTransformationNode, assertLineageOrganization } from "./transformationLineage";

describe("transformation lineage", () => {
  const hash = "b".repeat(64);

  it("records typed transformations and input/output hashes", () => {
    const node = createTransformationNode({ organizationId: 4, datasetVersionId: "dv1", type: "normalize", operation: "normalize-periods", implementationVersion: "2.1.0", inputHash: hash, outputHash: "c".repeat(64), createdByUserId: 9 });
    assert.equal(node.type, "normalize");
    assert.equal(node.implementationVersion, "2.1.0");
    assert.equal(node.inputHash.length, 64);
    assert.equal(node.outputHash.length, 64);
  });

  it("deduplicates parent lineage references", () => {
    const node = createTransformationNode({ organizationId: 4, datasetVersionId: "dv1", parentNodeIds: ["a", "a", "b"], type: "derive", operation: "calculate-ebitda", implementationVersion: "1", inputHash: hash, outputHash: hash, createdByUserId: 9 });
    assert.deepEqual(node.parentNodeIds, ["a", "b"]);
  });

  it("prevents cross-tenant lineage access", () => {
    assert.throws(() => assertLineageOrganization({ organizationId: 2 }, 1), /TENANT_BOUNDARY_VIOLATION/);
  });
});
