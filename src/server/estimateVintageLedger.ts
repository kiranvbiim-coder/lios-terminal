import type { AlternativePayload } from "@shared/pointInTimeAlternativeData";
import type { FinancialMetricStatus } from "@shared/financialMetricRegistry";

/** An existing point-in-time estimate row, with optional richer provider metadata. */
export type ProviderEstimateRow = Extract<AlternativePayload, { symbol: string; observations: unknown[] }>["observations"][number] & {
  provider?: string;
  sourceReference?: string | null;
  retrievedAt?: string;
  vintageAt?: string;
  status?: EstimateStatus;
};

/** Existing estimateActual rows plus optional definition/provenance fields. */
export type ProviderEstimateActual = Extract<AlternativePayload, { symbol: string; actuals: unknown[] }>["actuals"][number] & {
  unit?: string;
  currency?: string | null;
  sourceReference?: string | null;
  status?: FinancialMetricStatus;
};

export type EstimateStatus = Extract<FinancialMetricStatus, "live" | "filed" | "estimate" | "derived" | "manual" | "imported" | "stale"> | "cached" | "synthetic";
export type RevisionDirection = "up" | "down" | "unchanged";

export interface EstimateVintageObservation {
  contributor: string;
  provider: string;
  symbol: string;
  metric: string;
  fiscalPeriod: string;
  estimateValue: number;
  low: number | null;
  high: number | null;
  currency: string | null;
  unit: string;
  publishedAt: string;
  retrievedAt: string;
  vintageAt: string;
  sourceReference: string;
  status: EstimateStatus;
  revisionDelta: number | null;
  revisionPct: number | null;
  revisionDirection: RevisionDirection | null;
}

export interface EstimateDefinitionKey {
  symbol: string;
  metric: string;
  fiscalPeriod: string;
  unit: string;
  currency: string | null;
}

export interface EstimateDispersion {
  mean: number;
  median: number;
  low: number;
  high: number;
  standardDeviation: number;
  dispersionPct: number | null;
  contributorCount: number;
}

export interface EstimateActualMatch {
  actualValue: number;
  reportedAt: string;
  availableAt: string;
  sourceReference: string | null;
  status: FinancialMetricStatus;
  consensusEstimate: number | null;
  surprise: number | null;
  surprisePct: number | null;
}

export interface EstimateInternalDivergence {
  internalEstimateValue: number;
  estimateValue: number;
  difference: number;
  differencePct: number | null;
  sourceReference: string | null;
  status: EstimateStatus;
}

export interface ContributorAccuracy {
  contributor: string;
  provider: string;
  metric: string;
  fiscalPeriod: string;
  unit: string;
  currency: string | null;
  resolvedCount: number;
  meanError: number | null;
  meanAbsoluteError: number | null;
  meanAbsolutePercentageError: number | null;
  accuracyPct: number | null;
}

export interface EstimateVintageGroup {
  key: EstimateDefinitionKey;
  observations: EstimateVintageObservation[];
  latest: EstimateVintageObservation[];
  dispersion: EstimateDispersion | null;
  breadth: number | null;
  revisionMomentum: number | null;
  actual: EstimateActualMatch | null;
  internalDivergence: EstimateInternalDivergence | null;
  /** Percentage form of estimate-vs-internal divergence; retained as a flat field for panel consumers. */
  estimateVsInternalDivergence: number | null;
  contributorAccuracy: ContributorAccuracy[];
}

export interface EstimateVintageRejection {
  index: number;
  reason: string;
}

export interface EstimateVintageLedger {
  groups: EstimateVintageGroup[];
  rejected: EstimateVintageRejection[];
}

export interface EstimateInternalInput {
  symbol?: string;
  metric: string;
  fiscalPeriod: string;
  value: number;
  unit: string;
  currency: string | null;
  asOf?: string;
  sourceReference?: string | null;
  status?: EstimateStatus;
}

