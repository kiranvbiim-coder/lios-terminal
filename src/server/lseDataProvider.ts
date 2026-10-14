import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import WebSocket, { type RawData } from "ws";
import {
  adaptLegacySymbolCatalogRow,
  type InstrumentMasterCandidate,
} from "@shared/globalInstrumentMaster";
import type { InstrumentSearchFederatedFallback, InstrumentSearchOptions } from "@shared/instrumentSearchIndex";
import type {
  CanonicalDataRequest,
  ProviderEntitlementDecision,
  ProviderHealth,
  ProviderQuota,
  StreamingLifecycle,
} from "@shared/universalDataFabric";
import type {
  LiOSDataProviderAdapter,
  ProviderAdapterResult,
  ProviderSearchResult,
  ProviderStreamSubscription,
} from "./providerSdk";
import { ProviderRuntimeHub } from "./providerRuntimeHub";
import { buildStreamingLifecycle } from "./streamingCoordinator";
import { resolveCredential } from "./credentialVault";
import { isHostedProductionRuntime } from "./runtimeSecurity";
import { resolvePersistedInstrument } from "./globalInstrumentMasterStore";
import { mapOpenFigi, openFigiCredential } from "./openFigiConnector";
import { dataPath } from "./dataRoot";

export const LSE_DATA_UPSTREAM_COMMIT = "564c63dd99e3b447777cb396314ec6c4342f82ff";
export const LSE_VAULT_BASE = "https://api.londonstrategicedge.com/vault";
export const LSE_WS_URL = "wss://data-ws.londonstrategicedge.com";
export const LSE_PROVIDER_ID = "lse";
const LSE_CATALOG_TTL_MS = 5 * 60 * 1_000;
const LSE_HTTP_TIMEOUT_MS = 30_000;
const LSE_STREAM_PING_MS = 25_000;
const LSE_STREAM_RECONNECT_MS = 3_000;
const LSE_REPLAY_MAX_MS = 24 * 60 * 60 * 1_000;
const LSE_STREAM_BUFFER_MAX = 2_000;

export interface LseCatalogRow {
  dataset?: string | null;
  symbol?: string | null;
  name?: string | null;
  category?: string | null;
  exchange?: string | null;
  mic?: string | null;
  country?: string | null;
  currency?: string | null;
  ticks?: number | null;
  first?: string | null;
  first_tick?: string | null;
  last?: string | null;
  last_tick?: string | null;
  years?: number | null;
  [key: string]: unknown;
}

export interface LseStreamEvent {
  providerId: "lse";
  channel: string;
  type: "tick" | "replay_started" | "replay_complete" | "authenticated" | "error" | "disconnected";
  at: string;
  symbol?: string;
  data: unknown;
  replay?: boolean;
}

export interface LseDataProviderDependencies {
  fetchFn?: typeof fetch;
  credential?: string | null;
  now?: () => number;
}

class LseProviderError extends Error {
  readonly status: number;
  readonly quota: ProviderQuota | null;

  constructor(status: number, message: string, quota: ProviderQuota | null = null) {
    super(message);
    this.name = "LseProviderError";
    this.status = status;
    this.quota = quota;
  }
}

const catalogHub = new ProviderRuntimeHub<LseCatalogRow[]>({ maxEntries: 16 });
const streamHub = new ProviderRuntimeHub<LseStreamEvent>({ maxEntries: 16 });
const streamBuffers = new Map<string, LseStreamEvent[]>();

function lseCredential(dependencyCredential?: string | null): string | null {
  if (dependencyCredential !== undefined) return dependencyCredential;
  return resolveCredential("LSE_API_KEY", "lseApiKey");
}

function localOnlyReason(): string | null {
  return isHostedProductionRuntime()
    ? "London Strategic Edge BYOD execution is local-desktop only; central hosted redistribution is prohibited."
    : null;
}

function requestAsksRedistribution(request: CanonicalDataRequest): boolean {
  const parameters = request.parameters;
  return parameters.redistribute === true
    || parameters.redistribution === true
    || parameters.resell === true
    || parameters.serveThirdParty === true
    || parameters.centralCache === true;
}

export function lseEntitlementDecision(
  request: CanonicalDataRequest,
  credential: string | null = lseCredential(),
): ProviderEntitlementDecision {
  const hostedReason = localOnlyReason();
  if (hostedReason) {
    return {
      decision: "denied",
      policyId: "lse-local-byod-only",
      permittedUses: [],
      reasons: [hostedReason],
    };
  }
  if (!credential) {
    const explicitlyPinned = request.providerAllow.includes(LSE_PROVIDER_ID);
    return {
      decision: explicitlyPinned ? "denied" : "unknown",
      policyId: "lse-user-key-required",
      permittedUses: [],
      reasons: [explicitlyPinned
        ? "Connect a user-owned LSE API key in Connection Center before using the pinned LSE provider."
        : "LSE is optional and currently unconfigured; other providers remain eligible."],
    };
  }
  if (requestAsksRedistribution(request)) {
    return {
      decision: "denied",
      policyId: "lse-no-redistribution",
      permittedUses: ["internal_research", "own_trading", "model_training"],
      reasons: ["LSE-hosted data must not be redistributed, resold, centrally cached for unrelated users, or exposed as a competing feed."],
    };
  }
  return {
    decision: "allowed",
    policyId: "lse-user-key-local-use",
    permittedUses: ["internal_research", "own_trading", "model_training"],
    reasons: ["User-owned key; local Project/session use only. Upstream data rights remain separate from the MIT client-code license."],
  };
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectCandidates(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const root = payload as Record<string, unknown>;
  const nested = [root.usage, root.data, root.quota, root.limits]
    .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value)));
  return [root, ...nested];
}

