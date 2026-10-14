import type { QuantModelRegistryEntry, QuantValidationLevel } from "@shared/quantModelRegistry";

export type AssuranceBand =
  | "institutional"
  | "decision_grade"
  | "review_required"
  | "research_only"
  | "blocked";

export type ValidationEvidenceKind =
  | "known_answer"
  | "cross_engine"
  | "invariant"
  | "boundary"
  | "provider_reconciliation"
  | "out_of_sample"
  | "monte_carlo_stability"
  | "regression";

export interface ValidationEvidence {
  kind: ValidationEvidenceKind;
  passed: boolean;
  independent?: boolean;
  weight?: number;
  details?: string;
}

export interface DataQualityInput {
  completeness: number;
  freshness: number;
  provenance: number;
  providerAgreement: number;
  revisionStability: number;
  entitlement: number;
  outlierIntegrity: number;
  conflictCount?: number;
  unresolvedCriticalConflicts?: number;
}

export interface ModelAssuranceInput {
  modelId: string;
  status?: QuantModelRegistryEntry["status"];
  validationLevel: QuantValidationLevel;
  dataQuality: DataQualityInput;
  evidence: ValidationEvidence[];
  warnings?: string[];
  deterministic?: boolean;
  seed?: number | null;
  uncertaintyQuantified?: boolean;
  independentChallengerPassed?: boolean;
}

export interface ModelAssuranceResult {
  modelId: string;
  score: number;
  band: AssuranceBand;
  components: {
    validation: number;
    dataQuality: number;
    evidence: number;
    reproducibility: number;
  };
  blockers: string[];
  warnings: string[];
}

const VALIDATION_BASE: Record<QuantValidationLevel, number> = {
  known_answer: 0.98,
  regression_tested: 0.92,
  implementation_reviewed: 0.82,
  benchmark_required: 0.62,
  research_only: 0.42,
  not_started: 0.18,
};

