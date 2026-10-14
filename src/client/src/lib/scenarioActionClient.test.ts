import test from "node:test";
import assert from "node:assert/strict";
import { calculateClientScenarioActions } from "./scenarioActionClient";

test("client adapter prefers existing scenario graph total changes", () => {
  const result = calculateClientScenarioActions({
    nodeImpacts: { demand: 99 },
    graphTotalChanges: { demand: -0.2 },
    assetImpacts: [{ assetId: "ABC", node: "demand", riskImpact: 0.2, liquidity: 1 }],
    currentWeights: { ABC: 0.5 },
    actionAlternatives: [{ type: "hold", label: "Hold ABC" }],
  });

  assert.equal(result.candidates[0]?.expectedImpact, -0.1);
  assert.equal(result.candidates[0]?.source.status, "manual");
  assert.equal(result.approvalRequired, true);
});