function firstNumber(objects: Record<string, unknown>[], keys: string[]): number | null {
  for (const object of objects) {
    for (const key of keys) {
      const value = numberValue(object[key]);
      if (value !== null) return value;
    }
  }
  return null;
}

function firstString(objects: Record<string, unknown>[], keys: string[]): string | null {
  for (const object of objects) {
    for (const key of keys) {
      const value = stringValue(object[key]);
      if (value !== null) return value;
    }
  }
  return null;
}

export function parseLseUsageQuota(payload: unknown): ProviderQuota {
  const objects = objectCandidates(payload);
  const limit = firstNumber(objects, [
    "monthly_limit_bytes",
    "monthly_bytes_limit",
    "data_limit_bytes",
    "limit_bytes",
    "monthly_limit",
    "limit",
  ]);
  const used = firstNumber(objects, [
    "monthly_used_bytes",
    "used_bytes",
    "data_used_bytes",
    "monthly_used",
    "used",
  ]);
  const explicitRemaining = firstNumber(objects, [
    "monthly_remaining_bytes",
    "remaining_bytes",
    "data_remaining_bytes",
    "remaining",
  ]);
  const resetAt = firstString(objects, ["reset_at", "resetAt", "period_end", "renews_at", "renewsAt"]);
  return {
    limit: limit === null ? null : Math.floor(limit),
    remaining: explicitRemaining !== null
      ? Math.floor(explicitRemaining)
      : limit !== null && used !== null
        ? Math.max(0, Math.floor(limit - used))
        : null,
    resetAt: resetAt && Number.isFinite(Date.parse(resetAt)) ? new Date(resetAt).toISOString() : null,
    retryAfterMs: null,
    source: objects.length ? "provider_config" : "unknown",
  };
}

function quotaFromHeaders(headers: Headers): ProviderQuota | null {
  const readNumber = (name: string) => {
    const raw = headers.get(name);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
  };
  const limit = readNumber("x-ratelimit-limit") ?? readNumber("ratelimit-limit");
  const remaining = readNumber("x-ratelimit-remaining") ?? readNumber("ratelimit-remaining");
  const retryRaw = headers.get("retry-after");
  let retryAfterMs: number | null = null;
  if (retryRaw) {
    const seconds = Number(retryRaw);
    if (Number.isFinite(seconds) && seconds >= 0) retryAfterMs = Math.floor(seconds * 1_000);
    else {
      const retryAt = Date.parse(retryRaw);
      if (Number.isFinite(retryAt)) retryAfterMs = Math.max(0, retryAt - Date.now());
    }
  }
  if (limit === null && remaining === null && retryAfterMs === null) return null;
  return {
    limit,
    remaining,
    resetAt: retryAfterMs === null ? null : new Date(Date.now() + retryAfterMs).toISOString(),
    retryAfterMs,
    source: "response_headers",
  };
}

