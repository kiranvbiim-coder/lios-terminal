import crypto from "crypto";
import { and, desc, eq, lte } from "drizzle-orm";
import { datasetSnapshots } from "@shared/schema";
import {
  pointInTimeScalarSeriesSnapshotSchema,
  pointInTimeYieldCurveSnapshotSchema,
  scalarSeriesPayloadSchema,
  yieldCurvePayloadSchema,
  type EconomicDatasetQuality,
  type PointInTimeScalarSeriesSnapshot,
  type PointInTimeYieldCurveSnapshot,
  type ScalarSeriesPayload,
  type VintageObservation,
  type YieldCurvePayload,
} from "@shared/pointInTimeData";
import type { IndicatorObservation, YieldCurvePoint } from "./fredData";
import { getDb, type DrizzleDb } from "./db";
import { stableSnapshotHash } from "./pointInTimeDatasetStore";

const MATURITY_YEARS: Record<string, number> = { "1M": 1 / 12, "3M": 0.25, "6M": 0.5, "1Y": 1, "2Y": 2, "3Y": 3, "5Y": 5, "7Y": 7, "10Y": 10, "20Y": 20, "30Y": 30 };
export function economicSnapshotContentHash(payload: unknown, lineage: unknown): string {
  return stableSnapshotHash({ payload, lineage });
}

function isoStart(date: string): string { return `${date}T00:00:00.000Z`; }

export function inferObservationFrequency(observations: Array<{ date: string }>): string {
  if (observations.length < 2) return "unknown";
  const gaps = observations.slice(1).map((item, index) => (Date.parse(item.date) - Date.parse(observations[index].date)) / 86_400_000).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  if (median <= 3) return "daily"; if (median <= 10) return "weekly"; if (median <= 45) return "monthly"; if (median <= 120) return "quarterly"; return "annual";
}

export function buildScalarSeriesPayload(input: {
  seriesId: string; name: string; unit: string; category: string; observations: IndicatorObservation[]; retrievedAt: string;
}): { payload: ScalarSeriesPayload; quality: EconomicDatasetQuality } {
  const unique = new Map<string, IndicatorObservation>();
  for (const observation of input.observations) if (/^\d{4}-\d{2}-\d{2}$/.test(observation.date) && Number.isFinite(observation.value)) unique.set(observation.date, observation);
  const sorted = Array.from(unique.values()).sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) throw new Error(`No valid observations are available for ${input.seriesId.toUpperCase()}.`);
  const observations: VintageObservation[] = sorted.map((row) => ({
    date: row.date, value: row.value, realtimeStart: row.realtimeStart ?? null, realtimeEnd: row.realtimeEnd ?? null,
    availableAt: row.realtimeStart ? isoStart(row.realtimeStart) : input.retrievedAt,
  }));
  const vintageCount = observations.filter((row) => row.realtimeStart !== null).length;
  const vintageCoverage = vintageCount / observations.length;
  const warnings: string[] = [];
  if (vintageCoverage < 1) warnings.push("At least one observation lacks FRED realtime vintage dates; retrieval time is retained for dataset availability.");
  if (unique.size < input.observations.length) warnings.push(`${input.observations.length - unique.size} duplicate or invalid observations were excluded.`);
  const payload = scalarSeriesPayloadSchema.parse({ seriesId: input.seriesId.toUpperCase(), name: input.name, unit: input.unit, category: input.category,
    provider: "fred", frequency: inferObservationFrequency(observations), observations });
  return { payload, quality: { score: 0.8 + 0.2 * vintageCoverage, observationCount: input.observations.length,
    validObservationCount: observations.length, missingValues: input.observations.length - observations.length, vintageCoverage, warnings } };
}

