import crypto from "crypto";
import { and, desc, eq, lte } from "drizzle-orm";
import { datasetSnapshots } from "@shared/schema";
import {
  marketDatasetPayloadSchema,
  pointInTimeMarketSnapshotSchema,
  type CanonicalMarketBar,
  type CorporateAction,
  type MarketDatasetPayload,
  type MarketDatasetQuality,
  type MarketDatasetRevisionReport,
  type MarketSeriesRevision,
  type PointInTimeMarketSnapshot,
} from "@shared/pointInTimeData";
import type { OHLCVBar } from "./marketData";
import { getDb, type DrizzleDb } from "./db";
import { stableSnapshotHash } from "./pointInTimeDatasetStore";

const ONE_DAY_MS = 86_400_000;

export function trimMarketBarsToRange(bars: OHLCVBar[], range: string, asOf: Date): OHLCVBar[] {
  if (range.toUpperCase() === "MAX") return bars;
  const match = range.toUpperCase().match(/^(\d+)Y$/);
  if (!match) return bars;
  const cutoff = new Date(Date.UTC(asOf.getUTCFullYear() - Number(match[1]), asOf.getUTCMonth(), asOf.getUTCDate())).toISOString().slice(0, 10);
  return bars.filter((bar) => bar.date >= cutoff);
}

function isoDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function countPotentialMissingSessions(start: string, end: string, dates: Set<string>): number {
  let missing = 0;
  for (let time = Date.parse(`${start}T00:00:00Z`); time <= Date.parse(`${end}T00:00:00Z`); time += ONE_DAY_MS) {
    const date = new Date(time);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6 && !dates.has(date.toISOString().slice(0, 10))) missing += 1;
  }
  return missing;
}

export function buildMarketDatasetPayload(input: {
  symbol: string;
  bars: OHLCVBar[];
  corporateActions?: CorporateAction[];
  currency?: string;
  timezone?: string;
  calendar?: string;
  priceBasis?: MarketDatasetPayload["priceBasis"];
  assetClass?: MarketDatasetPayload["assetClass"];
  baseCurrency?: string | null;
  quoteCurrency?: string | null;
}): { payload: MarketDatasetPayload; quality: MarketDatasetQuality } {
  const sorted = [...input.bars].sort((a, b) => a.date.localeCompare(b.date));
  const unique = new Map<string, OHLCVBar>();
  let invalidBars = 0;
  for (const bar of sorted) {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(bar.date)
      && [bar.open, bar.high, bar.low, bar.close, bar.volume].every((value) => Number.isFinite(value) && value >= 0)
      && bar.high >= Math.max(bar.open, bar.low, bar.close)
      && bar.low <= Math.min(bar.open, bar.high, bar.close);
    if (!valid) { invalidBars += 1; continue; }
    unique.set(bar.date, bar);
  }
  const duplicateDates = sorted.length - invalidBars - unique.size;
  const actions = [...(input.corporateActions ?? [])].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  const dividendsByDate = new Map<string, number>();
  for (const action of actions) if (action.type === "cash_dividend" && action.cashAmount !== null) {
    dividendsByDate.set(action.effectiveDate, (dividendsByDate.get(action.effectiveDate) ?? 0) + action.cashAmount);
  }
  const bars: CanonicalMarketBar[] = [];
  for (const bar of Array.from(unique.values())) {
    const prior = bars.at(-1);
    const priceReturn = prior && prior.close > 0 ? bar.close / prior.close - 1 : null;
    const logReturn = prior && prior.close > 0 && bar.close > 0 ? Math.log(bar.close / prior.close) : null;
    const dividend = dividendsByDate.get(bar.date) ?? 0;
    const totalReturn = input.priceBasis === "raw" && prior && prior.close > 0 ? (bar.close + dividend) / prior.close - 1 : null;
    bars.push({ ...bar, priceReturn, logReturn, totalReturn });
  }
  if (bars.length === 0) throw new Error(`No valid daily market observations are available for ${input.symbol.toUpperCase()}.`);
  const dateSet = new Set(bars.map((bar) => bar.date));
  const missingSessions = countPotentialMissingSessions(bars[0].date, bars.at(-1)!.date, dateSet);
  const warnings: string[] = [];
  const priceBasis = input.priceBasis ?? "unknown";
  if (priceBasis === "unknown") warnings.push("History adjustment semantics are not guaranteed by every provider in the waterfall; total returns are withheld.");
  if (actions.length === 0) warnings.push("No dedicated corporate actions were available; absence does not prove that no actions occurred.");
  if (missingSessions > 0) warnings.push(`${missingSessions} potential weekday sessions are absent; exchange holidays are not classified yet.`);
  if (duplicateDates > 0) warnings.push(`${duplicateDates} duplicate observations were resolved by keeping the last value.`);
  if (invalidBars > 0) warnings.push(`${invalidBars} invalid observations were excluded.`);
  const returnCoverage = bars.length <= 1 ? 0 : bars.slice(1).filter((bar) => bar.priceReturn !== null).length / (bars.length - 1);
  const penalty = Math.min(0.5, invalidBars / Math.max(1, sorted.length) + duplicateDates / Math.max(1, sorted.length));
  const payload = marketDatasetPayloadSchema.parse({
    symbol: input.symbol.toUpperCase(), assetClass: input.assetClass ?? "unknown", baseCurrency: input.baseCurrency ?? null,
    quoteCurrency: input.quoteCurrency ?? null, interval: "1d", calendar: input.calendar ?? "UNKNOWN",
    timezone: input.timezone ?? "UTC", currency: input.currency ?? "UNKNOWN", priceBasis, bars, corporateActions: actions,
  });
  return { payload, quality: { score: Math.max(0, Math.min(1, returnCoverage - penalty)), barCount: bars.length, actionCount: actions.length, duplicateDates, invalidBars, missingSessions, returnCoverage, warnings } };
}

