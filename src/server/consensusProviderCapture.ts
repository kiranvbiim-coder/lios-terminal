import { eq } from "drizzle-orm";
import { consensusSnapshots } from "@shared/schema";
import { consensusSnapshotHash, type ConsensusMetric } from "./consensusService";
import { getDb } from "./db";

export type ProviderConsensusObservation = {
  metric: ConsensusMetric;
  fiscalPeriod: string;
  unit: string;
  currency: string | null;
  mean: number | null;
  median: number | null;
  high: number | null;
  low: number | null;
  contributorCount: number | null;
  metadata: Record<string, unknown>;
};

export type ProviderConsensusCapture = {
  symbol: string;
  provider: string;
  sourceName: string;
  sourceUrl?: string | null;
  sourceType?: "licensed_provider" | "user_supplied" | "manual";
  methodology: string;
  observations: ProviderConsensusObservation[];
  retrievedAt?: Date;
};

function cleanProvider(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Consensus provider id is required.");
  return trimmed;
}

function cleanSymbol(value: string): string {
  const upper = value.trim().toUpperCase();
  if (!upper) throw new Error("Consensus symbol is required.");
  return upper;
}

export async function captureProviderConsensus(input: ProviderConsensusCapture, createdByUserId: number) {
  const symbol = cleanSymbol(input.symbol);
  const provider = cleanProvider(input.provider);
  const retrievedAt = input.retrievedAt ?? new Date();
  if (!input.observations.length) throw new Error(`No usable consensus observations were supplied for ${symbol}.`);

  const db = getDb();
  const snapshots: Array<typeof consensusSnapshots.$inferSelect> = [];
  let createdCount = 0;

  for (const observation of input.observations) {
    const content = {
      symbol,
      metric: observation.metric,
      fiscalPeriod: observation.fiscalPeriod,
      unit: observation.unit,
      currency: observation.currency,
      mean: observation.mean,
      median: observation.median,
      high: observation.high,
      low: observation.low,
      contributorCount: observation.contributorCount,
      provider,
      metadata: observation.metadata,
    };
    const snapshotHash = consensusSnapshotHash(content);
    const [existing] = await db.select().from(consensusSnapshots)
      .where(eq(consensusSnapshots.snapshotHash, snapshotHash))
      .limit(1);
    if (existing) {
      snapshots.push(existing);
      continue;
    }

    const [created] = await db.insert(consensusSnapshots).values({
      symbol,
      organizationId: null,
      investigationId: null,
      metric: observation.metric,
      fiscalPeriod: observation.fiscalPeriod,
      periodEnd: null,
      currency: observation.currency,
      unit: observation.unit,
      mean: observation.mean,
      median: observation.median,
      high: observation.high,
      low: observation.low,
      contributorCount: observation.contributorCount,
      standardDeviation: null,
      upwardRevisionCount: null,
      downwardRevisionCount: null,
      unchangedRevisionCount: null,
      estimateAsOf: retrievedAt,
      publishedAt: null,
      retrievedAt,
      availableAt: retrievedAt,
      sourceType: input.sourceType ?? "licensed_provider",
      provider,
      sourceName: input.sourceName,
      sourceUrl: input.sourceUrl ?? null,
      methodology: input.methodology,
      snapshotHash,
      metadata: {
        ...observation.metadata,
        publicationTimeKnown: false,
        retrievalDefinesAvailability: true,
      },
      createdByUserId,
    }).returning();
    snapshots.push(created);
    createdCount += 1;
  }

  return {
    symbol,
    provider,
    createdCount,
    reusedCount: snapshots.length - createdCount,
    snapshots,
  };
}
