/**
 * First real instantiation of capabilityBroker.ts, for financial_statements.
 *
 * financialDataProviders.ts's getFinancialReportsWithFallback() stays
 * exactly as-is and remains what every panel/route uses for normal
 * display -- it's the fast, single-winner path this codebase already
 * relies on everywhere. This module reuses its exact provider list
 * (PROVIDERS) and its exact diff primitives (financialReportJoinKey,
 * differingFinancialFields) but calls providers CONCURRENTLY instead of
 * stopping at the first non-empty answer, so it can report what every
 * automatic source actually said and where they disagree -- the
 * "Data Conflict Detector" capability. Each provider's own module already
 * persists its own rows to financialStatementPeriods (companyStore.ts,
 * keyed by source), so calling more than one provider here has the
 * genuine side benefit of durably recording more than one source's data
 * for the same company+period, not just a throwaway comparison.
 *
 * Deliberately excludes pdf_import: a user's manually-uploaded statement
 * is a private, owner-scoped override already surfaced with its own
 * conflict flag by getFinancialReportsWithFallback -- comparing it here
 * against automatic public sources would just re-derive that same
 * signal a second, differently-shaped way.
 */
import {
  PROVIDERS,
  financialReportJoinKey,
  differingFinancialFields,
  type FinancialDataProvider,
} from "./financialDataProviders";
import type { LseFinancialReport } from "./lseData";
import { resolveCapabilityConcurrently, type CapabilityConflict, type CapabilityObservation, type CapabilityResolution } from "./capabilityBroker";
import { getRequestIdentity } from "./requestContext";
import { resolveFamilyProviderOrder } from "./dataStackService";

const AUTOMATIC_PROVIDERS: FinancialDataProvider[] = PROVIDERS.filter((p) => p.id !== "pdf_import");

export function diffReports(observations: CapabilityObservation<LseFinancialReport[]>[]): CapabilityConflict[] {
  const conflicts: CapabilityConflict[] = [];
  // Group every provider's rows by (report_type, fiscal_year, period) so
  // "does Q3 2024 revenue agree" is compared against the matching period,
  // not accidentally against a different period another provider covers.
  const byKey = new Map<string, Array<{ providerId: string; report: LseFinancialReport }>>();
  for (const observation of observations) {
    for (const report of observation.value) {
      const key = financialReportJoinKey(report);
      const bucket = byKey.get(key) ?? [];
      bucket.push({ providerId: observation.providerId, report });
      byKey.set(key, bucket);
    }
  }
  for (const [key, rows] of Array.from(byKey)) {
    if (rows.length < 2) continue;
    // Compare every provider against the first (highest-priority) one that
    // covers this period -- same pairwise-against-the-authoritative-source
    // shape getFinancialReportsWithFallback already uses for pdf-vs-public,
    // generalized from 2 sources to however many actually answered.
    const [reference, ...rest] = rows;
    const fieldConflicts = new Map<string, CapabilityConflict>();
    for (const other of rest) {
      // A different reported_currency between two providers for the same
      // period silently invalidates every numeric field comparison below
      // (an FX-scale gap would otherwise look like an enormous, spurious
      // "material" conflict). This module doesn't attempt FX conversion --
      // that would require picking a rate and a date, a real analytical
      // decision, not a mechanical one -- it only surfaces that the
      // currencies themselves disagree, which is honest and actionable on
      // its own.
      if (reference.report.reported_currency && other.report.reported_currency && reference.report.reported_currency !== other.report.reported_currency) {
        fieldConflicts.set("reported_currency", {
          key, field: "reported_currency", material: true,
          values: [{ providerId: reference.providerId, value: reference.report.reported_currency }, { providerId: other.providerId, value: other.report.reported_currency }],
        });
        continue;
      }
      const differingFields = differingFinancialFields(reference.report.data, other.report.data);
      for (const field of differingFields) {
        const referenceValue = parseField(reference.report.data, field);
        const otherValue = parseField(other.report.data, field);
        // A field only one provider populates at all is a coverage gap
        // (different normalized-field vocabularies), not a disagreement --
        // e.g. LSE's payload carries derived fields like `cik`/
        // `acceptedDate` that Finnhub's normalizer never sets. Only flag
        // it as a conflict when both sides actually reported a value and
        // those values differ.
        if (referenceValue === undefined || otherValue === undefined) continue;
        const existing = fieldConflicts.get(field) ?? { key, field, values: [{ providerId: reference.providerId, value: referenceValue }], material: false };
        if (!existing.values.some((v) => v.providerId === other.providerId)) {
          existing.values.push({ providerId: other.providerId, value: otherValue });
        }
        // Escalate to material the moment any pair of values in this
        // field's growing value set actually differs materially --
        // matches compareFinancialDatasetPayloads's own 1%-of-magnitude
        // threshold for revision comparisons, applied here across sources
        // instead of across time.
        existing.material = existing.material || fieldMaterial(referenceValue, otherValue);
        fieldConflicts.set(field, existing);
      }
    }
    conflicts.push(...Array.from(fieldConflicts.values()));
  }
  return conflicts.sort((a, b) => a.key.localeCompare(b.key) || a.field.localeCompare(b.field));
}

