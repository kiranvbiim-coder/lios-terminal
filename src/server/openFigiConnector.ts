import {
  adaptLegacySymbolCatalogRow,
  type InstrumentIdentifierType,
  type InstrumentMasterCandidate,
  type InstrumentProviderFallback,
  type InstrumentResolutionQuery,
} from "@shared/globalInstrumentMaster";
import type { InstrumentSearchFederatedFallback, InstrumentSearchOptions } from "@shared/instrumentSearchIndex";
import type { ProviderQuota } from "@shared/universalDataFabric";
import { resolveCredential } from "./credentialVault";
import { recordConnectorVerification } from "./connectorVerification";

const OPENFIGI_BASE = "https://api.openfigi.com";
const OPENFIGI_MAPPING = `${OPENFIGI_BASE}/v3/mapping`;
const OPENFIGI_FILTER = `${OPENFIGI_BASE}/v3/filter`;

export interface OpenFigiDataRow {
  figi?: string | null;
  securityType?: string | null;
  marketSector?: string | null;
  ticker?: string | null;
  name?: string | null;
  exchCode?: string | null;
  shareClassFIGI?: string | null;
  compositeFIGI?: string | null;
  securityType2?: string | null;
  securityDescription?: string | null;
}

export interface OpenFigiMappingJob {
  idType: string;
  idValue: string;
  exchCode?: string;
  micCode?: string;
  currency?: string;
  includeUnlistedEquities?: boolean;
}

export interface OpenFigiHttpResult<T> {
  data: T;
  quota: ProviderQuota;
  status: number;
  retrievedAt: string;
}

export type OpenFigiFetch = typeof fetch;

export function openFigiCredential(): string | null {
  return resolveCredential("OPENFIGI_API_KEY", "openFigiApiKey");
}

export function parseOpenFigiQuota(headers: Headers): ProviderQuota {
  const numberOrNull = (name: string): number | null => {
    const raw = headers.get(name);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  };
  const resetSeconds = numberOrNull("ratelimit-reset");
  return {
    limit: numberOrNull("ratelimit-limit"),
    remaining: numberOrNull("ratelimit-remaining"),
    resetAt: resetSeconds === null ? null : new Date(Date.now() + resetSeconds * 1_000).toISOString(),
    retryAfterMs: resetSeconds === null ? null : resetSeconds * 1_000,
    source: headers.has("ratelimit-limit") ? "response_headers" : "unknown",
  };
}

async function openFigiPost<T>(
  path: "/v3/mapping" | "/v3/filter",
  body: unknown,
  fetchFn: OpenFigiFetch = fetch,
  credential: string | null = openFigiCredential(),
): Promise<OpenFigiHttpResult<T>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (credential) headers["X-OPENFIGI-APIKEY"] = credential;
  const endpoint = path === "/v3/mapping" ? OPENFIGI_MAPPING : OPENFIGI_FILTER;
  const started = Date.now();
  try {
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const quota = parseOpenFigiQuota(response.headers);
    if (!response.ok) {
      const error = new Error(`OpenFIGI returned HTTP ${response.status}.`);
      (error as Error & { status?: number; quota?: ProviderQuota }).status = response.status;
      (error as Error & { status?: number; quota?: ProviderQuota }).quota = quota;
      recordConnectorVerification("openfigi", false, `OpenFIGI HTTP ${response.status}; latency ${Date.now() - started}ms.`);
      throw error;
    }
    const data = await response.json() as T;
    recordConnectorVerification("openfigi", true, `OpenFIGI v3 responded successfully; latency ${Date.now() - started}ms.`);
    return { data, quota, status: response.status, retrievedAt: new Date().toISOString() };
  } catch (error) {
    if (!(error instanceof Error && error.message.startsWith("OpenFIGI returned HTTP"))) {
      recordConnectorVerification("openfigi", false, error instanceof Error ? error.message : "OpenFIGI request failed.");
    }
    throw error;
  }
}

function idTypeFor(type: InstrumentIdentifierType): string | null {
  switch (type) {
    case "figi": return "ID_BB_GLOBAL";
    case "composite_figi": return "COMPOSITE_ID_BB_GLOBAL";
    case "isin": return "ID_ISIN";
    case "cusip": return "ID_CUSIP";
    case "sedol": return "ID_SEDOL";
    case "ticker": return "TICKER";
    default: return null;
  }
}

export function openFigiMappingJobFromQuery(query: InstrumentResolutionQuery): OpenFigiMappingJob | null {
  if (query.identifier) {
    const idType = idTypeFor(query.identifier.type);
    if (!idType) return null;
    const job: OpenFigiMappingJob = { idType, idValue: query.identifier.value };
    if (query.mic) job.micCode = query.mic;
    else if (query.exchange) job.exchCode = query.exchange;
    return job;
  }
  if (query.providerId?.provider.toLowerCase() === "openfigi") {
    return { idType: "ID_BB_GLOBAL", idValue: query.providerId.value };
  }
  if (query.ticker) {
    const job: OpenFigiMappingJob = { idType: "TICKER", idValue: query.ticker };
    if (query.mic) job.micCode = query.mic;
    else if (query.exchange) job.exchCode = query.exchange;
    return job;
  }
  return null;
}