export interface EstimateVintageLedgerOptions {
  actuals?: readonly ProviderEstimateActual[];
  internalEstimates?: readonly EstimateInternalInput[];
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/;
const FISCAL_PERIOD = /^(?:FY\d{4}(?:Q[1-4]|H[1-2])?|\d{4}(?:Q[1-4]|H[1-2])?|Q[1-4]FY\d{4}|CURRENT)$/i;
const SAFE_REFERENCE = /(?:api[_-]?key|apikey|token|secret|password|authorization)\s*=/i;

function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be a valid ISO timestamp.`);
  }
  const datePart = value.slice(0, 10);
  const [year, month, day] = datePart.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error(`${field} must contain a valid calendar date.`);
  }
  return new Date(value).toISOString();
}

function dateOnly(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must be an ISO date.`);
  const [year, month, day] = value.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw new Error(`${field} must be a valid calendar date.`);
  return value;
}

function fiscalPeriod(value: unknown): string {
  if (typeof value !== "string" || !FISCAL_PERIOD.test(value.trim())) throw new Error("fiscalPeriod must be a recognized fiscal period (for example FY2027 or FY2027Q1).");
  return value.trim().toUpperCase();
}

function currency(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value.trim())) throw new Error("currency must be a three-letter ISO currency code or null.");
  return value.trim().toUpperCase();
}

function reference(value: unknown, field = "sourceReference"): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 2_000 || SAFE_REFERENCE.test(value)) throw new Error(`${field} must be a non-empty credential-safe source reference.`);
  return value.trim();
}

function status(value: unknown): EstimateStatus {
  const selected = value ?? "estimate";
  if (!["live", "filed", "estimate", "derived", "manual", "imported", "stale", "cached", "synthetic"].includes(String(selected))) throw new Error("status is not a recognized data status.");
  return selected as EstimateStatus;
}

function definitionKey(row: Pick<EstimateVintageObservation, "symbol" | "metric" | "fiscalPeriod" | "unit" | "currency">): string {
  return [row.symbol, row.metric, row.fiscalPeriod, row.unit, row.currency ?? ""].join("\u001f");
}

function sameDefinition(left: EstimateVintageObservation, right: EstimateVintageObservation): boolean {
  return definitionKey(left) === definitionKey(right);
}

function percentage(value: number, base: number): number | null {
  return base === 0 ? null : round((value / Math.abs(base)) * 100);
}

/** Normalize one existing provider row into a source-bound vintage observation. */
export function normalizeEstimateVintageRow(row: ProviderEstimateRow): EstimateVintageObservation {
  if (!row || typeof row !== "object") throw new Error("Estimate row is required.");
  const symbol = typeof row.symbol === "string" && row.symbol.trim() ? row.symbol.trim().toUpperCase() : (() => { throw new Error("symbol is required."); })();
  const metric = typeof row.metric === "string" && row.metric.trim() ? row.metric.trim().toLowerCase() : (() => { throw new Error("metric is required."); })();
  const period = fiscalPeriod(row.fiscalPeriod);
  if (!finite(row.value)) throw new Error("estimate value must be a finite number.");
  const low = row.low === null || row.low === undefined ? null : (finite(row.low) ? row.low : (() => { throw new Error("low must be a finite number or null."); })());
  const high = row.high === null || row.high === undefined ? null : (finite(row.high) ? row.high : (() => { throw new Error("high must be a finite number or null."); })());
  if (low !== null && high !== null && low > high) throw new Error("low must not exceed high.");
  const unit = typeof row.unit === "string" && row.unit.trim() ? row.unit.trim().toLowerCase() : (() => { throw new Error("unit is required."); })();
  const normalizedCurrency = currency(row.currency);
  const publishedAt = timestamp(row.publishedAt, "publishedAt");
  const retrievedAt = timestamp(row.retrievedAt ?? row.availableAt, "retrievedAt");
  const vintageAt = timestamp(row.vintageAt ?? row.availableAt, "vintageAt");
  if (publishedAt > retrievedAt) throw new Error("publishedAt must not be after retrievedAt.");
  if (vintageAt < publishedAt) throw new Error("vintageAt must not be before publishedAt.");
  const sourceReference = reference(row.sourceReference ?? row.sourceUrl);
  const contributor = typeof row.contributor === "string" && row.contributor.trim() ? row.contributor.trim() : (() => { throw new Error("contributor is required."); })();
  const provider = typeof row.provider === "string" && row.provider.trim() ? row.provider.trim() : contributor;
  return {
    contributor, provider, symbol, metric, fiscalPeriod: period, estimateValue: row.value,
    low, high, currency: normalizedCurrency, unit, publishedAt, retrievedAt, vintageAt,
    sourceReference, status: status(row.status), revisionDelta: null, revisionPct: null, revisionDirection: null,
  };
}

