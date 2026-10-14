import test from "node:test";
import assert from "node:assert/strict";
import { buildIntelligenceGraph, createIntelligenceObject, relateIntelligenceObjects, upsertIntelligenceObject } from "./terminalIntelligenceObjects";
import { cloneScenarioBranch, createScenario, updateScenarioAssumption } from "./terminalScenarioUniverse";
import { suggestedViewsForLenses, toggleLens } from "./terminalLensStack";
import { appendWaterfallNode, createSignalWaterfall, decisionReadiness } from "./terminalSignalWaterfall";
import { searchUseCases, useCasesForDomain } from "./terminalUseCaseRegistry";
import { latestKnowableVintage, wasKnowableAt } from "./terminalVintageGuard";
import { addDecisionEvidence, createDecisionObject, decisionEvidenceBalance } from "./terminalDecisionObjects";

test("intelligence objects dedupe and preserve graph relationships", () => {
  const entity = createIntelligenceObject({ kind: "entity", label: "NVDA · Entity", symbol: "nvda", status: "live" });
  const evidence = createIntelligenceObject({ kind: "evidence", label: "10-Q evidence", symbol: "NVDA", status: "stable" });
  let objects = upsertIntelligenceObject([], entity);
  objects = upsertIntelligenceObject(objects, { ...entity, id: "replacement", updatedAt: entity.updatedAt + 1 });
  assert.equal(objects.length, 1);
  objects = [evidence, ...objects];
  objects = relateIntelligenceObjects(objects, entity.id, { targetId: evidence.id, kind: "supports" });
  const graph = buildIntelligenceGraph(objects);
  assert.equal(graph.objects.length, 2);
  assert.equal(graph.edges.length, 1);
});

test("scenario branches clone assumptions without mutating the parent", () => {
  const base = createScenario({ name: "BASE", kind: "base", scope: "entity", symbol: "AAPL", assumptions: [{ key: "growth", label: "Growth", value: 8, unit: "%" }] });
  const bear = cloneScenarioBranch(base, { name: "BEAR", kind: "bear" });
  const changed = updateScenarioAssumption(bear, { key: "growth", label: "Growth", value: 2, unit: "%" });
  assert.equal(base.assumptions[0].value, 8);
  assert.equal(changed.assumptions[0].value, 2);
  assert.equal(changed.parentId, base.id);
});

test("lens stack produces deterministic suggested views", () => {
  const withFinancial = toggleLens({ active: [], updatedAt: 0 }, "financial");
  const withRisk = toggleLens(withFinancial, "risk");
  const views = suggestedViewsForLenses(withRisk.active);
  assert.ok(views.includes("financialstatements"));
  assert.ok(views.includes("advancedrisk"));
});

test("signal waterfall exposes missing decision stages", () => {
  let waterfall = createSignalWaterfall("NVDA thesis", "NVDA");
  waterfall = appendWaterfallNode(waterfall, { stage: "data", label: "Revenue" });
  waterfall = appendWaterfallNode(waterfall, { stage: "evidence", label: "10-Q" });
  waterfall = appendWaterfallNode(waterfall, { stage: "model", label: "DCF" });
  const readiness = decisionReadiness(waterfall);
  assert.ok(readiness.score < 100);
  assert.ok(readiness.missing.includes("challenge"));
  assert.ok(readiness.missing.includes("monitor"));
});

test("use case registry covers cross-domain and searchable workflows", () => {
  assert.ok(useCasesForDomain("cross-domain").length >= 5);
  assert.ok(searchUseCases("airline").some((item) => item.id === "airline-fusion"));
});

test("vintage guard prevents hindsight leakage", () => {
  const before = { id: "old", value: 1, publishedAt: "2026-01-10T00:00:00Z" };
  const after = { id: "new", value: 2, publishedAt: "2026-02-10T00:00:00Z" };
  assert.equal(wasKnowableAt(before, "2026-02-01T00:00:00Z").knowable, true);
  assert.equal(wasKnowableAt(after, "2026-02-01T00:00:00Z").knowable, false);
  assert.equal(latestKnowableVintage([before, after], "2026-02-01T00:00:00Z")?.id, "old");
});

test("decision objects keep contradictory evidence explicit", () => {
  let decision = createDecisionObject({ title: "NVDA thesis", direction: "hold", status: "draft", thesis: "Valuation balanced", confidence: 60 });
  decision = addDecisionEvidence(decision, { objectId: "support-1", role: "support", weight: 2 });
  decision = addDecisionEvidence(decision, { objectId: "contradiction-1", role: "contradiction", weight: 3 });
  const balance = decisionEvidenceBalance(decision);
  assert.equal(balance.support, 2);
  assert.equal(balance.contradiction, 3);
  assert.equal(balance.net, -1);
});
