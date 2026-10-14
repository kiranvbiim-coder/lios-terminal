import test from "node:test";
import assert from "node:assert/strict";
import {
  detectChanges,
  challengeThesis,
  scoreEvidence,
  computeIntelligenceScore,
} from "./researchIntelligenceEngines";

// ─── What Changed ─────────────────────────────────────────────────────────

test("change detection: identifies material numeric changes", () => {
  const result = detectChanges({
    currentData: [
      { field: "revenue", value: 110, source: "SEC", asOf: "2026-08-25" },
      { field: "eps", value: 5.2, source: "SEC", asOf: "2026-08-25" },
      { field: "margin", value: 0.15, source: "SEC", asOf: "2026-08-25" },
    ],
    previousData: [
      { field: "revenue", value: 100, source: "SEC", asOf: "2026-05-25" },
      { field: "eps", value: 5.0, source: "SEC", asOf: "2026-05-25" },
      { field: "margin", value: 0.14, source: "SEC", asOf: "2026-05-25" },
    ],
    materialityThresholdPct: 0.05,
  });
  assert.equal(result.totalFieldsCompared, 3);
  // Revenue: +10% → material
  const revChange = result.changes.find((c) => c.field === "revenue");
  assert.ok(revChange?.isMaterial);
  assert.equal(revChange?.direction, "increased");
  assert.ok(Math.abs(revChange!.changePct! - 0.10) < 0.001);
  // Margin: 7.1% → material
  const marginChange = result.changes.find((c) => c.field === "margin");
  assert.ok(marginChange?.isMaterial);
  assert.ok(result.materialChanges >= 2);
  assert.equal(result.changeHash.length, 64);
});

test("change detection: new fields are flagged as material", () => {
  const result = detectChanges({
    currentData: [{ field: "newMetric", value: 42, source: "internal", asOf: "2026-08-25" }],
    previousData: [],
    materialityThresholdPct: 0.05,
  });
  assert.equal(result.materialChanges, 1);
  assert.equal(result.changes[0].direction, "changed");
});

// ─── Kill My Thesis ───────────────────────────────────────────────────────

test("thesis challenge: strong contradictions reduce confidence", () => {
  const result = challengeThesis({
    theses: [
      { id: "t1", claim: "Revenue will grow 15%", evidenceRefs: ["e1"], confidence: 0.80 },
    ],
    contradictions: [
      { evidenceId: "e2", summary: "Market contraction", contradicts: "t1", strength: "strong", source: "industry_report" },
      { evidenceId: "e3", summary: "Competitor gains share", contradicts: "t1", strength: "moderate", source: "news" },
    ],
  });
  assert.equal(result.theses.length, 1);
  assert.ok(result.theses[0].adjustedConfidence < 0.80);
  assert.ok(result.theses[0].adjustedConfidence < 0.60); // -0.20 strong -0.10 moderate = 0.50
  assert.equal(result.theses[0].status, "weakened");
  assert.equal(result.criticalRisks.length, 0); // 1 strong + 1 moderate: weakened, not invalidated
});

test("thesis challenge: no contradictions preserve confidence", () => {
  const result = challengeThesis({
    theses: [
      { id: "t1", claim: "Stable market position", evidenceRefs: ["e1"], confidence: 0.85 },
    ],
    contradictions: [],
  });
  assert.equal(result.theses[0].adjustedConfidence, 0.85);
  assert.equal(result.theses[0].status, "confirmed");
  assert.equal(result.overallThesisHealth, 0.85);
});

test("thesis challenge: invalidated thesis detected", () => {
  const result = challengeThesis({
    theses: [
      { id: "t1", claim: "Strong growth ahead", evidenceRefs: [], confidence: 0.40 },
    ],
    contradictions: [
      { evidenceId: "e1", summary: "Recession", contradicts: "t1", strength: "strong", source: "fed" },
      { evidenceId: "e2", summary: "Earnings miss", contradicts: "t1", strength: "strong", source: "filing" },
    ],
  });
  assert.equal(result.theses[0].status, "invalidated");
  assert.ok(result.criticalRisks.length > 0);
});

// ─── Evidence Scoring ─────────────────────────────────────────────────────

test("evidence scoring: filing with provenance scores higher than AI without", () => {
  const result = scoreEvidence([
    { id: "e1", sourceType: "filing", provider: "SEC", publishedAt: "2026-08-01", freshnessScore: 0.9, relevanceScore: 0.8, hasProvenance: true, isDeterministic: true },
    { id: "e2", sourceType: "ai", provider: "Gemini", publishedAt: "2026-08-25", freshnessScore: 1.0, relevanceScore: 0.7, hasProvenance: false, isDeterministic: false },
  ]);
  const filing = result.items.find((i) => i.id === "e1");
  const ai = result.items.find((i) => i.id === "e2");
  assert.ok(filing && ai);
  assert.ok(filing.compositeScore > ai.compositeScore);
  assert.equal(filing.qualityLevel, "high");
  assert.equal(result.provenanceRate, 0.5);
});

test("evidence scoring: coverage gaps detected", () => {
  const result = scoreEvidence([
    { id: "e1", sourceType: "news", provider: "Reuters", publishedAt: "2026-08-25", freshnessScore: 0.9, relevanceScore: 0.6, hasProvenance: false, isDeterministic: false },
  ]);
  assert.ok(result.coverageGaps.includes("filing"));
  assert.ok(result.coverageGaps.includes("data"));
  assert.ok(result.coverageGaps.includes("research"));
});

// ─── Intelligence Score ───────────────────────────────────────────────────

test("intelligence score: high inputs produce A grade", () => {
  const result = computeIntelligenceScore({
    dataQuality: 90, evidenceQuality: 85, modelReliability: 80,
    valuationAttractiveness: 75, riskPressure: 20,
  });
  assert.equal(result.grade, "A");
  assert.equal(result.actionability, "strong_conviction");
  assert.ok(result.overallScore >= 80);
  assert.ok(result.decisionConfidence >= 75);
});

test("intelligence score: poor data produces low grade", () => {
  const result = computeIntelligenceScore({
    dataQuality: 20, evidenceQuality: 25, modelReliability: 30,
    valuationAttractiveness: 50, riskPressure: 80,
  });
  assert.ok(result.grade === "D" || result.grade === "F");
  assert.equal(result.actionability, "insufficient_evidence");
});

test("intelligence score: components are preserved", () => {
  const inputs = { dataQuality: 70, evidenceQuality: 65, modelReliability: 60, valuationAttractiveness: 55, riskPressure: 40 };
  const result = computeIntelligenceScore(inputs);
  assert.deepEqual(result.components, inputs);
  assert.ok(result.overallScore > 0 && result.overallScore <= 100);
});
