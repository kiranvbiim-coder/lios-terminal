import { createHash } from "node:crypto";
import { getFundamentals, getOHLCV, type OHLCVBar } from "./marketData";
import { createFactorRiskSnapshotStore, type FactorRiskSnapshotStore } from "./factorRiskSnapshotStore";
import { getRequestIdentity } from "./requestContext";
import { buildFactorExposures, type SecurityRawInputs } from "../shared/factorExposureModel";
import { estimateFactorReturns, type FactorReturnEstimationResult, type PeriodReturns } from "../shared/factorReturnEstimation";
import { calculateFactorAttribution, type FactorAttributionResult, type FactorDefinition, type FactorScenario, type SecurityFactorExposure } from "../shared/factorAttribution";
import type { QuantInputSourceBinding } from "@shared/quantModelRegistry";
import { z } from "zod";
import { terminalExecutionTargetSchema } from "@shared/terminalArtifact";
import type { FactorAttributionInput } from "../shared/factorAttribution";


/** Bounded values accepted by marketData.getOHLCV for this calculation. */
export const FACTOR_RISK_RANGES = ["1Y", "2Y", "3Y", "5Y"] as const;
export type FactorRiskRange = (typeof FACTOR_RISK_RANGES)[number];

export interface FactorRiskCaptureRequest {
  symbols: readonly string[];
  benchmarkSymbol?: string;
  range?: FactorRiskRange | string;
  asOf?: string;
  /** Optional tenant identity; omitted requests are explicitly local-scoped. */
  organizationId?: number | null;
}

export interface NormalizedFactorRiskRequest {
  symbols: string[];
  benchmarkSymbol: string;
  range: FactorRiskRange;
  asOf: string;
  /** Included in the request hash to prevent cross-organization reuse. */
  scope: `organization:${number}` | "local";
}

export interface FactorRiskSourceMetadata {
  symbol: string;
  provider: string;
  status: string;
  source: string;
  asOf?: string;
  retrievedAt: string;
  bars?: number;
  fundamentalsAvailable?: boolean;
  /** Authoritative immutable upstream inputs, when a provider capture supplies them.
   * Summary provider labels/URLs alone are not source or licence evidence. */
  sourceBindings?: QuantInputSourceBinding[];
}

/** The original v1 content identity. Retrieval timestamps are deliberately not identity. */
export function factorRiskSnapshotContentHash(snapshot: Pick<FactorRiskSnapshot, "request" | "sources" | "factors" | "securities" | "estimation" | "excluded" | "limitations">): string {
  const withoutTimestamp = ({ retrievedAt: _retrievedAt, ...source }: FactorRiskSourceMetadata) => source;
  return hash({
    request: snapshot.request,
    sources: {
      benchmark: withoutTimestamp(snapshot.sources.benchmark),
      securities: Object.fromEntries(Object.entries(snapshot.sources.securities).map(([symbol, source]) => [symbol, withoutTimestamp(source)])),
    },
    factors: snapshot.factors, securities: snapshot.securities, estimation: snapshot.estimation,
    excluded: snapshot.excluded, limitations: snapshot.limitations,
  });
}

export interface FactorRiskSnapshot {
  snapshotId: string;
  contentHash: string;
  request: NormalizedFactorRiskRequest;
  capturedAt: string;
  retrievalStartedAt: string;
  retrievalCompletedAt: string;
  /** A newly captured snapshot always reports miss; the envelope reports hit/miss. */
  cache: "miss";
  sources: {
    benchmark: FactorRiskSourceMetadata;
    securities: Readonly<Record<string, FactorRiskSourceMetadata>>;
  };
  /** Alias consumed by API clients that call source lineage provenance. */
  provenance: {
    benchmark: FactorRiskSourceMetadata;
    securities: Readonly<Record<string, FactorRiskSourceMetadata>>;
  };
  factors: FactorDefinition[];
  securities: SecurityFactorExposure[];
  /** `estimation` is the public contract; estimator is retained as a readable alias. */
  estimation: FactorReturnEstimationResult;
  estimator: FactorReturnEstimationResult;
  excluded: Array<{ securityId: string; reason: string }>;
  limitations: string[];
}

export interface FactorRiskCaptureResult {
  snapshot: FactorRiskSnapshot;
  cache: "hit" | "miss";
}

export interface FactorRiskDecomposeInput {
  portfolioWeights: Readonly<Record<string, number>>;
  benchmarkWeights?: Readonly<Record<string, number>>;
  scenario?: FactorScenario;
}

