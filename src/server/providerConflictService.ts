import { z } from "zod";
import { listFinancialStatementsConflictSnapshots } from "./financialStatementsBroker";
import { getFinancialStatementPeriodsForSymbol } from "./companyStore";
import { stableSnapshotHash } from "./pointInTimeDatasetStore";

export const providerConflictQuerySchema = z.object({
  symbol: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9.^_=-]+$/),
  metric: z.string().trim().min(1).max(100).regex(/^[A-Za-z][A-Za-z0-9_.-]*$/),
  period: z.string().trim().min(1).max(20).regex(/^(?:FY|Q|Q[1-4]|FY\d{4}|\d{4}[:/-](?:FY|Q|Q[1-4])|\d{4}(?:FY|Q[1-4]))$/i),
});

export type ProviderObservationStatus = "LIVE" | "CACHED" | "HISTORICAL" | "MANUAL";
export type ProviderConflictStatus = "agreement" | "disagreement" | "insufficient";

export interface ProviderConflictObservation {
  providerId: string;
  provider: string;
  source: string;
  value: unknown;
  /** Capture availability clock from the immutable conflict snapshot. */
  asOf: string;
  retrievedAt: string;
  /** Acquisition status is CACHED/MANUAL unless a durable store says otherwise. */
  status: ProviderObservationStatus;
  /** Historical period and acquisition status are intentionally separate clocks. */
  temporalStatus: "CURRENT" | "HISTORICAL";
  snapshotId: string;
  contentHash: string;
  observationHash: string;
}

export interface ProviderConflictGroup {
  symbol: string;
  metric: string;
  period: string;
  status: ProviderConflictStatus;
  unresolved: boolean;
  conflictHash: string;
  observations: ProviderConflictObservation[];
  evidence: Array<{ snapshotId: string; contentHash: string; retrievedAt: string; availableAt: string }>;
}

export interface ProviderConflictView {
  symbol: string;
  metric: string;
  requestedPeriod: string;
  groups: ProviderConflictGroup[];
  generatedAt: string;
  limitations: string[];
}

type ConflictValue = { providerId: string; value: unknown };
type ConflictEntry = { key: string; field: string; values: ConflictValue[] };
type ConflictSnapshot = {
  id: string;
  contentHash: string;
  retrievedAt: string;
  availableAt: string;
  createdAt: string;
  payload: {
    symbol: string;
    reportType: string;
    period: string;
    observationProviderIds: string[];
    conflicts: ConflictEntry[];
  };
};
type StatementRow = {
  reportType: string;
  periodEnd: string;
  fiscalYear: string;
  period: string;
  data: Record<string, number>;
  filingDate: string | null;
  source: string;
  fetchedAt: Date;
};

interface ParsedPeriod {
  year: string | null;
  period: string;
}