const EVIDENCE_WEIGHT: Record<ValidationEvidenceKind, number> = {
  known_answer: 1.35,
  cross_engine: 1.25,
  invariant: 0.95,
  boundary: 0.9,
  provider_reconciliation: 1.1,
  out_of_sample: 1.3,
  monte_carlo_stability: 1.0,
  regression: 0.85,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function weightedGeometricMean(items: Array<{ value: number; weight: number }>): number {
  const valid = items.filter((item) => item.weight > 0);
  if (valid.length === 0) return 0;
  if (valid.some((item) => clamp01(item.value) === 0)) return 0;
  const totalWeight = valid.reduce((sum, item) => sum + item.weight, 0);
  const logSum = valid.reduce((sum, item) => sum + item.weight * Math.log(clamp01(item.value)), 0);
  return Math.exp(logSum / totalWeight);
}

export function scoreDataQuality(input: DataQualityInput): { score: number; blockers: string[] } {
  const blockers: string[] = [];
  const criticalConflicts = Math.max(0, input.unresolvedCriticalConflicts ?? 0);
  if (criticalConflicts > 0) blockers.push(`${criticalConflicts} unresolved critical data conflict(s)`);
  if (clamp01(input.entitlement) < 1) blockers.push("Data entitlement is incomplete or unverified");
  if (clamp01(input.provenance) < 0.5) blockers.push("Source provenance is below the minimum decision threshold");

  const raw = weightedGeometricMean([
    { value: input.completeness, weight: 1.25 },
    { value: input.freshness, weight: 1.0 },
    { value: input.provenance, weight: 1.5 },
    { value: input.providerAgreement, weight: 1.25 },
    { value: input.revisionStability, weight: 0.75 },
    { value: input.entitlement, weight: 1.5 },
    { value: input.outlierIntegrity, weight: 1.0 },
  ]);

  const conflictPenalty = Math.min(0.25, Math.max(0, input.conflictCount ?? 0) * 0.025);
  const score = blockers.some((item) => item.includes("critical data conflict"))
    ? Math.min(raw * (1 - conflictPenalty), 0.49)
    : raw * (1 - conflictPenalty);

  return { score: clamp01(score), blockers };
}

function scoreEvidence(evidence: ValidationEvidence[]): number {
  if (evidence.length === 0) return 0;
  let weightedPass = 0;
  let totalWeight = 0;
  for (const item of evidence) {
    const baseWeight = Math.max(0.05, item.weight ?? EVIDENCE_WEIGHT[item.kind]);
    const independenceMultiplier = item.independent ? 1.15 : 1;
    const weight = baseWeight * independenceMultiplier;
    totalWeight += weight;
    if (item.passed) weightedPass += weight;
  }
  return totalWeight === 0 ? 0 : clamp01(weightedPass / totalWeight);
}

function scoreReproducibility(input: ModelAssuranceInput): number {
  if (input.deterministic) return 1;
  if (input.seed !== null && input.seed !== undefined && Number.isInteger(input.seed)) return 0.9;
  return 0.45;
}

function bandFor(score: number, input: ModelAssuranceInput, blockers: string[]): AssuranceBand {
  if (blockers.length > 0) return "blocked";
  if (input.status === "experimental" || input.validationLevel === "research_only" || input.validationLevel === "not_started") {
    return "research_only";
  }
  if (score >= 0.93 && input.validationLevel === "known_answer" && input.independentChallengerPassed) return "institutional";
  if (score >= 0.84 && ["known_answer", "regression_tested", "implementation_reviewed"].includes(input.validationLevel)) {
    return "decision_grade";
  }
  if (score >= 0.62) return "review_required";
  return "research_only";
}

export function assessModelAssurance(input: ModelAssuranceInput): ModelAssuranceResult {
  const warnings = [...(input.warnings ?? [])];
  const data = scoreDataQuality(input.dataQuality);
  const validation = VALIDATION_BASE[input.validationLevel];
  const evidence = scoreEvidence(input.evidence);
  const reproducibility = scoreReproducibility(input);
  const blockers = [...data.blockers];

  const failedCriticalEvidence = input.evidence.filter(
    (item) => !item.passed && ["known_answer", "cross_engine", "out_of_sample"].includes(item.kind),
  );
  if (failedCriticalEvidence.length > 0) {
    blockers.push(`Critical validation evidence failed: ${failedCriticalEvidence.map((item) => item.kind).join(", ")}`);
  }

  if (input.validationLevel === "known_answer" && !input.evidence.some((item) => item.kind === "known_answer" && item.passed)) {
    blockers.push("Model claims known-answer validation without passing known-answer evidence");
  }

  if (!input.deterministic && input.seed == null) warnings.push("Stochastic calculation has no explicit reproducibility seed");
  if (!input.uncertaintyQuantified) warnings.push("Material model uncertainty is not explicitly quantified");
  if (!input.independentChallengerPassed) warnings.push("No independent challenger-model pass is attached");

  let score = weightedGeometricMean([
    { value: validation, weight: 0.34 },
    { value: data.score, weight: 0.34 },
    { value: evidence, weight: 0.24 },
    { value: reproducibility, weight: 0.08 },
  ]);

  score *= Math.max(0.7, 1 - warnings.length * 0.025);
  if (blockers.length > 0) score = Math.min(score, 0.59);
  score = clamp01(score);

  return {
    modelId: input.modelId,
    score: round(score * 100),
    band: bandFor(score, input, blockers),
    components: {
      validation: round(validation * 100),
      dataQuality: round(data.score * 100),
      evidence: round(evidence * 100),
      reproducibility: round(reproducibility * 100),
    },
    blockers,
    warnings,
  };
}

export interface ToleranceProfile {
  absolute: number;
  relative: number;
}

export interface NumericComparison {
  pass: boolean;
  actual: number;
  expected: number;
  absoluteError: number;
  relativeError: number;
  allowedError: number;
}

export function compareNumeric(actual: number, expected: number, tolerance: ToleranceProfile): NumericComparison {
  const absoluteError = Math.abs(actual - expected);
  const denominator = Math.max(Math.abs(expected), Number.EPSILON);
  const relativeError = absoluteError / denominator;
  const allowedError = Math.max(0, tolerance.absolute) + Math.max(0, tolerance.relative) * Math.abs(expected);
  const pass = Number.isFinite(actual) && Number.isFinite(expected) && absoluteError <= allowedError;
  return { pass, actual, expected, absoluteError, relativeError, allowedError };
}

export interface ProviderObservation {
  provider: string;
  value: number;
  asOf: string;
  confidence?: number;
  unit?: string;
}

export interface ProviderReconciliationResult {
  canonicalValue: number | null;
  agreementScore: number;
  relativeDispersion: number | null;
  outliers: string[];
  usedProviders: string[];
  blockers: string[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function latestPerProvider(observations: ProviderObservation[]): ProviderObservation[] {
  const latest = new Map<string, ProviderObservation>();
  for (const observation of observations) {
    const existing = latest.get(observation.provider);
    if (!existing || Date.parse(observation.asOf) > Date.parse(existing.asOf)) latest.set(observation.provider, observation);
  }
  return [...latest.values()].sort((a, b) => {
    const providerOrder = a.provider.localeCompare(b.provider);
    if (providerOrder !== 0) return providerOrder;
    const timeOrder = Date.parse(a.asOf) - Date.parse(b.asOf);
    if (timeOrder !== 0) return timeOrder;
    return a.value - b.value;
  });
}

export function reconcileProviderValues(
  observations: ProviderObservation[],
  options: { referenceTime?: string; freshnessHalfLifeHours?: number; outlierZ?: number } = {},
): ProviderReconciliationResult {
  const blockers: string[] = [];
  const valid = latestPerProvider(
    observations.filter((item) => Number.isFinite(item.value) && Number.isFinite(Date.parse(item.asOf))),
  );
  if (valid.length === 0) {
    return { canonicalValue: null, agreementScore: 0, relativeDispersion: null, outliers: [], usedProviders: [], blockers: ["No valid provider observations"] };
  }

  const units = new Set(valid.map((item) => item.unit).filter((unit): unit is string => Boolean(unit)));
  if (units.size > 1) blockers.push("Provider observations use inconsistent units");
  if (valid.length < 2) blockers.push("Independent provider cross-check is unavailable");

  const values = valid.map((item) => item.value);
  const center = median(values);
  const absoluteDeviations = values.map((value) => Math.abs(value - center));
  const mad = median(absoluteDeviations);
  const robustSigma = Math.max(1.4826 * mad, Number.EPSILON);
  const outlierZ = options.outlierZ ?? 3.5;
  const outliers = valid
    .filter((item) => Math.abs(item.value - center) / robustSigma > outlierZ)
    .map((item) => item.provider);

  const nonOutliers = valid.filter((item) => !outliers.includes(item.provider));
  const usable = nonOutliers.length >= 2 ? nonOutliers : valid;
  const latestObservationMs = Math.max(...usable.map((item) => Date.parse(item.asOf)));
  const requestedReferenceMs = options.referenceTime ? Date.parse(options.referenceTime) : latestObservationMs;
  const referenceMs = Number.isFinite(requestedReferenceMs) ? requestedReferenceMs : latestObservationMs;
  if (options.referenceTime && !Number.isFinite(requestedReferenceMs)) blockers.push("Provider reconciliation reference time is invalid");
  const halfLifeHours = Math.max(0.25, options.freshnessHalfLifeHours ?? 24);

  let weightedValue = 0;
  let weightTotal = 0;
  for (const item of usable) {
    const ageHours = Math.max(0, (referenceMs - Date.parse(item.asOf)) / 3_600_000);
    const freshnessWeight = 0.5 ** (ageHours / halfLifeHours);
    const confidenceWeight = Math.max(0.05, clamp01(item.confidence ?? 1));
    const weight = freshnessWeight * confidenceWeight;
    weightedValue += item.value * weight;
    weightTotal += weight;
  }

  const canonicalValue = weightTotal > 0 ? weightedValue / weightTotal : median(usable.map((item) => item.value));
  const usableMad = median(usable.map((item) => Math.abs(item.value - canonicalValue)));
  const relativeDispersion = Math.abs(canonicalValue) > Number.EPSILON
    ? (1.4826 * usableMad) / Math.abs(canonicalValue)
    : usableMad;
  const diversityFactor = Math.min(1, usable.length / 3);
  const agreementScore = clamp01(Math.exp(-6 * relativeDispersion) * (0.75 + 0.25 * diversityFactor));

  if (relativeDispersion > 0.05) blockers.push("Provider dispersion exceeds 5% of the reconciled value");

  return {
    canonicalValue: round(canonicalValue, 10),
    agreementScore: round(agreementScore * 100),
    relativeDispersion: round(relativeDispersion, 8),
    outliers,
    usedProviders: usable.map((item) => item.provider),
    blockers,
  };
}

export function auditModelRegistryAssurance(entries: QuantModelRegistryEntry[]): string[] {
  const issues: string[] = [];
  for (const entry of entries) {
    if (entry.status === "validated" && !["known_answer", "regression_tested"].includes(entry.validationLevel)) {
      issues.push(`${entry.id}: validated status requires known-answer or regression-tested evidence`);
    }
    if (entry.status === "validated" && entry.references.length === 0) {
      issues.push(`${entry.id}: validated status requires at least one independent reference`);
    }
    if (entry.validationLevel === "known_answer" && entry.nextValidation.toLowerCase().includes("add golden")) {
      issues.push(`${entry.id}: known-answer model still declares golden cases as future work`);
    }
    if (entry.dataMode === "synthetic_only" && entry.status === "validated") {
      issues.push(`${entry.id}: synthetic-only model cannot be promoted directly to validated`);
    }
  }
  return issues;
}