export function buildYieldCurvePayload(points: YieldCurvePoint[]): { payload: YieldCurvePayload; quality: EconomicDatasetQuality } {
  const normalized = points.map((point) => ({ label: point.label, seriesId: point.seriesId, maturityYears: MATURITY_YEARS[point.label],
    yield: typeof point.yield === "number" && Number.isFinite(point.yield) ? point.yield : null, observationDate: point.asOf, realtimeStart: point.realtimeStart ?? null }));
  const dates = normalized.map((point) => point.observationDate).filter((date): date is string => Boolean(date)).sort();
  if (!dates.length) throw new Error("No FRED Treasury curve observations are available.");
  const validObservationCount = normalized.filter((point) => point.yield !== null).length;
  const vintageCount = normalized.filter((point) => point.realtimeStart !== null).length;
  const warnings: string[] = [];
  if (validObservationCount < 11) warnings.push(`${11 - validObservationCount} Treasury tenors are unavailable.`);
  if (new Set(dates).size > 1) warnings.push("Curve tenors have different latest observation dates; each point retains its own date.");
  const payload = yieldCurvePayloadSchema.parse({ curveId: "UST_NOMINAL", currency: "USD", unit: "percent", curveDate: dates.at(-1), provider: "fred", points: normalized });
  return { payload, quality: { score: (validObservationCount / 11) * (0.8 + 0.2 * vintageCount / 11), observationCount: 11,
    validObservationCount, missingValues: 11 - validObservationCount, vintageCoverage: vintageCount / 11, warnings } };
}

function rowToScalar(row: typeof datasetSnapshots.$inferSelect): PointInTimeScalarSeriesSnapshot {
  return pointInTimeScalarSeriesSnapshotSchema.parse({ ...row, effectiveAt: row.effectiveAt?.toISOString(), publishedAt: row.publishedAt?.toISOString() ?? null,
    retrievedAt: row.retrievedAt.toISOString(), availableAt: row.availableAt.toISOString(), createdAt: row.createdAt.toISOString() });
}

function rowToCurve(row: typeof datasetSnapshots.$inferSelect): PointInTimeYieldCurveSnapshot {
  return pointInTimeYieldCurveSnapshotSchema.parse({ ...row, effectiveAt: row.effectiveAt?.toISOString(), publishedAt: row.publishedAt?.toISOString() ?? null,
    retrievedAt: row.retrievedAt.toISOString(), availableAt: row.availableAt.toISOString(), createdAt: row.createdAt.toISOString() });
}

export async function captureFredSeriesSnapshot(seriesId: string, createdByUserId: number, points = 240) {
  const id = seriesId.trim().toUpperCase(); const retrievedAt = new Date();
  const { getIndicatorHistory, getIndicatorProfile } = await import("./fredData");
  const profile = getIndicatorProfile(id); const observations = await getIndicatorHistory(id, points);
  if (!observations.length) throw new Error(`FRED returned no observations for ${id}; configure FRED_API_KEY or verify the series.`);
  const normalized = buildScalarSeriesPayload({ seriesId: id, name: profile?.name ?? id, unit: profile?.unit ?? "", category: profile?.category ?? "Unclassified", observations, retrievedAt: retrievedAt.toISOString() });
  const datasetKey = `economic:${id}`; const lineage = { selectedProvider: "fred", requestedPoints: points, publicationPrecision: "date" };
  const contentHash = economicSnapshotContentHash(normalized.payload, lineage); const db = getDb();
  const [existing] = await db.select().from(datasetSnapshots).where(and(eq(datasetSnapshots.datasetKey, datasetKey), eq(datasetSnapshots.contentHash, contentHash))).limit(1);
  if (existing) return { snapshot: rowToScalar(existing), created: false };
  const [parent] = await db.select().from(datasetSnapshots).where(eq(datasetSnapshots.datasetKey, datasetKey)).orderBy(desc(datasetSnapshots.createdAt)).limit(1);
  const start = normalized.payload.observations[0].date, end = normalized.payload.observations.at(-1)!.date;
  const publishedDates = normalized.payload.observations.map((row) => row.realtimeStart).filter((date): date is string => Boolean(date)).sort();
  const [created] = await db.insert(datasetSnapshots).values({ id: crypto.randomUUID(), datasetKey, entityKey: id, dataClass: "economic_series", schemaVersion: "1.0.0",
    source: "fred_series_observations", provider: "fred", frequency: normalized.payload.frequency, currency: null, timezone: "UTC",
    observationStart: start, observationEnd: end, effectiveAt: new Date(isoStart(end)), publishedAt: publishedDates.at(-1) ? new Date(isoStart(publishedDates.at(-1)!)) : null,
    retrievedAt, availableAt: retrievedAt, contentHash, parentSnapshotId: parent?.id ?? null, quality: normalized.quality, lineage, payload: normalized.payload, createdByUserId }).returning();
  return { snapshot: rowToScalar(created), created: true };
}

