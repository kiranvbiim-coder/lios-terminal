import { primaryNumericOutput, type AnalyticalModelRun } from "./analyticalCore";

export interface AnalyticalEnsembleRow {
  runId: string;
  modelId: string;
  modelLabel: string;
  value: number;
  unit?: string;
  qualityScore: number;
  deltaVsConsensusPct: number | null;
  outlier: boolean;
  status: AnalyticalModelRun["status"];
}

export interface AnalyticalEnsembleResult {
  objectId?: string;
  outputId?: string;
  unit?: string;
  consensusValue: number | null;
  medianValue: number | null;
  minValue: number | null;
  maxValue: number | null;
  dispersionPct: number | null;
  confidenceScore: number;
  rows: AnalyticalEnsembleRow[];
  outlierModelIds: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function analyticalRunQualityScore(run: AnalyticalModelRun): number {
  if (run.status === "blocked" || run.status === "error") return 0;
  let score = run.status === "partial" ? 0.82 : 1;
  for (const diagnostic of run.diagnostics) {
    if (diagnostic.severity === "critical") score -= diagnostic.blocking ? 0.45 : 0.25;
    else if (diagnostic.severity === "watch") score -= 0.08;
    else if (diagnostic.severity === "info") score -= 0.01;
  }
  const outputConfidence = run.outputs
    .map((output) => output.confidence)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (outputConfidence.length) {
    const average = outputConfidence.reduce((sum, value) => sum + value, 0) / outputConfidence.length;
    score *= clamp(average, 0, 1);
  }
  return clamp(score, 0, 1);
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mad(values: readonly number[], med: number): number {
  return median(values.map((value) => Math.abs(value - med))) ?? 0;
}

export function buildAnalyticalEnsemble(
  runs: readonly AnalyticalModelRun[],
  options: { outputId?: string; unit?: string } = {},
): AnalyticalEnsembleResult {
  const candidates = runs.flatMap((run) => {
    if (run.status === "blocked" || run.status === "error") return [];
    const output = options.outputId
      ? run.outputs.find((candidate) => candidate.id === options.outputId && typeof candidate.value === "number" && Number.isFinite(candidate.value)) ?? null
      : primaryNumericOutput(run);
    if (!output || typeof output.value !== "number") return [];
    if (options.unit && output.unit !== options.unit) return [];
    return [{ run, output }];
  });

  const unit = options.unit ?? candidates[0]?.output.unit;
  const compatible = candidates.filter(({ output }) => !unit || !output.unit || output.unit === unit);
  const values = compatible.map(({ output }) => output.value as number);
  const qualities = compatible.map(({ run }) => analyticalRunQualityScore(run));
  const weightTotal = qualities.reduce((sum, value) => sum + value, 0);
  const consensusValue = values.length
    ? (weightTotal > 0
        ? values.reduce((sum, value, index) => sum + value * qualities[index], 0) / weightTotal
        : values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
  const medianValue = median(values);
  const minValue = values.length ? Math.min(...values) : null;
  const maxValue = values.length ? Math.max(...values) : null;
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const variance = values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length : 0;
  const dispersionPct = values.length > 1 && Math.abs(mean) > 1e-12 ? (Math.sqrt(variance) / Math.abs(mean)) * 100 : values.length ? 0 : null;
  const medianAbsoluteDeviation = medianValue === null ? 0 : mad(values, medianValue);

  const rows = compatible.map(({ run, output }, index): AnalyticalEnsembleRow => {
    const value = output.value as number;
    const modifiedZ = medianValue === null || medianAbsoluteDeviation <= 1e-12 ? 0 : 0.6745 * (value - medianValue) / medianAbsoluteDeviation;
    return {
      runId: run.id,
      modelId: run.modelId,
      modelLabel: run.modelLabel,
      value,
      unit: output.unit,
      qualityScore: qualities[index],
      deltaVsConsensusPct: consensusValue !== null && Math.abs(consensusValue) > 1e-12 ? ((value / consensusValue) - 1) * 100 : null,
      outlier: Math.abs(modifiedZ) > 3.5,
      status: run.status,
    };
  });

  const averageQuality = qualities.length ? qualities.reduce((sum, value) => sum + value, 0) / qualities.length : 0;
  const dispersionPenalty = dispersionPct === null ? 1 : 1 - Math.min(dispersionPct / 100, 0.65);
  const confidenceScore = clamp(averageQuality * dispersionPenalty, 0, 1);

  return {
    objectId: runs.find((run) => run.objectId)?.objectId,
    outputId: options.outputId,
    unit,
    consensusValue,
    medianValue,
    minValue,
    maxValue,
    dispersionPct,
    confidenceScore,
    rows,
    outlierModelIds: rows.filter((row) => row.outlier).map((row) => row.modelId),
  };
}
