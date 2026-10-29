import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { LookupFunction } from "node:net";
import { z } from "zod";
import type { LiosPluginManifestV1 } from "@shared/pluginSdk";
import type { RuntimeExecutionContext } from "@shared/runtimeContracts";
import {
  authorizeBrokeredNetworkRequest,
  type PluginExecutionGrant,
} from "./p13PluginHost";

const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BODY_BYTES = 5 * 1024 * 1024;
const SENSITIVE_REQUEST_HEADER = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i;
const PROTECTED_TRANSPORT_HEADER = /^(?:host|content-length|connection|proxy-connection|transfer-encoding|upgrade|expect|te|trailer|keep-alive)$/i;

export const p13PluginNetworkRequestSchema = z.object({
  protocol: z.literal("lios-plugin-broker/1"),
  kind: z.literal("network.request"),
  requestId: z.string().uuid(),
  executionRequestId: z.string().uuid(),
  componentId: z.string().trim().min(1).max(300),
  url: z.string().url().max(4_000),
  method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  headers: z.record(z.string().max(8_192)).default({}),
  bodyBase64: z.string().max(Math.ceil(MAX_REQUEST_BODY_BYTES * 4 / 3) + 8).nullable().default(null),
  credentialHandle: z.string().trim().min(1).max(500).nullable().default(null),
  timeoutMs: z.number().int().positive().max(30_000).default(15_000),
  maxResponseBytes: z.number().int().positive().max(MAX_RESPONSE_BODY_BYTES).default(MAX_RESPONSE_BODY_BYTES),
}).strict();
export type P13PluginNetworkRequest = z.infer<typeof p13PluginNetworkRequestSchema>;

export interface P13PluginExecutionBinding {
  componentId: string;
  context: RuntimeExecutionContext;
}

export interface P13CredentialHeaderRequest {
  pluginId: string;
  componentId: string;
  credentialHandle: string;
  url: URL;
  context: RuntimeExecutionContext;
}

export type P13PluginCredentialResolver = (
  request: P13CredentialHeaderRequest,
) => Promise<Record<string, string>>;

export interface P13PluginAuxiliaryHandlerOptions {
  manifest: LiosPluginManifestV1;
  grant: PluginExecutionGrant;
  lookupExecution: (executionRequestId: string) => P13PluginExecutionBinding | null;
  credentialResolver?: P13PluginCredentialResolver;
  resolveAddress?: (hostname: string) => Promise<{ address: string; family: 4 | 6 }>;
  requester?: typeof requestPinned;
}

function privateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function privateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return net.isIP(mapped) === 4 ? privateIpv4(mapped) : true;
  }
  return false;
}

function isPrivateOrSpecialAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return privateIpv4(address);
  if (family === 6) return privateIpv6(address);
  return true;
}

export async function resolvePinnedPublicAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error("network_dns_empty");
  if (addresses.some((entry) => isPrivateOrSpecialAddress(entry.address))) {
    throw new Error("network_private_address_denied");
  }
  const first = addresses[0];
  if (first.family !== 4 && first.family !== 6) throw new Error("network_address_family_unsupported");
  return { address: first.address, family: first.family };
}

function normalizePluginHeaders(input: Record<string, string>): Record<string, string> {
  const entries = Object.entries(input);
  if (entries.length > 100) throw new Error("network_header_count_exceeded");
  const output: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new Error("network_header_name_invalid");
    if (SENSITIVE_REQUEST_HEADER.test(name)) throw new Error("network_sensitive_header_denied");
    if (PROTECTED_TRANSPORT_HEADER.test(name)) throw new Error("network_protected_header_denied");
    if (/[\r\n]/.test(value)) throw new Error("network_header_value_invalid");
    output[name] = value;
  }
  return output;
}

