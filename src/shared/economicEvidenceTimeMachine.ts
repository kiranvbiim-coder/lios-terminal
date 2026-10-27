import type { PointInTimeScalarSeriesSnapshot } from "./pointInTimeData";
import { marketEvidenceUtcDay } from "./marketEvidenceTimeMachine";

/** B06: FRED series are compared only across actually retained captures. */
export function eligibleEconomicCaptures(
  rows: readonly PointInTimeScalarSeriesSnapshot[], seriesId: string,
): PointInTimeScalarSeriesSnapshot[] {
  const id = seriesId.trim().toUpperCase();
  if (!/^[A-Z0-9._-]{1,80}$/.test(id)) return [];
  return rows.filter(row => row.dataClass === "economic_series" &&
    row.entityKey === id && row.datasetKey === `economic:${id}` &&
    row.payload.seriesId === id && /^[a-f0-9]{64}$/.test(row.contentHash) &&
    typeof row.availableAt === "string" && Number.isFinite(Date.parse(row.availableAt)))
    .sort((a,b) => Date.parse(b.availableAt)-Date.parse(a.availableAt) || a.id.localeCompare(b.id));
}

export function economicCaptureKnownOn(
  rows: readonly PointInTimeScalarSeriesSnapshot[], seriesId: string, utcDay: string,
): PointInTimeScalarSeriesSnapshot | null {
  const day = marketEvidenceUtcDay(utcDay);
  if (!day) return null;
  const latestEnd = Date.parse(day+"T23:59:59.999Z");
  return eligibleEconomicCaptures(rows,seriesId).find(row => Date.parse(row.availableAt) <= latestEnd) ?? null;
}

export function economicCapturePairIssue(
  before: PointInTimeScalarSeriesSnapshot, after: PointInTimeScalarSeriesSnapshot, seriesId: string,
): string | null {
  const id = seriesId.trim().toUpperCase();
  if (before.id === after.id) return "Select two distinct captured versions.";
  if (![before,after].every(row => row.dataClass === "economic_series" &&
    row.entityKey === id && row.datasetKey === `economic:${id}` &&
    row.payload.seriesId === id && /^[a-f0-9]{64}$/.test(row.contentHash))) {
    return "Both captures must belong to the same recorded economic series.";
  }
  if (!Number.isFinite(Date.parse(before.availableAt)) ||
    !Number.isFinite(Date.parse(after.availableAt)) ||
    Date.parse(before.availableAt) > Date.parse(after.availableAt)) {
    return "Baseline must have actually been available before the later capture.";
  }
  if (before.payload.unit !== after.payload.unit ||
    before.payload.frequency !== after.payload.frequency ||
    before.payload.category !== after.payload.category ||
    before.payload.provider !== after.payload.provider ||
    before.timezone !== after.timezone) {
    return "Recorded units, frequency, category, provider or time zone changed; numeric comparisons are withheld.";
  }
  return null;
}

export interface EconomicEvidenceComparison {
  status: "compared";
  baseline: { id: string; entityKey: string; datasetKey: string; availableAt: string; contentHash: string;
    retrievedAt: string; provider: string; unit: string };
  current: { id: string; entityKey: string; datasetKey: string; availableAt: string; contentHash: string;
    retrievedAt: string; provider: string; unit: string };
  changes: {
    status: "unchanged" | "revised"; changedObservations: number;
    totalAddedDates: number; totalRemovedDates: number;
    revisions: Array<{ date: string; before: number; after: number; absoluteChange: number; percentChange: number | null;
      beforeVintage: { realtimeStart: string | null; realtimeEnd: string | null };
      afterVintage: { realtimeStart: string | null; realtimeEnd: string | null } }>;
    addedDates: string[]; removedDates: string[];
  };
  omitted: { revisions: number; addedDates: number; removedDates: number };
}

export function economicCaptureReference(snapshot: PointInTimeScalarSeriesSnapshot) {
  return {
    id:snapshot.id, entityKey:snapshot.entityKey, datasetKey:snapshot.datasetKey,
    availableAt:snapshot.availableAt, contentHash:snapshot.contentHash,
    retrievedAt:snapshot.retrievedAt,provider:snapshot.provider,unit:snapshot.payload.unit,
  };
}
