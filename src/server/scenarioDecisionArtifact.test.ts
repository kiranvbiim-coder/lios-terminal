import test from "node:test";
import assert from "node:assert/strict";
import { buildScenarioDecisionArtifact, validateScenarioPipelineCalculation } from "./scenarioDecisionArtifact";
import { decisionSnapshotHash } from "./decisionEngine";

const input = {
  nodeImpacts: { revenue: -0.04 },
  assetImpacts: [{ assetId: "AAPL", node: "revenue", scenarioImpact: -0.02, riskImpact: 0.03, liquidity: 0.8, provider: "manual-import", asOf: "2026-08-31", unit: "return" }],
  exposures: [{ assetId: "AAPL", weight: 0.25 }],
  actionAlternatives: [{ type: "hold" as const }, { type: "reduce" as const, targetWeight: 0.1 }],
  constraints: { maxWeight: 1, minLiquidity: 0, maxTurnover: 1, riskBudget: 1 },
  source: { status: "provider" as const, provider: "manual-import", asOf: "2026-08-31", unit: "return" },
};

test("scenario artifact replay is deterministic and remains a candidate", () => {
  const first = buildScenarioDecisionArtifact({ scenarioInputs: input, modelVersion: "scenario-action-v1", modelHash: "model-sha" });
  const replay = buildScenarioDecisionArtifact({ scenarioInputs: structuredClone(input), modelVersion: "scenario-action-v1", modelHash: "model-sha" });
  assert.equal(first.artifact.candidateHash, replay.artifact.candidateHash);
  assert.deepEqual(first.artifact.candidateRanking, replay.artifact.candidateRanking);
  assert.equal(first.artifact.candidateStatus, "candidate");
  assert.equal(first.artifact.approvedDecision, null);
  assert.equal(first.artifact.sourceMetadata.provider, "manual-import");
});

test("scenario artifact hash changes when a material input changes", () => {
  const original = buildScenarioDecisionArtifact({ scenarioInputs: input, modelVersion: "scenario-action-v1" });
  const changed = buildScenarioDecisionArtifact({
    scenarioInputs: { ...input, constraints: { ...input.constraints, riskBudget: 0.001 } },
    modelVersion: "scenario-action-v1",
  });
  assert.notEqual(original.artifact.candidateHash, changed.artifact.candidateHash);
});

test("scenario artifact has no execution/order fields", () => {
  const { artifact } = buildScenarioDecisionArtifact({ scenarioInputs: input });
  assert.equal("orderId" in artifact, false);
  assert.equal("broker" in artifact, false);
  assert.equal("execution" in artifact, false);
});

test("scenario pipeline validator accepts an artifact and deterministic reference", () => {
  const trace = { schemaVersion: 1, valuation: { delta: -2 }, limitations: [] };
  const traceHash = decisionSnapshotHash(trace);
  const result = validateScenarioPipelineCalculation({
    scenarioPipelineArtifact: { ...trace, traceHash },
    deterministicRef: `scenario-pipeline:${traceHash}`,
  });
  assert.equal(result?.traceHash, traceHash);
  assert.equal(result?.calculation.value, -2);
  assert.equal(result?.calculation.modelVersion, "scenario-pipeline-v1");
});
