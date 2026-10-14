import crypto from "crypto";
import { and, desc, eq, lte } from "drizzle-orm";
import { datasetSnapshots } from "@shared/schema";
import {
  financialDatasetPayloadSchema,
  pointInTimeDatasetSnapshotSchema,
  type DatasetQuality,
  type FinancialDatasetPayload,
  type FinancialDatasetRevisionReport,
  type FinancialFieldRevision,
  type PointInTimeDatasetSnapshot,
} from "@shared/pointInTimeData";
import { CANONICAL_KEYS } from "@shared/financialFields";
import type { FinancialReportRow, FinancialReportsResult } from "./financialDataProviders";
import { getFinancialReportsWithFallback } from "./financialDataProviders";
import { getDb } from "./db";
import { getFmpRevenueSegments, type FmpRevenueSegment } from "./fmpData";

const CRITICAL_FIELDS: Record<"income" | "balance" | "cashflow", string[]> = {
  income: ["revenue", "costOfRevenue", "incomeBeforeTax", "incomeTaxExpense", "netIncome"],
  balance: ["cashAndCashEquivalents", "netReceivables", "inventory", "propertyPlantEquipmentNet", "accountPayables", "totalAssets", "totalLiabilities", "totalStockholdersEquity"],
  cashflow: ["depreciationAndAmortization", "investmentsInPropertyPlantAndEquipment"],
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}

