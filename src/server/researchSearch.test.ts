import test from "node:test";
import assert from "node:assert/strict";
import { searchOfficialData } from "./researchOfficialCatalog";

test("official catalog search returns normalized provenance without implying observations", () => {
  const results = searchOfficialData({
    query: "GDP",
    filters: { sourceClasses: ["official_data"] },
    organizationId: null,
    limit: 10,
  });

  assert.ok(results.length > 0);
  for (const result of results) {
    assert.equal(result.evidenceType, "official_data");
    assert.match(result.sourceUrl ?? "", /^https:\/\//);
    assert.equal(result.publishedAt, null);
    assert.equal(result.metadata.dataState, "catalog_metadata");
  }
});

test("dated searches exclude undated official catalog profiles", () => {
  const results = searchOfficialData({
    query: "GDP",
    filters: { sourceClasses: ["official_data"], freshnessDays: 30 },
    organizationId: null,
    limit: 10,
  });

  assert.deepEqual(results, []);
});