function revisionForObservation(previous: number | null, current: number): Pick<EstimateVintageObservation, "revisionDelta" | "revisionPct" | "revisionDirection"> {
  if (previous === null) return { revisionDelta: null, revisionPct: null, revisionDirection: null };
  const delta = round(current - previous);
  return { revisionDelta: delta, revisionPct: percentage(delta, previous), revisionDirection: delta > 0 ? "up" : delta < 0 ? "down" : "unchanged" };
}

/** Calculate a revision against a prior estimate. Zero prior values have no percentage revision. */
export function calculateEstimateRevision(previousValue: number | null, currentValue: number): { delta: number | null; percentage: number | null; direction: RevisionDirection | null } {
  const result = revisionForObservation(previousValue, currentValue);
  return { delta: result.revisionDelta, percentage: result.revisionPct, direction: result.revisionDirection };
}

/** Actual minus estimate; percentage surprise is null when the estimate is zero. */
export function calculateEstimateSurprise(actualValue: number, estimateValue: number): { surprise: number; surprisePct: number | null } {
  if (!finite(actualValue) || !finite(estimateValue)) throw new Error("Actual and estimate values must be finite numbers.");
  const surprise = round(actualValue - estimateValue);
  return { surprise, surprisePct: percentage(surprise, estimateValue) };
}

/** Population dispersion for the supplied estimates. */
export function calculateEstimateDispersion(values: readonly number[]): EstimateDispersion {
  if (!values.length) throw new Error("At least one estimate is required.");
  if (values.some((value) => !finite(value))) throw new Error("Estimate values must be finite numbers.");
  const sorted = [...values].sort((left, right) => left - right);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;
  return { mean: round(mean), median: round(median), low: sorted[0], high: sorted.at(-1)!, standardDeviation: round(Math.sqrt(variance)), dispersionPct: percentage(sorted.at(-1)! - sorted[0], median), contributorCount: sorted.length };
}

function sortObservations(rows: EstimateVintageObservation[]): EstimateVintageObservation[] {
  return [...rows].sort((left, right) => left.vintageAt.localeCompare(right.vintageAt) || left.retrievedAt.localeCompare(right.retrievedAt) || left.provider.localeCompare(right.provider) || left.contributor.localeCompare(right.contributor) || left.sourceReference.localeCompare(right.sourceReference) || left.estimateValue - right.estimateValue);
}

function latestByContributor(rows: EstimateVintageObservation[]): EstimateVintageObservation[] {
  const latest = new Map<string, EstimateVintageObservation>();
  for (const row of sortObservations(rows)) latest.set(`${row.provider}\u001f${row.contributor}`, row);
  return [...latest.values()].sort((left, right) => `${left.provider}\u001f${left.contributor}`.localeCompare(`${right.provider}\u001f${right.contributor}`));
}

