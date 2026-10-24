import assert from "node:assert/strict";
import test from "node:test";
import { comparePermittedResearchEvidence, researchComparisonFacetsSchema } from "./researchEvidenceComparison";
import type { ComposedResearchSource } from "@shared/researchSourceComposition";

type Source = Pick<ComposedResearchSource,
  "documentId" | "sourceRef" | "sourceClass" | "occurredAt" | "contentHash">;
const hash = "a".repeat(64);
const revised = "b".repeat(64);
const source = (id: string, ref: string, contentHash = hash): Source => ({
  documentId: id, sourceRef: ref, contentHash,
  sourceClass: "internal_research", occurredAt: "2026-10-24T08:00:00.000Z",
});

test("Compared sources include actual passages but never assert agreement", () => {
  const rows = comparePermittedResearchEvidence(["operating margin", "customer churn"],
    [source("one", "ref:1"), source("two", "ref:2")], [
      { facet: "operating margin", hits: [
        { documentId: "one", contentHash: hash, excerpt: "Operating margin increased to 18% in Q1." },
        { documentId: "two", contentHash: hash, excerpt: "Operating margin fell to 15% in Q1." },
      ] },
      { facet: "customer churn", hits: [] },
    ]);
  assert.equal(rows[0]?.status, "observed_in_retrieved_excerpts");
  assert.equal(rows[0]?.matchingSources, 2);
  assert.deepEqual(rows[0]?.rows.map(row => row.sourceRef), ["ref:1", "ref:2"]);
  assert.equal(rows[0]?.agreement, "not_assessed");
  assert.equal(rows[1]?.status, "not_observed_in_retrieved_excerpts");
  assert.equal(rows[1]?.inspectedSources, 2);
  assert.deepEqual(rows[1]?.rows, []);
});

test("Comparison filters unpermitted documents and stale excerpts", () => {
  const [facet] = comparePermittedResearchEvidence(["revenue"],
    [source("allowed", "trusted:source")], [{
      facet: "revenue", hits: [
        { documentId: "unentitled", contentHash: hash, excerpt: "secret revenue report" },
        { documentId: "allowed", contentHash: revised, excerpt: "stale revenue 99%" },
        { documentId: "allowed", contentHash: hash, excerpt: "observed revenue is 12" },
      ],
    }]);
  assert.equal(facet?.matchingSources, 1);
  assert.equal(facet?.rows[0]?.sourceRef, "trusted:source");
  assert.equal(JSON.stringify(facet).includes("secret"), false);
  assert.equal(JSON.stringify(facet).includes("99%"), false);
});

test("Facet matching requires a whole exact phrase and unique validated facets", () => {
  assert.equal(researchComparisonFacetsSchema.safeParse(["Revenue", "revenue"]).success, false);
  assert.equal(researchComparisonFacetsSchema.safeParse(["revenue".repeat(12)]).success, false);
  const [facet] = comparePermittedResearchEvidence(["AI"], [source("one", "safe")], [{
    facet: "AI", hits: [{ documentId: "one", contentHash: hash, excerpt: "Claimed gains in the chain." }],
  }]);
  assert.equal(facet?.matchingSources, 0);
});

test("The source-by-source grid enforces a 12-row presentation cap", () => {
  const sources = Array.from({ length: 20 }, (_, i) => source("doc:" + i, "ref:" + i));
  const [facet] = comparePermittedResearchEvidence(["demand"], sources, [{
    facet: "demand",
    hits: sources.map(item => ({ documentId: item.documentId, contentHash: hash, excerpt: "Demand reported." })),
  }]);
  assert.equal(facet?.matchingSources, 20);
  assert.equal(facet?.rows.length, 12);
  assert.equal(facet?.omittedMatches, 8);
});

test("Source references deduplicate repeated observations", () => {
  const [facet] = comparePermittedResearchEvidence(["demand"],
    [source("first", "same:ref"), source("second", "same:ref")], [{
      facet: "demand", hits: [
        { documentId: "first", contentHash: hash, excerpt: "Demand rose." },
        { documentId: "second", contentHash: hash, excerpt: "Demand fell." },
      ],
    }]);
  assert.equal(facet?.matchingSources, 1);
});
