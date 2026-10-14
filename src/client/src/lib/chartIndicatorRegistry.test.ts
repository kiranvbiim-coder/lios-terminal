import assert from "node:assert/strict";
import test from "node:test";
import { CHART_INDICATOR_DEFAULTS, CHART_INDICATOR_REGISTRY, clampIndicatorParameter } from "./chartIndicatorRegistry";

test("chart indicator registry covers price and oscillator panes", () => {
  assert.ok(CHART_INDICATOR_REGISTRY.some(item => item.pane === "price"));
  assert.ok(CHART_INDICATOR_REGISTRY.some(item => item.pane === "oscillator"));
  assert.equal(CHART_INDICATOR_DEFAULTS["MACD.fast"], 12);
});

test("indicator parameters clamp to documented bounds and step", () => {
  const definition = CHART_INDICATOR_REGISTRY.find(item => item.id === "RSI")!;
  assert.equal(clampIndicatorParameter(definition, "period", 1), 2);
  assert.equal(clampIndicatorParameter(definition, "period", 14.6), 15);
  assert.equal(clampIndicatorParameter(definition, "period", 500), 100);
});
