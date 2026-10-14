import assert from "node:assert/strict";
import test from "node:test";
import { chartAlertTriggered } from "./chartAlerts";

test("chart alerts trigger at inclusive price boundaries", () => {
  assert.equal(chartAlertTriggered({ enabled: true, operator: "above", price: 100 }, 100), true);
  assert.equal(chartAlertTriggered({ enabled: true, operator: "below", price: 100 }, 100), true);
  assert.equal(chartAlertTriggered({ enabled: true, operator: "above", price: 100 }, 99.99), false);
  assert.equal(chartAlertTriggered({ enabled: true, operator: "below", price: 100 }, 100.01), false);
});

test("disabled and invalid-price alerts never trigger", () => {
  assert.equal(chartAlertTriggered({ enabled: false, operator: "above", price: 100 }, 200), false);
  assert.equal(chartAlertTriggered({ enabled: true, operator: "above", price: Number.NaN }, 200), false);
  assert.equal(chartAlertTriggered({ enabled: true, operator: "above", price: 100 }, Number.NaN), false);
});
