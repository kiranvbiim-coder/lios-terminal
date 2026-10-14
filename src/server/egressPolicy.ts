import http from "node:http";
import https from "node:https";
import net from "node:net";
import {
  isCloudMetadataIpAddress,
  isIpInCidr,
  isLinkLocalIpAddress,
  isLoopbackIpAddress,
  normalizeIpAddress,
} from "./netPolicy/ip";

/**
 * GM-07d: the user's control over what their Home may reach (the NetworkProvider's egress half).
 *
 *   LIOS_EGRESS_MODE   open (default) | allowlist | offline
 *   LIOS_EGRESS_ALLOW  comma-separated: api.example.com, *.example.com, 203.0.113.7, 10.0.0.0/8
 *
 * - open:      anything except cloud-metadata and link-local endpoints (169.254.169.254, 100.100.100.200,
 *              metadata.google.internal, ...).
 * - allowlist: only listed hosts/IPs/CIDRs (plus this machine's loopback). Private-network addresses need a rule.
 * - offline:   loopback plus explicitly listed local rules (for example a LAN model server); nothing else.
 * Loopback is always reachable: the Python sidecar and local model servers are the Home's own services.
 * An explicit rule overrides the metadata block (an operator who really wants IMDS must name it).
 *
 * Enforced on the process-wide `fetch` (every provider, market-data and connector call). Redirects are followed by
 * this guard hop by hop in allowlist/offline modes so a permitted host cannot bounce a request to a forbidden one.
 * Also applied to `node:http`/`node:https` request and get (first hop). Not covered: raw sockets (a remote PostgreSQL),
 * the optional Playwright browser process and native addons.
 */

export type EgressMode = "open" | "allowlist" | "offline";

export type EgressRule =
  | { kind: "host"; host: string }
  | { kind: "suffix"; suffix: string }
  | { kind: "ip"; ip: string }
  | { kind: "cidr"; cidr: string };

export interface EgressPolicy {
  mode: EgressMode;
  rules: EgressRule[];
}

export interface EgressDecision {
  allowed: boolean;
  reason: "allowed" | "loopback" | "rule" | "metadata_blocked" | "not_in_allowlist" | "offline" | "unsupported_protocol";
}

export class EgressBlockedError extends Error {
  readonly host: string;
  readonly reason: EgressDecision["reason"];
  constructor(host: string, reason: EgressDecision["reason"], mode: EgressMode) {
    super(`Outbound request to ${host} was blocked by this Home's egress policy (${mode}: ${reason}).`);
    this.name = "EgressBlockedError";
    this.host = host;
    this.reason = reason;
  }
}

const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata", "instance-data", "instance-data.ec2.internal"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 10;

function hostOf(url: URL): string {
  return url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
}

export function parseEgressPolicy(env: NodeJS.ProcessEnv = process.env): EgressPolicy {
  const raw = env.LIOS_EGRESS_MODE?.trim().toLowerCase() || "open";
  if (raw !== "open" && raw !== "allowlist" && raw !== "offline") {
    throw new Error(`LIOS_EGRESS_MODE must be open, allowlist or offline (got "${raw}").`);
  }
  const rules: EgressRule[] = [];
  for (const entry of (env.LIOS_EGRESS_ALLOW ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean)) {
    if (entry.includes("/") && /^[0-9a-f:.]+\/\d{1,3}$/.test(entry)) rules.push({ kind: "cidr", cidr: entry });
    else if (net.isIP(entry)) rules.push({ kind: "ip", ip: normalizeIpAddress(entry) ?? entry });
    else if (entry.startsWith("*.") && /^\*\.[a-z0-9][a-z0-9.-]*$/.test(entry)) rules.push({ kind: "suffix", suffix: entry.slice(1) });
    else if (/^[a-z0-9][a-z0-9.-]*$/.test(entry)) rules.push({ kind: "host", host: entry });
    else throw new Error(`LIOS_EGRESS_ALLOW has an entry that is not a hostname, *.suffix, IP or CIDR: "${entry}".`);
  }
  return { mode: raw, rules };
}

function matchesRule(host: string, rules: readonly EgressRule[]): boolean {
  const ip = net.isIP(host) ? normalizeIpAddress(host) ?? host : null;
  return rules.some((rule) => {
    if (rule.kind === "host") return host === rule.host;
    if (rule.kind === "suffix") return host.endsWith(rule.suffix) && host.length > rule.suffix.length;
    if (rule.kind === "ip") return ip !== null && ip === rule.ip;
    return ip !== null && isIpInCidr(ip, rule.cidr);
  });
}

export function evaluateEgress(url: URL, policy: EgressPolicy): EgressDecision {
  if (url.protocol !== "http:" && url.protocol !== "https:") return { allowed: true, reason: "unsupported_protocol" };
  const host = hostOf(url).toLowerCase();
  const literal = net.isIP(host) !== 0;
  if (host === "localhost" || host.endsWith(".localhost") || (literal && isLoopbackIpAddress(host))) return { allowed: true, reason: "loopback" };
  if (matchesRule(host, policy.rules)) return { allowed: true, reason: "rule" };
  if (METADATA_HOSTS.has(host) || (literal && (isCloudMetadataIpAddress(host) || isLinkLocalIpAddress(host)))) return { allowed: false, reason: "metadata_blocked" };
  if (policy.mode === "offline") return { allowed: false, reason: "offline" };
  if (policy.mode === "allowlist") return { allowed: false, reason: "not_in_allowlist" };
  return { allowed: true, reason: "allowed" };
}