export function openFigiRowToCandidate(row: OpenFigiDataRow): InstrumentMasterCandidate | null {
  const ticker = row.ticker?.trim();
  const figi = row.figi?.trim();
  if (!ticker && !figi) return null;
  const name = row.name?.trim() || row.securityDescription?.trim() || ticker || figi!;
  // A record without a ticker stays ticker-less: the FIGI is an identifier, not a symbol to quote.
  const common = { name, exchange: row.exchCode?.trim() || null, provider: "openfigi", providerId: figi || null };
  const base = adaptLegacySymbolCatalogRow(ticker ? { ...common, symbol: ticker } : { ...common, symbol: null });
  const identifiers = [...base.identifiers];
  const add = (type: InstrumentIdentifierType, value: string | null | undefined) => {
    const normalized = value?.trim();
    if (normalized && !identifiers.some((item) => item.type === type && item.value === normalized)) {
      identifiers.push({ type, value: normalized, provider: "openfigi", isPrimary: type === "figi" });
    }
  };
  add("figi", figi);
  add("composite_figi", row.compositeFIGI);
  add("share_class_figi", row.shareClassFIGI);
  return {
    ...base,
    identifiers,
    source: "openfigi",
    canonical: false,
  };
}

function rowsFromMappingResponse(payload: unknown): OpenFigiDataRow[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((job) => {
    if (!job || typeof job !== "object") return [];
    const data = (job as { data?: unknown }).data;
    return Array.isArray(data) ? data.filter((row): row is OpenFigiDataRow => Boolean(row && typeof row === "object")) : [];
  });
}

function rowsFromFilterResponse(payload: unknown): OpenFigiDataRow[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  return Array.isArray(data) ? data.filter((row): row is OpenFigiDataRow => Boolean(row && typeof row === "object")) : [];
}

export async function mapOpenFigi(
  jobs: OpenFigiMappingJob[],
  options: { fetchFn?: OpenFigiFetch; credential?: string | null } = {},
): Promise<{ candidates: InstrumentMasterCandidate[]; quota: ProviderQuota; retrievedAt: string }> {
  if (!jobs.length) return { candidates: [], quota: { limit: null, remaining: null, resetAt: null, retryAfterMs: null, source: "unknown" }, retrievedAt: new Date().toISOString() };
  const credential = options.credential ?? openFigiCredential();
  const maxJobs = credential ? 100 : 5;
  const result = await openFigiPost<unknown[]>("/v3/mapping", jobs.slice(0, maxJobs), options.fetchFn, credential);
  return {
    candidates: rowsFromMappingResponse(result.data).map(openFigiRowToCandidate).filter((row): row is InstrumentMasterCandidate => row !== null),
    quota: result.quota,
    retrievedAt: result.retrievedAt,
  };
}

export async function searchOpenFigi(
  queryText: string,
  options: InstrumentSearchOptions = {},
  dependencies: { fetchFn?: OpenFigiFetch; credential?: string | null } = {},
): Promise<{ candidates: InstrumentMasterCandidate[]; quota: ProviderQuota; retrievedAt: string }> {
  const query = queryText.trim();
  if (!query) return { candidates: [], quota: { limit: null, remaining: null, resetAt: null, retryAfterMs: null, source: "unknown" }, retrievedAt: new Date().toISOString() };
  const credential = dependencies.credential ?? openFigiCredential();
  const payload: Record<string, unknown> = { query };
  const result = await openFigiPost<Record<string, unknown>>("/v3/filter", payload, dependencies.fetchFn, credential);
  const candidates = rowsFromFilterResponse(result.data).map(openFigiRowToCandidate).filter((row): row is InstrumentMasterCandidate => row !== null);
  return { candidates: candidates.slice(0, Math.max(1, options.limit ?? 20)), quota: result.quota, retrievedAt: result.retrievedAt };
}

export const openFigiInstrumentFallback: InstrumentProviderFallback = {
  async resolve(query) {
    if (!openFigiCredential()) return [];
    const job = openFigiMappingJobFromQuery(query);
    if (job) return (await mapOpenFigi([job])).candidates;
    if (query.name) return (await searchOpenFigi(query.name, { limit: 20 })).candidates;
    return [];
  },
};

export const openFigiSearchFallback: InstrumentSearchFederatedFallback = {
  async search(queryText, options) {
    if (!openFigiCredential()) return [];
    return (await searchOpenFigi(queryText, options)).candidates;
  },
};
