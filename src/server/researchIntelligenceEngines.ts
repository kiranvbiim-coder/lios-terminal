/**
 * Research Intelligence Engines: What Changed detection, Kill My Thesis
 * challenge, contradiction detection, evidence scoring, and research
 * memory. These are deterministic analytical engines that work over
 * structured evidence records — AI can optionally explain the results
 * but these engines do not require AI to function.
 *
 * All functions are deterministic and pure.
 */
import crypto from "crypto";

// ─── What Changed Detection ───────────────────────────────────────────────

export interface DataPoint {
  field: string;
  value: number | string | null;
  source: string;
  asOf: string;
}

export interface ChangeDetectionInputs {
  currentData: DataPoint[];
  previousData: DataPoint[];
  materialityThresholdPct: number; // decimal (0.05 = 5%)
}

export interface DetectedChange {
  field: string;
  previousValue: number | string | null;
  currentValue: number | string | null;
  changePct: number | null;
  isMaterial: boolean;
  source: string;
  direction: "increased" | "decreased" | "changed" | "unchanged";
}

export interface ChangeDetectionResult {
  changes: DetectedChange[];
  materialChanges: number;
  totalFieldsCompared: number;
  changeHash: string;
}

export function detectChanges(inputs: ChangeDetectionInputs): ChangeDetectionResult {
  const { currentData, previousData, materialityThresholdPct } = inputs;
  const prevMap = new Map(previousData.map((d) => [d.field, d]));
  const changes: DetectedChange[] = [];

  for (const current of currentData) {
    const prev = prevMap.get(current.field);
    if (!prev) {
      changes.push({ field: current.field, previousValue: null, currentValue: current.value, changePct: null, isMaterial: true, source: current.source, direction: "changed" });
      continue;
    }
    if (typeof current.value === "number" && typeof prev.value === "number") {
      const changePct = prev.value !== 0 ? (current.value - prev.value) / Math.abs(prev.value) : (current.value !== 0 ? 1 : 0);
      const isMaterial = Math.abs(changePct) >= materialityThresholdPct;
      changes.push({ field: current.field, previousValue: prev.value, currentValue: current.value, changePct, isMaterial, source: current.source, direction: changePct > 0 ? "increased" : changePct < 0 ? "decreased" : "unchanged" });
    } else if (current.value !== prev.value) {
      changes.push({ field: current.field, previousValue: prev.value, currentValue: current.value, changePct: null, isMaterial: true, source: current.source, direction: "changed" });
    }
  }

  const materialChanges = changes.filter((c) => c.isMaterial).length;
  const changeHash = crypto.createHash("sha256").update(JSON.stringify(changes.filter((c) => c.isMaterial))).digest("hex");

  return { changes, materialChanges, totalFieldsCompared: currentData.length, changeHash };
}

// ─── Kill My Thesis ───────────────────────────────────────────────────────

export interface ThesisStatement {
  id: string;
  claim: string;
  evidenceRefs: string[];
  confidence: number;         // 0-1
}

export interface ContradictoryEvidence {
  evidenceId: string;
  summary: string;
  contradicts: string;       // thesis id
  strength: "strong" | "moderate" | "weak";
  source: string;
}

export interface ThesisChallengeInputs {
  theses: ThesisStatement[];
  contradictions: ContradictoryEvidence[];
  dataChanges?: ChangeDetectionResult;
}

export interface ThesisChallengeResult {
  theses: Array<{
    id: string;
    claim: string;
    originalConfidence: number;
    adjustedConfidence: number;
    contradictionCount: number;
    strongContradictions: number;
    materialDataChanges: number;
    status: "confirmed" | "weakened" | "challenged" | "invalidated";
  }>;
  overallThesisHealth: number;  // 0-1
  criticalRisks: string[];
}

export function challengeThesis(inputs: ThesisChallengeInputs): ThesisChallengeResult {
  const { theses, contradictions, dataChanges } = inputs;
  const criticalRisks: string[] = [];

  const results = theses.map((thesis) => {
    const relevant = contradictions.filter((c) => c.contradicts === thesis.id);
    const strongCount = relevant.filter((c) => c.strength === "strong").length;
    const moderateCount = relevant.filter((c) => c.strength === "moderate").length;
    const weakCount = relevant.filter((c) => c.strength === "weak").length;

    // Confidence adjustment
    const contradictionPenalty = strongCount * 0.20 + moderateCount * 0.10 + weakCount * 0.05;
    const materialDataPenalty = (dataChanges?.materialChanges ?? 0) * 0.03;
    const adjustedConfidence = Math.max(0, Math.min(1, thesis.confidence - contradictionPenalty - materialDataPenalty));

    let status: "confirmed" | "weakened" | "challenged" | "invalidated";
    if (adjustedConfidence >= 0.7) status = "confirmed";
    else if (adjustedConfidence >= 0.4) status = "weakened";
    else if (adjustedConfidence >= 0.15) status = "challenged";
    else status = "invalidated";

    if (status === "invalidated") criticalRisks.push(`Thesis "${thesis.claim}" may be invalidated`);
    if (strongCount >= 2) criticalRisks.push(`Multiple strong contradictions to "${thesis.claim}"`);

    return {
      id: thesis.id, claim: thesis.claim, originalConfidence: thesis.confidence,
      adjustedConfidence, contradictionCount: relevant.length,
      strongContradictions: strongCount, materialDataChanges: dataChanges?.materialChanges ?? 0, status,
    };
  });

  const overallThesisHealth = results.length > 0
    ? results.reduce((s, r) => s + r.adjustedConfidence, 0) / results.length
    : 0;

  return { theses: results, overallThesisHealth, criticalRisks };
}

