import test from "node:test";
import assert from "node:assert/strict";
import { buildScenarioImpactMap } from "./terminalImpactMap";
import { createScenario } from "./terminalScenarioUniverse";
import { createIntelligenceObject } from "./terminalIntelligenceObjects";
import type { AssumptionBinding } from "./terminalAssumptionRegistry";

function binding(input: Partial<AssumptionBinding> & Pick<AssumptionBinding, "id" | "key" | "label" | "value">): AssumptionBinding {
  return { view: "valuation", apply: () => {}, ...input };
}

test("impact map measures scenario coverage without claiming model outputs", () => {
  const scenario = createScenario({
    name: "BEAR",
    kind: "bear",
    scope: "entity",
    symbol: "NVDA",
    assumptions: [
      { key: "wacc", label: "WACC", value: 11, unit: "%" },
      { key: "growth", label: "Revenue Growth", value: 5, unit: "%" },
      { key: "narrative", label: "Narrative", value: "slowdown" },
    ],
  });
  const bindings = [
    binding({ id: "wacc", key: "wacc", label: "WACC", value: 9, symbol: "NVDA", unit: "%" }),
    binding({ id: "growth", key: "growth", label: "Revenue Growth", value: 10, symbol: "NVDA", unit: "%" }),
  ];
  const map = buildScenarioImpactMap(scenario, bindings, []);
  assert.equal(map.matchedAssumptionCount, 2);
  assert.equal(map.skippedAssumptions.length, 1);
  assert.equal(Math.round(map.coveragePct), 100);
  assert.equal(map.bindingMatches.find((item) => item.bindingId === "wacc")?.absoluteDelta, 2);
});

test("impact map preserves only explicit object dependency links", () => {
  const source = createIntelligenceObject({ kind: "metric", label: "Oil", status: "stable", tags: [], assumptions: {}, metadata: {} });
  const target = createIntelligenceObject({ kind: "model", label: "Airline DCF", status: "stable", tags: [], assumptions: {}, metadata: {} });
  source.relations = [{ targetId: target.id, kind: "affects" }];
  const scenario = createScenario({ name: "BASE", kind: "base", scope: "global", assumptions: [] });
  const map = buildScenarioImpactMap(scenario, [], [source, target]);
  assert.equal(map.explicitObjectLinks.length, 1);
  assert.equal(map.explicitObjectLinks[0].relation, "affects");
});
