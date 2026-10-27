import type { PointInTimeMarketSnapshot } from "./pointInTimeData";

/**
 * B06 source-only evidence time selection. Historical bar dates do not prove
 * a vendor's data was available to the user on that date. Only an already
 * captured, retained snapshot's own availableAt timestamp can do that.
 */
export type MarketCaptureReference = Pick<PointInTimeMarketSnapshot,
  "id" | "datasetKey" | "entityKey" | "availableAt" | "retrievedAt" |
  "contentHash" | "observationStart" | "observationEnd" | "provider" | "currency"> & {
    priceBasis: PointInTimeMarketSnapshot["payload"]["priceBasis"];
  };

export interface MarketCaptureComparison {
  status: "compared";
  baseline: MarketCaptureReference;
  current: MarketCaptureReference;
  changes: {
    status: "initial" | "unchanged" | "revised";
    changedObservations: number;
    materialChanges: number;
    totalAddedDates: number;
    totalRemovedDates: number;
    actionChanges: number;
    revisions: Array<{ date: string; field: "open" | "high" | "low" | "close" | "volume";
      before: number | null; after: number | null; absoluteChange: number | null;
      percentChange: number | null; material: boolean }>;
    addedDates: string[];
    removedDates: string[];
  };
  omitted: { revisions: number; addedDates: number; removedDates: number };
}

/** Strict civil UTC date, including leap-day validity; never Date.parse free text. */
export function marketEvidenceUtcDay(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value)) return null;
  const time = Date.parse(value + "T00:00:00.000Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : null;
}

export function eligibleMarketCaptures(
  snapshots: readonly PointInTimeMarketSnapshot[], symbol: string,
): PointInTimeMarketSnapshot[] {
  const upper = symbol.trim().toUpperCase();
  if (!upper || !/^[A-Z0-9.^_=-]{1,40}$/.test(upper)) return [];
  return snapshots.filter(row => row.dataClass === "market_series" &&
    row.entityKey === upper && row.datasetKey === `market:${upper}:1d` &&
    row.payload.symbol === upper && /^[a-f0-9]{64}$/.test(row.contentHash) &&
    typeof row.availableAt === "string" && Number.isFinite(Date.parse(row.availableAt)))
    .sort((a, b) => Date.parse(b.availableAt) - Date.parse(a.availableAt) ||
      a.id.localeCompare(b.id));
}

export function latestMarketCapture(snapshots: readonly PointInTimeMarketSnapshot[], symbol: string) {
  return eligibleMarketCaptures(snapshots, symbol)[0] ?? null;
}

export function marketCaptureKnownOn(
  snapshots: readonly PointInTimeMarketSnapshot[], symbol: string, utcDay: string,
): PointInTimeMarketSnapshot | null {
  const day = marketEvidenceUtcDay(utcDay);
  if (!day) return null;
  const through = Date.parse(day + "T23:59:59.999Z");
  return eligibleMarketCaptures(snapshots, symbol).find(
    row => Date.parse(row.availableAt) <= through
  ) ?? null;
}

export function marketCapturePairIssue(
  before: PointInTimeMarketSnapshot, after: PointInTimeMarketSnapshot, symbol: string,
): string | null {
  const upper = symbol.trim().toUpperCase();
  if (before.id === after.id) return "Select two distinct captured versions.";
  if (![before, after].every(row => row.dataClass === "market_series" &&
    row.datasetKey === `market:${upper}:1d` && row.entityKey === upper &&
    row.payload.symbol === upper && /^[a-f0-9]{64}$/.test(row.contentHash))) {
    return "Both captures must belong to this exact recorded market dataset.";
  }
  if (!(Number.isFinite(Date.parse(before.availableAt)) &&
    Number.isFinite(Date.parse(after.availableAt))) ||
    Date.parse(before.availableAt) > Date.parse(after.availableAt)) {
    return "The baseline was not available before the comparison capture.";
  }
  if (before.payload.priceBasis !== after.payload.priceBasis ||
    before.currency !== after.currency ||
    before.payload.currency !== after.payload.currency ||
    before.payload.calendar !== after.payload.calendar ||
    before.payload.interval !== after.payload.interval ||
    before.payload.timezone !== after.payload.timezone) {
    return "Currency, exchange calendar, time zone or adjustment basis changed; numeric deltas are not comparable.";
  }
  return null;
}

export function marketCaptureReference(row: PointInTimeMarketSnapshot): MarketCaptureReference {
  return {
    id: row.id, datasetKey: row.datasetKey, entityKey: row.entityKey,
    availableAt: row.availableAt, retrievedAt: row.retrievedAt,
    contentHash: row.contentHash, observationStart: row.observationStart,
    observationEnd: row.observationEnd, provider: row.provider, currency: row.currency,
    priceBasis: row.payload.priceBasis,
  };
}
