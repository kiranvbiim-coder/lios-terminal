import { isIP } from "node:net";
import dns from "node:dns/promises";
import { isBlockedConnectorAddress } from "./apiConnector";
import { resolveRuntimeMode } from "./runtimeMode";
import type { RuntimeMode } from "@shared/runtimeProviderContracts";

export interface SourceEndpointPolicyResult {
  valid: boolean;
  normalizedEndpoint: string | null;
  reason:
    | "valid"
    | "missing"
    | "invalid_url"
    | "unsupported_protocol"
    | "embedded_credentials"
    | "insecure_remote_endpoint"
    | "private_host_blocked";
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return false;
  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1" || normalized === "[::1]") return true;
  if (isPrivateIpv4(normalized)) return true;
  if (isIP(normalized) === 6) {
    return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  }
  return false;
}

/** Resolves a hostname to every address it currently answers to. Injectable so tests can supply a deterministic fake instead of depending on live network DNS. */
export type HostResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: HostResolver = async (hostname) => {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => entry.address);
};

// Resolves the hostname (if it isn't already a literal IP) and checks every
// resolved address against the same blocked-network list apiConnector.ts
// uses for hosted connectors. This closes DNS rebinding: a hostname that
// passes the string-based isLocalOrPrivateHost check above (because it
// looks like an ordinary public domain) can still resolve to a
// private/blocked address at request time. Only consulted when
// allowLocalhost is false -- desktop/local BYOD callers intentionally
// allow private destinations by default (a user's own LAN/NAS), so this
// guard exists for the case that actually needs it: hosted or
// policy-restricted callers.
async function resolvesToBlockedAddress(hostname: string, resolveHost: HostResolver): Promise<boolean> {
  if (isIP(hostname)) return isBlockedConnectorAddress(hostname);
  try {
    const addresses = await resolveHost(hostname);
    if (addresses.length === 0) return true;
    return addresses.some((address) => isBlockedConnectorAddress(address));
  } catch {
    return true;
  }
}