export interface FactorRiskDecomposeResult {
  snapshotId: string;
  contentHash: string;
  provenance: FactorRiskSnapshot["sources"];
  factorReturnSelection: "arithmetic-average-of-estimated-period-returns";
  result: FactorAttributionResult;
}

export class FactorRiskValidationError extends Error {
  readonly statusCode = 400;
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Invalid factor-risk request: ${issues.join("; ")}`);
    this.name = "FactorRiskValidationError";
    this.issues = [...issues];
  }
}

export class FactorRiskSnapshotNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(snapshotId: string) {
    super(`Factor-risk snapshot ${snapshotId} is unavailable from the durable snapshot store.`);
    this.name = "FactorRiskSnapshotNotFoundError";
  }
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 32;
const MAX_CONCURRENT_PROVIDER_REQUESTS = 8;
const cache = new Map<string, { snapshot: FactorRiskSnapshot; expiresAt: number }>();
let snapshotStore: FactorRiskSnapshotStore = createFactorRiskSnapshotStore();

/** Replace the durable store for isolated tests or an embedded data directory. */
export function configureFactorRiskSnapshotStore(store: FactorRiskSnapshotStore): void {
  snapshotStore = store;
  cache.clear();
}

export function resetFactorRiskSnapshotStore(): void {
  snapshotStore = createFactorRiskSnapshotStore();
  cache.clear();
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function snapshotIsInRequestScope(snapshot: FactorRiskSnapshot): boolean {
  const identity = getRequestIdentity();
  const expectedScope = identity?.organizationId
    ? `organization:${identity.organizationId}`
    : "local";
  return snapshot.request.scope === expectedScope;
}

function normalizeRequest(request: FactorRiskCaptureRequest): NormalizedFactorRiskRequest {
  const issues: string[] = [];
  if (!Array.isArray(request?.symbols) || request.symbols.length < 1 || request.symbols.length > 100) issues.push("symbols must contain between 1 and 100 symbols");
  const symbols = Array.isArray(request?.symbols) ? request.symbols.map((symbol) => typeof symbol === "string" ? symbol.trim().toUpperCase() : "") : [];
  if (symbols.some((symbol) => !/^[A-Z0-9^._=-]{1,32}$/.test(symbol))) issues.push("symbols must be non-empty exchange symbols");
  if (new Set(symbols).size !== symbols.length) issues.push("symbols must not contain duplicates");
  const benchmarkSymbol = typeof request?.benchmarkSymbol === "string" && request.benchmarkSymbol.trim() ? request.benchmarkSymbol.trim().toUpperCase() : "^GSPC";
  if (!/^[A-Z0-9^._=-]{1,32}$/.test(benchmarkSymbol)) issues.push("benchmarkSymbol must be a non-empty exchange symbol");
  if (symbols.includes(benchmarkSymbol)) issues.push("benchmarkSymbol must not also be a universe symbol");
  const range = request?.range ?? "5Y";
  if (!(FACTOR_RISK_RANGES as readonly string[]).includes(range)) issues.push(`range must be one of ${FACTOR_RISK_RANGES.join(", ")}`);
  const asOf = request?.asOf ?? todayUtc();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`))) issues.push("asOf must be an ISO calendar date (YYYY-MM-DD)");
  const identity = getRequestIdentity();
  const organizationId = identity ? identity.organizationId : request?.organizationId;
  if (issues.length) throw new FactorRiskValidationError(issues);
  const scope = organizationId === undefined || organizationId === null ? "local" : `organization:${organizationId}` as const;
  return { symbols: [...new Set(symbols)].sort(), benchmarkSymbol, range: range as FactorRiskRange, asOf, scope };
}

