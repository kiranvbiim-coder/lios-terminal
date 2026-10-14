import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAIAttribution, hashText, assertAIEvidenceOrganization } from "./aiEvidenceLineage";

describe("AI evidence attribution", () => {
  it("hashes prompts and outputs without storing them in the attribution record", () => {
    const record = createAIAttribution({ organizationId: 6, prompt: "Explain revenue decline", output: "Revenue declined due to volume.", evidence: [{ id: "e1", kind: "dataset_version", resourceId: "dv1", locator: "Revenue!B12" }], provider: "BYOAI", modelName: "client-model", createdByUserId: 11 });
    assert.equal(record.promptHash, hashText("Explain revenue decline"));
    assert.equal(record.outputHash, hashText("Revenue declined due to volume."));
    assert.ok(!JSON.stringify(record).includes("Explain revenue decline"));
  });
  it("retains explicit evidence references", () => {
    const record = createAIAttribution({ organizationId: 6, prompt: "p", output: "o", evidence: [{ id: "e1", kind: "valuation", resourceId: "v1", locator: "equity-value" }], provider: "BYOAI", modelName: "client-model", createdByUserId: 11 });
    assert.equal(record.evidence[0].kind, "valuation");
    assert.equal(record.evidence[0].resourceId, "v1");
  });
  it("rejects cross-tenant evidence access", () => {
    assert.throws(() => assertAIEvidenceOrganization({ organizationId: 2 }, 6), /TENANT_BOUNDARY_VIOLATION/);
  });
});
