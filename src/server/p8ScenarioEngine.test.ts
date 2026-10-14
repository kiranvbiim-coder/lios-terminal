import assert from "node:assert/strict";
import test from "node:test";
import {
  buildP8ChangeReview,
  buildP8ScenarioSnapshot,
  buildSelectedAssumptionPatch,
  compareP8ScenarioSnapshots,
  validateP8FormulaDraft,
} from "./p8ScenarioEngine";

const baseContent = {
  kind: "valuation" as const,
  symbol: "ACME",
  modelId: "dcf",
  assumptions: { revenueGrowth: 0.08, wacc: 0.10, terminal: { growth: 0.03 } },
  outputs: { equityValue: 100, perShare: 10 },
  summary: {},
};

const bullContent = {
  ...baseContent,
  assumptions: { revenueGrowth: 0.12, wacc: 0.09, terminal: { growth: 0.035 } },
  outputs: { equityValue: 130, perShare: 13 },
};

function snapshot(id: string, kind: "base" | "bull", content: typeof baseContent, hash: string) {
  return buildP8ScenarioSnapshot({
    artifactId: id,
    artifactVersion: 1,
    title: id,
    artifactKind: "valuation",
    scenarioKind: kind,
    contentHash: hash.repeat(64).slice(0, 64),
    forkedFromArtifactId: kind === "base" ? null : "base",
    forkedFromVersion: kind === "base" ? null : 1,
    content,
  });
}

test("P8 scenario comparison produces assumption/output matrix and numeric waterfall without mutating inputs", () => {
  const base = snapshot("base", "base", baseContent, "a");
  const bull = snapshot("bull", "bull", bullContent, "b");
  const result = compareP8ScenarioSnapshots({ projectId: 1, rootArtifactId: "base", base, branches: [bull] });
  assert.ok(result.changedAssumptionKeys.includes("revenueGrowth"));
  assert.ok(result.changedOutputKeys.includes("equityValue"));
  assert.equal(result.waterfall.find((item) => item.key === "wacc")?.delta, -0.010000000000000009);
  assert.equal(baseContent.assumptions.revenueGrowth, 0.08);
});

test("P8 selected assumption merge copies only requested paths", () => {
  const patch = buildSelectedAssumptionPatch(bullContent, baseContent, ["wacc", "terminal.growth"]);
  assert.deepEqual(patch, { assumptions: { revenueGrowth: 0.08, wacc: 0.09, terminal: { growth: 0.035 } } });
  assert.equal(baseContent.assumptions.wacc, 0.10);
});

test("P8 Formula Studio validates deterministic formulas and never needs eval", () => {
  const result = validateP8FormulaDraft({
    expression: "revenue * margin - debt",
    targetSurface: "metric",
    targetKey: "equity_proxy",
    targetArtifactId: null,
    sampleValues: { revenue: 100, margin: 0.2, debt: 5 },
  });
  assert.equal(result.status, "valid");
  assert.deepEqual(result.dependencies.sort(), ["debt", "margin", "revenue"]);
  assert.equal(result.sampleValue, 15);
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
});

test("P8 Formula Studio rejects executable JavaScript syntax", () => {
  const result = validateP8FormulaDraft({
    expression: "globalThis.process.exit()",
    targetSurface: "metric",
    targetKey: "unsafe",
    targetArtifactId: null,
    sampleValues: {},
  });
  assert.equal(result.status, "invalid");
});

test("P8 model change review exposes precise changed paths", () => {
  const result = buildP8ChangeReview(baseContent, bullContent);
  assert.equal(result.changed, true);
  assert.ok(result.changedPaths.some((item) => item.path === "assumptions.revenueGrowth" && item.numericDelta === 0.039999999999999994));
});