function normalizedDate(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

interface MonthlyReturnPoint { periodEnd: string; value: number; }

/** Last valid trading close per calendar month, followed by month-over-month returns. */
function monthlyReturns(bars: readonly OHLCVBar[], asOf: string): MonthlyReturnPoint[] {
  const monthEnds = new Map<string, { date: string; close: number }>();
  for (const bar of bars) {
    const date = normalizedDate(bar.date);
    if (!date || date > asOf || !finite(bar.close) || bar.close <= 0) continue;
    const month = date.slice(0, 7);
    const current = monthEnds.get(month);
    if (!current || date > current.date) monthEnds.set(month, { date, close: bar.close });
  }
  const closes = [...monthEnds.values()].sort((left, right) => left.date.localeCompare(right.date));
  const returns: MonthlyReturnPoint[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    const value = closes[index].close / closes[index - 1].close - 1;
    if (finite(value)) returns.push({ periodEnd: closes[index].date, value });
  }
  return returns;
}

function dailyVolatilityAnnualized(bars: readonly OHLCVBar[], asOf: string): number | null {
  const closes = bars.map((bar) => ({ date: normalizedDate(bar.date), close: bar.close })).filter((bar): bar is { date: string; close: number } => bar.date !== null && bar.date <= asOf && finite(bar.close) && bar.close > 0).sort((left, right) => left.date.localeCompare(right.date));
  const returns: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    const value = closes[index].close / closes[index - 1].close - 1;
    if (finite(value)) returns.push(value);
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  const volatility = Math.sqrt(variance) * Math.sqrt(252);
  return finite(volatility) ? volatility : null;
}

async function mapWithConcurrency<T, R>(items: readonly T[], worker: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => run()));
  return results;
}

function sourceMetadata(symbol: string, request: NormalizedFactorRiskRequest, retrievedAt: string, bars: number, fundamentalsAvailable?: boolean, status = "available", source = "marketData provider/cache"): FactorRiskSourceMetadata {
  return { symbol, provider: "marketData", status, source, asOf: request.asOf, retrievedAt, bars, fundamentalsAvailable };
}

function averageFactorReturns(factors: readonly FactorDefinition[], estimation: FactorReturnEstimationResult): Record<string, number> {
  const sums = Object.fromEntries(factors.map((factor) => [factor.id, 0])) as Record<string, number>;
  if (!estimation.factorReturnSeries.length) return sums;
  for (const period of estimation.factorReturnSeries) for (const factor of factors) sums[factor.id] += period.returns[factor.id] ?? 0;
  for (const factor of factors) sums[factor.id] /= estimation.factorReturnSeries.length;
  return sums;
}

function ensureExactWeights(weights: Readonly<Record<string, number>>, securityIds: readonly string[], label: string): void {
  if (!weights || typeof weights !== "object" || Array.isArray(weights)) throw new FactorRiskValidationError([`${label} must be an object keyed by every snapshot security`]);
  const expected = new Set(securityIds);
  const issues = [
    ...Object.keys(weights).filter((id) => !expected.has(id)).map((id) => `${label} contains unknown security ${id}`),
    ...securityIds.filter((id) => !Object.prototype.hasOwnProperty.call(weights, id)).map((id) => `${label} is missing security ${id}`),
  ];
  for (const id of Object.keys(weights)) if (!finite(weights[id])) issues.push(`${label} ${id} must be finite`);
  if (issues.length) throw new FactorRiskValidationError(issues);
}

