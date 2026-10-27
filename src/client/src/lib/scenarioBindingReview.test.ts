import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalScenario } from "./terminalScenarioUniverse";
import {
  registerAssumptionBinding,
  previewScenarioBindingApplication,
  applyScenarioToBindings,
  updateAssumptionBindingValue,
} from "./terminalAssumptionRegistry";
import { scenarioBindingReviewKey } from "./scenarioBindingReview";

const scenario = (assumptions: TerminalScenario["assumptions"]): TerminalScenario => ({
  id: "recorded-scenario", name: "Saved Scenario", kind: "custom", scope: "global",
  assumptions, createdAt: 1, updatedAt: 1,
});

test("C02 preview is read-only; exact registered model values and units determine review", () => {
  let applied = 0;
  const dispose = registerAssumptionBinding({
    id: "c02-growth", key: "growth", label: "Growth", view: "valuation",
    value: 4, unit: "%", apply: () => { applied += 1; },
  });
  try {
    const saved = scenario([
      { key: "growth", label: "Growth", value: 8, unit: "%" },
      { key: "cost", label: "Cost", value: 900, unit: "USD" },
      { key: "note", label: "Note", value: "optimistic" },
    ]);
    const before = JSON.stringify(saved);
    const plan = previewScenarioBindingApplication(saved, { view: "valuation" });
    assert.equal(applied, 0, "Read-only preview must not call registered model inputs");
    assert.deepEqual(plan.matched.map(m => [m.bindingId, m.currentValue, m.value, m.unit]),
      [["c02-growth", 4, 8, "%"]]);
    assert.deepEqual(plan.unmatched, ["cost"]);
    assert.deepEqual(plan.skipped.map(x => x.assumptionKey), ["note"]);
    assert.ok(scenarioBindingReviewKey(saved, "valuation", undefined, plan));
    assert.equal(JSON.stringify(saved), before);
  } finally { dispose(); }
});

test("C02 unit mismatch, absent unit and invalid numeric values never change model inputs", () => {
  let called = 0;
  const dispose = registerAssumptionBinding({
    id: "c02-revenue", view: "valuation", key: "revenue", label: "Revenue",
    value: 100, unit: "USD", apply: () => { called++; },
  });
  try {
    for (const value of [
      { value: 120, unit: "EUR" },
      { value: 120 },
      { value: Number.POSITIVE_INFINITY, unit: "USD" },
    ]) {
      const item = scenario([{ key: "revenue", label: "Revenue", ...value }]);
      const plan = previewScenarioBindingApplication(item, { view: "valuation" });
      assert.deepEqual(plan.matched, []);
      assert.equal(plan.skipped.length, 1);
      assert.equal(scenarioBindingReviewKey(item, "valuation", undefined, plan), null);
      assert.deepEqual(applyScenarioToBindings(item, { view: "valuation" }).applied, []);
    }
    assert.equal(called, 0);
  } finally { dispose(); }
});

test("C02 application key expires when live model inputs, scenario assumptions or pane change", () => {
  const dispose = registerAssumptionBinding({
    id: "c02-margin", view: "valuation", key: "margin", label: "Margin",
    value: 10, unit: "%", apply: () => undefined,
  });
  try {
    const item = scenario([{ key: "margin", label: "Margin", value: 12, unit: "%" }]);
    const first = scenarioBindingReviewKey(item, "valuation", undefined,
      previewScenarioBindingApplication(item, { view: "valuation" }));
    updateAssumptionBindingValue("c02-margin", 11);
    const newInput = scenarioBindingReviewKey(item, "valuation", undefined,
      previewScenarioBindingApplication(item, { view: "valuation" }));
    const newScenario = scenarioBindingReviewKey(scenario([{ key: "margin", label: "Margin", value: 13, unit: "%" }]),
      "valuation", undefined, previewScenarioBindingApplication(item, { view: "valuation" }));
    assert.notEqual(first, newInput);
    assert.notEqual(newInput, newScenario);
    assert.equal(scenarioBindingReviewKey(item, "research", undefined,
      previewScenarioBindingApplication(item, { view: "research" })), null);
  } finally { dispose(); }
});

test("C04 explicit registered input application changes only exact matching allowed bindings", () => {
  const updated: number[] = [];
  const dispose = registerAssumptionBinding({
    id: "c04-enterprise", view: "valuation", key: "enterprise_value", label: "Enterprise value",
    value: 100, unit: "USD", apply: value => updated.push(value),
  });
  try {
    const item = scenario([
      { key: "enterprise_value", label: "Enterprise value", value: 125, unit: "USD" },
      { key: "other", label: "Other", value: 50 },
    ]);
    assert.deepEqual(updated, []);
    const out = applyScenarioToBindings(item, { view: "valuation" });
    assert.deepEqual(updated, [125]);
    assert.deepEqual(out.applied.map(x => [x.bindingId, x.value]), [["c04-enterprise", 125]]);
    assert.deepEqual(out.unmatched, ["other"]);
    const next = previewScenarioBindingApplication(item, { view: "valuation" });
    assert.equal(next.matched[0].currentValue, 125);
  } finally { dispose(); }
});

test("C04 rejected model binding does not claim a successful input write", () => {
  const dispose = registerAssumptionBinding({
    id: "c04-rejected", view: "valuation", key: "rate", label: "Rate", value: 2,
    apply: () => { throw new Error("Model rejected"); },
  });
  try {
    const out = applyScenarioToBindings(scenario([{ key: "rate", label: "Rate", value: 3 }]), { view: "valuation" });
    assert.deepEqual(out.applied, []);
    assert.equal(out.skipped.length, 1);
    assert.match(out.skipped[0].reason, /inspect actual model state/i);
  } finally { dispose(); }
});
