/**
 * Official MCP TypeScript SDK v2.3.1 transport adapter (Apache-2.0).
 * Upstream: https://github.com/modelcontextprotocol/typescript-sdk/tree/v2.3.1/packages/client
 * The SDK owns protocol framing, negotiation, pagination and Streamable HTTP.
 * LiOS retains transport admission, credentials, scope, cancellation and receipts.
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { ExternalMcpServerConfig } from "./externalMcpClient";
import { currentConversationSignal, linkAbortSignal } from "./exec/execution-scope";
import { resolveCredential } from "./credentialVault";
import { fetchWithEndpointPolicy, isDesktopMcpLoopbackEndpoint, validateMcpSourceEndpoint } from "./sourceConnectionPolicy";

export const LIOS_MCP_SDK_VERSION = "2.3.1";
export const MCP_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export function boundMcpResponse(response: Response, limit = MCP_MAX_RESPONSE_BYTES): Response {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!Number.isSafeInteger(Number(declared)) || Number(declared) > limit)) {
    response.body?.cancel().catch(() => {});
    throw new Error("MCP response exceeded the source read limit.");
  }
  if (!response.body) return response;
  const reader = response.body.getReader();
  let used = 0;
  const bounded = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { controller.close(); return; }
        used += value.byteLength;
        if (used > limit) {
          await reader.cancel();
          controller.error(new Error("MCP response exceeded the source read limit."));
          return;
        }
        controller.enqueue(value);
      } catch (error) { controller.error(error); }
    },
    async cancel(reason) { await reader.cancel(reason); },
  });
  return new Response(bounded, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/**
 * The SDK's custom fetch is intentionally constrained to the registered MCP
 * endpoint. OAuth authorization/metadata and arbitrary server redirects are
 * not enabled in this first slice; they need separate provider/issuer review.
 * SDK transports may POST, GET and DELETE; all requests use LiOS's existing
 * DNS/SSRF network policy and strict response byte budget.
 */
export function scopedMcpFetch(endpoint: string, fetcher = fetchWithEndpointPolicy): typeof fetch {
  return async (input, init) => {
    const actual = new URL(input instanceof Request ? input.url : String(input));
    const expected = new URL(endpoint);
    if (actual.href !== expected.href || actual.username || actual.password) {
      throw new Error("MCP transport refused an unapproved endpoint.");
    }
    const policy = await validateMcpSourceEndpoint(actual.href);
    if (!policy.valid || policy.normalizedEndpoint !== expected.href) {
      throw new Error("MCP transport endpoint failed source policy.");
    }
    // MCP is pinned to this exact URL, not merely its origin. The source
    // fetch helper must reject the first 3xx BEFORE forwarding any bearer,
    // cookie-equivalent headers, or request body to a new path or host.
    const response = await fetcher(actual.href, {
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
      signal: init?.signal,
      cache: init?.cache,
      credentials: "omit",
    }, isDesktopMcpLoopbackEndpoint(actual.href), 0);
    if (response.url && response.url !== actual.href) {
      response.body?.cancel().catch(() => {});
      throw new Error("MCP transport refused a redirected endpoint.");
    }
    return boundMcpResponse(response);
  };
}

export async function withOfficialMcpClient<T>(
  config: ExternalMcpServerConfig,
  operation: (client: Client, signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const policy = await validateMcpSourceEndpoint(config.endpoint);
  if (!policy.valid || !policy.normalizedEndpoint) throw new Error("MCP source endpoint is unavailable or blocked.");
  const controller = new AbortController();
  const unlink = [
    linkAbortSignal(AbortSignal.timeout(30_000), controller),
    linkAbortSignal(currentConversationSignal(), controller),
    linkAbortSignal(signal, controller),
  ];
  const bearer = config.policy.credentialRef ? resolveCredential("", config.policy.credentialRef) : null;
  const client = new Client({ name: "LiOS", version: "1.0.0" }, {
    listMaxPages: 16,
    enforceStrictCapabilities: true,
    // SDK v2 defaults to the legacy protocol unless opted in. Probe modern
    // server/discover, falling back to the official legacy initialize path
    // only when the server explicitly demonstrates legacy behavior.
    versionNegotiation: { mode: "auto", probe: { timeoutMs: 5_000 } },
  });
  const transport = new StreamableHTTPClientTransport(new URL(policy.normalizedEndpoint), {
    redirectPolicy: "same-origin",
    requestInit: bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : undefined,
    fetch: scopedMcpFetch(policy.normalizedEndpoint),
  });
  try {
    if (controller.signal.aborted) throw new Error("MCP request cancelled.");
    await client.connect(transport, {
      signal: controller.signal,
      timeout: Math.min(30_000, Math.max(1_000, config.policy.healthTimeoutMs)),
    });
    if (controller.signal.aborted) throw new Error("MCP request cancelled.");
    return await operation(client, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("MCP request cancelled or timed out.");
    // Never pass remote SDK error bodies or endpoint credentials to Chat.
    if (error instanceof Error && /MCP (transport|source|response)/.test(error.message)) throw error;
    throw new Error("MCP server request failed or returned an unsupported response.");
  } finally {
    unlink.forEach(release => release());
    try { await client.close(); } catch { /* closing an already failed transport is best-effort */ }
  }
}