function queryUrl(route: string, params: Record<string, unknown> = {}): string {
  const url = new URL(LSE_VAULT_BASE + route);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function lseJsonRequest<T>(
  route: string,
  input: {
    method?: "GET" | "POST";
    params?: Record<string, unknown>;
    body?: unknown;
    credential: string;
    fetchFn?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<{ data: T; quota: ProviderQuota | null; retrievedAt: string; sourceRef: string }> {
  const fetchFn = input.fetchFn ?? fetch;
  const endpoint = queryUrl(route, input.params);
  const response = await fetchFn(endpoint, {
    method: input.method ?? (input.body === undefined ? "GET" : "POST"),
    headers: {
      "x-api-key": input.credential,
      "User-Agent": "LiOS-Terminal/1.0 (+https://limuriaintelligence.com)",
      ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    signal: AbortSignal.timeout(input.timeoutMs ?? LSE_HTTP_TIMEOUT_MS),
  });
  const payload = await readResponsePayload(response);
  const quota = quotaFromHeaders(response.headers);
  if (!response.ok) {
    const detail = typeof payload === "string"
      ? payload.slice(0, 500)
      : payload && typeof payload === "object"
        ? String((payload as Record<string, unknown>).detail ?? (payload as Record<string, unknown>).message ?? "request failed")
        : "request failed";
    throw new LseProviderError(response.status, "LSE returned HTTP " + response.status + ": " + detail, quota);
  }
  return {
    data: payload as T,
    quota,
    retrievedAt: new Date().toISOString(),
    sourceRef: endpoint,
  };
}

async function lseUsage(
  credential: string,
  fetchFn?: typeof fetch,
): Promise<{ payload: unknown; quota: ProviderQuota; sourceRef: string }> {
  const result = await lseJsonRequest<unknown>("/usage", { credential, fetchFn });
  const quota = parseLseUsageQuota(result.data);
  if (result.quota) {
    quota.limit = result.quota.limit ?? quota.limit;
    quota.remaining = result.quota.remaining ?? quota.remaining;
    quota.retryAfterMs = result.quota.retryAfterMs ?? quota.retryAfterMs;
    quota.resetAt = result.quota.resetAt ?? quota.resetAt;
    quota.source = result.quota.source;
  }
  return { payload: result.data, quota, sourceRef: result.sourceRef };
}

async function lseCatalog(
  credential: string,
  fetchFn?: typeof fetch,
): Promise<LseCatalogRow[]> {
  const credentialScope = crypto.createHash("sha256").update(credential).digest("hex").slice(0, 16);
  const key = "lse:catalog:" + credentialScope;
  return catalogHub.getOrFetch(key, LSE_CATALOG_TTL_MS, async () => {
    const result = await lseJsonRequest<unknown>("/catalog", { credential, fetchFn });
    if (!Array.isArray(result.data)) return [];
    return result.data.filter((row): row is LseCatalogRow => Boolean(row && typeof row === "object"));
  });
}

function rowSymbol(row: LseCatalogRow): string | null {
  return stringValue(row.symbol)?.toUpperCase() ?? null;
}

function rowName(row: LseCatalogRow): string {
  return stringValue(row.name) ?? rowSymbol(row) ?? "Unknown";
}

export function lseCatalogRowToCandidate(row: LseCatalogRow): (InstrumentMasterCandidate & { symbol: string }) | null {
  const symbol = rowSymbol(row);
  if (!symbol) return null;
  const base = adaptLegacySymbolCatalogRow({
    symbol,
    name: rowName(row),
    exchange: stringValue(row.exchange) ?? stringValue(row.mic) ?? null,
    provider: LSE_PROVIDER_ID,
    providerId: symbol,
  });
  const providerId = base.identifiers.some((item) => item.type === "provider_id" && item.provider === LSE_PROVIDER_ID)
    ? base.identifiers
    : [...base.identifiers, { type: "provider_id" as const, value: symbol, provider: LSE_PROVIDER_ID }];
  return {
    ...base,
    symbol,
    countryCode: stringValue(row.country),
    currency: stringValue(row.currency),
    identifiers: providerId,
    aliases: [
      ...(base.aliases ?? []),
      { value: symbol, kind: "ticker" as const, mic: stringValue(row.mic) },
    ],
    source: LSE_PROVIDER_ID,
    canonical: false,
  };
}

function matchCatalogRows(rows: LseCatalogRow[], queryText: string, limit = 20): LseCatalogRow[] {
  const query = queryText.trim().toUpperCase();
  if (!query) return [];
  const exact: LseCatalogRow[] = [];
  const prefix: LseCatalogRow[] = [];
  const contains: LseCatalogRow[] = [];
  for (const row of rows) {
    const symbol = rowSymbol(row) ?? "";
    const name = rowName(row).toUpperCase();
    const dataset = stringValue(row.dataset)?.toUpperCase() ?? "";
    if (symbol === query) exact.push(row);
    else if (symbol.startsWith(query) || name.startsWith(query)) prefix.push(row);
    else if (symbol.includes(query) || name.includes(query) || dataset.includes(query)) contains.push(row);
  }
  return [...exact, ...prefix, ...contains].slice(0, Math.max(1, Math.min(limit, 100)));
}

export async function searchLseCatalogCandidates(
  queryText: string,
  options: InstrumentSearchOptions = {},
  dependencies: LseDataProviderDependencies = {},
): Promise<InstrumentMasterCandidate[]> {
  if (localOnlyReason()) return [];
  const credential = lseCredential(dependencies.credential);
  if (!credential) return [];
  const rows = await lseCatalog(credential, dependencies.fetchFn);
  return matchCatalogRows(rows, queryText, options.limit ?? 20).flatMap((row) => {
    const candidate = lseCatalogRowToCandidate(row);
    return candidate ? [candidate] : [];
  });
}

export const lseFederatedInstrumentFallback: InstrumentSearchFederatedFallback = {
  async search(queryText, options) {
    try {
      return await searchLseCatalogCandidates(queryText, options);
    } catch {
      return [];
    }
  },
};

async function mappedCatalogResult(
  row: LseCatalogRow,
  openFigiCandidates: InstrumentMasterCandidate[] = [],
): Promise<Record<string, unknown>> {
  const providerCandidate = lseCatalogRowToCandidate(row);
  if (!providerCandidate) return { providerCandidate: null, canonicalMatch: null, resolutionStatus: "not_found", openFigiCandidates: [] };

  let resolutionStatus = "not_found";
  let canonicalMatch: InstrumentMasterCandidate | null = null;
  try {
    const providerSpecific = await resolvePersistedInstrument({
      providerId: { provider: LSE_PROVIDER_ID, value: providerCandidate.symbol },
    });
    const byTicker = providerSpecific.status === "resolved" && providerSpecific.match?.canonical
      ? providerSpecific
      : await resolvePersistedInstrument({ ticker: providerCandidate.symbol });
    resolutionStatus = byTicker.status;
    canonicalMatch = byTicker.status === "resolved" && byTicker.match?.canonical ? byTicker.match : null;
  } catch {
    resolutionStatus = "local_identity_unavailable";
  }

  const figiForSymbol = canonicalMatch
    ? []
    : openFigiCandidates.filter((candidate) => candidate.symbol?.toUpperCase() === providerCandidate.symbol.toUpperCase());

  return {
    providerCandidate,
    canonicalMatch,
    resolutionStatus: canonicalMatch ? "resolved" : resolutionStatus,
    openFigiCandidates: figiForSymbol,
    mapping: {
      provider: LSE_PROVIDER_ID,
      providerSymbol: providerCandidate.symbol,
      canonicalId: canonicalMatch?.listingId ?? canonicalMatch?.securityId ?? canonicalMatch?.entityId ?? null,
      canonical: Boolean(canonicalMatch),
      openFigiEnrichmentOnly: figiForSymbol.length > 0,
    },
  };
}

async function mappedCatalogResults(rows: LseCatalogRow[]): Promise<Record<string, unknown>[]> {
  let openFigiCandidates: InstrumentMasterCandidate[] = [];
  const figiKey = openFigiCredential();
  if (figiKey && rows.length) {
    try {
      const jobs = rows.flatMap((row) => {
        const symbol = rowSymbol(row);
        if (!symbol) return [];
        const exchange = stringValue(row.exchange);
        return [{
          idType: "TICKER",
          idValue: symbol,
          ...(exchange ? { exchCode: exchange } : {}),
        }];
      });
      if (jobs.length) openFigiCandidates = (await mapOpenFigi(jobs, { credential: figiKey })).candidates;
    } catch {
      openFigiCandidates = [];
    }
  }
  return Promise.all(rows.map((row) => mappedCatalogResult(row, openFigiCandidates)));
}

function boundedLimit(request: CanonicalDataRequest, fallback = 5000): number {
  const raw = numberValue(request.parameters.limit);
  return Math.max(1, Math.min(raw === null ? fallback : Math.floor(raw), 5000));
}

function requestDateParameter(request: CanonicalDataRequest, key: "start" | "end"): string | null {
  const value = stringValue(request.parameters[key]);
  if (!value) return null;
  if (!Number.isFinite(Date.parse(value))) throw new LseProviderError(400, "Invalid " + key + " timestamp.");
  return value;
}

function result(
  data: unknown,
  sourceRefs: string[],
  input: { quota?: ProviderQuota | null; availableAt?: string | null; warnings?: string[] } = {},
): ProviderAdapterResult {
  return {
    providerId: LSE_PROVIDER_ID,
    data,
    sourceRefs,
    availableAt: input.availableAt ?? new Date().toISOString(),
    quota: input.quota ?? null,
    entitlement: {
      decision: "allowed",
      policyId: "lse-user-key-local-use",
      permittedUses: ["internal_research", "own_trading", "model_training"],
      reasons: ["User-owned key; local use only; no redistribution."],
    },
    normalized: true,
    warnings: input.warnings ?? [],
  };
}

async function fetchPrices(
  request: CanonicalDataRequest,
  credential: string,
  fetchFn?: typeof fetch,
): Promise<ProviderAdapterResult | null> {
  const symbol = request.entity.symbol?.trim() || request.entity.ref.trim();
  if (!symbol) return null;
  const response = await lseJsonRequest<unknown[]>("/candles", {
    credential,
    fetchFn,
    params: {
      symbol,
      timeframe: stringValue(request.parameters.timeframe) ?? "1d",
      order: stringValue(request.parameters.order) ?? "asc",
      limit: boundedLimit(request),
      dataset: stringValue(request.parameters.dataset),
      start: requestDateParameter(request, "start"),
      end: requestDateParameter(request, "end"),
    },
  });
  const rows = Array.isArray(response.data) ? response.data : [];
  if (!rows.length) return null;
  const normalizedRows = rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const record = { ...(row as Record<string, unknown>) };
    if (record.timestamp === undefined && record.ts !== undefined) record.timestamp = record.ts;
    if (record.volume === undefined) record.volume = 0;
    return record;
  });
  return result({
    kind: "ohlcv_series",
    symbol: symbol.toUpperCase(),
    timeframe: stringValue(request.parameters.timeframe) ?? "1d",
    rows: normalizedRows,
  }, [response.sourceRef], { quota: response.quota, availableAt: response.retrievedAt });
}

async function fetchStatements(
  request: CanonicalDataRequest,
  credential: string,
  fetchFn?: typeof fetch,
): Promise<ProviderAdapterResult | null> {
  const symbol = request.entity.symbol?.trim() || request.entity.ref.trim();
  if (!symbol) return null;
  const response = await lseJsonRequest<unknown[]>("/ref/financial_reports", {
    credential,
    fetchFn,
    params: {
      symbol,
      report_type: stringValue(request.parameters.reportType),
      period: stringValue(request.parameters.period),
      start: requestDateParameter(request, "start"),
      end: requestDateParameter(request, "end"),
      order: stringValue(request.parameters.order) ?? "desc",
      limit: boundedLimit(request),
    },
  });
  const rows = Array.isArray(response.data) ? response.data : [];
  if (!rows.length) return null;
  return result({ kind: "financial_statements", symbol: symbol.toUpperCase(), reports: rows }, [response.sourceRef], {
    quota: response.quota,
    availableAt: response.retrievedAt,
  });
}

async function fetchSeries(
  request: CanonicalDataRequest,
  credential: string,
  dataset: string | null,
  fetchFn?: typeof fetch,
): Promise<ProviderAdapterResult | null> {
  const symbol = request.entity.symbol?.trim() || request.entity.ref.trim();
  if (!symbol) return null;
  const response = await lseJsonRequest<unknown[]>("/series", {
    credential,
    fetchFn,
    params: {
      symbol,
      dataset,
      start: requestDateParameter(request, "start"),
      end: requestDateParameter(request, "end"),
      order: stringValue(request.parameters.order) ?? "asc",
      limit: boundedLimit(request),
    },
  });
  const rows = Array.isArray(response.data) ? response.data : [];
  if (!rows.length) return null;
  return result({
    kind: request.capability === "curves" ? "yield_series" : "economic_series",
    symbol: symbol.toUpperCase(),
    observations: rows,
  }, [response.sourceRef], { quota: response.quota, availableAt: response.retrievedAt });
}

async function fetchOptions(
  request: CanonicalDataRequest,
  credential: string,
  fetchFn?: typeof fetch,
): Promise<ProviderAdapterResult | null> {
  const underlying = request.entity.symbol?.trim() || request.entity.ref.trim();
  if (!underlying) return null;
  const operation = stringValue(request.parameters.operation) ?? "chain";
  const route = operation === "flow" ? "/options/flow" : operation === "candles" ? "/options/candles" : "/options/chain";
  const params: Record<string, unknown> = {
    underlying: route === "/options/candles" ? undefined : underlying,
    ticker: route === "/options/candles" ? stringValue(request.parameters.contract) ?? underlying : undefined,
    type: stringValue(request.parameters.type),
    expiry: stringValue(request.parameters.expiry),
    strike: numberValue(request.parameters.strike),
    strike_min: numberValue(request.parameters.strikeMin),
    strike_max: numberValue(request.parameters.strikeMax),
    min_dte: numberValue(request.parameters.minDte),
    max_dte: numberValue(request.parameters.maxDte),
    min_premium: numberValue(request.parameters.minPremium),
    start: requestDateParameter(request, "start"),
    end: requestDateParameter(request, "end"),
    order: stringValue(request.parameters.order) ?? (route === "/options/flow" ? "desc" : "asc"),
    limit: boundedLimit(request),
  };
  const response = await lseJsonRequest<unknown[]>(route, { credential, fetchFn, params });
  const rows = Array.isArray(response.data) ? response.data : [];
  if (!rows.length) return null;
  return result({
    kind: route === "/options/chain" ? "option_chain" : route === "/options/flow" ? "option_flow" : "option_candles",
    underlying: underlying.toUpperCase(),
    rows,
  }, [response.sourceRef], { quota: response.quota, availableAt: response.retrievedAt });
}

function lseImportRoot(): string {
  return dataPath("lse-imports");
}

function safeJobId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw new LseProviderError(400, "Invalid LSE export job id.");
  return value;
}

export async function createLseParquetExport(
  input: {
    dataset: string;
    symbol?: string | null;
    timeframe?: string | null;
    start?: string | null;
    end?: string | null;
  },
  dependencies: LseDataProviderDependencies = {},
): Promise<Record<string, unknown>> {
  const credential = lseCredential(dependencies.credential);
  if (!credential) throw new LseProviderError(401, "LSE API key is not configured.");
  if (localOnlyReason()) throw new LseProviderError(403, localOnlyReason()!);
  const response = await lseJsonRequest<Record<string, unknown>>("/export", {
    method: "POST",
    credential,
    fetchFn: dependencies.fetchFn,
    timeoutMs: 60_000,
    body: {
      dataset: input.dataset,
      symbol: input.symbol ?? "all",
      timeframe: input.timeframe ?? "tick",
      start: input.start ?? null,
      end: input.end ?? null,
      format: "parquet",
    },
  });
  return {
    ...response.data,
    format: "parquet",
    sourceRef: response.sourceRef,
    retrievedAt: response.retrievedAt,
  };
}

export async function getLseParquetExportStatus(
  jobId: string,
  dependencies: LseDataProviderDependencies = {},
): Promise<Record<string, unknown>> {
  const credential = lseCredential(dependencies.credential);
  if (!credential) throw new LseProviderError(401, "LSE API key is not configured.");
  if (localOnlyReason()) throw new LseProviderError(403, localOnlyReason()!);
  const id = safeJobId(jobId);
  const response = await lseJsonRequest<Record<string, unknown>>("/export/" + id, {
    credential,
    fetchFn: dependencies.fetchFn,
  });
  return { ...response.data, sourceRef: response.sourceRef, retrievedAt: response.retrievedAt };
}

export async function downloadLseParquetExport(
  jobId: string,
  dependencies: LseDataProviderDependencies = {},
): Promise<{ path: string; bytes: number; resumed: boolean; sourceRef: string }> {
  const credential = lseCredential(dependencies.credential);
  if (!credential) throw new LseProviderError(401, "LSE API key is not configured.");
  if (localOnlyReason()) throw new LseProviderError(403, localOnlyReason()!);
  const id = safeJobId(jobId);
  const root = lseImportRoot();
  fs.mkdirSync(root, { recursive: true });
  const finalPath = path.join(root, "lse-" + id + ".parquet");
  const partPath = finalPath + ".part";
  const offset = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
  const endpoint = LSE_VAULT_BASE + "/export/" + id + "/download";
  const fetchFn = dependencies.fetchFn ?? fetch;
  const response = await fetchFn(endpoint, {
    headers: {
      "x-api-key": credential,
      "User-Agent": "LiOS-Terminal/1.0 (+https://limuriaintelligence.com)",
      ...(offset > 0 ? { Range: "bytes=" + offset + "-" } : {}),
    },
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!response.ok) {
    const payload = await readResponsePayload(response);
    throw new LseProviderError(response.status, "LSE Parquet download failed: " + String(payload ?? response.statusText), quotaFromHeaders(response.headers));
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(partPath, bytes, { flag: offset > 0 && response.status === 206 ? "a" : "w", mode: 0o600 });
  const status = await getLseParquetExportStatus(id, { fetchFn, credential });
  const expectedBytes = numberValue(status.bytes);
  const actualBytes = fs.statSync(partPath).size;
  if (expectedBytes !== null && expectedBytes > 0 && actualBytes !== expectedBytes) {
    throw new LseProviderError(0, "LSE Parquet download incomplete (" + actualBytes + "/" + expectedBytes + " bytes); .part retained for resume.");
  }
  fs.renameSync(partPath, finalPath);
  try { fs.chmodSync(finalPath, 0o600); } catch { /* Windows */ }
  return {
    path: finalPath,
    bytes: actualBytes,
    resumed: offset > 0 && response.status === 206,
    sourceRef: endpoint,
  };
}

async function fetchExtension(
  request: CanonicalDataRequest,
  credential: string,
  fetchFn?: typeof fetch,
): Promise<ProviderAdapterResult | null> {
  const operation = stringValue(request.parameters.operation) ?? "meta";
  if (operation === "usage") {
    const usage = await lseUsage(credential, fetchFn);
    return result({ kind: "provider_usage", usage: usage.payload }, [usage.sourceRef], { quota: usage.quota });
  }
  if (operation === "catalog") {
    const rows = await lseCatalog(credential, fetchFn);
    return result({ kind: "instrument_catalog", rows }, [LSE_VAULT_BASE + "/catalog"]);
  }
  if (operation === "meta" || operation === "capabilities") {
    const meta = await lseJsonRequest<unknown>("/meta", { credential, fetchFn });
    return result({ kind: "provider_capabilities", meta: meta.data }, [meta.sourceRef], {
      quota: meta.quota,
      availableAt: meta.retrievedAt,
    });
  }
  if (operation === "bulk_export") {
    const dataset = stringValue(request.parameters.dataset);
    if (!dataset) throw new LseProviderError(400, "bulk_export requires parameters.dataset.");
    const job = await createLseParquetExport({
      dataset,
      symbol: stringValue(request.parameters.symbol) ?? request.entity.symbol ?? request.entity.ref,
      timeframe: stringValue(request.parameters.timeframe),
      start: requestDateParameter(request, "start"),
      end: requestDateParameter(request, "end"),
    }, { fetchFn, credential });
    return result({ kind: "parquet_export_job", job }, [LSE_VAULT_BASE + "/export"]);
  }
  if (operation === "bulk_export_status") {
    const jobId = stringValue(request.parameters.jobId);
    if (!jobId) throw new LseProviderError(400, "bulk_export_status requires parameters.jobId.");
    const job = await getLseParquetExportStatus(jobId, { fetchFn, credential });
    return result({ kind: "parquet_export_status", job }, [LSE_VAULT_BASE + "/export/" + safeJobId(jobId)]);
  }
  if (operation === "bulk_download") {
    const jobId = stringValue(request.parameters.jobId);
    if (!jobId) throw new LseProviderError(400, "bulk_download requires parameters.jobId.");
    const artifact = await downloadLseParquetExport(jobId, { fetchFn, credential });
    return result({ kind: "parquet_artifact", artifact }, [artifact.sourceRef]);
  }
  const refRoutes: Record<string, string> = {
    economic_calendar: "/ref/economic_calendar",
    insider_trades: "/ref/insider_trades",
    dividends: "/ref/dividends",
    splits: "/ref/stock_splits",
    cot: "/ref/cot",
    company_profiles: "/ref/company_profiles",
    fundamentals: "/ref/stock_fundamentals",
    bond_yields: "/ref/bond_yields",
  };
  const route = refRoutes[operation];
  if (!route) throw new LseProviderError(400, "Unsupported LSE provider_extension operation: " + operation);
  const response = await lseJsonRequest<unknown[]>(route, {
    credential,
    fetchFn,
    params: {
      symbol: request.entity.symbol ?? request.entity.ref,
      region: stringValue(request.parameters.region),
      event: stringValue(request.parameters.event),
      type: stringValue(request.parameters.type),
      start: requestDateParameter(request, "start"),
      end: requestDateParameter(request, "end"),
      order: stringValue(request.parameters.order) ?? "desc",
      limit: boundedLimit(request),
    },
  });
  const rows = Array.isArray(response.data) ? response.data : [];
  if (!rows.length) return null;
  return result({ kind: operation, rows }, [response.sourceRef], { quota: response.quota, availableAt: response.retrievedAt });
}

export function lseStreamChannel(request: CanonicalDataRequest): string {
  const scope = request.projectId == null ? "unscoped" : "project:" + request.projectId;
  const symbol = (request.entity.symbol ?? request.entity.ref).trim().toUpperCase();
  return "lse:" + scope + ":" + symbol;
}

export function buildLseSubscribeMessage(symbol: string, replayStart?: string | null): Record<string, unknown> {
  const message: Record<string, unknown> = { action: "subscribe", symbol };
  if (replayStart) message.start = replayStart;
  return message;
}

export function normalizeLseStreamMessage(message: unknown): LseStreamEvent | null {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const row = message as Record<string, unknown>;
  const type = stringValue(row.type);
  if (!type) return null;
  const at = new Date().toISOString();
  if (type === "tick") {
    const symbol = stringValue(row.symbol)?.toUpperCase();
    if (!symbol) return null;
    return {
      providerId: "lse",
      channel: "",
      type: "tick",
      at,
      symbol,
      replay: row.replay === true,
      data: {
        symbol,
        price: numberValue(row.price),
        bid: numberValue(row.bid),
        ask: numberValue(row.ask),
        volume: numberValue(row.volume),
        timestamp: stringValue(row.ts) ?? stringValue(row.timestamp),
        name: stringValue(row.name),
        replay: row.replay === true,
      },
    };
  }
  if (type === "replay_started" || type === "replay_complete" || type === "authenticated") {
    return { providerId: "lse", channel: "", type, at, data: row };
  }
  if (type === "error") return { providerId: "lse", channel: "", type: "error", at, data: row };
  return null;
}

function publishStreamEvent(channel: string, event: LseStreamEvent): void {
  const withChannel = { ...event, channel };
  const buffer = streamBuffers.get(channel) ?? [];
  buffer.push(withChannel);
  if (buffer.length > LSE_STREAM_BUFFER_MAX) buffer.splice(0, buffer.length - LSE_STREAM_BUFFER_MAX);
  streamBuffers.set(channel, buffer);
  streamHub.publish(channel, withChannel);
}

export function subscribeLseStreamEvents(channel: string, listener: (event: LseStreamEvent) => void): () => void {
  return streamHub.subscribe(channel, listener);
}

export function recentLseStreamEvents(channel: string, limit = 200): LseStreamEvent[] {
  const rows = streamBuffers.get(channel) ?? [];
  return rows.slice(-Math.max(1, Math.min(limit, LSE_STREAM_BUFFER_MAX)));
}

function replayStartFor(request: CanonicalDataRequest, now: () => number): string | null {
  const replayStart = stringValue(request.parameters.replayStart);
  if (!replayStart) return null;
  const parsed = Date.parse(replayStart);
  if (!Number.isFinite(parsed)) throw new LseProviderError(400, "Invalid replayStart timestamp.");
  if (parsed > now() || now() - parsed > LSE_REPLAY_MAX_MS) {
    throw new LseProviderError(400, "LSE replayStart must be within the provider's trailing 24-hour replay window.");
  }
  return new Date(parsed).toISOString();
}

async function startLseWebSocket(
  request: CanonicalDataRequest,
  credential: string,
  now: () => number,
): Promise<ProviderStreamSubscription> {
  if (!request.projectId) throw new LseProviderError(400, "LSE streaming requires a Project-scoped request.");
  const symbol = (request.entity.symbol ?? request.entity.ref).trim().toUpperCase();
  if (!symbol) throw new LseProviderError(400, "LSE streaming requires a symbol.");
  const replayStart = replayStartFor(request, now);
  if (request.capability === "options" && replayStart) {
    throw new LseProviderError(400, "LSE option-chain streaming does not advertise replayStart support.");
  }
  const channel = lseStreamChannel(request);
  let socket: WebSocket | null = null;
  let pingTimer: NodeJS.Timeout | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let stopped = false;
  let authenticated = false;

  const clearTimers = () => {
    if (pingTimer) clearInterval(pingTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    pingTimer = null;
    reconnectTimer = null;
  };

  const connect = (initial: boolean): Promise<void> => new Promise((resolve, reject) => {
    let settled = false;
    socket = new WebSocket(LSE_WS_URL);
    const authTimeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      const error = new LseProviderError(0, "Timed out authenticating the LSE WebSocket.");
      reject(error);
      try { socket?.close(); } catch { /* noop */ }
    }, 10_000);

    socket.on("message", (raw: RawData) => {
      let message: unknown;
      try { message = JSON.parse(raw.toString()) as unknown; } catch { return; }
      if (!message || typeof message !== "object" || Array.isArray(message)) return;
      const record = message as Record<string, unknown>;
      const type = stringValue(record.type);
      if (type === "welcome") {
        socket?.send(JSON.stringify({ action: "auth", api_key: credential }));
        return;
      }
      if (type === "authenticated") {
        authenticated = true;
        if (request.capability === "options") {
          socket?.send(JSON.stringify({ action: "subscribe_options", underlying: symbol }));
        } else {
          socket?.send(JSON.stringify(buildLseSubscribeMessage(symbol, replayStart)));
        }
        if (!pingTimer) {
          pingTimer = setInterval(() => {
            if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ action: "ping" }));
          }, LSE_STREAM_PING_MS);
          pingTimer.unref?.();
        }
        publishStreamEvent(channel, {
          providerId: "lse",
          channel,
          type: "authenticated",
          at: new Date().toISOString(),
          data: { tier: record.tier ?? null, symbolCount: Array.isArray(record.symbols) ? record.symbols.length : null },
        });
        if (!settled) {
          settled = true;
          clearTimeout(authTimeout);
          resolve();
        }
        return;
      }
      const event = normalizeLseStreamMessage(message);
      if (event) publishStreamEvent(channel, event);
      if (type === "error") {
        const code = stringValue(record.code) ?? "";
        if (!settled && (code === "INVALID_KEY" || code === "MISSING_KEY" || code === "QUOTA_EXCEEDED" || !authenticated)) {
          settled = true;
          clearTimeout(authTimeout);
          reject(new LseProviderError(code === "QUOTA_EXCEEDED" ? 429 : 401, stringValue(record.message) ?? "LSE stream authentication failed."));
        }
      }
    });

    socket.on("error", (error: Error) => {
      publishStreamEvent(channel, {
        providerId: "lse",
        channel,
        type: "error",
        at: new Date().toISOString(),
        data: { message: error.message },
      });
      if (!settled) {
        settled = true;
        clearTimeout(authTimeout);
        reject(error);
      }
    });

    socket.on("close", () => {
      clearTimeout(authTimeout);
      const wasAuthenticated = authenticated;
      authenticated = false;
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
      if (!settled) {
        settled = true;
        reject(new LseProviderError(0, "LSE WebSocket closed before authentication completed."));
      }
      const shouldReconnect = !stopped && (wasAuthenticated || !initial);
      publishStreamEvent(channel, {
        providerId: "lse",
        channel,
        type: "disconnected",
        at: new Date().toISOString(),
        data: { reconnecting: shouldReconnect },
      });
      if (shouldReconnect) {
        reconnectTimer = setTimeout(() => {
          void connect(false).catch((error) => {
            publishStreamEvent(channel, {
              providerId: "lse",
              channel,
              type: "error",
              at: new Date().toISOString(),
              data: { message: error instanceof Error ? error.message : "LSE reconnect failed." },
            });
          });
        }, LSE_STREAM_RECONNECT_MS);
        reconnectTimer.unref?.();
      }
    });
  });

  await connect(true);
  const lifecycle: StreamingLifecycle = buildStreamingLifecycle({
    providerId: LSE_PROVIDER_ID,
    capability: request.capability,
    supportsStream: true,
    streamHealthy: true,
    quota: null,
    lastEventAt: null,
    reason: replayStart
      ? "LSE WebSocket authenticated; replay transitions to live on the same provider-neutral stream channel."
      : "LSE WebSocket authenticated on the provider-neutral stream channel.",
  });
  return {
    lifecycle,
    async stop() {
      stopped = true;
      clearTimers();
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "LiOS stream stopped");
      streamBuffers.delete(channel);
    },
  };
}