function parsePeriod(value: string): ParsedPeriod {
  const normalized = value.trim().toUpperCase().replace(/\//g, ":").replace(/-/g, ":");
  const fyYear = /^FY(\d{4})$/.exec(normalized);
  if (fyYear) return { year: fyYear[1], period: "FY" };
  const yearPeriod = /^(\d{4}):?(FY|Q[1-4]|Q)$/.exec(normalized);
  if (yearPeriod) return { year: yearPeriod[1], period: yearPeriod[2] === "Q" ? "Q" : yearPeriod[2] };
  return { year: null, period: normalized === "Q" ? "Q" : normalized };
}

function canonicalPeriod(fiscalYear: string, period: string): string {
  return `${fiscalYear}:${period.toUpperCase()}`;
}

function matchesRequestedPeriod(fiscalYear: string, period: string, requested: ParsedPeriod): boolean {
  const normalizedPeriod = period.toUpperCase();
  return normalizedPeriod === requested.period
    && (requested.year === null || fiscalYear === requested.year);
}

function sourceStatus(source: string): ProviderObservationStatus {
  return /(?:manual|pdf|upload)/i.test(source) ? "MANUAL" : "CACHED";
}

function temporalStatus(periodEndOrFiscalYear: string): "CURRENT" | "HISTORICAL" {
  const yearMatch = /^\d{4}$/.exec(periodEndOrFiscalYear);
  if (yearMatch) return Number(yearMatch[0]) < new Date().getUTCFullYear() ? "HISTORICAL" : "CURRENT";
  const timestamp = Date.parse(periodEndOrFiscalYear);
  return Number.isFinite(timestamp) && timestamp < Date.now() - 86_400_000 ? "HISTORICAL" : "CURRENT";
}

function snapshotMatches(snapshot: ConflictSnapshot, reportType: string, period: string): boolean {
  return snapshot.payload.reportType.toLowerCase() === reportType.toLowerCase()
    && snapshot.payload.period.toUpperCase() === period.toUpperCase();
}

function evidenceFor(
  snapshots: ConflictSnapshot[],
  symbol: string,
  reportType: string,
  period: string,
  providerId: string,
): ConflictSnapshot | null {
  return snapshots
    .filter((snapshot) => snapshot.payload.symbol.toUpperCase() === symbol && snapshotMatches(snapshot, reportType, period) && snapshot.payload.observationProviderIds.includes(providerId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

function valuesAgree(values: unknown[]): boolean {
  if (values.length < 2) return false;
  const first = JSON.stringify(values[0]);
  return values.every((value) => JSON.stringify(value) === first);
}

/**
 * Build a conflict view exclusively from durable provider observations and
 * immutable conflict captures. A provider row without a matching capture is
 * not emitted: fabricating a snapshot ID would make the result look more
 * reproducible than the stored evidence actually is.
 */
export function buildProviderConflictView(input: {
  symbol: string;
  metric: string;
  period: string;
  snapshots: ConflictSnapshot[];
  statementRows: StatementRow[];
  generatedAt?: string;
}): ProviderConflictView {
  const symbol = input.symbol.trim().toUpperCase();
  const metric = input.metric.trim();
  const requested = parsePeriod(input.period);
  const orderedSnapshots = [...input.snapshots].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const groups = new Map<string, { reportType: string; fiscalYear: string; period: string; observations: Map<string, ProviderConflictObservation>; evidence: Map<string, ConflictSnapshot> }>();

  const addObservation = (reportType: string, fiscalYear: string, period: string, providerId: string, value: unknown, snapshot: ConflictSnapshot, row?: StatementRow) => {
    const groupPeriod = canonicalPeriod(fiscalYear, period);
    const groupKey = `${reportType}:${groupPeriod}:${metric}`;
    const group = groups.get(groupKey) ?? { reportType, fiscalYear, period, observations: new Map(), evidence: new Map() };
    if (!row && group.observations.has(providerId)) return;
    const observationAsOf = row?.filingDate && !Number.isNaN(Date.parse(row.filingDate))
      ? new Date(row.filingDate).toISOString()
      : snapshot.availableAt;
    const retrievedAt = row?.fetchedAt?.toISOString?.() ?? snapshot.retrievedAt;
    const source = row?.source ?? providerId;
    group.observations.set(providerId, {
      providerId,
      provider: providerId,
      source,
      value,
      asOf: observationAsOf,
      retrievedAt,
      status: sourceStatus(source),
      temporalStatus: temporalStatus(row?.periodEnd ?? fiscalYear),
      snapshotId: snapshot.id,
      contentHash: snapshot.contentHash,
      observationHash: stableSnapshotHash({ symbol, reportType, fiscalYear, period, metric, providerId, value }),
    });
    group.evidence.set(snapshot.id, snapshot);
    groups.set(groupKey, group);
  };

  // Financial statement rows are the durable source observations. They carry
  // the exact provider value; the conflict snapshot supplies the immutable
  // capture ID and hash that make the row auditable.
  for (const row of input.statementRows) {
    if (!matchesRequestedPeriod(row.fiscalYear, row.period, requested)) continue;
    const value = row.data?.[metric];
    if (value === undefined || (typeof value === "number" && !Number.isFinite(value))) continue;
    const snapshot = evidenceFor(input.snapshots, symbol, row.reportType, row.period, row.source);
    if (!snapshot || row.fetchedAt.getTime() > Date.parse(snapshot.retrievedAt)) continue;
    addObservation(row.reportType, row.fiscalYear, row.period, row.source, value, snapshot, row);
  }

  // Conflict payloads retain every disagreeing provider value even when a
  // provider did not write a financial_statement_periods row. Include those
  // values so disagreement remains visible rather than being silently reduced
  // to the one persisted source.
  for (const snapshot of orderedSnapshots) {
    if (snapshot.payload.symbol.toUpperCase() !== symbol) continue;
    for (const conflict of snapshot.payload.conflicts) {
      const [reportType, fiscalYear, period] = conflict.key.split(":");
      if (!reportType || !fiscalYear || !period || conflict.field !== metric) continue;
      if (!matchesRequestedPeriod(fiscalYear, period, requested)) continue;
      for (const value of conflict.values) {
        addObservation(reportType, fiscalYear, period, value.providerId, value.value, snapshot);
      }
    }
  }

  const resultGroups = Array.from(groups.values()).sort((a, b) => `${a.fiscalYear}:${a.period}:${a.reportType}`.localeCompare(`${b.fiscalYear}:${b.period}:${b.reportType}`)).map((group) => {
    const observations = Array.from(group.observations.values()).sort((a, b) => a.providerId.localeCompare(b.providerId));
    const status: ProviderConflictStatus = observations.length < 2 ? "insufficient" : valuesAgree(observations.map((observation) => observation.value)) ? "agreement" : "disagreement";
    const evidence = Array.from(group.evidence.values()).sort((a, b) => a.id.localeCompare(b.id)).map((snapshot) => ({ snapshotId: snapshot.id, contentHash: snapshot.contentHash, retrievedAt: snapshot.retrievedAt, availableAt: snapshot.availableAt }));
    const conflictHash = stableSnapshotHash({ symbol, metric, period: canonicalPeriod(group.fiscalYear, group.period), observations: observations.map(({ providerId, value, snapshotId, contentHash }) => ({ providerId, value, snapshotId, contentHash })) });
    return { symbol, metric, period: canonicalPeriod(group.fiscalYear, group.period), status, unresolved: status === "disagreement", conflictHash, observations, evidence } satisfies ProviderConflictGroup;
  });

  return {
    symbol,
    metric,
    requestedPeriod: input.period.trim().toUpperCase(),
    groups: resultGroups,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    limitations: [
      "Only observations linked to an immutable financial-statements conflict capture are shown.",
      "Stored conflict captures do not expose a provider's live request state; persisted observations are labeled CACHED (or MANUAL where applicable), never guessed LIVE.",
      ...(resultGroups.length === 0 ? ["No permitted observation was available for this metric and period."] : []),
    ],
  };
}

export async function getProviderConflictView(input: { symbol: string; metric: string; period: string }): Promise<ProviderConflictView> {
  const symbol = input.symbol.trim().toUpperCase();
  const [snapshots, statementRows] = await Promise.all([
    listFinancialStatementsConflictSnapshots(symbol, 100),
    getFinancialStatementPeriodsForSymbol(symbol),
  ]);
  return buildProviderConflictView({ symbol, metric: input.metric, period: input.period, snapshots: snapshots as unknown as ConflictSnapshot[], statementRows: statementRows as unknown as StatementRow[] });
}
