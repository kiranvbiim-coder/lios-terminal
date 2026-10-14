import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { consensusBenchmarks, consensusSnapshots } from "@shared/schema";
import { researchSourceMetadataSchema } from "@shared/researchSourceComposition";
import type { ConsensusMetric } from "./consensusService";
import {
  buildEstimateVintageLedger,
  normalizeEstimateVintageRow,
  type EstimateInternalInput,
  type EstimateVintageObservation,
  type ProviderEstimateActual,
  type ProviderEstimateRow,
} from "./estimateVintageLedger";
import { getDb } from "./db";

type ConsensusSnapshotRow = typeof consensusSnapshots.$inferSelect;
type ConsensusBenchmarkRow = typeof consensusBenchmarks.$inferSelect;

export type EstimateEvidenceUse = "human_internal" | "ai_assistance";
export type EstimateEvidenceBlockReason =
  | "source_rights_unknown"
  | "entitlement_denied"
  | "entitlement_unknown"
  | "internal_use_restricted"
  | "internal_use_unknown"
  | "ai_transmission_restricted"
  | "ai_transmission_unknown";

function sourceRightsBlockReason(metadata: Record<string, unknown>, targetUse: EstimateEvidenceUse): EstimateEvidenceBlockReason | null {
  if (targetUse === "human_internal") return null;
  const parsed = researchSourceMetadataSchema.safeParse(metadata.researchSource);
  if (!parsed.success) return "source_rights_unknown";
  const rights = parsed.data.rights;
  if (rights.entitlement.decision === "denied") return "entitlement_denied";
  if (rights.entitlement.decision === "unknown") return "entitlement_unknown";
  if (rights.internalUse === "restricted") return "internal_use_restricted";
  if (rights.internalUse === "unknown") return "internal_use_unknown";
  if (rights.aiTransmission === "restricted") return "ai_transmission_restricted";
  if (rights.aiTransmission === "unknown") return "ai_transmission_unknown";
  return null;
}

export interface ExplicitEstimateIdentity {
  analystId: string | null;
  recommendationLabel: string | null;
  recommendationAction: string | null;
}

export interface EstimateRecommendationEvidenceObservation extends EstimateVintageObservation, ExplicitEstimateIdentity {}

