import { XMLParser } from "fast-xml-parser";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { mapColumnsToContract, type ContractColumnMapping } from "./databaseConnector";
import { isHostedProductionRuntime } from "./runtimeSecurity";
import type { FinancialMetricObservation } from "@shared/financialMetricRegistry";
import {
  profileSourceRecords,
  recordsFromDiscoveredValue,
  selectDiscoveryValue,
  validateDiscoveryPath,
  type SourceSchemaPreview,
} from "@shared/sourceDiscovery";

export interface ApiSourceConfig {
  endpoint: string;
  protocol?: "rest" | "graphql" | "soap";
  method?: "GET" | "POST";
  pageParam?: string;
  pageSizeParam?: string;
  pageSize?: number;
  maxPages?: number;
  responsePath?: string;
  authMode?: "bearer" | "x-api-key" | "oauth" | "none";
  graphqlQuery?: string;
  soapAction?: string;
  soapBody?: string;
}

export interface ApiFetchResult {
  records: Array<Record<string, unknown>>;
  status: number;
  pagesFetched: number;
  truncated: boolean;
  retrievedAt: string;
  snapshotId?: string;
}

export interface ApiDiscoveryResult extends SourceSchemaPreview {
  endpoint: string;
  protocol: "rest" | "graphql" | "soap";
  httpStatus: number;
  responsePath: string | null;
  retrievedAt: string;
}

export interface ApiMappedResult {
  records: Array<Record<string, unknown>>;
  mappings: ContractColumnMapping[];
  missingFields: string[];
  normalizedObservations?: FinancialMetricObservation[];
  normalizedRejected?: Array<{ row: number; reason: string }>;
  snapshotId?: string;
}

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

const BLOCKED_NETWORKS = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as Array<[string, number]>) BLOCKED_NETWORKS.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32],
] as Array<[string, number]>) BLOCKED_NETWORKS.addSubnet(network, prefix, "ipv6");
BLOCKED_NETWORKS.addAddress("::", "ipv6");
BLOCKED_NETWORKS.addAddress("::1", "ipv6");

export function isHostedApiConnectorRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return isHostedProductionRuntime(env);
}

export function privateConnectorNetworksAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LIOS_ALLOW_PRIVATE_CONNECTOR_NETWORKS?.trim().toLowerCase() === "true";
}

export function isBlockedConnectorAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isBlockedConnectorAddress(normalized.slice(7));
  const version = isIP(address);
  if (version === 4) return BLOCKED_NETWORKS.check(address, "ipv4");
  if (version === 6) return BLOCKED_NETWORKS.check(address, "ipv6");
  return false;
}

export async function assertSafeApiEndpoint(
  rawUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("API connector endpoint must be a valid URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("API connector endpoint must use HTTP or HTTPS.");
  if (url.username || url.password) throw new Error("API connector endpoint must not embed credentials in the URL.");

  const hosted = isHostedApiConnectorRuntime(env);
  if (hosted && url.protocol !== "https:") throw new Error("Hosted API connectors require HTTPS.");
  if (!hosted || privateConnectorNetworksAllowed(env)) return url;

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Hosted API connectors cannot access local/private network destinations.");
  }
  if (isIP(hostname)) {
    if (isBlockedConnectorAddress(hostname)) throw new Error("Hosted API connectors cannot access local/private network destinations.");
    return url;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("API connector endpoint hostname could not be resolved.");
  }
  if (addresses.length === 0 || addresses.some((entry) => isBlockedConnectorAddress(entry.address))) {
    throw new Error("Hosted API connectors cannot access local/private network destinations.");
  }
  return url;
}

async function fetchWithSafeRedirects(
  rawUrl: string,
  init: RequestInit,
  credential: string | null,
): Promise<Response> {
  let current = await assertSafeApiEndpoint(rawUrl);
  const originalOrigin = current.origin;
  let requestInit = { ...init, redirect: "manual" as const };

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(current, requestInit);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirectCount === MAX_REDIRECTS) throw new Error("API connector exceeded the redirect safety limit.");
    const location = response.headers.get("location");
    if (!location) throw new Error("API connector redirect did not include a Location header.");
    const next = await assertSafeApiEndpoint(new URL(location, current).toString());
    if (credential && next.origin !== originalOrigin) {
      throw new Error("API connector refused to forward credentials across origins.");
    }
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && requestInit.method === "POST")) {
      const headers = { ...(requestInit.headers as Record<string, string> | undefined) };
      delete headers["Content-Type"];
      requestInit = { ...requestInit, method: "GET", body: undefined, headers, redirect: "manual" };
    }
    current = next;
  }
  throw new Error("API connector redirect handling failed.");
}

function recordsFromPayload(payload: unknown, responsePath?: string): Array<Record<string, unknown>> {
  const selected = selectDiscoveryValue(payload, responsePath);
  return recordsFromDiscoveredValue(selected);
}

function urlWithPage(endpoint: string, pageParam: string | undefined, page: number, pageSizeParam: string | undefined, pageSize: number): string {
  const url = new URL(endpoint);
  if (pageParam) url.searchParams.set(pageParam, String(page));
  if (pageSizeParam) url.searchParams.set(pageSizeParam, String(pageSize));
  return url.toString();
}