export function createLseDataProviderAdapter(
  dependencies: LseDataProviderDependencies = {},
): LiOSDataProviderAdapter {
  const credential = () => lseCredential(dependencies.credential);
  const now = dependencies.now ?? Date.now;
  return {
    id: LSE_PROVIDER_ID,
    label: "London Strategic Edge",
    priority: 25,
    capabilities: ["security_resolution", "prices", "statements", "options", "curves", "macro", "provider_extension"],
    pointInTimeModes: ["latest"],
    async entitlement(request) {
      return lseEntitlementDecision(request, credential());
    },
    async health(): Promise<ProviderHealth> {
      const checkedAt = new Date().toISOString();
      const hostedReason = localOnlyReason();
      if (hostedReason) return { state: "disabled", checkedAt, latencyMs: null, detail: hostedReason };
      const key = credential();
      if (!key) return { state: "disabled", checkedAt, latencyMs: null, detail: "LSE API key is not configured." };
      const started = Date.now();
      try {
        await lseUsage(key, dependencies.fetchFn);
        return { state: "healthy", checkedAt, latencyMs: Date.now() - started, detail: "LSE /vault/usage authenticated successfully." };
      } catch (error) {
        const status = (error as { status?: number } | null)?.status;
        return {
          state: status === 429 ? "rate_limited" : status === 401 || status === 403 ? "disabled" : "degraded",
          checkedAt,
          latencyMs: Date.now() - started,
          detail: error instanceof Error ? error.message : "LSE health check failed.",
        };
      }
    },
    async quota() {
      const key = credential();
      if (!key || localOnlyReason()) return null;
      try {
        return (await lseUsage(key, dependencies.fetchFn)).quota;
      } catch (error) {
        return (error as { quota?: ProviderQuota } | null)?.quota ?? null;
      }
    },
    async search(request): Promise<ProviderSearchResult> {
      const key = credential();
      if (!key || localOnlyReason()) return { providerId: LSE_PROVIDER_ID, rows: [], sourceRefs: [] };
      const rows = matchCatalogRows(await lseCatalog(key, dependencies.fetchFn), request.query, request.limit ?? 20);
      const mapped = await mappedCatalogResults(rows);
      return {
        providerId: LSE_PROVIDER_ID,
        rows: mapped,
        sourceRefs: [LSE_VAULT_BASE + "/catalog", "provider-symbol-map:lse"],
      };
    },
    async fetch(request) {
      const key = credential();
      if (!key) {
        if (request.providerAllow.includes(LSE_PROVIDER_ID)) throw new LseProviderError(401, "LSE API key is not configured.");
        return null;
      }
      const entitlement = lseEntitlementDecision(request, key);
      if (entitlement.decision === "denied") throw new LseProviderError(403, entitlement.reasons.join(" "));
      if (request.capability === "security_resolution") {
        const rows = matchCatalogRows(await lseCatalog(key, dependencies.fetchFn), request.entity.symbol ?? request.entity.ref, 10);
        if (!rows.length) return null;
        return result({
          kind: "instrument_resolution",
          candidates: await mappedCatalogResults(rows),
        }, [LSE_VAULT_BASE + "/catalog", "provider-symbol-map:lse"]);
      }
      if (request.capability === "prices") return fetchPrices(request, key, dependencies.fetchFn);
      if (request.capability === "statements") return fetchStatements(request, key, dependencies.fetchFn);
      if (request.capability === "macro") return fetchSeries(request, key, stringValue(request.parameters.dataset) ?? "economics", dependencies.fetchFn);
      if (request.capability === "curves") return fetchSeries(request, key, stringValue(request.parameters.dataset) ?? "bonds", dependencies.fetchFn);
      if (request.capability === "options") return fetchOptions(request, key, dependencies.fetchFn);
      if (request.capability === "provider_extension") return fetchExtension(request, key, dependencies.fetchFn);
      return null;
    },
    async stream(request) {
      const key = credential();
      if (!key) throw new LseProviderError(401, "LSE API key is not configured.");
      const entitlement = lseEntitlementDecision(request, key);
      if (entitlement.decision === "denied") throw new LseProviderError(403, entitlement.reasons.join(" "));
      if (request.capability !== "prices" && request.capability !== "options") {
        throw new LseProviderError(400, "LSE streaming supports prices and options capabilities.");
      }
      return startLseWebSocket(request, key, now);
    },
    async normalize(data) {
      return data;
    },
  };
}