function cacheSnapshot(key: string, snapshot: FactorRiskSnapshot): Promise<void> {
  const expiresAt = Date.now() + CACHE_TTL_MS;
  cache.set(key, { snapshot: clone(snapshot), expiresAt });
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest) cache.delete(oldest); else break;
  }
  return snapshotStore.save(snapshot as unknown as Record<string, unknown>, key, expiresAt);
}
function cacheSnapshotWithoutPersistence(key: string, snapshot: FactorRiskSnapshot, expiresAt: number): void {
  cache.set(key, { snapshot: clone(snapshot), expiresAt });
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest) cache.delete(oldest); else break;
  }
}
export async function captureFactorRiskSnapshot(request: FactorRiskCaptureRequest): Promise<FactorRiskCaptureResult> {
  const normalized = normalizeRequest(request);
  const requestHash = hash(normalized);
  const cached = cache.get(requestHash);
  if (cached) {
    if (cached.expiresAt > Date.now()) return { snapshot: clone(cached.snapshot), cache: "hit" };
    cache.delete(requestHash);
  }
  const persisted = await snapshotStore.getByRequestKey(requestHash);
  if (persisted) {
    const snapshot = persisted.snapshot as unknown as FactorRiskSnapshot;
    cacheSnapshotWithoutPersistence(requestHash, snapshot, persisted.expiresAt);
    return { snapshot: clone(snapshot), cache: "hit" };
  }
  const retrievalStartedAt = new Date().toISOString();
  let benchmarkBars: OHLCVBar[];
  try {
    benchmarkBars = await getOHLCV(normalized.benchmarkSymbol, normalized.range, "1d");
  } catch (error) {
    throw new FactorRiskValidationError([`benchmark ${normalized.benchmarkSymbol} could not be retrieved: ${error instanceof Error ? error.message : "provider error"}`]);
  }
  const benchmarkSource = sourceMetadata(normalized.benchmarkSymbol, normalized, new Date().toISOString(), benchmarkBars.length, undefined, benchmarkBars.length ? "available" : "unavailable");
  if (!benchmarkBars.length) throw new FactorRiskValidationError([`benchmark ${normalized.benchmarkSymbol} returned no OHLCV data; supply a benchmark symbol with available history`]);
  const benchmarkMonthly = monthlyReturns(benchmarkBars, normalized.asOf);
  if (benchmarkMonthly.length < 12) throw new FactorRiskValidationError([`benchmark ${normalized.benchmarkSymbol} has fewer than 12 monthly returns in the requested history`]);

  const fetched = await mapWithConcurrency(normalized.symbols, async (symbol) => {
    const retrievedAt = new Date().toISOString();
    try {
      const [bars, fundamentals] = await Promise.all([getOHLCV(symbol, normalized.range, "1d"), getFundamentals(symbol)]);
      const source = sourceMetadata(symbol, normalized, retrievedAt, bars.length, fundamentals !== null, bars.length ? "available" : "unavailable", fundamentals ? "marketData provider/cache" : "marketData provider/cache; fundamentals unavailable");
      if (!bars.length) return { symbol, source, raw: null as SecurityRawInputs | null, returns: [] as MonthlyReturnPoint[], reason: "OHLCV provider returned no history" };
      if (!fundamentals) return { symbol, source, raw: null, returns: [], reason: "fundamentals provider returned no data" };
      const sector = fundamentals.sector?.trim();
      if (!sector) return { symbol, source, raw: null, returns: [], reason: "fundamentals did not provide a sector classification" };
      const benchmarkPeriods = new Map(benchmarkMonthly.map((point) => [point.periodEnd.slice(0, 7), point.periodEnd]));
      const returns = monthlyReturns(bars, normalized.asOf)
        .filter((point) => benchmarkPeriods.has(point.periodEnd.slice(0, 7)))
        .map((point) => ({ ...point, periodEnd: benchmarkPeriods.get(point.periodEnd.slice(0, 7)) as string }));
      const latestClose = bars.map((bar) => ({ date: normalizedDate(bar.date), close: bar.close })).filter((bar): bar is { date: string; close: number } => bar.date !== null && bar.date <= normalized.asOf && finite(bar.close) && bar.close > 0).sort((left, right) => left.date.localeCompare(right.date)).at(-1)?.close ?? null;
      const raw: SecurityRawInputs = {
        securityId: symbol, sector, marketCap: fundamentals.marketCap, bookValue: fundamentals.bookValue, eps: fundamentals.trailingEps, price: latestClose,
        roe: fundamentals.returnOnEquity, roa: null, netMargin: fundamentals.profitMargins, monthlyReturns: returns.map((point) => point.value), dailyVolatilityAnnualized: dailyVolatilityAnnualized(bars, normalized.asOf),
      };
      return { symbol, source, raw, returns, reason: null as string | null };
    } catch (error) {
      return { symbol, source: sourceMetadata(symbol, normalized, retrievedAt, 0, false, "error", `marketData provider/cache error: ${error instanceof Error ? error.message : "provider error"}`), raw: null, returns: [] as MonthlyReturnPoint[], reason: `provider retrieval failed: ${error instanceof Error ? error.message : "provider error"}` };
    }
  }, MAX_CONCURRENT_PROVIDER_REQUESTS);

  const candidateItems = fetched.filter((item): item is typeof item & { raw: SecurityRawInputs } => item.raw !== null);
  const sharedMonths = new Set(benchmarkMonthly.map((point) => point.periodEnd.slice(0, 7)));
  for (const item of candidateItems) {
    const itemMonths = new Set(item.returns.map((point) => point.periodEnd.slice(0, 7)));
    for (const month of sharedMonths) if (!itemMonths.has(month)) sharedMonths.delete(month);
  }
  const benchmarkForModel = benchmarkMonthly.filter((point) => sharedMonths.has(point.periodEnd.slice(0, 7)));
  const rawInputs = candidateItems.map((item) => ({
    ...item.raw,
    monthlyReturns: item.returns.filter((point) => sharedMonths.has(point.periodEnd.slice(0, 7))).map((point) => point.value),
  }));
  const exposureResult = buildFactorExposures(rawInputs, benchmarkForModel.map((point) => point.value), normalized.asOf);
  const excluded = [...fetched.filter((item) => item.reason).map((item) => ({ securityId: item.symbol, reason: item.reason as string })), ...exposureResult.excluded];
  const includedIds = new Set(exposureResult.securities.map((security) => security.securityId));
  const periodsByEnd = new Map<string, Record<string, number>>();
  for (const item of fetched) {
    if (!includedIds.has(item.symbol)) continue;
    for (const point of item.returns) {
      if (!sharedMonths.has(point.periodEnd.slice(0, 7))) continue;
      let values = periodsByEnd.get(point.periodEnd);
      if (!values) { values = {}; periodsByEnd.set(point.periodEnd, values); }
      values[item.symbol] = point.value;
    }
  }
  const periods: PeriodReturns[] = [...periodsByEnd.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([periodEnd, securityReturns]) => ({ periodEnd, securityReturns }));
  const estimation = estimateFactorReturns(exposureResult.factors, exposureResult.securities, periods, 12);
  const retrievalCompletedAt = new Date().toISOString();
  const limitations = [
    "Static-exposure limitation: current/as-of fundamentals are applied to every historical period because point-in-time fundamentals are not available from all current providers.",
    "Benchmark limitation: benchmark returns use the requested symbol's available daily OHLCV history and are not a synthetic equal-weight benchmark; missing or short benchmark history is surfaced as an error.",
    "Monthly transformation limitation: each month's last observed trading close is used; non-trading month-end dates are not interpolated.",
    "Decomposition limitation: factor returns supplied to attribution are the arithmetic average of estimated monthly factor returns.",
    "Quality limitation: ROA is unavailable from the canonical marketData fundamentals contract and is omitted from the quality composite when unavailable.",
  ];
  const sources = { benchmark: benchmarkSource, securities: Object.fromEntries(fetched.map((item) => [item.symbol, item.source])) };
  const contentHash = factorRiskSnapshotContentHash({ request: normalized, sources, factors: exposureResult.factors, securities: exposureResult.securities, estimation, excluded, limitations });
  const snapshot: FactorRiskSnapshot = {
    snapshotId: `factor-risk-${contentHash.slice(0, 24)}`, contentHash, request: normalized, capturedAt: retrievalCompletedAt, retrievalStartedAt, retrievalCompletedAt, cache: "miss", sources,
    provenance: sources,
    factors: exposureResult.factors, securities: exposureResult.securities, estimation, estimator: estimation, excluded, limitations,
  };
  await cacheSnapshot(requestHash, snapshot);
  return { snapshot: clone(snapshot), cache: "miss" };
}

