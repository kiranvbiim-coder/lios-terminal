import { createHash } from "node:crypto";

export type EvidenceInput = {
  id?: number;
  title: string;
  kind: string;
  supports: "supports" | "contradicts" | "neutral";
  quality: {
    authority: number;
    directness: number;
    recency: number;
    corroboration: number;
    extractionConfidence: number;
  };
};

export type AssumptionInput = {
  label: string;
  value: string;
  uncertainty: number;
  basis: string;
  invalidationCondition: string;
};

export type ScenarioInput = {
  name: string;
  probability?: number;
  outcome: number;
  decision: string;
};

export type ModelCandidate = {
  name: string;
  version: string;
  output: number;
  methodologyQuality: number;
  sourceCoverage: number;
  validationScore: number;
  independence: number;
};

export type ContradictionInput = {
  description: string;
  resolved: boolean;
  resolution?: string;
};

export type DecisionConfidence = {
  score: number;
  label: "low" | "guarded" | "moderate" | "strong";
  components: {
    evidenceCoverage: number;
    sourceQuality: number;
    modelAgreement: number;
    sensitivityResilience: number;
    uncertaintyDiscipline: number;
    contradictionResolution: number;
  };
  explanation: string[];
  caveat: string;
};

export type ReceiptCompletenessInput = {
  question: string;
  recommendation: string;
  interpretation: string;
  materiality: "routine" | "material" | "critical";
  requiredEvidenceCount: number;
  evidence: Array<Record<string, unknown>>;
  assumptions: Array<Record<string, unknown>>;
  calculations: Array<Record<string, unknown>>;
  models: Array<Record<string, unknown>>;
  scenarios: Array<Record<string, unknown>>;
  alternatives: Array<Record<string, unknown>>;
  counterarguments: Array<Record<string, unknown>>;
  contradictions: ContradictionInput[];
  monitoringTriggers: Array<Record<string, unknown>>;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const round = (value: number, digits = 4) => Number(value.toFixed(digits));
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}

export function decisionSnapshotHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function modelAgreement(models: ModelCandidate[]): number {
  if (models.length < 2) return models.length === 1 ? 0.5 : 0;
  const outputs = models.map((model) => model.output);
  const center = Math.max(Math.abs(mean(outputs)), 1e-9);
  const deviation = Math.sqrt(mean(outputs.map((value) => (value - mean(outputs)) ** 2)));
  return clamp01(1 - deviation / center);
}

