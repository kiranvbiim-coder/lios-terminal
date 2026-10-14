import test from "node:test";
import assert from "node:assert/strict";
import { cycleSemanticZoom } from "./terminalAnalyticalState";
import { analyticalSnapshotFingerprint, diffAnalyticalSnapshots, type AnalyticalSnapshot } from "./terminalChangeIntelligence";
import { diffCalculationReceipts } from "./terminalComparison";
import { deriveTerminalDataAtmosphere } from "./terminalDataState";
import { parseCommandSequence } from "./terminalCommandComposer";
import { createThesisMap, thesisCaseScore } from "./terminalThesisMap";
import { createUiActionProposal, validateUiActionProposal } from "./terminalUiActionPreview";
import type { CalculationReceipt, EvidenceSnapshot } from "./terminalEvidence";

test("semantic zoom cycles detail to analysis to thesis", () => {
  assert.equal(cycleSemanticZoom("detail"), "analysis");
  assert.equal(cycleSemanticZoom("analysis"), "thesis");
  assert.equal(cycleSemanticZoom("thesis"), "detail");
});

test("analytical snapshot fingerprint is stable across object key ordering", () => {
  const left = analyticalSnapshotFingerprint({ view: "valuation", symbol: "NVDA", values: { b: 2, a: 1 }, metadata: { z: "x", y: "w" } });
  const right = analyticalSnapshotFingerprint({ view: "valuation", symbol: "nvda", values: { a: 1, b: 2 }, metadata: { y: "w", z: "x" } });
  assert.equal(left, right);
});

test("change intelligence reports numeric direction, delta and severity", () => {
  const base: AnalyticalSnapshot = { id: "a", view: "valuation", symbol: "NVDA", label: "A", capturedAt: 1, values: { fairValue: 100, wacc: 9 }, metadata: {} };
  const next: AnalyticalSnapshot = { id: "b", view: "valuation", symbol: "NVDA", label: "B", capturedAt: 2, values: { fairValue: 75, wacc: 9.5 }, metadata: {} };
  const changes = diffAnalyticalSnapshots(base, next);
  const fairValue = changes.find((item) => item.key === "fairValue");
  assert.equal(fairValue?.direction, "down");
  assert.equal(fairValue?.absoluteDelta, -25);
  assert.equal(fairValue?.percentDelta, -25);
  assert.equal(fairValue?.severity, "critical");
});

function receipt(id: string, growth: number, fairValue: number, warnings: string[] = []): CalculationReceipt {
  return {
    id,
    label: "DCF",
    engine: "LiOS deterministic DCF",
    createdAt: "2026-08-27T00:00:00Z",
    inputs: { revenue: 100 },
    parameters: { growth },
    outputs: { fairValue },
    diagnostics: [],
    warnings,
    reproducibilityId: id,
  };
}

test("model diff separates inputs parameters outputs and warning changes", () => {
  const diff = diffCalculationReceipts(receipt("a", 10, 120, ["old"]), receipt("b", 7, 92, ["new"]));
  assert.equal(diff.inputs.find((item) => item.key === "revenue")?.changed, false);
  assert.equal(diff.parameters.find((item) => item.key === "growth")?.changed, true);
  assert.equal(diff.outputs.find((item) => item.key === "fairValue")?.after, 92);
  assert.deepEqual(diff.warningsAdded, ["new"]);
  assert.deepEqual(diff.warningsRemoved, ["old"]);
});

test("data atmosphere prioritizes stale and unavailable truth signals", () => {
  const snapshot: EvidenceSnapshot = {
    provenance: [
      { id: "live", label: "Live", source: "feed", freshness: "live", transformations: [], assumptions: [], quality: "verified", conflicts: [] },
      { id: "stale", label: "Stale", source: "filing", freshness: "stale", transformations: [], assumptions: [], quality: "warning", conflicts: [] },
    ],
    receipts: [],
  };
  assert.equal(deriveTerminalDataAtmosphere(snapshot).state, "stale");
});

test("command composer keeps active symbol through action-first sequence", () => {
  const steps = parseCommandSequence("NVDA → FINANCIALS → DCF → PEERS", "AAPL");
  assert.equal(steps.length, 4);
  assert.equal(steps[0]?.symbol, "NVDA");
  assert.equal(steps[1]?.symbol, "NVDA");
  assert.equal(steps[2]?.symbol, "NVDA");
  assert.equal(steps[3]?.symbol, "NVDA");
  assert.equal(steps[1]?.view, "financialstatements");
  assert.equal(steps[2]?.view, "valuation");
  assert.equal(steps[3]?.view, "peercomp");
});

test("thesis score reflects supporting and weakening weighted evidence", () => {
  const map = createThesisMap("NVDA");
  const scenario = {
    ...map.cases.base,
    evidence: [
      { id: "s", title: "support", view: "financialstatements" as const, symbol: "NVDA", polarity: "supports" as const, weight: 5, note: "", updatedAt: 1 },
      { id: "w", title: "weak", view: "advancedrisk" as const, symbol: "NVDA", polarity: "weakens" as const, weight: 2, note: "", updatedAt: 2 },
    ],
  };
  assert.equal(thesisCaseScore(scenario), 30);
});

test("safe UI action preview blocks internal-only surfaces in client mode", () => {
  const proposal = createUiActionProposal({
    title: "Open internal surface",
    rationale: "test",
    source: "byoai",
    actions: [{ type: "open", view: "quantlab", mode: "tab" }],
  });
  const validation = validateUiActionProposal(proposal, false);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("internal-only")));
});