function parseField(data: string, field: string): unknown {
  try {
    return (JSON.parse(data) as Record<string, unknown>)[field];
  } catch {
    return undefined;
  }
}

// Same 1%-of-magnitude threshold compareFinancialDatasetPayloads
// (pointInTimeDatasetStore.ts) uses for time-based revisions, applied here
// to a source-vs-source comparison instead. Non-numeric fields (dates,
// strings) have no meaningful "percent difference" -- any disagreement
// there is treated as material, since there's no rounding-noise floor to
// exempt it under.
function fieldMaterial(a: unknown, b: unknown): boolean {
  if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) return true;
  if (a === b) return false;
  const denominator = Math.abs(a) || Math.abs(b) || 1;
  return Math.abs(a - b) / denominator >= 0.01;
}

export async function resolveFinancialStatements(
  symbol: string,
  reportType: string,
  period: string,
  selectedProviderIds?: string[],
): Promise<CapabilityResolution<LseFinancialReport[]>> {
  const eligible = selectedProviderIds?.length
    ? AUTOMATIC_PROVIDERS.filter((p) => selectedProviderIds.includes(p.id))
    : AUTOMATIC_PROVIDERS;
  // Same P0.2 fix as financialDataProviders.ts's orderedAutomaticProviders:
  // AUTOMATIC_PROVIDERS's fixed array order previously doubled as both the
  // concurrent-fetch attempt order AND (via resolveCapabilityConcurrently's
  // default `rank`, which walks `providers` in the order given) the
  // tie-break for which source wins as authoritative -- meaning the user's
  // providerStackOrder/pins had no effect on which source financial
  // statements resolution treated as authoritative, only on quote/OHLCV.
  const identity = getRequestIdentity();
  const order = resolveFamilyProviderOrder("statements", eligible.map((p) => p.id), {
    globalStackOrder: identity?.providerStackOrder,
    pins: identity?.dataStackPins,
    symbol,
  });
  const byId = new Map(eligible.map((p) => [p.id, p]));
  const providers = order.map((id) => byId.get(id)!).filter(Boolean);

  return resolveCapabilityConcurrently({
    capability: "financial_statements",
    entity: symbol.toUpperCase(),
    providers: providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      fetch: () => provider.getReports(symbol, reportType, period),
    })),
    concurrency: 3,
    isEmpty: (reports) => reports.length === 0,
    diff: diffReports,
  });
}

// ── Point-in-time persistence ───────────────────────────────────────────
// Reuses the existing datasetSnapshots table (pointInTimeDatasetStore.ts's
// "financial_statements" dataClass already captures the single-winner
// payload; this is a sibling dataClass for the broker's N-way resolution,
// same content-hash dedup + parentSnapshotId revision chain mechanism).
import crypto from "crypto";
import { and, desc, eq, lte } from "drizzle-orm";
import { datasetSnapshots } from "@shared/schema";
import {
  financialStatementsConflictPayloadSchema,
  pointInTimeFinancialStatementsConflictSnapshotSchema,
  type FinancialStatementsConflictQuality,
  type PointInTimeFinancialStatementsConflictSnapshot,
} from "@shared/pointInTimeData";
import { getDb } from "./db";
import { stableSnapshotHash } from "./pointInTimeDatasetStore";

function rowToConflictSnapshot(row: typeof datasetSnapshots.$inferSelect): PointInTimeFinancialStatementsConflictSnapshot {
  return pointInTimeFinancialStatementsConflictSnapshotSchema.parse({
    ...row,
    effectiveAt: row.effectiveAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    retrievedAt: row.retrievedAt.toISOString(),
    availableAt: row.availableAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  });
}