export async function getFactorRiskSnapshot(snapshotId: string): Promise<FactorRiskSnapshot | null> {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) { cache.delete(key); continue; }
    if (entry.snapshot.snapshotId === snapshotId) return snapshotIsInRequestScope(entry.snapshot) ? clone(entry.snapshot) : null;
  }
  const persisted = await snapshotStore.getBySnapshotId(snapshotId, now);
  if (!persisted) return null;
  const snapshot = persisted.snapshot as unknown as FactorRiskSnapshot;
  if (!snapshotIsInRequestScope(snapshot)) return null;
  cacheSnapshotWithoutPersistence(persisted.requestKey, snapshot, persisted.expiresAt);
  return clone(snapshot);
}

export async function decomposeFactorRiskSnapshot(snapshotId: string, input: FactorRiskDecomposeInput): Promise<FactorRiskDecomposeResult> {
  const snapshot = await getFactorRiskSnapshot(snapshotId);
  if (!snapshot) throw new FactorRiskSnapshotNotFoundError(snapshotId);
  const ids = snapshot.securities.map((security) => security.securityId);
  ensureExactWeights(input.portfolioWeights, ids, "portfolioWeights");
  if (input.benchmarkWeights) ensureExactWeights(input.benchmarkWeights, ids, "benchmarkWeights");
  const factorReturns = averageFactorReturns(snapshot.factors, snapshot.estimation);
  const result = calculateFactorAttribution({ factors: snapshot.factors, factorReturns, factorCovariance: snapshot.estimation.factorCovariance, securities: snapshot.securities, specificVariances: snapshot.estimation.specificVariances, portfolioWeights: input.portfolioWeights, benchmarkWeights: input.benchmarkWeights, scenario: input.scenario });
  return { snapshotId: snapshot.snapshotId, contentHash: snapshot.contentHash, provenance: snapshot.sources, factorReturnSelection: "arithmetic-average-of-estimated-period-returns", result };
}

