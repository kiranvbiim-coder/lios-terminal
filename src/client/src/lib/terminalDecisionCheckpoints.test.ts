import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionDriftReport, createDecisionCheckpoint } from "./terminalDecisionCheckpoints";
import { addDecisionEvidence, createDecisionObject, patchDecisionObject } from "./terminalDecisionObjects";
import { createIntelligenceObject } from "./terminalIntelligenceObjects";

function metric(idLabel: string, value: number) {
  return createIntelligenceObject({ kind: "metric", label: idLabel, status: "stable", value: { raw: value }, tags: [], assumptions: {}, metadata: {} });
}

test("decision checkpoint freezes linked object values and evidence balance", () => {
  const fairValue = metric("Fair Value", 100);
  let decision = createDecisionObject({ title: "Decision", direction: "buy", status: "active", thesis: "Value exceeds price", confidence: 70 });
  decision = addDecisionEvidence(decision, { objectId: fairValue.id, role: "support", weight: 2 });
  const checkpoint = createDecisionCheckpoint({ decision, objects: [fairValue] });
  assert.equal(checkpoint.objectStates[0].value, 100);
  assert.equal(checkpoint.evidenceSupport, 2);
});

test("decision drift reports numeric object movement without inventing causality", () => {
  const fairValue = metric("Fair Value", 100);
  let decision = createDecisionObject({ title: "Decision", direction: "buy", status: "active", thesis: "Value exceeds price", confidence: 70 });
  decision = addDecisionEvidence(decision, { objectId: fairValue.id, role: "support", weight: 1 });
  const checkpoint = createDecisionCheckpoint({ decision, objects: [fairValue] });
  const changed = { ...fairValue, value: { raw: 80 }, updatedAt: fairValue.updatedAt + 100 };
  const report = buildDecisionDriftReport(decision, checkpoint, [changed]);
  assert.equal(report.changedObjectCount, 1);
  assert.equal(report.materialObjectCount, 1);
  assert.equal(report.objectDrift[0].percentDelta, -20);
});

test("decision drift separately flags thesis direction and confidence changes", () => {
  const object = metric("Signal", 1);
  let decision = createDecisionObject({ title: "Decision", direction: "hold", status: "active", thesis: "Stable", confidence: 60 });
  decision = addDecisionEvidence(decision, { objectId: object.id, role: "context" });
  const checkpoint = createDecisionCheckpoint({ decision, objects: [object] });
  decision = patchDecisionObject(decision, { direction: "sell", thesis: "Deteriorated", confidence: 35 });
  const report = buildDecisionDriftReport(decision, checkpoint, [object]);
  assert.equal(report.directionChanged, true);
  assert.equal(report.thesisChanged, true);
  assert.equal(report.confidenceDelta, -25);
});
