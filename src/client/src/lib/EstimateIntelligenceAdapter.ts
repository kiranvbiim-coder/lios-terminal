import {
  buildEstimateVintageLedger,
  type EstimateInternalInput,
  type EstimateStatus,
  type EstimateVintageGroup,
  type EstimateVintageLedger,
  type ProviderEstimateActual,
  type ProviderEstimateRow,
} from "../../../server/estimateVintageLedger";

/** The server snapshot shape as returned by the point-in-time data fabric. */
export interface EstimateIntelligenceSnapshot {
  provider?: string | null;
  publishedAt?: string | null;
  retrievedAt?: string | null;
  availableAt?: string | null;
  lineage?: Record<string, unknown> | null;
  payload?: {
    observations?: readonly unknown[];
    actuals?: readonly unknown[];
  } | null;
}

export interface EstimateIntelligenceConsensus {
  target_high?: number | null;
  target_low?: number | null;
  target_consensus?: number | null;
  target_median?: number | null;
  recommendation?: string | null;
  recommendation_mean?: number | null;
  number_of_analysts?: number | null;
  current_price?: number | null;
  currency?: string | null;
}

/** A model-derived valuation output that may be linked only on exact definition. */
export interface EstimateIntelligenceScenarioInput {
  metric: string;
  fiscalPeriod: string;
  value: number;
  unit: string;
  currency: string | null;
  sourceReference?: string | null;
  status?: EstimateStatus;
  asOf?: string;
}

export interface EstimateIntelligenceLink {
  group: EstimateVintageGroup;
  linked: boolean;
  reason: string;
}

export interface EstimateIntelligenceResult {
  ledger: EstimateVintageLedger;
  links: EstimateIntelligenceLink[];
  aggregateOnly: boolean;
  aggregateMessage: string | null;
  sourceProvider: string | null;
  retrievedAt: string | null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasAggregateConsensus(consensus: EstimateIntelligenceConsensus | null | undefined): boolean {
  if (!consensus) return false;
  return [consensus.target_high, consensus.target_low, consensus.target_consensus, consensus.target_median,
    consensus.recommendation, consensus.recommendation_mean, consensus.number_of_analysts]
    .some((value) => typeof value === "number" ? Number.isFinite(value) : typeof value === "string" && value.trim().length > 0);
}

/**
 * Adapt data already fetched by valuation surfaces into the point-in-time
 * estimate ledger. The adapter adds only snapshot provenance that belongs to
 * the row; it never turns an aggregate target/recommendation into contributor
 * observations.
 */
export function buildEstimateIntelligence(input: {
  symbol: string;
  snapshot?: EstimateIntelligenceSnapshot | null;
  consensus?: EstimateIntelligenceConsensus | null;
  scenarioInputs?: readonly EstimateIntelligenceScenarioInput[];
}): EstimateIntelligenceResult {
  const snapshot = input.snapshot ?? null;
  const sourceProvider = typeof snapshot?.provider === "string" && snapshot.provider.trim() ? snapshot.provider.trim() : null;
  const retrievedAt = typeof snapshot?.retrievedAt === "string" && snapshot.retrievedAt.trim() ? snapshot.retrievedAt : null;
  const observations: ProviderEstimateRow[] = (snapshot?.payload?.observations ?? []).flatMap((raw): ProviderEstimateRow[] => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
    if (!row) return [];
    // Preserve all provider fields. These defaults are source metadata from
    // the enclosing snapshot, not generated estimate values.
    return [{
      ...row,
      provider: typeof row.provider === "string" ? row.provider : sourceProvider ?? undefined,
      retrievedAt: typeof row.retrievedAt === "string" ? row.retrievedAt : retrievedAt ?? undefined,
      vintageAt: typeof row.vintageAt === "string" ? row.vintageAt : typeof row.availableAt === "string" ? row.availableAt : snapshot?.availableAt ?? retrievedAt ?? undefined,
      status: typeof row.status === "string" ? row.status as EstimateStatus : "estimate",
    } as ProviderEstimateRow];
  });
  const actuals: ProviderEstimateActual[] = (snapshot?.payload?.actuals ?? []).flatMap((raw): ProviderEstimateActual[] => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
    return row ? [row as ProviderEstimateActual] : [];
  });
  const scenarioInputs = (input.scenarioInputs ?? []).filter((row) => finite(row.value));
  const ledger = buildEstimateVintageLedger(observations, { actuals, internalEstimates: scenarioInputs as EstimateInternalInput[] });
  const hasConstituent = ledger.groups.some((group) => group.latest.some((row) => !/\baggregate\b|\bconsensus\b/i.test(row.contributor)));
  const snapshotMarkedAggregate = snapshot?.lineage?.aggregateOnly === true;
  const hasSnapshotAggregate = snapshotMarkedAggregate || (ledger.groups.length > 0 && !hasConstituent);
  const aggregateOnly = hasSnapshotAggregate || (!hasConstituent && hasAggregateConsensus(input.consensus));
  const aggregateMessage = aggregateOnly
    ? hasSnapshotAggregate
      ? "Provider aggregate estimate rows are available; constituent analyst vintages are not available."
      : "Only aggregate target/recommendation data is available; no contributor estimate rows were constructed."
    : null;
  const links = ledger.groups.map((group) => ({
    group,
    linked: group.internalDivergence !== null,
    reason: group.internalDivergence !== null
      ? "linked — exact fiscal period, unit and currency match"
      : "not linked — no valuation scenario input matches this fiscal period, unit and currency",
  }));
  return { ledger, links, aggregateOnly, aggregateMessage, sourceProvider, retrievedAt };
}

export function estimateIntelligenceDisplayValue(value: number | null, unit: string, currencySymbol: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (unit === "per_share") return `${currencySymbol}${value.toFixed(2)}`;
  if (unit === "percent") return `${value.toFixed(2)}%`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