export function calculateDecisionConfidence(input: {
  evidence: EvidenceInput[];
  requiredEvidenceCount: number;
  assumptions: AssumptionInput[];
  scenarios: ScenarioInput[];
  models: ModelCandidate[];
  contradictions: ContradictionInput[];
}): DecisionConfidence {
  const evidenceCoverage = clamp01(input.evidence.length / Math.max(1, input.requiredEvidenceCount));
  const sourceQuality = input.evidence.length
    ? mean(input.evidence.map((evidence) => mean(Object.values(evidence.quality).map(clamp01))))
    : 0;
  const agreement = modelAgreement(input.models);
  const outcomes = input.scenarios.map((scenario) => scenario.outcome);
  const outcomeCenter = Math.max(Math.abs(mean(outcomes)), 1e-9);
  const outcomeRange = outcomes.length > 1 ? Math.max(...outcomes) - Math.min(...outcomes) : outcomeCenter;
  const sensitivityResilience = outcomes.length ? clamp01(1 - Math.abs(outcomeRange) / (2 * outcomeCenter)) : 0;
  const uncertaintyDiscipline = input.assumptions.length
    ? mean(input.assumptions.map((assumption) => {
      const documented = assumption.basis.trim() && assumption.invalidationCondition.trim() ? 1 : 0;
      return clamp01(documented * (1 - clamp01(assumption.uncertainty) * 0.35));
    }))
    : 0;
  const contradictionResolution = input.contradictions.length
    ? input.contradictions.filter((item) => item.resolved && item.resolution?.trim()).length / input.contradictions.length
    : 1;

  const components = {
    evidenceCoverage: round(evidenceCoverage),
    sourceQuality: round(sourceQuality),
    modelAgreement: round(agreement),
    sensitivityResilience: round(sensitivityResilience),
    uncertaintyDiscipline: round(uncertaintyDiscipline),
    contradictionResolution: round(contradictionResolution),
  };
  const weights = {
    evidenceCoverage: 0.22,
    sourceQuality: 0.2,
    modelAgreement: 0.16,
    sensitivityResilience: 0.15,
    uncertaintyDiscipline: 0.12,
    contradictionResolution: 0.15,
  };
  const rawScore = Object.entries(weights).reduce((sum, [key, weight]) => sum + components[key as keyof typeof components] * weight, 0);
  const score = Math.min(95, Math.round(rawScore * 100));
  const label = score >= 80 ? "strong" : score >= 65 ? "moderate" : score >= 45 ? "guarded" : "low";
  const explanation = Object.entries(components)
    .sort((left, right) => left[1] - right[1])
    .slice(0, 3)
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}: ${Math.round(value * 100)}%`);

  return {
    score,
    label,
    components,
    explanation,
    caveat: "Decision confidence is a transparent evidence-readiness score, not a probability of success or statistical certainty.",
  };
}

export function runModelTournament(models: ModelCandidate[]) {
  const ranked = models.map((model) => ({
    ...model,
    score: round(100 * (
      clamp01(model.methodologyQuality) * 0.3
      + clamp01(model.sourceCoverage) * 0.25
      + clamp01(model.validationScore) * 0.3
      + clamp01(model.independence) * 0.15
    ), 2),
  })).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
  return {
    ranked,
    winner: ranked[0] ?? null,
    agreement: round(modelAgreement(models)),
    warning: models.length < 2 ? "At least two independent models are required for a tournament." : null,
  };
}

export function stressThesis(input: {
  evidence: EvidenceInput[];
  assumptions: AssumptionInput[];
  scenarios: ScenarioInput[];
  contradictions: ContradictionInput[];
}) {
  const counterevidence = input.evidence.filter((item) => item.supports === "contradicts");
  const fragileAssumptions = input.assumptions.filter((item) => clamp01(item.uncertainty) >= 0.6 || !item.invalidationCondition.trim());
  const reversalScenarios = input.scenarios.filter((item) => /reject|avoid|sell|exit|defer|no[- ]go/i.test(item.decision));
  const unresolvedContradictions = input.contradictions.filter((item) => !item.resolved);
  const killSignalCount = counterevidence.length + fragileAssumptions.length + reversalScenarios.length + unresolvedContradictions.length;
  return {
    verdict: killSignalCount >= 4 ? "thesis_fails" : killSignalCount >= 2 ? "material_challenge" : "survives_current_tests",
    killSignalCount,
    counterevidence,
    fragileAssumptions,
    reversalScenarios,
    unresolvedContradictions,
  } as const;
}

export function findDecisionBoundary(points: Array<{ assumptionValue: number; outcome: number }>, threshold: number) {
  const sorted = [...points].filter((point) => Number.isFinite(point.assumptionValue) && Number.isFinite(point.outcome))
    .sort((left, right) => left.assumptionValue - right.assumptionValue);
  for (let index = 1; index < sorted.length; index += 1) {
    const left = sorted[index - 1];
    const right = sorted[index];
    if ((left.outcome - threshold) * (right.outcome - threshold) <= 0 && left.outcome !== right.outcome) {
      const fraction = (threshold - left.outcome) / (right.outcome - left.outcome);
      return {
        assumptionValue: round(left.assumptionValue + fraction * (right.assumptionValue - left.assumptionValue), 6),
        threshold,
        bracket: [left, right],
      };
    }
  }
  return null;
}

export function calculateReverseDcf(input: {
  enterpriseValue: number;
  currentFreeCashFlow: number;
  forecastYears: number;
  discountRate: number;
  terminalGrowthRate: number;
}) {
  const { enterpriseValue, currentFreeCashFlow, forecastYears, discountRate, terminalGrowthRate } = input;
  if (!(enterpriseValue > 0) || !(currentFreeCashFlow > 0) || !Number.isInteger(forecastYears) || forecastYears < 1 || forecastYears > 30) {
    throw new Error("Enterprise value, free cash flow, and forecast years must be positive.");
  }
  if (!(discountRate > terminalGrowthRate) || discountRate <= -1 || terminalGrowthRate <= -1) {
    throw new Error("Discount rate must be greater than terminal growth rate.");
  }
  const presentValue = (growthRate: number) => {
    let value = 0;
    for (let year = 1; year <= forecastYears; year += 1) {
      value += currentFreeCashFlow * (1 + growthRate) ** year / (1 + discountRate) ** year;
    }
    const terminalFcf = currentFreeCashFlow * (1 + growthRate) ** forecastYears * (1 + terminalGrowthRate);
    value += terminalFcf / (discountRate - terminalGrowthRate) / (1 + discountRate) ** forecastYears;
    return value;
  };
  let low = -0.95;
  let high = 3;
  if (presentValue(low) > enterpriseValue || presentValue(high) < enterpriseValue) {
    throw new Error("No implied growth solution exists inside the supported -95% to 300% range.");
  }
  for (let iteration = 0; iteration < 120; iteration += 1) {
    const midpoint = (low + high) / 2;
    if (presentValue(midpoint) < enterpriseValue) low = midpoint;
    else high = midpoint;
  }
  const impliedGrowthRate = (low + high) / 2;
  return {
    impliedGrowthRate: round(impliedGrowthRate, 8),
    impliedGrowthPercent: round(impliedGrowthRate * 100, 4),
    reproducedEnterpriseValue: round(presentValue(impliedGrowthRate), 2),
    assumptions: { forecastYears, discountRate, terminalGrowthRate },
  };
}

export function assessReceiptCompleteness(input: ReceiptCompletenessInput) {
  const missing: string[] = [];
  if (!input.question.trim()) missing.push("question");
  if (!input.recommendation.trim()) missing.push("recommendation");
  if (!input.interpretation.trim()) missing.push("interpretation");
  if (input.evidence.length < Math.max(1, input.requiredEvidenceCount)) missing.push("evidence coverage");
  if (!input.assumptions.length || input.assumptions.some((item) => !String(item.basis ?? "").trim() || !String(item.invalidationCondition ?? "").trim())) {
    missing.push("assumption basis and invalidation conditions");
  }
  if (input.calculations.some((item) => !String(item.deterministicRef ?? "").trim())) missing.push("deterministic calculation references");
  if (!input.models.length || input.models.some((item) => !String(item.version ?? "").trim())) missing.push("versioned models");
  if (input.scenarios.length < 2) missing.push("at least two scenarios");
  if (input.alternatives.length < 2) missing.push("at least two alternatives");
  if (!input.counterarguments.length) missing.push("counterarguments");
  if (input.contradictions.some((item) => !item.resolved || !item.resolution?.trim())) missing.push("resolved contradictions");
  if (input.materiality !== "routine" && !input.monitoringTriggers.length) missing.push("reversal triggers");
  return { complete: missing.length === 0, missing };
}

export function evaluateMonitoringRule(operator: string, threshold: number, currentValue: number): boolean {
  if (!Number.isFinite(threshold) || !Number.isFinite(currentValue)) throw new Error("Threshold and current value must be finite.");
  switch (operator) {
    case "gt": return currentValue > threshold;
    case "gte": return currentValue >= threshold;
    case "lt": return currentValue < threshold;
    case "lte": return currentValue <= threshold;
    case "eq": return currentValue === threshold;
    default: throw new Error(`Unsupported monitoring operator: ${operator}`);
  }
}
