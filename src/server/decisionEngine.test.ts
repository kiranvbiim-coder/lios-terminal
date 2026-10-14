import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateDecisionConfidence,
  calculateReverseDcf,
  assessReceiptCompleteness,
  decisionSnapshotHash,
  evaluateMonitoringRule,
  findDecisionBoundary,
  runModelTournament,
  stressThesis,
  type AssumptionInput,
  type EvidenceInput,
} from "./decisionEngine";

const quality = { authority: 0.9, directness: 0.8, recency: 1, corroboration: 0.7, extractionConfidence: 0.95 };
const evidence: EvidenceInput[] = [
  { id: 1, title: "Filing", kind: "filing", supports: "supports", quality },
  { id: 2, title: "Channel check", kind: "internal_note", supports: "contradicts", quality: { ...quality, authority: 0.6 } },
];
const assumptions: AssumptionInput[] = [
  { label: "Revenue growth", value: "12%", uncertainty: 0.3, basis: "Filed guidance", invalidationCondition: "Guidance below 8%" },
];

test("snapshot hashes are stable across object key order", () => {
  assert.equal(decisionSnapshotHash({ b: 2, a: { d: 4, c: 3 } }), decisionSnapshotHash({ a: { c: 3, d: 4 }, b: 2 }));
});

test("confidence is decomposed, capped, and explicitly non-probabilistic", () => {
  const confidence = calculateDecisionConfidence({
    evidence,
    requiredEvidenceCount: 2,
    assumptions,
    scenarios: [
      { name: "Bear", outcome: 80, decision: "defer" },
      { name: "Base", outcome: 100, decision: "proceed" },
      { name: "Bull", outcome: 120, decision: "proceed" },
    ],
    models: [
      { name: "DCF", version: "1", output: 100, methodologyQuality: 0.9, sourceCoverage: 0.9, validationScore: 0.8, independence: 0.7 },
      { name: "Comps", version: "1", output: 105, methodologyQuality: 0.8, sourceCoverage: 0.8, validationScore: 0.75, independence: 0.9 },
    ],
    contradictions: [{ description: "Demand signal conflict", resolved: true, resolution: "Filed orders take precedence" }],
  });
  assert.ok(confidence.score > 65 && confidence.score <= 95);
  assert.equal(confidence.components.evidenceCoverage, 1);
  assert.match(confidence.caveat, /not a probability/i);
});

test("model tournament uses quality rather than highest output", () => {
  const tournament = runModelTournament([
    { name: "Optimistic", version: "1", output: 180, methodologyQuality: 0.3, sourceCoverage: 0.4, validationScore: 0.2, independence: 0.8 },
    { name: "Validated", version: "2", output: 110, methodologyQuality: 0.9, sourceCoverage: 0.9, validationScore: 0.95, independence: 0.8 },
  ]);
  assert.equal(tournament.winner?.name, "Validated");
  assert.equal(tournament.ranked.length, 2);
});

test("thesis stress exposes counterevidence and reversal scenarios", () => {
  const result = stressThesis({
    evidence,
    assumptions: [{ ...assumptions[0], uncertainty: 0.8 }],
    scenarios: [{ name: "Bear", outcome: 60, decision: "no-go" }],
    contradictions: [{ description: "Conflicting demand evidence", resolved: false }],
  });
  assert.equal(result.verdict, "thesis_fails");
  assert.equal(result.killSignalCount, 4);
});

test("decision boundary interpolates the threshold crossing", () => {
  const boundary = findDecisionBoundary([
    { assumptionValue: 5, outcome: 90 },
    { assumptionValue: 10, outcome: 110 },
  ], 100);
  assert.equal(boundary?.assumptionValue, 7.5);
});

test("reverse DCF reproduces enterprise value and rejects invalid rates", () => {
  const result = calculateReverseDcf({ enterpriseValue: 1500, currentFreeCashFlow: 100, forecastYears: 5, discountRate: 0.1, terminalGrowthRate: 0.03 });
  assert.ok(result.impliedGrowthRate > 0);
  assert.ok(Math.abs(result.reproducedEnterpriseValue - 1500) < 0.01);
  assert.throws(() => calculateReverseDcf({ enterpriseValue: 100, currentFreeCashFlow: 10, forecastYears: 5, discountRate: 0.02, terminalGrowthRate: 0.03 }), /greater than terminal/);
});

test("material receipts expose every approval-blocking omission", () => {
  const result = assessReceiptCompleteness({
    question: "Proceed?", recommendation: "Proceed", interpretation: "Evidence supports entry", materiality: "material",
    requiredEvidenceCount: 2, evidence: [{ id: 1 }], assumptions: [], calculations: [], models: [], scenarios: [], alternatives: [],
    counterarguments: [], contradictions: [{ description: "Demand", resolved: false }], monitoringTriggers: [],
  });
  assert.equal(result.complete, false);
  assert.ok(result.missing.includes("evidence coverage"));
  assert.ok(result.missing.includes("reversal triggers"));
  assert.ok(result.missing.includes("resolved contradictions"));
});

test("monitoring rules support explicit comparison operators", () => {
  assert.equal(evaluateMonitoringRule("lt", 8, 7.5), true);
  assert.equal(evaluateMonitoringRule("gte", 10, 10), true);
  assert.equal(evaluateMonitoringRule("gt", 10, 10), false);
  assert.throws(() => evaluateMonitoringRule("contains", 1, 1), /Unsupported/);
});
