import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ScenarioComparisonBoard from "./ScenarioComparisonBoard";
import type { TerminalScenario } from "@/lib/terminalScenarioUniverse";
import type { AssumptionBinding } from "@/lib/terminalAssumptionRegistry";

function scenario(id: string, assumptions: TerminalScenario["assumptions"]): TerminalScenario {
  return {
    id, name: id === "base" ? "Central case" : "Upside case", kind: id === "base" ? "base" : "bull",
    scope: "global", assumptions, probability: 30, createdAt: 1, updatedAt: 1,
  };
}
const base = scenario("base", [{ key: "demand", label: "Demand", value: 100, unit: "units" }]);
const upside = scenario("upside", [{ key: "demand", label: "Demand", value: 125, unit: "units" }]);
const live: AssumptionBinding[] = [{
  id: "model-demand", view: "valuation", key: "demand", label: "Demand", value: 105,
  unit: "units", apply: () => { throw new Error("Preview must never invoke apply"); },
}];

test("comparison renders actual before/after inputs and registered current model value", () => {
  const html = renderToStaticMarkup(React.createElement(ScenarioComparisonBoard, {
    active: upside, reference: base, bindings: live,
  }));
  assert.match(html, /scenario-comparison-board/);
  assert.match(html, /Central case/);
  assert.match(html, /Upside case/);
  assert.match(html, /100 units/);
  assert.match(html, /125 units/);
  assert.match(html, /Input difference/);
  assert.match(html, /\+25 units/);
  assert.match(html, /\+25\.0%/);
  assert.match(html, /105 units/);
  assert.match(html, /Preview only/);
  assert.match(html, /not forecasted outputs/);
  assert.doesNotMatch(html, /<img\b|<iframe\b/);
});

test("comparison does not render invented values where an assumption is absent", () => {
  const html = renderToStaticMarkup(React.createElement(ScenarioComparisonBoard, {
    active: scenario("upside", [{ key: "new", label: "New", value: 5 }]),
    reference: base, bindings: [],
  }));
  assert.match(html, /Not specified/);
  assert.match(html, /Active only/);
  assert.match(html, /Reference only/);
  assert.doesNotMatch(html, /0 units/);
});

test("empty scenarios clearly show no comparison is available", () => {
  const html = renderToStaticMarkup(React.createElement(ScenarioComparisonBoard, {
    active: scenario("upside", []), reference: scenario("base", []), bindings: [],
  }));
  assert.match(html, /Neither scenario has recorded assumptions/);
  assert.doesNotMatch(html, /data-difference="changed"/);
});

test("untrusted user-authored assumptions render as escaped text", () => {
  const html = renderToStaticMarkup(React.createElement(ScenarioComparisonBoard, {
    active: scenario("upside", [{ key: "x", label: "<script>unsafe</script>", value: "<img src=x>" }]),
    reference: scenario("base", []), bindings: [],
  }));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<script\b|<img\b/);
});
