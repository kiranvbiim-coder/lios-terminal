import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createValuationLineage, assertValuationOrganization } from "./valuationLineage";

describe("valuation lineage", () => {
  const hash = "e".repeat(64);
  it("records valuation method, output and calculation version", () => {
    const record = createValuationLineage({ organizationId: 5, modelId: "m1", method: "dcf", outputName: "equity-value", outputValue: 8421, currency: "inr", calculationVersion: "dcf-3.2.0", outputHash: hash, createdByUserId: 8 });
    assert.equal(record.method, "dcf");
    assert.equal(record.currency, "INR");
    assert.equal(record.outputValue, 8421);
  });
  it("deduplicates input and assumption references", () => {
    const record = createValuationLineage({ organizationId: 5, modelId: "m1", method: "trading_comps", outputName: "share-price", outputValue: 120, currency: "usd", inputLineageIds: ["i1", "i1"], assumptionNames: ["WACC", "WACC"], calculationVersion: "1", outputHash: hash, createdByUserId: 8 });
    assert.deepEqual(record.inputLineageIds, ["i1"]);
    assert.deepEqual(record.assumptionNames, ["WACC"]);
  });
  it("rejects cross-tenant valuation access", () => {
    assert.throws(() => assertValuationOrganization({ organizationId: 2 }, 5), /TENANT_BOUNDARY_VIOLATION/);
  });
});