export async function validateSourceEndpoint(
  endpoint: string | null | undefined,
  allowLocalhost = !process.env.DATABASE_URL,
  resolveHost: HostResolver = defaultResolver,
): Promise<SourceEndpointPolicyResult> {
  if (!endpoint?.trim()) return { valid: false, normalizedEndpoint: null, reason: "missing" };
  let parsed: URL;
  try {
    parsed = new URL(endpoint.trim());
  } catch {
    return { valid: false, normalizedEndpoint: null, reason: "invalid_url" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return { valid: false, normalizedEndpoint: null, reason: "unsupported_protocol" };
  if (parsed.username || parsed.password) return { valid: false, normalizedEndpoint: null, reason: "embedded_credentials" };

  const local = isLocalOrPrivateHost(parsed.hostname);
  if (parsed.protocol === "http:" && !local) {
    return { valid: false, normalizedEndpoint: null, reason: "insecure_remote_endpoint" };
  }
  if (local && !allowLocalhost) return { valid: false, normalizedEndpoint: null, reason: "private_host_blocked" };

  if (!local && !allowLocalhost && await resolvesToBlockedAddress(parsed.hostname, resolveHost)) {
    return { valid: false, normalizedEndpoint: null, reason: "private_host_blocked" };
  }

  parsed.hash = "";
  return { valid: true, normalizedEndpoint: parsed.toString(), reason: "valid" };
}

/**
 * MCP servers have a narrower local-network allowance than general BYOD
 * sources. Desktop can explicitly connect to its *own* loopback server,
 * independent of DATABASE_URL. An exposed Home never receives that grant.
 *
 * "localhost" is canonicalized to a numeric loopback IP so a hosts-file or
 * resolver cannot silently send an authorized localhost MCP request to LAN.
 * Arbitrary private LAN addresses, DNS aliases and 127.x aliases are not MCP
 * loopback grants. Public remote MCP still requires HTTPS + the usual
 * blocked-address/DNS admission checks.
 */
export function isDesktopMcpLoopbackEndpoint(
  endpoint: string,
  mode: RuntimeMode = resolveRuntimeMode(),
): boolean {
  if (mode !== "desktop_local") return false;
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    return (url.protocol === "http:" || url.protocol === "https:")
      && (host === "localhost" || host === "127.0.0.1" || host === "[::1]");
  } catch {
    return false;
  }
}

export async function validateMcpSourceEndpoint(
  endpoint: string | null | undefined,
  mode: RuntimeMode = resolveRuntimeMode(),
  resolveHost: HostResolver = defaultResolver,
): Promise<SourceEndpointPolicyResult> {
  const candidate = typeof endpoint === "string" ? endpoint.trim() : "";
  const local = isDesktopMcpLoopbackEndpoint(candidate, mode);
  // A loopback grant requires an explicit numeric address at transport time.
  // In particular, a local Home using PostgreSQL is STILL desktop_local.
  let normalizedCandidate = candidate;
  if (local) {
    const parsed = new URL(candidate);
    if (parsed.hostname.toLowerCase() === "localhost") parsed.hostname = "127.0.0.1";
    normalizedCandidate = parsed.href;
  }
  return validateSourceEndpoint(normalizedCandidate, local, resolveHost);
}

const SECRET_CONFIG_KEYS = /password|secret|token|api[_-]?key|credential|private[_-]?key|authorization/i;

export function sanitizeSourceConfig(config: Record<string, string | number | boolean | null>): Record<string, string | number | boolean | null> {
  return Object.fromEntries(Object.entries(config).filter(([key]) => !SECRET_CONFIG_KEYS.test(key)));
}

export async function normalizeSourceConfig(sourceType: string, config: Record<string, string | number | boolean | null>): Promise<Record<string, string | number | boolean | null>> {
  const sanitized = sanitizeSourceConfig(config);
  const endpoint = typeof sanitized.endpoint === "string"
    ? sourceType === "mcp"
      ? await validateMcpSourceEndpoint(sanitized.endpoint)
      : await validateSourceEndpoint(sanitized.endpoint)
    : null;
  if (endpoint && endpoint.valid && endpoint.normalizedEndpoint) sanitized.endpoint = endpoint.normalizedEndpoint;
  return { ...sanitized, sourceType };
}

const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const SENSITIVE_REDIRECT_HEADERS = /^(?:authorization|proxy-authorization|cookie|x-api-key|api-key)$/i;

function requestCarriesSensitiveHeaders(headers: HeadersInit | undefined): boolean {
  if (!headers) return false;
  const normalized = new Headers(headers);
  for (const [name] of normalized.entries()) {
    if (SENSITIVE_REDIRECT_HEADERS.test(name)) return true;
  }
  return false;
}

// fetch() wrapper that re-validates every redirect hop against the same
// endpoint policy, so a validated URL cannot be used to reach a blocked
// destination via a redirect response (mirrors apiConnector.ts's
// fetchWithSafeRedirects for the sourceConnectionService BYOD paths).
export async function fetchWithEndpointPolicy(
  url: string,
  options: Omit<RequestInit, "redirect"> = {},
  allowLocalhost = !process.env.DATABASE_URL,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
): Promise<Response> {
  // MCP and other authenticated, endpoint-pinned clients must be able to
  // forbid redirects *before* a second request carries headers/body to a
  // different path. Other source callers retain their existing default.
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > DEFAULT_MAX_REDIRECTS) {
    throw new Error("Invalid source redirect limit.");
  }
  let current = url;
  let requestInit: RequestInit = { ...options, redirect: "manual" };
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const policy = await validateSourceEndpoint(current, allowLocalhost);
    if (!policy.valid || !policy.normalizedEndpoint) {
      throw new Error(`Endpoint rejected: ${policy.reason}.`);
    }
    const response = await fetch(policy.normalizedEndpoint, requestInit);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirectCount === maxRedirects) throw new Error("Endpoint exceeded the redirect safety limit.");
    const location = response.headers.get("location");
    if (!location) throw new Error("Endpoint redirect did not include a Location header.");
    const next = new URL(location, policy.normalizedEndpoint);
    if (requestCarriesSensitiveHeaders(requestInit.headers) && next.origin !== new URL(policy.normalizedEndpoint).origin) {
      throw new Error("Endpoint refused to forward credentials across origins.");
    }
    current = next.toString();
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && requestInit.method === "POST")) {
      const headers = { ...(requestInit.headers as Record<string, string> | undefined) };
      delete headers["Content-Type"];
      requestInit = { ...requestInit, method: "GET", body: undefined, headers, redirect: "manual" };
    }
  }
  throw new Error("Endpoint redirect handling failed.");
}

// Reads a response body up to maxBytes, rejecting instead of buffering an
// unbounded remote response.
export async function readBoundedText(response: Response, maxBytes: number = DEFAULT_MAX_RESPONSE_BYTES): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("Response exceeds the connector safety limit.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error("Response exceeds the connector safety limit.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}
