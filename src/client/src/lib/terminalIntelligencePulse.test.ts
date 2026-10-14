import test from "node:test";
import assert from "node:assert/strict";
import { buildIntelligencePulseFromState, buildScenarioMatrix } from "./terminalIntelligencePulse";
import { evaluateReversalCondition } from "./terminalDecisionMonitor";
import { createDecisionObject, addReversalCondition } from "./terminalDecisionObjects";
import { createIntelligenceObject } from "./terminalIntelligenceObjects";
import { createScenario } from "./terminalScenarioUniverse";
import type { AnalyticalContextChange } from "./terminalChangeIntelligence";

const latestTime = { enabled: false, asOfDate: null, mode: "latest" as const };

test("pulse prioritizes critical analytical changes", () => {
  const changes: AnalyticalContextChange[] = [{
    contextKey: "valuation:NVDA",
    view: "valuation",
    symbol: "NVDA",
    label: "NVDA · Valuation",
    capturedAt: 20,
    previousCapturedAt: 10,
    criticalCount: 1,
    materialCount: 1,
    changes: [{ key: "fairValue", before: 100, after: 70, direction: "down", severity: "critical", absoluteDelta: -30, percentDelta: -30 }],
  }];
  const pulse = buildIntelligencePulseFromState({ changes, decisions: [], objects: [], activeScenario: null, timeContext: latestTime });
  assert.equal(pulse.items[0].priority, "critical");
  assert.equal(pulse.items[0].symbol, "NVDA");
  assert.equal(pulse.counts.critical, 1);
});

test("reversal condition evaluates numeric object threshold through canonical monitor", () => {
  const object = createIntelligenceObject({ kind: "metric", label: "WACC", status: "stable", value: { raw: 10.5 }, tags: [], assumptions: {}, metadata: {} });
  let decision = createDecisionObject({ title: "NVDA decision", direction: "hold", status: "active", thesis: "Base thesis", confidence: 60 });
  decision = addReversalCondition(decision, { label: "WACC guardrail", description: "Reverse if WACC exceeds 10", objectId: object.id, comparator: "gt", threshold: 10 });
  const result = evaluateReversalCondition(decision.reversalConditions[0], [object]);
  assert.equal(result.triggered, true);
});

test("scenario matrix aligns assumptions and exposes numeric spread", () => {
  const base = createScenario({ name: "BASE", kind: "base", scope: "global", assumptions: [{ key: "growth", label: "Growth", value: 8, unit: "%" }] });
  const bull = createScenario({ name: "BULL", kind: "bull", scope: "global", assumptions: [{ key: "growth", label: "Growth", value: 12, unit: "%" }] });
  const bear = createScenario({ name: "BEAR", kind: "bear", scope: "global", assumptions: [{ key: "growth", label: "Growth", value: 3, unit: "%" }] });
  const matrix = buildScenarioMatrix([bear, base, bull]);
  assert.deepEqual(matrix.scenarios.map((scenario) => scenario.kind), ["base", "bull", "bear"]);
  assert.equal(matrix.rows[0].spread, 9);
  assert.equal(matrix.rows[0].values[base.id], 8);
});