export async function captureFredYieldCurveSnapshot(createdByUserId: number, curveDate?: string) {
  const retrievedAt = new Date(); const { getYieldCurve } = await import("./fredData"); const result = await getYieldCurve(curveDate);
  const normalized = buildYieldCurvePayload(result.curve); const datasetKey = "curve:UST_NOMINAL";
  const lineage = { selectedProvider: "fred", requestedCurveDate: curveDate ?? null, publicationPrecision: "date" };
  const contentHash = economicSnapshotContentHash(normalized.payload, lineage); const db = getDb();
  const [existing] = await db.select().from(datasetSnapshots).where(and(eq(datasetSnapshots.datasetKey, datasetKey), eq(datasetSnapshots.contentHash, contentHash))).limit(1);
  if (existing) return { snapshot: rowToCurve(existing), created: false };
  const [parent] = await db.select().from(datasetSnapshots).where(eq(datasetSnapshots.datasetKey, datasetKey)).orderBy(desc(datasetSnapshots.createdAt)).limit(1);
  const publishedDates = normalized.payload.points.map((row) => row.realtimeStart).filter((date): date is string => Boolean(date)).sort();
  const [created] = await db.insert(datasetSnapshots).values({ id: crypto.randomUUID(), datasetKey, entityKey: "UST_NOMINAL", dataClass: "yield_curve", schemaVersion: "1.0.0",
    source: "fred_treasury_curve", provider: "fred", frequency: "daily", currency: "USD", timezone: "UTC", observationStart: normalized.payload.curveDate,
    observationEnd: normalized.payload.curveDate, effectiveAt: new Date(isoStart(normalized.payload.curveDate)), publishedAt: publishedDates.at(-1) ? new Date(isoStart(publishedDates.at(-1)!)) : null,
    retrievedAt, availableAt: retrievedAt, contentHash, parentSnapshotId: parent?.id ?? null, quality: normalized.quality, lineage, payload: normalized.payload, createdByUserId }).returning();
  return { snapshot: rowToCurve(created), created: true };
}

export async function listEconomicDatasetSnapshots(entityKey: string, dataClass: "economic_series" | "yield_curve", limit = 50) {
  const rows = await getDb().select().from(datasetSnapshots).where(and(eq(datasetSnapshots.entityKey, entityKey.toUpperCase()), eq(datasetSnapshots.dataClass, dataClass))).orderBy(desc(datasetSnapshots.createdAt)).limit(limit);
  return dataClass === "economic_series" ? rows.map(rowToScalar) : rows.map(rowToCurve);
}

export async function getEconomicDatasetAsOf(entityKey: string, dataClass: "economic_series" | "yield_curve", asOf: Date) {
  const datasetKey = dataClass === "economic_series" ? `economic:${entityKey.toUpperCase()}` : "curve:UST_NOMINAL";
  const [row] = await getDb().select().from(datasetSnapshots).where(and(eq(datasetSnapshots.datasetKey, datasetKey), lte(datasetSnapshots.availableAt, asOf))).orderBy(desc(datasetSnapshots.availableAt), desc(datasetSnapshots.createdAt)).limit(1);
  return row ? (dataClass === "economic_series" ? rowToScalar(row) : rowToCurve(row)) : null;
}

