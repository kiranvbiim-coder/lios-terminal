import assert from "node:assert/strict";
import test from "node:test";
import type { ArtifactSemanticComparison } from "@shared/artifactSemanticDiffContracts";
import { semanticArtifactComparisonLabel } from "./artifactSemanticComparisonSummary";

function semantic(flags: ArtifactSemanticComparison["comparability"], comparable: boolean[]): ArtifactSemanticComparison {
  return {
    materialChange: flags.some(f => f.blocksAttribution),
    numericDeltas: comparable.map((value, index) => ({
      path: `summary.field${index}`,
      before: 100, after: 110,
      absoluteChange: value ? 10 : null,
      percentChange: value ? 0.10 : null,
      direction: "up" as const, comparable: value,
    })),
    collectionDeltas: [],
    comparability: flags,
    attribution: { available: false, reason: "authoritative_p11_contributions_not_supplied",
      items: [], totalChange: null, residual: null },
  };
}

test("Artifact compare displays donor-derived currency and fiscal period blockers without fake math", () => {
  const label = semanticArtifactComparisonLabel(semantic([
    {kind: "currency", path: "outputs.targetPrice", message: "mismatch", blocksAttribution: true},
    {kind: "currency", path: "outputs.bookValuePerShare", message: "mismatch", blocksAttribution: true},
    {kind: "period", path: "summary.revenue", message: "different", blocksAttribution: true},
  ], [false, false, true]));
  assert.match(label, /1 comparable numeric change/);
  assert.match(label, /currency basis unverified or different for 2 fields/);
  assert.match(label, /accounting period unverified or different for 1 field/);
  assert.match(label, /no change % computed for affected values/);
});
test("unchanged and legacy comparisons are explicit and backward compatible", () => {
  assert.equal(semanticArtifactComparisonLabel(null), "");
  assert.equal(semanticArtifactComparisonLabel(semantic([], [true])), "Semantic: 1 comparable numeric change");
  assert.equal(semanticArtifactComparisonLabel(semantic([], [])), "Semantic: 0 comparable numeric changes");
});
test("only explicit caliber flags appear, no untrusted model message interpolation", () => {
  const out = semanticArtifactComparisonLabel(semantic([
    {kind: "model", path: "modelId", message: "INTERNAL SECRET", blocksAttribution: true},
    {kind: "currency", path: "outputs.targetPrice", message: "PRIVATE PRICE DATA", blocksAttribution: true},
  ], [false]));
  assert.doesNotMatch(out, /INTERNAL SECRET|PRIVATE PRICE DATA|outputs.targetPrice/);
  assert.match(out, /currency basis/);
});