export function stableSnapshotHash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function parseReportData(statementType: keyof typeof CANONICAL_KEYS, raw: string): Record<string, number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid ${statementType} statement JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid ${statementType} statement payload.`);
  }
  // Providers legitimately attach non-financial metadata alongside real
  // statement figures (e.g. LSE's payload carries derived fields like
  // `cik`/`acceptedDate` -- see financialStatementsBroker.ts's diffReports
  // comment). Silently drop anything outside the canonical key set instead
  // of failing the whole capture; only recognized canonical numeric fields
  // are kept, and buildFinancialDatasetPayload's quality scoring already
  // flags genuinely missing critical fields downstream.
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, number] =>
      CANONICAL_KEYS[statementType].has(entry[0]) && typeof entry[1] === "number" && Number.isFinite(entry[1])),
  );
}

function normalizeCurrency(raw: string | null | undefined): string {
  const currency = raw?.trim().toUpperCase();
  if (!currency || !/^[A-Z]{3}$/.test(currency)) throw new Error("Financial statement is missing a valid ISO 4217 currency.");
  return currency;
}

function reportProvider(report: FinancialReportRow, result: FinancialReportsResult): string {
  return report.data_source?.trim() || report.status?.provider?.trim() || result.provider?.trim() || "unknown";
}

function isoAtStartOfDay(date: string | null | undefined, fallback: string): string {
  if (!date) return fallback;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

export function buildFinancialDatasetPayload(
  symbol: string,
  results: Record<"income" | "balance" | "cashflow", FinancialReportsResult>,
  retrievedAt: string,
  segmentation: { products: FmpRevenueSegment[]; geographies: FmpRevenueSegment[] } = { products: [], geographies: [] },
): { payload: FinancialDatasetPayload; quality: DatasetQuality; provider: string; publishedAt: string | null; lineage: Record<string, unknown> } {
  type StatementType = keyof typeof CANONICAL_KEYS;
  type Candidate = { report: FinancialReportRow; data: Record<string, number>; provider: string };
  type PendingPeriod = {
    fiscalYear: string; period: string; periodEnd: string; filingDate: string | null; currency: string;
    income: Record<string, number>; balance: Record<string, number>; cashflow: Record<string, number>;
    candidates: Record<StatementType, Candidate[]>; segments: Record<string, number>; geographies: Record<string, number>;
    sources: Array<{ statementType: StatementType; provider: string }>;
  };
  const periods = new Map<string, PendingPeriod>();
  const warnings: string[] = [];
  for (const statementType of ["income", "balance", "cashflow"] as const) {
    const result = results[statementType];
    for (const report of result.reports) {
      const key = `${report.fiscal_year}:${report.period}`;
      const currency = normalizeCurrency(report.reported_currency);
      const provider = reportProvider(report, result);
      const candidate = { report, data: parseReportData(statementType, report.data), provider };
      const current = periods.get(key) ?? {
        fiscalYear: report.fiscal_year, period: report.period, periodEnd: report.date, filingDate: report.filing_date ?? null,
        currency, income: {}, balance: {}, cashflow: {},
        candidates: { income: [], balance: [], cashflow: [] }, segments: {}, geographies: {}, sources: [],
      };
      if (current.currency !== currency) throw new Error(`Conflicting reporting currencies for ${key}: ${current.currency} and ${currency}.`);
      current.periodEnd = report.date > current.periodEnd ? report.date : current.periodEnd;
      if (report.filing_date && (!current.filingDate || report.filing_date > current.filingDate)) current.filingDate = report.filing_date;
      current.candidates[statementType].push(candidate);
      current.sources.push({ statementType, provider });
      periods.set(key, current);
    }
  }
  for (const [key, period] of periods) {
    for (const statementType of ["income", "balance", "cashflow"] as const) {
      const candidates = period.candidates[statementType];
      if (candidates.length === 0) continue;
      const ordered = [...candidates].sort((left, right) => (
        (left.report.filing_date ?? "").localeCompare(right.report.filing_date ?? "") ||
        left.provider.localeCompare(right.provider) ||
        left.report.data.localeCompare(right.report.data)
      ));
      const selected = ordered.at(-1)!;
      period[statementType] = selected.data;
      if (candidates.length > 1) warnings.push(`Duplicate ${statementType} statements for ${key}; selected filing ${selected.report.filing_date ?? "undated"} from ${selected.provider}.`);
    }
    period.sources = [...period.sources].sort((left, right) => left.statementType.localeCompare(right.statementType) || left.provider.localeCompare(right.provider));
  }
  for (const row of segmentation.products) {
    const period = periods.get(`${row.fiscalYear}:${row.period}`);
    if (period) period.segments = Object.fromEntries(Object.entries(row.data).filter((entry): entry is [string, number] => Number.isFinite(entry[1])));
  }
  for (const row of segmentation.geographies) {
    const period = periods.get(`${row.fiscalYear}:${row.period}`);
    if (period) period.geographies = Object.fromEntries(Object.entries(row.data).filter((entry): entry is [string, number] => Number.isFinite(entry[1])));
  }
  const normalizedPeriods = Array.from(periods.values()).map((period) => ({ ...period, availableAt: isoAtStartOfDay(period.filingDate, retrievedAt) })).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const payload = financialDatasetPayloadSchema.parse({ symbol: symbol.toUpperCase(), periods: normalizedPeriods });
  const latest = payload.periods.at(-1)!;
  const missingCriticalFields = (Object.entries(CRITICAL_FIELDS) as Array<[keyof typeof CRITICAL_FIELDS, string[]]>).flatMap(([statementType, fields]) => fields.filter((field) => !Number.isFinite(latest[statementType][field])).map((field) => `${statementType}.${field}`));
  const statementCoverage = { income: results.income.reports.length, balance: results.balance.reports.length, cashflow: results.cashflow.reports.length };
  const criticalFieldsExpected = Object.values(CRITICAL_FIELDS).flat().length;
  for (const [statementType, count] of Object.entries(statementCoverage)) if (count === 0) warnings.push(`No ${statementType} statement was available.`);
  if (new Set(payload.periods.map((period) => period.currency)).size > 1) warnings.push("Source periods contain mixed reported currencies.");
  if (payload.periods.some((period) => period.filingDate === null)) warnings.push("At least one period lacks a filing date; retrieval time is used as its available-to-model time.");
  const quality: DatasetQuality = { score: (criticalFieldsExpected - missingCriticalFields.length) / criticalFieldsExpected, statementCoverage, criticalFieldsPresent: criticalFieldsExpected - missingCriticalFields.length, criticalFieldsExpected, missingCriticalFields, warnings };
  const rowProviders = Array.from(new Set(payload.periods.flatMap((period) => period.sources.map((source) => source.provider))));
  const providers = rowProviders.length > 1 ? ["mixed"] : rowProviders;
  const filingDates = payload.periods.map((period) => period.filingDate).filter((item): item is string => Boolean(item)).sort();
  return {
    payload, quality, provider: providers[0] ?? "unavailable",
    publishedAt: filingDates.at(-1) ? isoAtStartOfDay(filingDates.at(-1), retrievedAt) : null,
    lineage: { ...Object.fromEntries((Object.entries(results) as Array<[string, FinancialReportsResult]>).map(([statementType, result]) => [statementType, { selectedProvider: result.provider, attemptedProviders: result.attemptedProviders, failures: result.failures, reportCount: result.reports.length }])), segmentation: { provider: "FMP", productPeriods: segmentation.products.length, geographyPeriods: segmentation.geographies.length } },
  };
}

function rowToSnapshot(row: typeof datasetSnapshots.$inferSelect): PointInTimeDatasetSnapshot {
  return pointInTimeDatasetSnapshotSchema.parse({
    ...row,
    quality: row.quality,
    lineage: row.lineage,
    payload: row.payload,
    effectiveAt: row.effectiveAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    retrievedAt: row.retrievedAt.toISOString(),
    availableAt: row.availableAt.toISOString(),
    createdAt: row.createdAt.toISOString(),

  });
}
export async function captureFinancialDatasetSnapshot(symbol: string, createdByUserId: number): Promise<{ snapshot: PointInTimeDatasetSnapshot; created: boolean }> {
  const upper = symbol.trim().toUpperCase();
  const retrievedAt = new Date().toISOString();
  const [income, balance, cashflow, segmentation] = await Promise.all([
    getFinancialReportsWithFallback(upper, "income", "FY", createdByUserId), getFinancialReportsWithFallback(upper, "balance", "FY", createdByUserId),
    getFinancialReportsWithFallback(upper, "cashflow", "FY", createdByUserId), getFmpRevenueSegments(upper),
  ]);
  if (income.reports.length + balance.reports.length + cashflow.reports.length === 0) throw new Error(`No annual financial statements are available for ${upper}.`);
  const normalized = buildFinancialDatasetPayload(upper, { income, balance, cashflow }, retrievedAt, segmentation);
  const datasetKey = `financials:${upper}:FY`;
  const contentHash = stableSnapshotHash({ payload: normalized.payload, provider: normalized.provider, lineage: normalized.lineage });
  const db = getDb();
  const [existing] = await db.select().from(datasetSnapshots).where(and(eq(datasetSnapshots.datasetKey, datasetKey), eq(datasetSnapshots.contentHash, contentHash))).limit(1);
  if (existing) return { snapshot: rowToSnapshot(existing), created: false };
  const [parent] = await db.select().from(datasetSnapshots).where(eq(datasetSnapshots.datasetKey, datasetKey)).orderBy(desc(datasetSnapshots.createdAt)).limit(1);
  const observationStart = normalized.payload.periods.at(0)?.periodEnd ?? null;
  const observationEnd = normalized.payload.periods.at(-1)?.periodEnd ?? null;
  const availableAt = normalized.payload.periods.map((period) => period.availableAt).sort().at(-1) ?? retrievedAt;
  const currencies = Array.from(new Set(normalized.payload.periods.map((period) => period.currency)));
  const id = crypto.randomUUID();
  const [created] = await db.insert(datasetSnapshots).values({
    id, datasetKey, entityKey: upper, dataClass: "financial_statements", schemaVersion: "1.0.0",
    source: "financial_provider_waterfall", provider: normalized.provider, frequency: "annual",
    currency: currencies.length === 1 ? currencies[0] : null, timezone: "UTC", observationStart, observationEnd,
    effectiveAt: observationEnd ? new Date(`${observationEnd}T00:00:00.000Z`) : null,
    publishedAt: normalized.publishedAt ? new Date(normalized.publishedAt) : null,
    retrievedAt: new Date(retrievedAt), availableAt: new Date(availableAt), contentHash,
    parentSnapshotId: parent?.id ?? null, quality: normalized.quality, lineage: normalized.lineage,
    payload: normalized.payload, createdByUserId,
  }).returning();
  return { snapshot: rowToSnapshot(created), created: true };
}

export async function getDatasetSnapshot(id: string): Promise<PointInTimeDatasetSnapshot | null> {
  const [row] = await getDb().select().from(datasetSnapshots).where(and(eq(datasetSnapshots.id, id), eq(datasetSnapshots.dataClass, "financial_statements"))).limit(1);
  return row ? rowToSnapshot(row) : null;
}

export async function listDatasetSnapshots(entityKey?: string, limit = 100): Promise<PointInTimeDatasetSnapshot[]> {
  const query = getDb().select().from(datasetSnapshots);
  const rows = entityKey
    ? await query.where(and(eq(datasetSnapshots.entityKey, entityKey.toUpperCase()), eq(datasetSnapshots.dataClass, "financial_statements"))).orderBy(desc(datasetSnapshots.createdAt)).limit(limit)
    : await query.where(eq(datasetSnapshots.dataClass, "financial_statements")).orderBy(desc(datasetSnapshots.createdAt)).limit(limit);
  return rows.map(rowToSnapshot);
}

export async function getFinancialDatasetAsOf(symbol: string, asOf: Date): Promise<PointInTimeDatasetSnapshot | null> {
  const upper = symbol.toUpperCase();
  const [row] = await getDb().select().from(datasetSnapshots).where(and(
    eq(datasetSnapshots.datasetKey, `financials:${upper}:FY`),
    eq(datasetSnapshots.entityKey, upper),
    lte(datasetSnapshots.availableAt, asOf),
  )).orderBy(desc(datasetSnapshots.availableAt), desc(datasetSnapshots.createdAt)).limit(1);
  return row ? rowToSnapshot(row) : null;
}

export function compareFinancialDatasetPayloads(
  before: FinancialDatasetPayload,
  after: FinancialDatasetPayload,
  snapshotId = "comparison",
  parentSnapshotId: string | null = null,
): FinancialDatasetRevisionReport {
  const periodKey = (period: FinancialDatasetPayload["periods"][number]) => `${period.fiscalYear}:${period.period}`;
  const beforePeriods = new Map(before.periods.map((period) => [periodKey(period), period]));
  const afterPeriods = new Map(after.periods.map((period) => [periodKey(period), period]));
  const revisions: FinancialFieldRevision[] = [];
  for (const [key, current] of Array.from(afterPeriods.entries())) {
    const previous = beforePeriods.get(key);
    if (!previous) continue;
    for (const statementType of ["income", "balance", "cashflow"] as const) {
      const fields = new Set([...Object.keys(previous[statementType]), ...Object.keys(current[statementType])]);
      for (const field of Array.from(fields)) {
        const oldValue = previous[statementType][field];
        const newValue = current[statementType][field];
        if (oldValue === newValue) continue;
        const absoluteChange = oldValue === undefined || newValue === undefined ? null : newValue - oldValue;
        const percentChange = absoluteChange === null || oldValue === 0 ? null : absoluteChange / Math.abs(oldValue);
        revisions.push({
          fiscalYear: current.fiscalYear, period: current.period, statementType, field,
          before: oldValue ?? null, after: newValue ?? null, absoluteChange, percentChange,
          material: oldValue === undefined || newValue === undefined || Math.abs(percentChange ?? absoluteChange ?? 0) >= 0.01,
        });
      }
    }
  }
  const addedPeriods = Array.from(afterPeriods.keys()).filter((key) => !beforePeriods.has(key)).sort();
  const removedPeriods = Array.from(beforePeriods.keys()).filter((key) => !afterPeriods.has(key)).sort();
  return {
    snapshotId, parentSnapshotId,
    status: revisions.length + addedPeriods.length + removedPeriods.length === 0 ? "unchanged" : "revised",
    changedFields: revisions.length,
    materialChanges: revisions.filter((revision) => revision.material).length,
    addedPeriods, removedPeriods,
    revisions: revisions.sort((a, b) => `${b.fiscalYear}:${b.period}:${b.statementType}:${b.field}`.localeCompare(`${a.fiscalYear}:${a.period}:${a.statementType}:${a.field}`)),
  };
}

export async function getDatasetRevisionReport(id: string): Promise<FinancialDatasetRevisionReport | null> {
  const snapshot = await getDatasetSnapshot(id);
  if (!snapshot) return null;
  if (!snapshot.parentSnapshotId) return { snapshotId: id, parentSnapshotId: null, status: "initial", changedFields: 0, materialChanges: 0, addedPeriods: snapshot.payload.periods.map((period) => `${period.fiscalYear}:${period.period}`), removedPeriods: [], revisions: [] };
  const parent = await getDatasetSnapshot(snapshot.parentSnapshotId);
  if (!parent) return { snapshotId: id, parentSnapshotId: snapshot.parentSnapshotId, status: "initial", changedFields: 0, materialChanges: 0, addedPeriods: [], removedPeriods: [], revisions: [] };
  return compareFinancialDatasetPayloads(parent.payload, snapshot.payload, id, parent.id);
}
