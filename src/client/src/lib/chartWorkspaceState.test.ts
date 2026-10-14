import assert from "node:assert/strict";
import test from "node:test";
import { loadChartWorkspacePreset } from "./chartWorkspaceState";

test("chart workspace preset loader fails closed outside a browser", () => {
  assert.equal(loadChartWorkspacePreset("AAPL"), null);
});