export async function persistFinancialStatementsConflictResolution(
  resolution: CapabilityResolution<LseFinancialReport[]>,
  reportType: string,
  period: string,
  createdByUserId: number,
): Promise<{ snapshot: PointInTimeFinancialStatementsConflictSnapshot; created: boolean }> {
  const upper = resolution.entity.toUpperCase();
  const retrievedAt = new Date();

  const payload = financialStatementsConflictPayloadSchema.parse({
    symbol: upper,
    reportType,
    period,
    authoritativeProviderId: resolution.authoritative?.providerId ?? null,
    authoritativeReason: resolution.authoritativeReason,
    observationProviderIds: resolution.observations.map((o) => o.providerId),
    attemptedProviders: resolution.attemptedProviders,
    failedProviders: resolution.failures.map((f) => f.providerId),
    conflicts: resolution.conflicts,
  });
  const warnings: string[] = [];
  if (resolution.observations.length === 0) warnings.push("No provider returned data for this symbol/reportType/period.");
  if (resolution.failures.length > 0) warnings.push(`${resolution.failures.length} provider(s) failed rather than cleanly reporting no data.`);
  const quality: FinancialStatementsConflictQuality = {
    score: resolution.observations.length === 0 ? 0 : Math.max(0, 1 - resolution.conflicts.length / (resolution.observations.length * 10)),
    providersAttempted: resolution.attemptedProviders.length,
    providersAnswered: resolution.observations.length,
    providersFailed: resolution.failures.length,
    conflictCount: resolution.conflicts.length,
    warnings,
  };

  const datasetKey = `financial_statements_conflicts:${upper}:${reportType}:${period}`;
  // resolvedAt is deliberately excluded from lineage: it's always a fresh
  // timestamp on every call, and including it in the content hash would
  // mean two calls that resolve to the exact same conflicts/authoritative
  // provider never dedup -- the row's own retrievedAt/availableAt columns
  // already record when this particular capture happened.
  const lineage = { attemptedProviders: resolution.attemptedProviders, failures: resolution.failures };
  const contentHash = stableSnapshotHash({ payload, lineage });
  const db = getDb();
  const [existing] = await db.select().from(datasetSnapshots).where(and(eq(datasetSnapshots.datasetKey, datasetKey), eq(datasetSnapshots.contentHash, contentHash))).limit(1);
  if (existing) return { snapshot: rowToConflictSnapshot(existing), created: false };
  const [parent] = await db.select().from(datasetSnapshots).where(eq(datasetSnapshots.datasetKey, datasetKey)).orderBy(desc(datasetSnapshots.createdAt)).limit(1);
  const [created] = await db.insert(datasetSnapshots).values({
    id: crypto.randomUUID(), datasetKey, entityKey: upper, dataClass: "financial_statements_conflicts", schemaVersion: "1.0.0",
    source: "financial_statements_broker", provider: resolution.authoritative?.providerId ?? "none", frequency: period === "FY" ? "annual" : "quarterly",
    currency: null, timezone: "UTC", observationStart: null, observationEnd: null,
    effectiveAt: null, publishedAt: null, retrievedAt, availableAt: retrievedAt,
    contentHash, parentSnapshotId: parent?.id ?? null, quality, lineage, payload, createdByUserId,
  }).returning();
  return { snapshot: rowToConflictSnapshot(created), created: true };
}

export async function captureFinancialStatementsConflictSnapshot(
  symbol: string,
  reportType: string,
  period: string,
  createdByUserId: number,
  selectedProviderIds?: string[],
): Promise<{ snapshot: PointInTimeFinancialStatementsConflictSnapshot; created: boolean }> {
  const resolution = await resolveFinancialStatements(symbol.trim().toUpperCase(), reportType, period, selectedProviderIds);
  return persistFinancialStatementsConflictResolution(resolution, reportType, period, createdByUserId);
}

export async function getFinancialStatementsConflictSnapshot(id: string): Promise<PointInTimeFinancialStatementsConflictSnapshot | null> {
  const [row] = await getDb().select().from(datasetSnapshots).where(and(eq(datasetSnapshots.id, id), eq(datasetSnapshots.dataClass, "financial_statements_conflicts"))).limit(1);
  return row ? rowToConflictSnapshot(row) : null;
}

export async function listFinancialStatementsConflictSnapshots(symbol: string, limit = 50): Promise<PointInTimeFinancialStatementsConflictSnapshot[]> {
  const rows = await getDb().select().from(datasetSnapshots)
    .where(and(eq(datasetSnapshots.entityKey, symbol.toUpperCase()), eq(datasetSnapshots.dataClass, "financial_statements_conflicts")))
    .orderBy(desc(datasetSnapshots.createdAt)).limit(limit);
  return rows.map(rowToConflictSnapshot);
}

export async function getFinancialStatementsConflictSnapshotAsOf(symbol: string, reportType: string, period: string, asOf: Date): Promise<PointInTimeFinancialStatementsConflictSnapshot | null> {
  const datasetKey = `financial_statements_conflicts:${symbol.toUpperCase()}:${reportType}:${period}`;
  const [row] = await getDb().select().from(datasetSnapshots)
    .where(and(eq(datasetSnapshots.datasetKey, datasetKey), lte(datasetSnapshots.availableAt, asOf)))
    .orderBy(desc(datasetSnapshots.availableAt), desc(datasetSnapshots.createdAt)).limit(1);
  return row ? rowToConflictSnapshot(row) : null;
}