function requestHeaders(config: ApiSourceConfig, credential: string | null): { headers: Record<string, string>; body: string | undefined } {
  const protocol = config.protocol ?? "rest";
  const headers: Record<string, string> = { Accept: protocol === "soap" ? "application/xml, text/xml" : "application/json" };
  let body: string | undefined;

  if (protocol === "graphql") {
    if (!config.graphqlQuery?.trim()) throw new Error("GraphQL connector requires a query.");
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ query: config.graphqlQuery });
  } else if (protocol === "soap") {
    if (!config.soapBody?.trim()) throw new Error("SOAP connector requires a request body.");
    headers["Content-Type"] = "text/xml";
    if (config.soapAction) headers.SOAPAction = config.soapAction;
    body = config.soapBody;
  }

  if (credential && config.authMode !== "none") {
    if (config.authMode === "x-api-key") headers["X-API-Key"] = credential;
    else headers.Authorization = `Bearer ${credential}`;
  }

  return { headers, body };
}

async function parseResponseBody(response: Response, protocol: "rest" | "graphql" | "soap"): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("API response exceeds the 5 MB connector safety limit.");
  }
  if (!response.body) throw new Error("API connector returned an empty response body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let raw = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("API response exceeds the 5 MB connector safety limit.");
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  if (protocol === "soap") return new XMLParser({ ignoreAttributes: false }).parse(raw);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("API connector expected JSON but the response was not valid JSON.");
  }
}

async function fetchApiPage(
  config: ApiSourceConfig,
  credential: string | null,
  page: number,
  pageSize: number,
): Promise<{ status: number; records: Array<Record<string, unknown>> }> {
  const protocol = config.protocol ?? "rest";
  const pathValidation = validateDiscoveryPath(config.responsePath);
  if (!pathValidation.valid) throw new Error(pathValidation.reason);
  const { headers, body } = requestHeaders(config, credential);
  const response = await fetchWithSafeRedirects(
    urlWithPage(
      config.endpoint,
      protocol === "rest" ? config.pageParam : undefined,
      page,
      protocol === "rest" ? config.pageSizeParam : undefined,
      pageSize,
    ),
    {
      method: protocol === "rest" ? config.method ?? "GET" : "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    },
    credential,
  );
  if (!response.ok) throw new Error(`API connector returned HTTP ${response.status}.`);
  const payload = await parseResponseBody(response, protocol);
  if (protocol === "graphql" && payload && typeof payload === "object" && "errors" in payload && Array.isArray((payload as { errors?: unknown[] }).errors) && (payload as { errors: unknown[] }).errors.length > 0) {
    throw new Error("GraphQL connector returned errors.");
  }
  return { status: response.status, records: recordsFromPayload(payload, config.responsePath) };
}

export async function fetchApiSource(config: ApiSourceConfig, credential: string | null): Promise<ApiFetchResult> {
  const pageSize = Math.min(Math.max(Math.floor(config.pageSize ?? 100), 1), 1_000);
  const maxPages = Math.min(Math.max(Math.floor(config.maxPages ?? 10), 1), 50);
  const protocol = config.protocol ?? "rest";
  const records: Array<Record<string, unknown>> = [];
  let status = 0;
  let pagesFetched = 0;
  let truncated = false;

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await fetchApiPage(config, credential, page, pageSize);
    status = result.status;
    pagesFetched = page;
    records.push(...result.records);
    if (protocol !== "rest" || !config.pageParam || result.records.length < pageSize) break;
    if (page === maxPages) truncated = true;
  }

  return { records, status, pagesFetched, truncated, retrievedAt: new Date().toISOString() };
}

export async function discoverApiSource(config: ApiSourceConfig, credential: string | null): Promise<ApiDiscoveryResult> {
  const pageSize = Math.min(Math.max(Math.floor(config.pageSize ?? 100), 1), 100);
  const result = await fetchApiPage({ ...config, maxPages: 1 }, credential, 1, pageSize);
  if (result.records.length === 0) {
    throw new Error(config.responsePath
      ? `The endpoint responded successfully but no object records were found at response path "${config.responsePath}".`
      : "The endpoint responded successfully but no object records were found. Configure a response path when records are nested.");
  }
  const preview = profileSourceRecords(result.records, { maxRows: 100, maxSamplesPerField: 3 });
  return {
    ...preview,
    endpoint: config.endpoint,
    protocol: config.protocol ?? "rest",
    httpStatus: result.status,
    responsePath: config.responsePath?.trim() || null,
    retrievedAt: new Date().toISOString(),
  };
}

export function mapApiRecordsToContract(records: Array<Record<string, unknown>>, contractFamily: string): ApiMappedResult {
  const columns = Array.from(new Set(records.flatMap((record) => Object.keys(record))));
  const mapping = mapColumnsToContract(columns, contractFamily);
  const normalizedRecords = records.map((record) => {
    const normalized: Record<string, unknown> = {};
    for (const item of mapping.mappings) normalized[item.contractField] = record[item.sourceColumn] ?? null;
    return normalized;
  });
  return { records: normalizedRecords, mappings: mapping.mappings, missingFields: mapping.missingFields };
}
