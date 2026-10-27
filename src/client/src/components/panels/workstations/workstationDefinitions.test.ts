import test from "node:test";
import assert from "node:assert/strict";

import { WORKSTATION_DEFINITIONS, validateWorkstationDefinition } from "./workstationDefinitions";

test("institutional workstation definitions expose unique navigable sections", () => {
  for (const definition of Object.values(WORKSTATION_DEFINITIONS)) {
    assert.deepEqual(validateWorkstationDefinition(definition), [], `${definition.id} should be structurally valid`);
    // Research is evidence-driven (thesis, filings, consensus); it intentionally has no quantitative MODEL stage.
    if (definition.id !== "research") assert.ok(definition.sections.some((section) => section.stage === "MODEL"), `${definition.id} should expose a MODEL stage`);
    assert.ok(definition.sections.some((section) => section.stage === "ANALYZE"), `${definition.id} should expose an ANALYZE stage`);
  }
});

test("core workstations expose the intended first-class capability groups", () => {
  assert.deepEqual(WORKSTATION_DEFINITIONS.valuation.sections.map((section) => section.id), ["overview", "financials", "fundamentals", "dcf", "comps", "advanced", "methodology"]);
  assert.deepEqual(WORKSTATION_DEFINITIONS.portfolio.sections.map((section) => section.id), ["overview", "holdings", "optimizer", "attribution", "risk", "stress", "network", "methodology"]);
  assert.deepEqual(WORKSTATION_DEFINITIONS.fixedIncome.sections.map((section) => section.id), ["overview", "curves", "bonds", "methodology"]);
  assert.deepEqual(WORKSTATION_DEFINITIONS.quant.sections.map((section) => section.id), ["overview", "lab", "methodology"]);
  assert.deepEqual(WORKSTATION_DEFINITIONS.economics.sections.map((section) => section.id), ["overview", "macro", "signals", "policy", "indicators", "calendar"]);
  assert.deepEqual(WORKSTATION_DEFINITIONS.research.sections.map((section) => section.id), ["investigation", "perspectives", "filings", "consensus", "financials", "fundamentals", "methodology"]);
});

test("trust/methodology remains first-class where hidden assumptions are material", () => {
  for (const key of ["valuation", "portfolio", "fixedIncome", "quant", "research"] as const) {
    assert.ok(WORKSTATION_DEFINITIONS[key].sections.some((section) => section.stage === "TRUST"), `${key} should expose a TRUST section`);
  }
});

test("advanced valuation and the economic calendar are explicitly surfaced with trust-aware descriptions", () => {
  const advanced = WORKSTATION_DEFINITIONS.valuation.sections.find((section) => section.id === "advanced");
  assert.ok(advanced);
  assert.match(advanced.description, /source-gated/i);
  assert.match(advanced.description, /reverse DCF/i);

  const calendar = WORKSTATION_DEFINITIONS.economics.sections.find((section) => section.id === "calendar");
  assert.ok(calendar);
  assert.match(calendar.description, /source-backed/i);
  assert.match(calendar.description, /hard-coded central-bank probability presets are no longer rendered/i);
});
