import crypto from "crypto";

export const CONSENSUS_METRICS = [
  "revenue", "ebitda", "ebit", "eps", "free_cash_flow", "gross_margin",
  "operating_margin", "net_margin", "capex", "price_target", "recommendation_score",
] as const;

export type ConsensusMetric = typeof CONSENSUS_METRICS[number];
export type ConsensusSourceType = "licensed_provider" | "user_supplied" | "manual";
export type ConsensusBenchmarkKind = "company_guidance" | "reported_actual" | "limuria_model";

export interface ConsensusStatistics {
  mean: number;
  median: number;
  high: number;
  low: number;
  contributorCount: number;
  standardDeviation: number;
  dispersionPct: number | null;
}

export interface ConsensusSnapshotLike {
  id: number;
  symbol: string;
  metric: ConsensusMetric;
  fiscalPeriod: string;
  estimateAsOf: Date;
  mean: number | null;
  median: number | null;
  high: number | null;
  low: number | null;
  contributorCount: number | null;
  upwardRevisionCount: number | null;
  downwardRevisionCount: number | null;
  unchangedRevisionCount: number | null;
}

export interface ConsensusBenchmarkLike {
  id: number;
  symbol: string;
  metric: ConsensusMetric;
  fiscalPeriod: string;
  benchmarkKind: ConsensusBenchmarkKind;
  value: number | null;
  low: number | null;
  high: number | null;
  effectiveAt: Date;
  evidenceIds?: number[];
  assumptionRefs?: Array<{ label: string; value?: number | string | null; evidenceId?: number }>;
}

export interface ConsensusRevisionPoint {
  snapshotId: number;
  estimateAsOf: string;
  median: number | null;
  mean: number | null;
  medianChange: number | null;
  medianChangePct: number | null;
  dispersionPct: number | null;
  breadth: number | null;
}

export interface ConsensusComparison {
  benchmarkId: number;
  benchmarkKind: ConsensusBenchmarkKind;
  benchmarkValue: number;
  consensusSnapshotId: number;
  consensusMedian: number;
  difference: number;
  differencePct: number | null;
  evidenceIds: number[];
  assumptionRefs: Array<{ label: string; value?: number | string | null; evidenceId?: number }>;
}

export interface ConsensusSignal {
  signalType: "material_revision" | "widening_dispersion" | "guidance_gap" | "model_divergence";
  severity: "watch" | "material";
  valuePct: number;
  thresholdPct: number;
  message: string;
  snapshotId: number;
  benchmarkId?: number;
}

function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function percentDifference(value: number, base: number): number | null {
  if (base === 0) return null;
  return round(((value - base) / Math.abs(base)) * 100);
}

function midpoint(item: Pick<ConsensusBenchmarkLike, "value" | "low" | "high">): number | null {
  if (item.value != null) return item.value;
  if (item.low != null && item.high != null) return round((item.low + item.high) / 2);
  return item.low ?? item.high ?? null;
}

export function calculateConsensusStatistics(observations: number[]): ConsensusStatistics {
  if (!observations.length) throw new Error("At least one observation is required.");
  if (observations.some((value) => !Number.isFinite(value))) throw new Error("Consensus observations must be finite numbers.");
  const sorted = [...observations].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;
  return {
    mean: round(mean),
    median: round(median),
    high: sorted[sorted.length - 1],
    low: sorted[0],
    contributorCount: sorted.length,
    standardDeviation: round(Math.sqrt(variance)),
    dispersionPct: median === 0 ? null : round(((sorted[sorted.length - 1] - sorted[0]) / Math.abs(median)) * 100),
  };
}

export function consensusSnapshotHash(payload: Record<string, unknown>): string {
  const stable = (value: unknown): string => {
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
    }
    return JSON.stringify(value);
  };
  return crypto.createHash("sha256").update(stable(payload)).digest("hex");
}

export function buildRevisionSeries(snapshots: ConsensusSnapshotLike[]): ConsensusRevisionPoint[] {
  const ordered = [...snapshots].sort((a, b) => a.estimateAsOf.getTime() - b.estimateAsOf.getTime() || a.id - b.id);
  return ordered.map((item, index) => {
    const previous = ordered[index - 1];
    const medianChange = item.median != null && previous?.median != null ? round(item.median - previous.median) : null;
    const medianChangePct = item.median != null && previous?.median != null ? percentDifference(item.median, previous.median) : null;
    const revisions = (item.upwardRevisionCount ?? 0) + (item.downwardRevisionCount ?? 0);
    const breadth = revisions > 0
      ? round(((item.upwardRevisionCount ?? 0) - (item.downwardRevisionCount ?? 0)) / revisions)
      : null;
    const dispersionPct = item.median != null && item.median !== 0 && item.high != null && item.low != null
      ? round(((item.high - item.low) / Math.abs(item.median)) * 100)
      : null;
    return {
      snapshotId: item.id,
      estimateAsOf: item.estimateAsOf.toISOString(),
      median: item.median,
      mean: item.mean,
      medianChange,
      medianChangePct,
      dispersionPct,
      breadth,
    };
  });
}

