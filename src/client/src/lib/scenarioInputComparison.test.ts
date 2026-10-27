import assert from "node:assert/strict";
import test from "node:test";
import type { AssumptionBinding } from "./terminalAssumptionRegistry";
import {
  buildScenarioInputComparison,
  scenarioInputText,
} from "./scenarioInputComparison";
import type { TerminalScenario } from "./terminalScenarioUniverse";

const scenario = (id: string, assumptions: TerminalScenario["assumptions"]): TerminalScenario => ({
  id, name: id, kind: id === "base" ? "base" : "custom", scope: "global",
  assumptions, createdAt: 1, updatedAt: 1,
});

const binding = (id: string, key: string, value: number, unit?: string): AssumptionBinding => ({
  id, view: "valuation", key, label: key, value, unit, apply: () => {
    throw Error("Comparison must never invoke apply");
  },
});

test("shows only recorded same-key inputs and exact unit-aware numeric differences", () => {
  const base = scenario("base", [
    { key: "growth", label: "Growth", value: 10, unit: "%" },
    { key: "revenue", label: "Revenue", value: 500, unit: "USD" },
    { key: "mode", label: "Mode", value: "approved" },
  ]);
  const active = scenario("upside", [
    { key: "growth", label: "Growth", value: 15, unit: "%" },
    { key: "revenue", label: "Revenue", value: 500, unit: "EUR" },
    { key: "mode", label: "Mode", value: "approved" },
  ]);
  const result = buildScenarioInputComparison(base, active, [binding("growth-model", "growth", 12, "%")]);
  assert.equal(result.changedCount, 2);
  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.rows.map(x => [x.key, x.status]), [
    ["growth", "changed"], ["revenue", "changed"], ["mode", "unchanged"],
  ]);
  assert.equal(result.rows[0].absoluteDelta, 5);
  assert.equal(result.rows[0].percentDelta, 50);
  assert.equal(result.rows[0].liveMatches[0].currentValue, 12);
  assert.equal(result.rows[1].absoluteDelta, null, "EUR and USD have no honest arithmetic comparison");
  assert.equal(result.rows[1].percentDelta, null);
  assert.equal(result.nonNumericCount, 1);
  assert.equal(result.liveMatchedCount, 1);
});

test("missing assumptions stay missing instead of being invented as zero", () => {
  const base = scenario("base", [{ key: "existing", label: "Existing", value: 30 }]);
  const active = scenario("branch", [{ key: "new", label: "New", value: 70 }]);
  const comparison = buildScenarioInputComparison(base, active, []);
  assert.deepEqual(comparison.rows.map(x => x.status), ["reference_only", "active_only"]);
  assert.equal(comparison.changedCount, 0);
  assert.equal(comparison.referenceOnlyCount, 1);
  assert.equal(comparison.activeOnlyCount, 1);
  assert.equal(comparison.rows[0].absoluteDelta, null);
  assert.equal(comparison.rows[1].absoluteDelta, null);
  assert.equal(scenarioInputText(null), "Not specified");
  assert.equal(scenarioInputText({ key: "x", label: "x", value: null }), "Unset");
});

test("zero reference prevents an invented percentage; negative values use absolute denominator", () => {
  const base = scenario("base", [{ key: "x", label: "X", value: 0 }, { key: "y", label: "Y", value: -40 }]);
  const active = scenario("custom", [{ key: "x", label: "X", value: 5 }, { key: "y", label: "Y", value: -20 }]);
  const r = buildScenarioInputComparison(base, active, []);
  assert.equal(r.rows[0].absoluteDelta, 5);
  assert.equal(r.rows[0].percentDelta, null);
  assert.equal(r.rows[1].absoluteDelta, 20);
  assert.equal(r.rows[1].percentDelta, 50);
});

test("only mounted model bindings are counted, with original side-effect-free values", () => {
  const reference = scenario("base", [{ key: "margin", label: "Margin", value: 10 }]);
  const active = scenario("bull", [{ key: "margin", label: "Margin", value: 14 }]);
  const applySpy = () => { throw Error("Unexpected apply action"); };
  const live: AssumptionBinding[] = [
    { ...binding("m1", "margin", 9), apply: applySpy },
    { ...binding("m2", "margin", 11), apply: applySpy },
    { ...binding("m3", "other", 11), apply: applySpy },
  ];
  const before = JSON.stringify({ reference, active, live: live.map(({ apply: _, ...b }) => b) });
  const r = buildScenarioInputComparison(reference, active, live);
  assert.equal(r.liveMatchedCount, 1);
  assert.equal(r.liveInputCount, 2);
  assert.equal(r.rows[0].liveMatches.length, 2);
  assert.deepEqual(r.rows[0].liveMatches.map(x => x.currentValue), [9, 11]);
  assert.equal(JSON.stringify({ reference, active, live: live.map(({ apply: _, ...b }) => b) }), before);
});

test("string inputs and mixed value types are displayed but cannot imply numeric impact", () => {
  const base = scenario("base", [{ key: "condition", label: "Condition", value: false }]);
  const active = scenario("bear", [{ key: "condition", label: "Condition", value: "cautious" }]);
  const r = buildScenarioInputComparison(base, active, []);
  assert.equal(r.rows[0].status, "changed");
  assert.equal(r.rows[0].comparableNumeric, false);
  assert.equal(r.rows[0].absoluteDelta, null);
  assert.equal(scenarioInputText(base.assumptions[0]), "False");
  assert.equal(scenarioInputText(active.assumptions[0]), "cautious");
  assert.equal(scenarioInputText({ key: "x", label: "X", value: Infinity }), "Invalid numeric input");
});

test("independent branches with no assumptions have no made-up rows", () => {
  const result = buildScenarioInputComparison(scenario("base", []), scenario("new", []), []);
  assert.deepEqual(result.rows, []);
  assert.equal(result.changedCount, 0);
  assert.equal(result.liveInputCount, 0);
});

test("C02 comparison never calls incompatible currency binding an applicable model input", () => {
  const base = scenario("base", [{ key: "revenue", label: "Revenue", value: 450, unit: "EUR" }]);
  const proposal = scenario("proposal", [{ key: "revenue", label: "Revenue", value: 500, unit: "EUR" }]);
  const result = buildScenarioInputComparison(base, proposal, [binding("model-USD", "revenue", 400, "USD")]);
  assert.equal(result.rows[0].absoluteDelta, 50, "Same-unit scenario assumptions remain comparable");
  assert.equal(result.rows[0].liveMatches.length, 0, "But a USD model input is not a EUR binding");
  assert.equal(result.liveInputCount, 0);
});