export function describeEgress(policy: EgressPolicy): { mode: EgressMode; ruleCount: number } {
  return { mode: policy.mode, ruleCount: policy.rules.length };
}

type FetchFunction = typeof fetch;

function assertAllowed(url: URL, policy: EgressPolicy): void {
  const decision = evaluateEgress(url, policy);
  if (!decision.allowed) throw new EgressBlockedError(hostOf(url), decision.reason, policy.mode);
}

/** Wraps a fetch implementation with the policy. Exported for tests; production installs it on globalThis. */
export function createGuardedFetch(native: FetchFunction, policy: EgressPolicy): FetchFunction {
  return async function guardedFetch(input: Parameters<FetchFunction>[0], init?: Parameters<FetchFunction>[1]): Promise<Response> {
    const isRequest = typeof input === "object" && input !== null && "url" in input && "method" in input;
    let url = new URL(isRequest ? (input as Request).url : String(input));
    assertAllowed(url, policy);
    const redirect = init?.redirect ?? (isRequest ? (input as Request).redirect : "follow");
    // In open mode only the first hop is checked (connector code has its own redirect-aware endpoint policy).
    if (policy.mode === "open" || redirect !== "follow") return native(input, init);

    // One normalised view of the request so every hop can be rebuilt from plain fields.
    const merged = isRequest ? new Request(input as Request, init) : null;
    let method = (merged?.method ?? init?.method ?? "GET").toUpperCase();
    let headers = new Headers(merged?.headers ?? init?.headers);
    let body: BodyInit | null | undefined = merged ? undefined : init?.body;
    const streamedBody = merged?.body ?? (typeof ReadableStream !== "undefined" && body instanceof ReadableStream ? body : null);

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = hop === 0 && merged
        ? await native(new Request(merged, { redirect: "manual" }))
        : await native(url.href, { ...init, method, headers, body: method === "GET" || method === "HEAD" ? undefined : body, redirect: "manual" });
      const location = response.headers.get("location");
      if (!REDIRECT_STATUSES.has(response.status) || !location) return response;
      await response.body?.cancel().catch(() => undefined);
      const next = new URL(location, url);
      assertAllowed(next, policy);
      if ((response.status === 307 || response.status === 308) && streamedBody) {
        throw new TypeError("fetch failed: a streamed request body cannot be replayed across a redirect.");
      }
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
        headers = new Headers(headers);
        for (const name of ["content-type", "content-length", "content-encoding", "content-language", "content-location"]) headers.delete(name);
      }
      if (next.origin !== url.origin) {
        headers = new Headers(headers);
        for (const name of ["authorization", "cookie", "proxy-authorization"]) headers.delete(name);
      }
      url = next;
    }
    throw new TypeError("fetch failed: too many redirects.");
  } as FetchFunction;
}

type RequestFunction = typeof http.request;

/** The destination a `node:http(s)` call will connect to, or null for a unix socket or when it cannot be determined. */
function nodeRequestUrl(args: unknown[], defaultProtocol: "http:" | "https:"): URL | null {
  const [first, second] = args;
  if (typeof first === "string") return new URL(first);
  if (first instanceof URL) return first;
  const options = (typeof first === "object" && first !== null ? first : typeof second === "object" ? second : null) as
    { socketPath?: string; hostname?: string; host?: string; protocol?: string } | null;
  if (!options || options.socketPath) return null;
  const host = options.hostname ?? options.host ?? "localhost";
  return new URL(`${options.protocol ?? defaultProtocol}//${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}`);
}

/** Applies the policy to `node:http` / `node:https` request and get (callers that do not use fetch). First hop only: node does not follow redirects. */
export function createGuardedRequest(native: RequestFunction, policy: EgressPolicy, defaultProtocol: "http:" | "https:"): RequestFunction {
  return function guardedRequest(this: unknown, ...args: unknown[]) {
    const url = nodeRequestUrl(args, defaultProtocol);
    if (url) assertAllowed(url, policy);
    return (native as (...parameters: unknown[]) => ReturnType<RequestFunction>).apply(this, args);
  } as RequestFunction;
}

let installed: { policy: EgressPolicy } | null = null;

/** Idempotent. Throws on a malformed policy so a typo cannot silently leave a Home open. */
export function installEgressGuard(env: NodeJS.ProcessEnv = process.env): EgressPolicy {
  if (installed) return installed.policy;
  const policy = parseEgressPolicy(env);
  if (policy.mode === "allowlist" && policy.rules.length === 0) {
    console.warn("LIOS_EGRESS_MODE=allowlist with no LIOS_EGRESS_ALLOW rules: only this machine can be reached.");
  }
  globalThis.fetch = createGuardedFetch(globalThis.fetch.bind(globalThis), policy);
  // `http.get` calls the module-internal request, so wrapping `request` alone would miss it on some Node versions.
  for (const [module, protocol] of [[http, "http:"], [https, "https:"]] as const) {
    const nativeRequest = module.request.bind(module) as RequestFunction;
    const nativeGet = module.get.bind(module);
    module.request = createGuardedRequest(nativeRequest, policy, protocol);
    module.get = ((...args: unknown[]) => {
      const req = (module.request as (...parameters: unknown[]) => http.ClientRequest)(...args);
      req.end();
      return req;
    }) as typeof nativeGet;
  }
  installed = { policy };
  return policy;
}