function applyRevisions(rows: EstimateVintageObservation[]): EstimateVintageObservation[] {
  const previous = new Map<string, { value: number; vintageAt: string }>();
  return sortObservations(rows).map((row) => {
    const contributorKey = `${row.provider}\u001f${row.contributor}`;
    const prior = previous.get(contributorKey);
    const revision = prior?.vintageAt === row.vintageAt ? { revisionDelta: null, revisionPct: null, revisionDirection: null } : revisionForObservation(prior?.value ?? null, row.estimateValue);
    previous.set(contributorKey, { value: row.estimateValue, vintageAt: row.vintageAt });
    return { ...row, revisionDelta: revision.revisionDelta, revisionPct: revision.revisionPct, revisionDirection: revision.revisionDirection };
  });
}

interface NormalizedEstimateActual {
  metric: string;
  fiscalPeriod: string;
  periodEnd: string | null;
  value: number;
  unit: string | null;
  currency: string | null;
  reportedAt: string;
  availableAt: string;
  sourceReference: string | null;
  status: FinancialMetricStatus;
}

interface NormalizedEstimateInternalInput {
  symbol?: string;
  metric: string;
  fiscalPeriod: string;
  value: number;
  unit: string;
  currency: string | null;
  asOf?: string;
  sourceReference?: string | null;
  status: EstimateStatus;
}

function normalizeActualStatus(value: unknown): FinancialMetricStatus {
  const selected = value ?? "filed";
  const valid = ["live", "filed", "estimate", "derived", "manual", "imported", "missing", "stale", "conflict", "not-applicable"];
  if (!valid.includes(String(selected))) throw new Error("actual status is not a recognized data status.");
  return selected as FinancialMetricStatus;
}

function normalizeActual(row: ProviderEstimateActual): NormalizedEstimateActual {
  if (!row || typeof row !== "object" || typeof row.metric !== "string" || !row.metric.trim()) throw new Error("actual metric is required.");
  if (!finite(row.value)) throw new Error("actual value must be a finite number.");
  const sourceReference = row.sourceReference == null ? null : reference(row.sourceReference, "actual sourceReference");
  const unit = row.unit == null ? null : (typeof row.unit === "string" && row.unit.trim() ? row.unit.trim().toLowerCase() : (() => { throw new Error("actual unit must be non-empty when supplied."); })());
  const reportedAt = timestamp(row.reportedAt, "reportedAt");
  const availableAt = timestamp(row.availableAt, "actual availableAt");
  if (availableAt < reportedAt) throw new Error("actual availableAt must not be before reportedAt.");
  return { metric: row.metric.trim().toLowerCase(), fiscalPeriod: fiscalPeriod(row.fiscalPeriod), value: row.value, periodEnd: dateOnly(row.periodEnd, "actual periodEnd"), unit, currency: currency(row.currency), reportedAt, availableAt, sourceReference, status: normalizeActualStatus(row.status) };
}

function actualForGroup(rows: EstimateVintageObservation[], actuals: readonly NormalizedEstimateActual[]): EstimateActualMatch | null {
  const candidates = actuals.filter((actual) => actual.metric === rows[0].metric && actual.fiscalPeriod === rows[0].fiscalPeriod && (actual.unit === null || actual.unit === rows[0].unit) && (actual.currency === null || actual.currency === rows[0].currency));
  const actual = [...candidates].sort((left, right) => left.reportedAt.localeCompare(right.reportedAt) || left.availableAt.localeCompare(right.availableAt)).at(-1);
  if (!actual) return null;
  const eligible = rows.filter((row) => row.vintageAt <= actual.reportedAt);
  const consensus = eligible.length ? calculateEstimateDispersion(latestByContributor(eligible).map((row) => row.estimateValue)).mean : null;
  const surprise = consensus === null ? { surprise: null, surprisePct: null } : calculateEstimateSurprise(actual.value, consensus);
  return { actualValue: actual.value, reportedAt: actual.reportedAt, availableAt: actual.availableAt, sourceReference: actual.sourceReference, status: actual.status, consensusEstimate: consensus, surprise: surprise.surprise, surprisePct: surprise.surprisePct };
}