function normalizeCredentialHeaders(input: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  const entries = Object.entries(input);
  if (entries.length > 20) throw new Error("credential_header_count_exceeded");
  for (const [name, value] of entries) {
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
      || PROTECTED_TRANSPORT_HEADER.test(name)
      || /[\r\n]/.test(value)
    ) {
      throw new Error("credential_header_invalid");
    }
    output[name] = value;
  }
  return output;
}

function responseHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const output: Record<string, string> = {};
  let count = 0;
  for (const [name, value] of Object.entries(headers)) {
    if (count >= 100 || value === undefined) break;
    if (name.toLowerCase() === "set-cookie") continue;
    const normalized = Array.isArray(value) ? value.join(", ") : String(value);
    output[name] = normalized.slice(0, 8_192);
    count += 1;
  }
  return output;
}

export async function requestPinned(input: {
  url: URL;
  address: string;
  family: 4 | 6;
  method: P13PluginNetworkRequest["method"];
  headers: Record<string, string>;
  body: Buffer | null;
  timeoutMs: number;
  maxResponseBytes: number;
  signal?: AbortSignal;
}): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const completion = Promise.withResolvers<{
    status: number;
    headers: Record<string, string>;
    body: Buffer;
  }>();
  let settled = false;
  let request: http.ClientRequest | undefined;
  const cleanup = () => input.signal?.removeEventListener("abort", onAbort);
  const finishReject = (error: Error) => {
    if (settled) return;
    settled = true;
    cleanup();
    completion.reject(error);
  };
  const onAbort = () => request?.destroy(new Error("network_request_cancelled"));
  if (input.signal?.aborted) {
    finishReject(new Error("network_request_cancelled"));
    return completion.promise;
  }
  const requestImpl = input.url.protocol === "https:" ? https.request : http.request;
  const lookup: LookupFunction = (_hostname, lookupOptions, callback) => {
    // Always return the one DNS-pinned address in the shape Node requested.
    if (lookupOptions.all) callback(null, [{ address: input.address, family: input.family }]);
    else callback(null, input.address, input.family);
  };
  const options: https.RequestOptions = {
    protocol: input.url.protocol,
    hostname: input.url.hostname,
    port: input.url.port || undefined,
    path: input.url.pathname + input.url.search,
    method: input.method,
    headers: input.headers,
    servername: input.url.hostname,
    lookup,
  };

  request = requestImpl(options, (response) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    response.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > input.maxResponseBytes) {
        response.destroy();
        request?.destroy();
        finishReject(new Error("network_response_too_large"));
        return;
      }
      chunks.push(buffer);
    });
    response.on("end", () => {
      if (settled) return;
      settled = true;
      cleanup();
      completion.resolve({
        status: response.statusCode ?? 0,
        headers: responseHeaders(response.headers),
        body: Buffer.concat(chunks),
      });
    });
    response.on("error", (error) => finishReject(error));
  });

  input.signal?.addEventListener("abort", onAbort, { once: true });
  request.setTimeout(input.timeoutMs, () => {
    request?.destroy(new Error("network_request_timeout"));
  });
  request.on("error", (error) => finishReject(error));
  if (input.body) request.write(input.body);
  request.end();
  return completion.promise;
}

export interface PinnedPublicNetworkRequest {
  url: URL;
  method: P13PluginNetworkRequest["method"];
  headers: Record<string, string>;
  body: Buffer | null;
  timeoutMs: number;
  maxResponseBytes: number;
  signal?: AbortSignal;
}

/**
 * Shared P13 host transport for policy-authorized callers such as the isolated
 * browser broker. URL/domain authority stays with the caller; this layer owns
 * public-address DNS pinning, header restrictions and bounded HTTP transport.
 */