export async function clearFactorRiskSnapshotCache(): Promise<void> {
  cache.clear();
  await snapshotStore.prune();
}
export const FACTOR_RISK_CACHE_TTL_MS = CACHE_TTL_MS;
const finiteNumber = z.number().finite();
const weightsSchema = z.record(z.string().min(1), finiteNumber);
const factorScenarioSchema = z.object({
  id: z.string().min(1).max(200).optional(),
  label: z.string().min(1).max(200).optional(),
  factorShocks: z.union([weightsSchema, z.array(finiteNumber)]),
  specificShocks: weightsSchema.optional(),
  provenance: z.object({
    source: z.string().min(1), asOf: z.string().min(1), units: z.string().min(1),
    status: z.string().optional(), period: z.string().optional(), currency: z.string().optional(),
    sourceRef: z.string().optional(), snapshotId: z.string().optional(),
  }).optional(),
}).strict();

export const factorRiskDecomposeRequestSchema = z.object({
  snapshotId: z.string().trim().min(1).max(256),
  portfolioWeights: weightsSchema,
  benchmarkWeights: weightsSchema.optional(),
  scenario: factorScenarioSchema.optional(),
  expectedSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  terminalArtifact: terminalExecutionTargetSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.terminalArtifact && !value.expectedSnapshotHash) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expectedSnapshotHash"], message: "Retained decomposition requires the selected immutable source hash." });
});
export type FactorRiskDecomposeRequest = z.infer<typeof factorRiskDecomposeRequestSchema>;

type EstimationShape = {
  factorReturnSeries?: readonly { periodEnd: string; returns: Readonly<Record<string, number>> }[];
  factorCovariance?: readonly (readonly number[])[];
  specificVariances?: Readonly<Record<string, number>>;
};

type SnapshotShape = {
  snapshotId?: string;
  contentHash?: string;
  request?: {
    symbols: readonly string[];
    benchmarkSymbol: string;
    range: string;
    asOf: string;
    scope?: string;
  };
  capturedAt?: string;
  factors?: readonly FactorDefinition[];
  securities?: readonly SecurityFactorExposure[];
  estimation?: EstimationShape;
  estimator?: EstimationShape;
  factorReturnSeries?: EstimationShape["factorReturnSeries"];
  factorCovariance?: EstimationShape["factorCovariance"];
  specificVariances?: EstimationShape["specificVariances"];
  provenance?: unknown;
  sources?: unknown;
  excluded?: Array<{ securityId: string; reason: string }>;
};
export function validateDecomposeWeights(
  weights: Readonly<Record<string, number>>,
  securityIds: readonly string[],
  fieldName: string,
): string | null {
  const expected = new Set(securityIds);
  const actual = Object.keys(weights);
  const unknown = actual.filter((id) => !expected.has(id));
  if (unknown.length) return `${fieldName} contains unknown security weight(s): ${unknown.join(", ")}.`;
  const missing = securityIds.filter((id) => !Object.prototype.hasOwnProperty.call(weights, id));
  if (missing.length) return `${fieldName} is missing security weight(s): ${missing.join(", ")}.`;
  return null;
}
export function buildFactorAttributionInput(snapshot: SnapshotShape, request: FactorRiskDecomposeRequest): FactorAttributionInput {
  const factors = snapshot.factors ?? [];
  const securities = snapshot.securities ?? [];
  const estimate = snapshot.estimation ?? snapshot.estimator ?? snapshot;
  const series = estimate.factorReturnSeries ?? [];
  if (!series.length) throw new Error("Snapshot contains no estimated factor-return period.");
  if (!estimate.factorCovariance) throw new Error("Snapshot contains no factor covariance.");
  // Arithmetic average of estimated periods is selected deliberately so the
  // decomposition is not driven by one noisy latest month; covariance and
  // specific variance remain estimated over the full retained history.
  const factorReturns = Object.fromEntries(factors.map((factor) => [
    factor.id,
    series.reduce((sum, period) => sum + (period.returns[factor.id] ?? 0), 0) / series.length,
  ]));
  return {
    factors,
    factorReturns,
    factorCovariance: estimate.factorCovariance,
    securities,
    portfolioWeights: request.portfolioWeights,
    ...(request.benchmarkWeights ? { benchmarkWeights: request.benchmarkWeights } : {}),
    ...(estimate.specificVariances ? { specificVariances: estimate.specificVariances } : {}),
    ...(request.scenario ? { scenario: request.scenario as FactorScenario } : {}),
  };
}