function internalForGroup(group: EstimateVintageGroup, internals: readonly NormalizedEstimateInternalInput[]): EstimateInternalDivergence | null {
  const candidates = internals.filter((row) => (!row.symbol || row.symbol === group.key.symbol) && row.metric === group.key.metric && row.fiscalPeriod === group.key.fiscalPeriod && row.unit === group.key.unit && row.currency === group.key.currency);
  const internal = [...candidates].sort((left, right) => (left.asOf ?? "").localeCompare(right.asOf ?? "") || left.value - right.value).at(-1);
  if (!internal) return null;
  const estimateValue = group.dispersion?.mean ?? 0;
  const difference = round(estimateValue - internal.value);
  return { internalEstimateValue: internal.value, estimateValue, difference, differencePct: percentage(difference, internal.value), sourceReference: internal.sourceReference ?? null, status: internal.status };
}

function calculateAccuracy(rows: EstimateVintageObservation[], actuals: readonly NormalizedEstimateActual[]): ContributorAccuracy[] {
  const result: ContributorAccuracy[] = [];
  const contributors = new Map<string, EstimateVintageObservation[]>();
  for (const row of rows) { const key = `${row.provider}\u001f${row.contributor}`; contributors.set(key, [...(contributors.get(key) ?? []), row]); }
  for (const contributorRows of contributors.values()) {
    const first = contributorRows[0];
    const errors: number[] = [];
    const pctErrors: number[] = [];
    for (const actual of actuals.filter((candidate) => candidate.metric === first.metric && candidate.fiscalPeriod === first.fiscalPeriod && (candidate.unit === null || candidate.unit === first.unit) && (candidate.currency === null || candidate.currency === first.currency))) {
      const forecast = sortObservations(contributorRows.filter((row) => row.vintageAt <= actual.reportedAt)).at(-1);
      if (!forecast) continue;
      const error = round(forecast.estimateValue - actual.value);
      errors.push(error);
      if (actual.value !== 0) pctErrors.push(Math.abs(error) / Math.abs(actual.value));
    }
    result.push({ contributor: first.contributor, provider: first.provider, metric: first.metric, fiscalPeriod: first.fiscalPeriod, unit: first.unit, currency: first.currency, resolvedCount: errors.length, meanError: errors.length ? round(errors.reduce((sum, value) => sum + value, 0) / errors.length) : null, meanAbsoluteError: errors.length ? round(errors.reduce((sum, value) => sum + Math.abs(value), 0) / errors.length) : null, meanAbsolutePercentageError: pctErrors.length ? round(pctErrors.reduce((sum, value) => sum + value, 0) / pctErrors.length * 100) : null, accuracyPct: pctErrors.length ? round(100 - pctErrors.reduce((sum, value) => sum + value, 0) / pctErrors.length * 100) : null });
  }
  return result.sort((left, right) => `${left.provider}\u001f${left.contributor}`.localeCompare(`${right.provider}\u001f${right.contributor}`));
}

function buildGroup(rows: EstimateVintageObservation[], actuals: readonly NormalizedEstimateActual[], internals: readonly NormalizedEstimateInternalInput[]): EstimateVintageGroup {
  const revised = applyRevisions(rows);
  const latest = latestByContributor(revised);
  const dispersion = latest.length ? calculateEstimateDispersion(latest.map((row) => row.estimateValue)) : null;
  const revisionRows = latest.filter((row) => row.revisionDirection !== null);
  const up = revisionRows.filter((row) => row.revisionDirection === "up").length;
  const down = revisionRows.filter((row) => row.revisionDirection === "down").length;
  const revisions = up + down;
  const revisionPcts = revisionRows.map((row) => row.revisionPct).filter((value): value is number => value !== null);
  const group: EstimateVintageGroup = { key: { symbol: rows[0].symbol, metric: rows[0].metric, fiscalPeriod: rows[0].fiscalPeriod, unit: rows[0].unit, currency: rows[0].currency }, observations: revised, latest, dispersion, breadth: revisions ? round((up - down) / revisions) : null, revisionMomentum: revisionPcts.length ? round(revisionPcts.reduce((sum, value) => sum + value, 0) / revisionPcts.length) : null, actual: actualForGroup(revised, actuals), internalDivergence: null, estimateVsInternalDivergence: null, contributorAccuracy: calculateAccuracy(revised, actuals) };
  group.internalDivergence = internalForGroup(group, internals);
  group.estimateVsInternalDivergence = group.internalDivergence?.differencePct ?? null;
  return group;
}