type ExplicitProviderEstimateRow = ProviderEstimateRow & {
  provider: string;
  sourceReference: string;
  retrievedAt: string;
  vintageAt: string;
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function finiteRecordValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringRecordValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function contributorCandidates(snapshot: ConsensusSnapshotRow): Array<Record<string, unknown>> {
  const metadata = recordValue(snapshot.metadata);
  if (!metadata) return [];
  return ["vintageObservations", "estimateVintages", "contributorObservations", "contributors"]
    .flatMap((key) => Array.isArray(metadata[key]) ? metadata[key] : [])
    .flatMap((candidate) => {
      const item = recordValue(candidate);
      return item ? [item] : [];
    });
}

function providerRow(snapshot: ConsensusSnapshotRow, item: Record<string, unknown>): ExplicitProviderEstimateRow | null {
  const contributor = stringRecordValue(item.contributor);
  const value = finiteRecordValue(item.value ?? item.estimateValue);
  const provider = stringRecordValue(item.provider) ?? stringRecordValue(snapshot.provider);
  const sourceReference = stringRecordValue(item.sourceReference)
    ?? stringRecordValue(item.sourceUrl)
    ?? stringRecordValue(snapshot.sourceUrl)
    ?? stringRecordValue(snapshot.sourceName);
  const publishedAt = stringRecordValue(item.publishedAt) ?? snapshot.publishedAt?.toISOString();
  const retrievedAt = stringRecordValue(item.retrievedAt) ?? snapshot.retrievedAt?.toISOString();
  const vintageAt = stringRecordValue(item.vintageAt) ?? stringRecordValue(item.availableAt) ?? snapshot.availableAt?.toISOString();
  const rowStatus = stringRecordValue(item.status) ?? "estimate";
  if (!contributor || value === null || !provider || !sourceReference || !publishedAt || !retrievedAt || !vintageAt) return null;
  if (publishedAt > retrievedAt || vintageAt < publishedAt) return null;
  if (!["live", "filed", "estimate", "derived", "manual", "imported", "stale", "cached", "synthetic"].includes(rowStatus)) return null;
  return {
    symbol: snapshot.symbol,
    metric: snapshot.metric,
    fiscalPeriod: snapshot.fiscalPeriod,
    unit: snapshot.unit,
    currency: snapshot.currency,
    contributor,
    value,
    low: finiteRecordValue(item.low) ?? snapshot.low,
    high: finiteRecordValue(item.high) ?? snapshot.high,
    publishedAt,
    retrievedAt,
    vintageAt,
    availableAt: vintageAt,
    sourceUrl: sourceReference,
    provider,
    sourceReference,
    status: rowStatus as ProviderEstimateRow["status"],
  } as ExplicitProviderEstimateRow;
}

function explicitIdentity(item: Record<string, unknown>): ExplicitEstimateIdentity {
  return {
    analystId: stringRecordValue(item.analystId) ?? stringRecordValue(item.contributorId),
    recommendationLabel: stringRecordValue(item.recommendationLabel) ?? stringRecordValue(item.ratingLabel),
    recommendationAction: stringRecordValue(item.recommendationAction) ?? stringRecordValue(item.ratingAction),
  };
}

/**
 * Only explicit contributor/vintage arrays are adapted. A provider aggregate is
 * never treated as an analyst/contributor because that would fabricate identity.
 */
export function snapshotVintageRows(snapshot: ConsensusSnapshotRow): ExplicitProviderEstimateRow[] {
  return contributorCandidates(snapshot).flatMap((item) => {
    const row = providerRow(snapshot, item);
    return row ? [row] : [];
  });
}

function normalizedObservationKey(row: EstimateVintageObservation): string {
  return [
    row.contributor,
    row.provider,
    row.symbol,
    row.metric,
    row.fiscalPeriod,
    row.unit,
    row.currency ?? "",
    String(row.estimateValue),
    row.publishedAt,
    row.vintageAt,
    row.sourceReference,
  ].join("\u001f");
}

function explicitIdentityMap(snapshots: ConsensusSnapshotRow[]): Map<string, ExplicitEstimateIdentity> {
  const map = new Map<string, ExplicitEstimateIdentity>();
  for (const snapshot of snapshots) {
    for (const item of contributorCandidates(snapshot)) {
      const row = providerRow(snapshot, item);
      if (!row) continue;
      try {
        const normalized = normalizeEstimateVintageRow(row);
        map.set(normalizedObservationKey(normalized), explicitIdentity(item));
      } catch {
        // Canonical vintage ledger owns rejection semantics. Invalid rows are
        // not promoted into analyst identity metadata.
      }
    }
  }
  return map;
}

export function aggregateSnapshotView(snapshot: ConsensusSnapshotRow) {
  return {
    id: snapshot.id,
    symbol: snapshot.symbol,
    metric: snapshot.metric,
    fiscalPeriod: snapshot.fiscalPeriod,
    unit: snapshot.unit,
    currency: snapshot.currency,
    mean: snapshot.mean,
    median: snapshot.median,
    high: snapshot.high,
    low: snapshot.low,
    contributorCount: snapshot.contributorCount,
    standardDeviation: snapshot.standardDeviation,
    estimateAsOf: snapshot.estimateAsOf,
    publishedAt: snapshot.publishedAt,
    retrievedAt: snapshot.retrievedAt,
    availableAt: snapshot.availableAt,
    sourceType: snapshot.sourceType,
    provider: snapshot.provider,
    sourceName: snapshot.sourceName,
    sourceUrl: snapshot.sourceUrl,
    methodology: snapshot.methodology,
    snapshotHash: snapshot.snapshotHash,
    organizationId: snapshot.organizationId,
    aggregateOnly: true as const,
    analystIdentityAvailable: false as const,
  };
}

function benchmarkActual(benchmark: ConsensusBenchmarkRow): ProviderEstimateActual | null {
  if (benchmark.benchmarkKind !== "reported_actual" || benchmark.value === null || !Number.isFinite(benchmark.value)) return null;
  return {
    metric: benchmark.metric,
    fiscalPeriod: benchmark.fiscalPeriod,
    periodEnd: benchmark.periodEnd ? benchmark.periodEnd.toISOString().slice(0, 10) : null,
    value: benchmark.value,
    unit: benchmark.unit,
    currency: benchmark.currency,
    reportedAt: benchmark.effectiveAt.toISOString(),
    availableAt: benchmark.createdAt.toISOString(),
    sourceReference: benchmark.sourceUrl ?? benchmark.sourceName,
    status: "filed",
  } as ProviderEstimateActual;
}

function benchmarkInternalEstimate(benchmark: ConsensusBenchmarkRow): EstimateInternalInput | null {
  if (benchmark.benchmarkKind !== "limuria_model" || benchmark.value === null || !Number.isFinite(benchmark.value)) return null;
  return {
    symbol: benchmark.symbol,
    metric: benchmark.metric,
    fiscalPeriod: benchmark.fiscalPeriod,
    value: benchmark.value,
    unit: benchmark.unit,
    currency: benchmark.currency,
    asOf: benchmark.effectiveAt.toISOString(),
    sourceReference: benchmark.sourceUrl ?? benchmark.sourceName,
    status: "derived",
  };
}

function scopeCondition(
  column: typeof consensusSnapshots.organizationId | typeof consensusBenchmarks.organizationId,
  organizationId: number | null,
) {
  return organizationId === null ? isNull(column) : or(isNull(column), eq(column, organizationId));
}

export interface EstimateRecommendationEvidenceInput {
  organizationId: number | null;
  symbol: string;
  metric: ConsensusMetric;
  fiscalPeriod: string;
  asOf?: Date;
  page?: number;
  limit?: number;
  targetUse?: EstimateEvidenceUse;
}

export async function getEstimateRecommendationEvidence(input: EstimateRecommendationEvidenceInput) {
  const page = Math.min(Math.max(Math.trunc(input.page ?? 1), 1), 10_000);
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 25), 1), 100);
  const symbol = input.symbol.trim().toUpperCase();
  const fiscalPeriod = input.fiscalPeriod.trim().toUpperCase();

  const snapshotFilters = [
    eq(consensusSnapshots.symbol, symbol),
    eq(consensusSnapshots.metric, input.metric),
    eq(consensusSnapshots.fiscalPeriod, fiscalPeriod),
    scopeCondition(consensusSnapshots.organizationId, input.organizationId),
  ];
  const benchmarkFilters = [
    eq(consensusBenchmarks.symbol, symbol),
    eq(consensusBenchmarks.metric, input.metric),
    eq(consensusBenchmarks.fiscalPeriod, fiscalPeriod),
    scopeCondition(consensusBenchmarks.organizationId, input.organizationId),
  ];
  if (input.asOf) {
    snapshotFilters.push(lte(consensusSnapshots.availableAt, input.asOf));
    benchmarkFilters.push(lte(consensusBenchmarks.effectiveAt, input.asOf));
  }

  const [queriedSnapshots, queriedBenchmarks] = await Promise.all([
    getDb().select().from(consensusSnapshots).where(and(...snapshotFilters)).orderBy(asc(consensusSnapshots.estimateAsOf), asc(consensusSnapshots.id)),
    getDb().select().from(consensusBenchmarks).where(and(...benchmarkFilters)).orderBy(asc(consensusBenchmarks.effectiveAt), asc(consensusBenchmarks.id)),
  ]);

  const targetUse = input.targetUse ?? "human_internal";
  const blockedByReason: Record<string, number> = {};
  const snapshots = queriedSnapshots.filter((snapshot) => {
    const reason = sourceRightsBlockReason(snapshot.metadata, targetUse);
    if (!reason) return true;
    blockedByReason[reason] = (blockedByReason[reason] ?? 0) + 1;
    return false;
  });
  const benchmarks = queriedBenchmarks.filter((benchmark) => {
    const reason = sourceRightsBlockReason(benchmark.metadata, targetUse);
    if (!reason) return true;
    blockedByReason[reason] = (blockedByReason[reason] ?? 0) + 1;
    return false;
  });

  const asOfIso = input.asOf?.toISOString() ?? null;
  const adaptedSnapshots = snapshots.map((snapshot) => ({
    snapshot,
    rows: snapshotVintageRows(snapshot).filter((row) => !asOfIso || row.vintageAt <= asOfIso),
  }));
  const contributorRows = adaptedSnapshots.flatMap((item) => item.rows);
  const actuals = benchmarks.flatMap((benchmark) => {
    const actual = benchmarkActual(benchmark);
    return actual ? [actual] : [];
  });
  const internalEstimates = benchmarks.flatMap((benchmark) => {
    const internal = benchmarkInternalEstimate(benchmark);
    return internal ? [internal] : [];
  });
  const ledger = buildEstimateVintageLedger(contributorRows, { actuals, internalEstimates });
  const aggregateSnapshots = adaptedSnapshots.filter((item) => !item.rows.length).map((item) => aggregateSnapshotView(item.snapshot));
  const identities = explicitIdentityMap(snapshots);
  const contributorVintages: EstimateRecommendationEvidenceObservation[] = ledger.groups.flatMap((group) =>
    group.observations.map((observation) => ({
      ...observation,
      ...(identities.get(normalizedObservationKey(observation)) ?? {
        analystId: null,
        recommendationLabel: null,
        recommendationAction: null,
      }),
    }))
  );

  const records = [
    ...ledger.groups.map((group) => ({ kind: "contributor-vintage" as const, sortAt: group.observations.at(-1)?.vintageAt ?? "", group })),
    ...aggregateSnapshots.map((aggregate) => ({ kind: "aggregate-only" as const, sortAt: aggregate.availableAt.toISOString(), aggregate })),
  ].sort((left, right) => right.sortAt.localeCompare(left.sortAt));
  const start = (page - 1) * limit;
  const pageRecords = records.slice(start, start + limit);
  const groups = pageRecords.flatMap((record) => record.kind === "contributor-vintage" ? [record.group] : []);
  const aggregates = pageRecords.flatMap((record) => record.kind === "aggregate-only" ? [record.aggregate] : []);

  const sourceModes = new Map<string, { provider: string; sourceName: string; aggregateOnly: number; contributorVintage: number }>();
  for (const { snapshot, rows } of adaptedSnapshots) {
    const key = `${snapshot.provider}\u001f${snapshot.sourceName}`;
    const current = sourceModes.get(key) ?? { provider: snapshot.provider, sourceName: snapshot.sourceName, aggregateOnly: 0, contributorVintage: 0 };
    if (rows.length) current.contributorVintage += 1;
    else current.aggregateOnly += 1;
    sourceModes.set(key, current);
  }

  const hasMore = start + pageRecords.length < records.length;
  return {
    symbol,
    metric: input.metric,
    fiscalPeriod,
    organizationId: input.organizationId,
    asOf: input.asOf?.toISOString() ?? null,
    targetUse,
    groups,
    aggregates,
    rejected: ledger.rejected,
    evidence: {
      contributorVintages,
      aggregateSnapshots,
      ratingLabelPolicy: "explicit_only" as const,
      aggregateIdentityPolicy: "aggregate_is_not_analyst_identity" as const,
      blockedByRights: {
        count: queriedSnapshots.length + queriedBenchmarks.length - snapshots.length - benchmarks.length,
        byReason: blockedByReason,
      },
    },
    paging: {
      page,
      limit,
      total: records.length,
      returned: pageRecords.length,
      hasMore,
      nextPage: hasMore ? page + 1 : null,
    },
    count: {
      snapshots: snapshots.length,
      benchmarks: benchmarks.length,
      contributorObservations: contributorRows.length,
      groups: ledger.groups.length,
      aggregateOnly: aggregateSnapshots.length,
    },
    provenance: {
      snapshots: adaptedSnapshots.map(({ snapshot, rows }) => ({
        id: snapshot.id,
        organizationId: snapshot.organizationId,
        provider: snapshot.provider,
        sourceType: snapshot.sourceType,
        sourceName: snapshot.sourceName,
        sourceUrl: snapshot.sourceUrl,
        estimateAsOf: snapshot.estimateAsOf,
        publishedAt: snapshot.publishedAt,
        retrievedAt: snapshot.retrievedAt,
        availableAt: snapshot.availableAt,
        snapshotHash: snapshot.snapshotHash,
        mode: rows.length ? "contributor-vintage" as const : "aggregate-only" as const,
      })),
      benchmarks: benchmarks.map((benchmark) => ({
        id: benchmark.id,
        organizationId: benchmark.organizationId,
        benchmarkKind: benchmark.benchmarkKind,
        provider: benchmark.provider,
        sourceName: benchmark.sourceName,
        sourceUrl: benchmark.sourceUrl,
        effectiveAt: benchmark.effectiveAt,
      })),
    },
    coverage: {
      state: snapshots.length ? "available" as const : "unavailable" as const,
      snapshotCount: snapshots.length,
      benchmarkCount: benchmarks.length,
      groupCount: ledger.groups.length,
      aggregateOnlyCount: aggregateSnapshots.length,
      contributorObservationCount: contributorRows.length,
      sources: [...sourceModes.values()].map((source) => ({
        provider: source.provider,
        sourceName: source.sourceName,
        mode: source.contributorVintage ? source.aggregateOnly ? "mixed" as const : "contributor-vintage" as const : "aggregate-only" as const,
        aggregateSnapshotCount: source.aggregateOnly,
        contributorVintageSnapshotCount: source.contributorVintage,
      })),
      reason: snapshots.length
        ? undefined
        : targetUse === "ai_assistance" && queriedSnapshots.length
          ? "Consensus evidence exists, but no snapshot has explicit entitlement, internal-use and AI-transmission permission for model assistance."
          : "No permitted consensus snapshots were recorded for this organization and point-in-time scope.",
    },
  };
}
