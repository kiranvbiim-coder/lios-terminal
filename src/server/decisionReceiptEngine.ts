/**
 * Decision Receipt Engine: Forecast Accountability.
 *
 * Tracks predictions against outcomes and computes error, attribution,
 * and model accountability scores. Pure and deterministic.
 */
// ─── Forecast Accountability ──────────────────────────────────────────────

export interface ForecastRecord {
  id: string;
  metric: string;
  forecastValue: number;
  forecastDate: string;
  targetDate: string;
  actualValue?: number;
  actualDate?: string;
  engineId: string;
  receiptId: string;
  owner: { userId: number; name: string };
}

export interface ForecastError {
  id: string;
  metric: string;
  forecastValue: number;
  actualValue: number;
  absoluteError: number;
  percentageError: number;
  direction: "over" | "under" | "exact";
  daysBetween: number;
}

export interface ForecastAccountabilityResult {
  forecasts: ForecastError[];
  meanAbsoluteError: number;
  meanPercentageError: number;
  overPredictionBias: number;
  totalForecasts: number;
  resolvedForecasts: number;
  accuracyScore: number;         // 0-100
  mostAccurateMetric: string | null;
  leastAccurateMetric: string | null;
}

export function computeForecastAccountability(records: ForecastRecord[]): ForecastAccountabilityResult {
  const resolved = records.filter((r) => r.actualValue != null && r.actualDate != null);

  if (resolved.length === 0) {
    return {
      forecasts: [], meanAbsoluteError: 0, meanPercentageError: 0,
      overPredictionBias: 0, totalForecasts: records.length,
      resolvedForecasts: 0, accuracyScore: 0,
      mostAccurateMetric: null, leastAccurateMetric: null,
    };
  }

  const errors: ForecastError[] = resolved.map((r) => {
    const absoluteError = Math.abs(r.forecastValue - r.actualValue!);
    const percentageError = r.actualValue !== 0 ? absoluteError / Math.abs(r.actualValue!) : (r.forecastValue !== 0 ? 1 : 0);
    const daysBetween = Math.abs(new Date(r.actualDate!).getTime() - new Date(r.forecastDate).getTime()) / 86_400_000;

    return {
      id: r.id,
      metric: r.metric,
      forecastValue: r.forecastValue,
      actualValue: r.actualValue!,
      absoluteError,
      percentageError,
      direction: r.forecastValue > r.actualValue! ? "over" : r.forecastValue < r.actualValue! ? "under" : "exact",
      daysBetween,
    };
  });

  const meanAbsoluteError = errors.reduce((s, e) => s + e.absoluteError, 0) / errors.length;
  const meanPercentageError = errors.reduce((s, e) => s + e.percentageError, 0) / errors.length;
  const overCount = errors.filter((e) => e.direction === "over").length;
  const overPredictionBias = overCount / errors.length;

  // Accuracy score: 100 - mean percentage error × 100 (capped at 0)
  const accuracyScore = Math.max(0, Math.min(100, (1 - meanPercentageError) * 100));

  // Best/worst metric by average percentage error
  const byMetric = new Map<string, number[]>();
  for (const e of errors) {
    const arr = byMetric.get(e.metric) ?? [];
    arr.push(e.percentageError);
    byMetric.set(e.metric, arr);
  }
  const metricAvgs = Array.from(byMetric.entries()).map(([metric, pcts]) => ({
    metric,
    avgPct: pcts.reduce((s, v) => s + v, 0) / pcts.length,
  })).sort((a, b) => a.avgPct - b.avgPct);

  return {
    forecasts: errors,
    meanAbsoluteError,
    meanPercentageError,
    overPredictionBias,
    totalForecasts: records.length,
    resolvedForecasts: resolved.length,
    accuracyScore,
    mostAccurateMetric: metricAvgs[0]?.metric ?? null,
    leastAccurateMetric: metricAvgs.at(-1)?.metric ?? null,
  };
}