export async function getEconomicDatasetSnapshot(id: string, db: Pick<DrizzleDb, "select"> = getDb()) {
  const [row] = await db.select().from(datasetSnapshots).where(eq(datasetSnapshots.id, id)).limit(1);
  if (!row || (row.dataClass !== "economic_series" && row.dataClass !== "yield_curve")) return null;
  return row.dataClass === "economic_series" ? rowToScalar(row) : rowToCurve(row);
}

export function compareEconomicDatasetPayloads(before: ScalarSeriesPayload, after: ScalarSeriesPayload) {
  const previous = new Map(before.observations.map((row) => [row.date, row]));
  const current = new Map(after.observations.map((row) => [row.date, row]));
  const revisions = Array.from(current.entries()).flatMap(([date, row]) => {
    const prior = previous.get(date);
    return prior && (prior.value !== row.value || prior.realtimeStart !== row.realtimeStart || prior.realtimeEnd !== row.realtimeEnd)
      ? [{ date, before: prior.value, after: row.value, absoluteChange: row.value - prior.value,
        percentChange: prior.value === 0 ? null : (row.value - prior.value) / Math.abs(prior.value),
        beforeVintage: { realtimeStart: prior.realtimeStart, realtimeEnd: prior.realtimeEnd },
        afterVintage: { realtimeStart: row.realtimeStart, realtimeEnd: row.realtimeEnd } }]
      : [];
  });
  const addedDates = Array.from(current.keys()).filter((date) => !previous.has(date)).sort();
  const removedDates = Array.from(previous.keys()).filter((date) => !current.has(date)).sort();
  return { status: revisions.length + addedDates.length + removedDates.length === 0 ? "unchanged" as const : "revised" as const,
    changedObservations: revisions.length, addedDates, removedDates, revisions: revisions.sort((a, b) => b.date.localeCompare(a.date)) };
}

export function compareYieldCurvePayloads(before: YieldCurvePayload, after: YieldCurvePayload) {
  const previous = new Map(before.points.map((row) => [row.label, row]));
  const revisions = after.points.flatMap((row) => {
    const prior = previous.get(row.label);
    return prior && (prior.yield !== row.yield || prior.observationDate !== row.observationDate || prior.realtimeStart !== row.realtimeStart)
      ? [{ tenor: row.label, before: prior.yield, after: row.yield,
        absoluteChange: prior.yield === null || row.yield === null ? null : row.yield - prior.yield,
        beforeObservationDate: prior.observationDate, afterObservationDate: row.observationDate,
        beforeRealtimeStart: prior.realtimeStart, afterRealtimeStart: row.realtimeStart }]
      : [];
  });
  return { status: revisions.length === 0 ? "unchanged" as const : "revised" as const,
    changedTenors: revisions.length, revisions };
}

export async function getEconomicDatasetRevisionReport(id: string) {
  const snapshot = await getEconomicDatasetSnapshot(id);
  if (!snapshot) return null;
  if (!snapshot.parentSnapshotId) return { snapshotId: id, parentSnapshotId: null, status: "initial" as const,
    ...(snapshot.dataClass === "economic_series"
      ? { changedObservations: 0, addedDates: snapshot.payload.observations.map((row) => row.date), removedDates: [], revisions: [] }
      : { changedTenors: 0, revisions: [] }) };
  const parent = await getEconomicDatasetSnapshot(snapshot.parentSnapshotId);
  if (!parent || parent.dataClass !== snapshot.dataClass) return null;
  const comparison = snapshot.dataClass === "economic_series" && parent.dataClass === "economic_series"
    ? compareEconomicDatasetPayloads(parent.payload, snapshot.payload)
    : snapshot.dataClass === "yield_curve" && parent.dataClass === "yield_curve"
      ? compareYieldCurvePayloads(parent.payload, snapshot.payload)
      : null;
  return comparison ? { snapshotId: id, parentSnapshotId: parent.id, ...comparison } : null;
}
