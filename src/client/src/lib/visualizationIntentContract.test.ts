import test from "node:test";
import assert from "node:assert/strict";
import {
  VISUALIZATION_INTENT_POLICIES,
  canUseVisualizationIntentOnMonitor,
} from "./visualizationIntent";

test("visualization intent keeps monitors context-only", () => {
  assert.equal(canUseVisualizationIntentOnMonitor("context"), true);
  assert.equal(canUseVisualizationIntentOnMonitor("diagnostic"), false);
  assert.equal(canUseVisualizationIntentOnMonitor("primary"), false);
  assert.equal(VISUALIZATION_INTENT_POLICIES.context.maxInlineHeightPx, 96);
});