export async function requestPublicPinned(
  input: PinnedPublicNetworkRequest,
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  if (input.url.protocol !== "https:" && input.url.protocol !== "http:") {
    throw new Error("network_protocol_denied");
  }
  if (input.url.username || input.url.password) throw new Error("network_url_credentials_denied");
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 30_000) {
    throw new Error("network_timeout_invalid");
  }
  if (
    !Number.isSafeInteger(input.maxResponseBytes)
    || input.maxResponseBytes < 1
    || input.maxResponseBytes > MAX_RESPONSE_BODY_BYTES
  ) {
    throw new Error("network_response_limit_invalid");
  }
  if (input.body && input.body.byteLength > MAX_REQUEST_BODY_BYTES) {
    throw new Error("network_request_body_too_large");
  }
  if ((input.method === "GET" || input.method === "HEAD") && input.body) {
    throw new Error("network_body_not_allowed_for_method");
  }
  input.signal?.throwIfAborted();
  const pinned = await resolvePinnedPublicAddress(input.url.hostname);
  input.signal?.throwIfAborted();
  return requestPinned({
    ...input,
    headers: normalizePluginHeaders(input.headers),
    address: pinned.address,
    family: pinned.family,
  });
}

function networkError(requestId: string, code: string) {
  return {
    protocol: "lios-plugin-broker/1",
    kind: "network.error",
    requestId,
    code,
    message: "Brokered network request failed.",
  };
}

export function createP13PluginAuxiliaryHandler(options: P13PluginAuxiliaryHandlerOptions) {
  const declaredComponents = new Set([
    ...options.manifest.connectors.map((item) => item.componentId),
    ...options.manifest.tools.map((item) => item.componentId),
    ...options.manifest.agents.map((item) => item.componentId),
  ]);

  return async (raw: unknown): Promise<unknown | null> => {
    const parsed = p13PluginNetworkRequestSchema.safeParse(raw);
    if (!parsed.success) return null;
    const request = parsed.data;

    try {
      const execution = options.lookupExecution(request.executionRequestId);
      if (!execution || execution.componentId !== request.componentId) throw new Error("network_execution_scope_invalid");
      if (!declaredComponents.has(request.componentId)) throw new Error("network_component_not_declared");

      const url = authorizeBrokeredNetworkRequest(request.url, options.manifest, options.grant);
      if (url.username || url.password) throw new Error("network_url_credentials_denied");

      const pluginHeaders = normalizePluginHeaders(request.headers);
      const pinned = await (options.resolveAddress ?? resolvePinnedPublicAddress)(url.hostname);

      let credentialHeaders: Record<string, string> = {};
      if (request.credentialHandle) {
        if (!options.manifest.permissions.includes("connector.credentials")) {
          throw new Error("credential_permission_denied");
        }
        if (!options.credentialResolver) throw new Error("credential_broker_unavailable");
        credentialHeaders = normalizeCredentialHeaders(await options.credentialResolver({
          pluginId: options.manifest.id,
          componentId: request.componentId,
          credentialHandle: request.credentialHandle,
          url,
          context: execution.context,
        }));
      }

      const body = request.bodyBase64 ? Buffer.from(request.bodyBase64, "base64") : null;
      if (body && body.byteLength > MAX_REQUEST_BODY_BYTES) throw new Error("network_request_body_too_large");
      if ((request.method === "GET" || request.method === "HEAD") && body) {
        throw new Error("network_body_not_allowed_for_method");
      }

      const response = await (options.requester ?? requestPinned)({
        url,
        address: pinned.address,
        family: pinned.family,
        method: request.method,
        headers: { ...pluginHeaders, ...credentialHeaders },
        body,
        timeoutMs: request.timeoutMs,
        maxResponseBytes: request.maxResponseBytes,
      });

      return {
        protocol: "lios-plugin-broker/1",
        kind: "network.response",
        requestId: request.requestId,
        status: response.status,
        headers: response.headers,
        bodyBase64: response.body.toString("base64"),
      };
    } catch (error) {
      const code = error instanceof Error && /^[a-z0-9_]+$/.test(error.message)
        ? error.message
        : "network_request_failed";
      return networkError(request.requestId, code);
    }
  };
}
