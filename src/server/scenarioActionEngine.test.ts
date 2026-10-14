import test from "node:test";
import assert from "node:assert/strict";
import { calculateScenarioActionCandidates } from "./scenarioActionEngine";

test("scenario action candidates reduce the loss from a supplied shock", () => {
  const result = calculateScenarioActionCandidates({
    nodeImpacts: [{ node: "demand", change: -0.2, provider: "manual", asOf: "2026-08-31", unit: "return per weight" }],
    assetImpacts: [{ assetId: "ABC", node: "demand", riskImpact: 0.2, liquidity: 0.9 }],
    exposures: [{ assetId: "ABC", weight: 0.5 }],
    actionAlternatives: ["hold", "reduce"],
    constraints: { maxWeight: 0.6, minLiquidity: 0.5, maxTurnover: 0.6, riskBudget: 0.2 },
    costs: { reduce: 0.01 },
  });

  assert.equal(result.inputCoverage.complete, true);
  assert.equal(result.candidates.length, 2);
  const reduce = result.candidates.find((candidate) => candidate.type === "reduce");
  assert.ok(reduce);
  assert.equal(reduce.status, "feasible");
  assert.equal(reduce.expectedImpact, 0);
  assert.equal(reduce.netExpectedImpact, -0.01);
  assert.equal(reduce.residualRisk, 0);
  assert.equal(reduce.turnover, 0.5);
  assert.equal(reduce.approvalRequired, true);
  assert.equal(result.recommendedAction, "REDUCE");
});

test("candidate is rejected when target weight breaches max weight", () => {
  const result = calculateScenarioActionCandidates({
    assetImpacts: [{ assetId: "ABC", scenarioImpact: 0.1, riskImpact: 0.1, liquidity: 1 }],
    currentWeights: { ABC: 0.5 },
    actionAlternatives: [{ type: "increase", label: "Increase ABC" }],
    constraints: { maxWeight: 0.6, maxTurnover: 1, minLiquidity: 0, riskBudget: 1 },
  });

  assert.equal(result.candidates[0]?.status, "rejected");
  assert.deepEqual(result.candidates[0]?.constraintViolations.map((violation) => violation.constraint), ["max_weight"]);
  assert.equal(result.recommendedAction, null);
});

test("missing observations remain null and become required evidence", () => {
  const result = calculateScenarioActionCandidates({
    assetImpacts: [{ assetId: "ABC", liquidity: 0.8 }],
    currentExposure: { ABC: 0.25 },
    actionAlternatives: ["hold"],
  });
  const candidate = result.candidates[0];
  assert.equal(candidate?.expectedImpact, null);
  assert.equal(candidate?.residualRisk, null);
  assert.equal(candidate?.status, "rejected");
  assert.ok(candidate?.requiredEvidence.some((evidence) => evidence.requirement === "Scenario impact observation"));
});