async function fetchCorporateActions(symbol: string): Promise<{ actions: CorporateAction[]; lineage: Record<string, unknown> }> {
  const actions: CorporateAction[] = [];
  const failures: string[] = [];
  const { getDividends, getStockSplits, isLseConfigured } = await import("./lseData");
  if (isLseConfigured()) {
    try {
      const [dividendResult, splitResult] = await Promise.all([getDividends(symbol, 500), getStockSplits(symbol, 200)]);
      const dividends = Array.isArray(dividendResult) ? dividendResult : dividendResult.rows;
      const splits = Array.isArray(splitResult) ? splitResult : splitResult.rows;
      for (const row of dividends) actions.push({
        type: "cash_dividend", effectiveDate: row.effective_date, declarationDate: isoDay(row.declaration_date),
        recordDate: isoDay(row.record_date), paymentDate: isoDay(row.payment_date), cashAmount: row.dividend_amount,
        currency: row.currency || null, splitFrom: null, splitTo: null, adjustmentFactor: null, source: "lse",
      });
      for (const row of splits) actions.push({
        type: "stock_split", effectiveDate: row.effective_date, declarationDate: null, recordDate: null, paymentDate: null,
        cashAmount: null, currency: null, splitFrom: row.split_from, splitTo: row.split_to,
        adjustmentFactor: row.split_to > 0 ? row.split_from / row.split_to : null, source: "lse",
      });
      return { actions, lineage: { selectedProvider: "lse", attemptedProviders: ["lse"], failures } };
    } catch (error) { failures.push(`lse: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return {
    actions,
    lineage: {
      selectedProvider: actions.length ? "lse" : null,
      attemptedProviders: isLseConfigured() ? ["lse"] : [],
      failures,
    },
  };
}

function rowToMarketSnapshot(row: typeof datasetSnapshots.$inferSelect): PointInTimeMarketSnapshot {
  return pointInTimeMarketSnapshotSchema.parse({ ...row, effectiveAt: row.effectiveAt?.toISOString(), publishedAt: row.publishedAt?.toISOString() ?? null,
    retrievedAt: row.retrievedAt.toISOString(), availableAt: row.availableAt.toISOString(), createdAt: row.createdAt.toISOString() });
}

export async function captureMarketDatasetSnapshot(symbol: string, createdByUserId: number, range = "5Y") {
  const upper = symbol.trim().toUpperCase();
  const retrievedAt = new Date();
  const { getOHLCV, getQuotes } = await import("./marketData");
  const [bars, actionResult, quote] = await Promise.all([
    getOHLCV(upper, range, "1d"), fetchCorporateActions(upper), getQuotes([upper]).then((rows) => rows[0] ?? null),
  ]);
  const fxMatch = upper.match(/^([A-Z]{3})([A-Z]{3})=X$/);
  const rangeBars = trimMarketBarsToRange(bars, range, retrievedAt);
  const normalized = buildMarketDatasetPayload({
    symbol: upper, bars: rangeBars, corporateActions: actionResult.actions.filter((action) => !rangeBars[0] || action.effectiveDate >= rangeBars[0].date), currency: quote?.currency ?? "UNKNOWN",
    calendar: quote?.exchange ?? "UNKNOWN", priceBasis: "unknown", assetClass: fxMatch ? "fx" : "unknown",
    baseCurrency: fxMatch?.[1] ?? null, quoteCurrency: fxMatch?.[2] ?? null,
  });
  const datasetKey = `market:${upper}:1d`;
  const lineage = { prices: { selectedProvider: "market_data_waterfall", currentQuoteSource: quote?.quoteSource ?? null, requestedRange: range }, corporateActions: actionResult.lineage };
  const contentHash = stableSnapshotHash({ payload: normalized.payload, lineage });
  const db = getDb();
  const [existing] = await db.select().from(datasetSnapshots).where(and(eq(datasetSnapshots.datasetKey, datasetKey), eq(datasetSnapshots.contentHash, contentHash))).limit(1);
  if (existing) return { snapshot: rowToMarketSnapshot(existing), created: false };
  const [parent] = await db.select().from(datasetSnapshots).where(eq(datasetSnapshots.datasetKey, datasetKey)).orderBy(desc(datasetSnapshots.createdAt)).limit(1);
  const start = normalized.payload.bars[0].date, end = normalized.payload.bars.at(-1)!.date;
  const [created] = await db.insert(datasetSnapshots).values({
    id: crypto.randomUUID(), datasetKey, entityKey: upper, dataClass: "market_series", schemaVersion: "1.0.0",
    source: "market_data_waterfall", provider: "market_data_waterfall", frequency: "daily", currency: normalized.payload.currency,
    timezone: normalized.payload.timezone, observationStart: start, observationEnd: end,
    effectiveAt: new Date(`${end}T23:59:59.999Z`), publishedAt: null, retrievedAt, availableAt: retrievedAt,
    contentHash, parentSnapshotId: parent?.id ?? null, quality: normalized.quality, lineage, payload: normalized.payload, createdByUserId,
  }).returning();
  return { snapshot: rowToMarketSnapshot(created), created: true };
}

export async function getMarketDatasetSnapshot(id: string, db: Pick<DrizzleDb, "select"> = getDb()): Promise<PointInTimeMarketSnapshot | null> {
  const [row] = await db.select().from(datasetSnapshots).where(and(eq(datasetSnapshots.id, id), eq(datasetSnapshots.dataClass, "market_series"))).limit(1);
  return row ? rowToMarketSnapshot(row) : null;
}

export async function listMarketDatasetSnapshots(symbol: string, limit = 50): Promise<PointInTimeMarketSnapshot[]> {
  const rows = await getDb().select().from(datasetSnapshots).where(and(eq(datasetSnapshots.entityKey, symbol.toUpperCase()), eq(datasetSnapshots.dataClass, "market_series"))).orderBy(desc(datasetSnapshots.createdAt)).limit(limit);
  return rows.map(rowToMarketSnapshot);
}

export async function getMarketDatasetAsOf(symbol: string, asOf: Date): Promise<PointInTimeMarketSnapshot | null> {
  const [row] = await getDb().select().from(datasetSnapshots).where(and(eq(datasetSnapshots.datasetKey, `market:${symbol.toUpperCase()}:1d`), lte(datasetSnapshots.availableAt, asOf))).orderBy(desc(datasetSnapshots.availableAt), desc(datasetSnapshots.createdAt)).limit(1);
  return row ? rowToMarketSnapshot(row) : null;
}

export function compareMarketDatasetPayloads(before: MarketDatasetPayload, after: MarketDatasetPayload, snapshotId = "comparison", parentSnapshotId: string | null = null): MarketDatasetRevisionReport {
  const oldBars = new Map(before.bars.map((bar) => [bar.date, bar])), currentBars = new Map(after.bars.map((bar) => [bar.date, bar]));
  const revisions: MarketSeriesRevision[] = [];
  for (const [date, current] of Array.from(currentBars.entries())) {
    const previous = oldBars.get(date); if (!previous) continue;
    for (const field of ["open", "high", "low", "close", "volume"] as const) if (previous[field] !== current[field]) {
      const absoluteChange = current[field] - previous[field];
      const percentChange = previous[field] === 0 ? null : absoluteChange / Math.abs(previous[field]);
      revisions.push({ date, field, before: previous[field], after: current[field], absoluteChange, percentChange, material: Math.abs(percentChange ?? absoluteChange) >= 0.001 });
    }
  }
  const addedDates = Array.from(currentBars.keys()).filter((date) => !oldBars.has(date)).sort();
  const removedDates = Array.from(oldBars.keys()).filter((date) => !currentBars.has(date)).sort();
  const oldActions = new Set(before.corporateActions.map((action) => stableSnapshotHash(action)));
  const newActions = new Set(after.corporateActions.map((action) => stableSnapshotHash(action)));
  const actionChanges = Array.from(oldActions).filter((hash) => !newActions.has(hash)).length + Array.from(newActions).filter((hash) => !oldActions.has(hash)).length;
  return { snapshotId, parentSnapshotId, status: revisions.length + addedDates.length + removedDates.length + actionChanges === 0 ? "unchanged" : "revised",
    changedObservations: revisions.length, materialChanges: revisions.filter((revision) => revision.material).length,
    addedDates, removedDates, actionChanges, revisions: revisions.sort((a, b) => b.date.localeCompare(a.date)) };
}

export async function getMarketDatasetRevisionReport(id: string): Promise<MarketDatasetRevisionReport | null> {
  const snapshot = await getMarketDatasetSnapshot(id); if (!snapshot) return null;
  if (!snapshot.parentSnapshotId) return { snapshotId: id, parentSnapshotId: null, status: "initial", changedObservations: 0, materialChanges: 0, addedDates: snapshot.payload.bars.map((bar) => bar.date), removedDates: [], actionChanges: snapshot.payload.corporateActions.length, revisions: [] };
  const parent = await getMarketDatasetSnapshot(snapshot.parentSnapshotId);
  return parent ? compareMarketDatasetPayloads(parent.payload, snapshot.payload, id, parent.id) : null;
}