function normalizeInternalEstimate(row: EstimateInternalInput): NormalizedEstimateInternalInput {
  if (!row || typeof row !== "object" || typeof row.metric !== "string" || !row.metric.trim()) throw new Error("Internal estimate metric is required.");
  if (!finite(row.value)) throw new Error("Internal estimate value must be a finite number.");
  if (typeof row.unit !== "string" || !row.unit.trim()) throw new Error("Internal estimate unit is required.");
  if (row.asOf) timestamp(row.asOf, "internal asOf");
  const sourceReference = row.sourceReference == null ? null : reference(row.sourceReference, "internal sourceReference");
  return { symbol: row.symbol?.trim().toUpperCase(), metric: row.metric.trim().toLowerCase(), fiscalPeriod: fiscalPeriod(row.fiscalPeriod), value: row.value, unit: row.unit.trim().toLowerCase(), currency: currency(row.currency), asOf: row.asOf ? timestamp(row.asOf, "internal asOf") : undefined, sourceReference, status: status(row.status ?? "derived") };
}

/** Merge only rows with identical symbol, metric, fiscal period, unit and currency. */
export function mergeEstimateVintageRows(rows: readonly ProviderEstimateRow[]): EstimateVintageGroup {
  if (!rows.length) throw new Error("At least one estimate row is required.");
  const normalized = rows.map(normalizeEstimateVintageRow);
  if (normalized.some((row) => !sameDefinition(row, normalized[0]))) throw new Error("Incompatible estimate rows cannot be merged; metric, fiscal period, unit and currency must match.");
  return buildGroup(normalized, [], []);
}

/** Build deterministic estimate-vintage groups while retaining rejected malformed rows. */
export function buildEstimateVintageLedger(rows: readonly ProviderEstimateRow[], options: EstimateVintageLedgerOptions = {}): EstimateVintageLedger {
  const actuals = (options.actuals ?? []).map(normalizeActual);
  const internals = (options.internalEstimates ?? []).map(normalizeInternalEstimate);
  const rejected: EstimateVintageRejection[] = [];
  const groups = new Map<string, EstimateVintageObservation[]>();
  rows.forEach((raw, index) => {
    try {
      const row = normalizeEstimateVintageRow(raw);
      const key = definitionKey(row);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    } catch (error) {
      rejected.push({ index, reason: error instanceof Error ? error.message : "Invalid estimate row." });
    }
  });
  return { groups: [...groups.values()].sort((left, right) => definitionKey(left[0]).localeCompare(definitionKey(right[0]))).map((group) => buildGroup(group, actuals, internals)), rejected };
}
/** Short aliases retained as the small integration seam for consensus consumers. */
export const calculateRevision = calculateEstimateRevision;
export const calculateSurprise = calculateEstimateSurprise;
export const calculateDispersion = calculateEstimateDispersion;
export const buildEstimateVintageReport = buildEstimateVintageLedger;

/** Calculate contributor accuracy for resolved actuals without constructing a ledger. */
export function calculateContributorAccuracy(rows: readonly ProviderEstimateRow[], actuals: readonly ProviderEstimateActual[]): ContributorAccuracy[] {
  const normalizedRows = rows.map(normalizeEstimateVintageRow);
  return calculateAccuracy(normalizedRows, actuals.map(normalizeActual));
}