export function compareConsensusBenchmarks(
  snapshots: ConsensusSnapshotLike[],
  benchmarks: ConsensusBenchmarkLike[],
): ConsensusComparison[] {
  const orderedSnapshots = [...snapshots].sort((a, b) => a.estimateAsOf.getTime() - b.estimateAsOf.getTime() || a.id - b.id);
  return benchmarks.flatMap((benchmark) => {
    const benchmarkValue = midpoint(benchmark);
    if (benchmarkValue == null) return [];
    const eligible = orderedSnapshots.filter((snapshot) =>
      snapshot.symbol === benchmark.symbol && snapshot.metric === benchmark.metric &&
      snapshot.fiscalPeriod === benchmark.fiscalPeriod && snapshot.median != null &&
      (benchmark.benchmarkKind === "reported_actual" ? snapshot.estimateAsOf <= benchmark.effectiveAt : true));
    const consensus = eligible.at(-1);
    if (!consensus || consensus.median == null) return [];
    return [{
      benchmarkId: benchmark.id,
      benchmarkKind: benchmark.benchmarkKind,
      benchmarkValue,
      consensusSnapshotId: consensus.id,
      consensusMedian: consensus.median,
      difference: round(benchmarkValue - consensus.median),
      differencePct: percentDifference(benchmarkValue, consensus.median),
      evidenceIds: benchmark.evidenceIds ?? [],
      assumptionRefs: benchmark.assumptionRefs ?? [],
    }];
  });
}

export function buildConsensusSignals(
  snapshots: ConsensusSnapshotLike[],
  benchmarks: ConsensusBenchmarkLike[],
  thresholds = { revisionPct: 5, dispersionPct: 20, divergencePct: 10 },
): ConsensusSignal[] {
  if (!snapshots.length) return [];
  const revisions = buildRevisionSeries(snapshots);
  const latest = revisions.at(-1)!;
  const previous = revisions.at(-2);
  const signals: ConsensusSignal[] = [];
  if (latest.medianChangePct != null && Math.abs(latest.medianChangePct) >= thresholds.revisionPct) {
    signals.push({ signalType: "material_revision", severity: Math.abs(latest.medianChangePct) >= thresholds.revisionPct * 2 ? "material" : "watch", valuePct: latest.medianChangePct, thresholdPct: thresholds.revisionPct, message: `Consensus median revised ${latest.medianChangePct > 0 ? "up" : "down"} ${Math.abs(latest.medianChangePct).toFixed(1)}%.`, snapshotId: latest.snapshotId });
  }
  if (latest.dispersionPct != null && latest.dispersionPct >= thresholds.dispersionPct && (previous?.dispersionPct == null || latest.dispersionPct > previous.dispersionPct)) {
    signals.push({ signalType: "widening_dispersion", severity: latest.dispersionPct >= thresholds.dispersionPct * 1.5 ? "material" : "watch", valuePct: latest.dispersionPct, thresholdPct: thresholds.dispersionPct, message: `Estimate range is ${latest.dispersionPct.toFixed(1)}% of the median and widening.`, snapshotId: latest.snapshotId });
  }
  for (const comparison of compareConsensusBenchmarks(snapshots, benchmarks)) {
    if (comparison.differencePct == null || Math.abs(comparison.differencePct) < thresholds.divergencePct) continue;
    const signalType = comparison.benchmarkKind === "company_guidance" ? "guidance_gap" : comparison.benchmarkKind === "limuria_model" ? "model_divergence" : null;
    if (!signalType) continue;
    signals.push({ signalType, severity: Math.abs(comparison.differencePct) >= thresholds.divergencePct * 2 ? "material" : "watch", valuePct: comparison.differencePct, thresholdPct: thresholds.divergencePct, message: `${comparison.benchmarkKind === "company_guidance" ? "Guidance midpoint" : "Limuria model"} differs from consensus by ${comparison.differencePct.toFixed(1)}%.`, snapshotId: comparison.consensusSnapshotId, benchmarkId: comparison.benchmarkId });
  }
  return signals;
}

export function revisionAcceleration(series: ConsensusRevisionPoint[]): number | null {
  const changes = series.map((point) => point.medianChangePct).filter((value): value is number => value != null);
  return changes.length >= 2 ? round(changes.at(-1)! - changes.at(-2)!) : null;
}