// ─── Evidence Scoring ─────────────────────────────────────────────────────

export interface EvidenceItem {
  id: string;
  sourceType: "filing" | "news" | "research" | "data" | "user" | "ai";
  provider: string;
  publishedAt: string;
  freshnessScore: number;     // 0-1
  relevanceScore: number;     // 0-1
  hasProvenance: boolean;
  isDeterministic: boolean;
}

export interface EvidenceScoreResult {
  items: Array<{
    id: string;
    compositeScore: number;
    qualityLevel: "high" | "medium" | "low" | "unverified";
  }>;
  averageScore: number;
  coverageGaps: string[];
  provenanceRate: number;     // fraction with provenance
}

export function scoreEvidence(items: EvidenceItem[]): EvidenceScoreResult {
  const SOURCE_WEIGHT: Record<string, number> = { filing: 1.0, data: 0.9, research: 0.7, news: 0.5, user: 0.6, ai: 0.3 };
  const sourceTypes = new Set(items.map((i) => i.sourceType));
  const expectedTypes = ["filing", "data", "research", "news"];
  const coverageGaps = expectedTypes.filter((t) => !sourceTypes.has(t as EvidenceItem["sourceType"]));

  const scored = items.map((item) => {
    const sourceWeight = SOURCE_WEIGHT[item.sourceType] ?? 0.5;
    const provenanceBonus = item.hasProvenance ? 0.15 : 0;
    const deterministicBonus = item.isDeterministic ? 0.10 : 0;
    const compositeScore = Math.min(1, item.freshnessScore * 0.3 + item.relevanceScore * 0.3 + sourceWeight * 0.25 + provenanceBonus + deterministicBonus);
    const qualityLevel = compositeScore >= 0.7 ? "high" : compositeScore >= 0.4 ? "medium" : compositeScore >= 0.2 ? "low" : "unverified";
    return { id: item.id, compositeScore, qualityLevel: qualityLevel as "high" | "medium" | "low" | "unverified" };
  });

  const averageScore = scored.length > 0 ? scored.reduce((s, i) => s + i.compositeScore, 0) / scored.length : 0;
  const provenanceRate = items.length > 0 ? items.filter((i) => i.hasProvenance).length / items.length : 0;

  return { items: scored, averageScore, coverageGaps, provenanceRate };
}

// ─── Intelligence Score Decomposition ─────────────────────────────────────

export interface IntelligenceScoreInputs {
  dataQuality: number;         // 0-100
  evidenceQuality: number;     // 0-100
  modelReliability: number;    // 0-100
  valuationAttractiveness: number; // 0-100
  riskPressure: number;        // 0-100 (higher = more risk)
}

export interface IntelligenceScoreResult {
  overallScore: number;        // 0-100
  decisionConfidence: number;  // 0-100
  components: IntelligenceScoreInputs;
  grade: "A" | "B" | "C" | "D" | "F";
  actionability: "strong_conviction" | "moderate_conviction" | "low_conviction" | "insufficient_evidence";
}

/**
 * Limuria Intelligence Score: a decomposed, transparent score rather than
 * a black-box number. Each component is independently verifiable.
 */
export function computeIntelligenceScore(inputs: IntelligenceScoreInputs): IntelligenceScoreResult {
  const { dataQuality, evidenceQuality, modelReliability, valuationAttractiveness, riskPressure } = inputs;

  // Weighted composite: data and evidence matter most
  const overallScore = dataQuality * 0.25 + evidenceQuality * 0.25 + modelReliability * 0.20 + valuationAttractiveness * 0.15 + (100 - riskPressure) * 0.15;

  // Decision confidence depends more on data + evidence + model
  const decisionConfidence = dataQuality * 0.30 + evidenceQuality * 0.30 + modelReliability * 0.25 + (100 - riskPressure) * 0.15;

  const grade = overallScore >= 80 ? "A" : overallScore >= 65 ? "B" : overallScore >= 50 ? "C" : overallScore >= 35 ? "D" : "F";
  const actionability = decisionConfidence >= 75 ? "strong_conviction" : decisionConfidence >= 55 ? "moderate_conviction" : decisionConfidence >= 35 ? "low_conviction" : "insufficient_evidence";

  return { overallScore, decisionConfidence, components: inputs, grade, actionability };
}
