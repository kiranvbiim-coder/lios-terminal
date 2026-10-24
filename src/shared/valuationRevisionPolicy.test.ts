import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ArtifactContent } from "./artifactContracts";
import { assertValuationRevisionIsRecorded, prepareValuationRecalculationPrompt, validWaccChange } from "./valuationRevisionPolicy";

const saved: Extract<ArtifactContent, { kind: "valuation" }> = {
  kind: "valuation", symbol: "ACME", modelId: "python.advanced.valuation.dcf-sensitivity",
  assumptions: { waccPct: 10, terminalGrowthPct: 3, freeCashFlows: [100, 110, 120] },
  outputs: { base: { valuePerShare: 71.370824940136, waccPct: 10 } },
  summary: { modelVersion: "1.0.0", inputSnapshotHash: "a".repeat(64), outputSnapshotHash: "b".repeat(64) },
};
const target = { artifactId: "artifact-abc", version: 4, contentHash: "a".repeat(64) };

test("generic P4 changes cannot relabel a recorded WACC, model, output, ticker or summary", () => {
  for (const changed of [
    { ...saved, assumptions: { ...saved.assumptions, waccPct: 11 } },
    { ...saved, outputs: { base: { valuePerShare: 101, waccPct: 10 } } },
    { ...saved, summary: { modelVersion: "999" } },
    { ...saved, modelId: "different-model" },
    { ...saved, symbol: "MSFT" },
  ] satisfies ArtifactContent[]) {
    assert.throws(() => assertValuationRevisionIsRecorded(saved, changed), /without a deterministic engine run/);
  }
});

test("identical recorded valuation is not a fake calculation change despite JSON key ordering", () => {
  const copied: Extract<ArtifactContent, { kind: "valuation" }> = {
    ...saved, assumptions: { freeCashFlows: [100, 110, 120], terminalGrowthPct: 3, waccPct: 10 },
    outputs: { base: { waccPct: 10, valuePerShare: 71.370824940136 } },
    summary: { outputSnapshotHash: "b".repeat(64), inputSnapshotHash: "a".repeat(64), modelVersion: "1.0.0" },
  };
  assert.doesNotThrow(() => assertValuationRevisionIsRecorded(saved, copied));
});

test("WACC proposal is bounded and never implies a live calculation", () => {
  assert.equal(validWaccChange(saved, 11), true);
  for (const value of [0, -1, 10, NaN, Infinity, 101]) {
    assert.equal(validWaccChange(saved, value), false);
    assert.throws(() => prepareValuationRecalculationPrompt(saved, target, value));
  }
  const prompt = prepareValuationRecalculationPrompt(saved, target, 11);
  for (const text of ["artifact-abc", "version: 4", "a".repeat(64), "10%", "11%", "deterministic", "engine receipt", "rights", "unchanged"]) {
    assert.ok(prompt.includes(text), `request must include ${text}`);
  }
  assert.ok(!prompt.includes("calculated value per share:"));
  assert.throws(() => prepareValuationRecalculationPrompt(saved, { ...target, contentHash: "" }, 11), /exact saved valuation identity/);
  assert.throws(() => prepareValuationRecalculationPrompt(saved, { ...target, version: 0 }, 11));
});

test("original server version write and proposal acceptance both protect valuation outputs", () => {
  const source = readFileSync(new URL("../server/artifactStore.ts", import.meta.url), "utf8");
  assert.match(source, /if \(input\.action !== "undo"\) assertValuationRevisionIsRecorded\(baseContent, content\)/);
  assert.match(source, /assertValuationRevisionIsRecorded\(baseContent, proposedContent\)/);
  assert.match(source, /const nativeWriteAuthorized/);
});

test("readable valuation never saves arbitrary JSON or labels proposed WACC as recalculated", () => {
  const viewer = readFileSync(new URL("../client/src/components/terminal/ValuationArtifactView.tsx", import.meta.url), "utf8");
  const pane = readFileSync(new URL("../client/src/components/terminal/ArtifactPane.tsx", import.meta.url), "utf8");
  assert.match(viewer, /Prepare recalculation in Chat/);
  assert.match(viewer, /Recorded valuation JSON/);
  assert.doesNotMatch(viewer, /<ExpertJsonView/);
  assert.match(pane, /prepareValuationRecalculationPrompt\(content, \{ artifactId, version: revision, contentHash \}, waccPct\)/);
});
