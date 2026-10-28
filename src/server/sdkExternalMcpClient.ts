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
import { createHash } from "node:crypto";
import { getRequestIdentity } from "./requestContext";
import { providerCredentialRevision } from "./providerCredentialRevision";
import { homeMcpStartupBackoff, McpStartupBackoffError } from "./mcpStartupBackoff";
import { organizationCredentialRevision } from "./organizationCredentialVault";

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
    // Official SDK v2 can use a ReadableStream POST body. Node fetch rejects
    // streamed request bodies unless duplex:"half" is forwarded. The mocked
    // fetch contract never surfaced this real desktop-transport failure.
    const streamedBody = init?.body != null
      && typeof (init.body as { getReader?: unknown }).getReader === "function";
    const response = await fetcher(actual.href, {
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
      signal: init?.signal,
      cache: init?.cache,
      credentials: "omit",
      ...(streamedBody ? { duplex: "half" as const } : {}),
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
  if (config.policy.credentialRef && !bearer) {
    unlink.forEach(release => release());
    // A source configured to use an owner credential must NEVER silently
    // fall through as an anonymous connection when that credential is absent
    // or has been revoked. No network call or prompt may leave the machine.
    throw new Error("MCP source credential is unavailable or revoked.");
  }
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
    const connect = () => client.connect(transport, {
      signal: controller.signal,
      timeout: Math.min(30_000, Math.max(1_000, config.policy.healthTimeoutMs)),
    });
    const identity = getRequestIdentity();
    if (identity?.userId != null) {
      // Only a known canonical request identity may share negative startup state.
      // Credentials never enter the key; mutation revisions and policy/endpoint identity fence old observations.
      const key = createHash("sha256").update(JSON.stringify({
        userId: identity.userId, organizationId: identity.organizationId,
        endpoint: policy.normalizedEndpoint, policy: config.policy,
        credentialRevision: providerCredentialRevision(),
        organizationCredentialRevision: identity.organizationId === null ? 0 : organizationCredentialRevision(identity.organizationId),
      })).digest("hex");
      await homeMcpStartupBackoff.connect(key, controller.signal, connect);
    } else {
      // Standalone trusted callers lack an owner key; do not create global cross-tenant cooldown state.
      await connect();
    }
    if (controller.signal.aborted) throw new Error("MCP request cancelled.");
    return await operation(client, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("MCP request cancelled or timed out.");
    if (error instanceof McpStartupBackoffError) throw error;
    // Never pass remote SDK error bodies or endpoint credentials to Chat.
    if (error instanceof Error && /MCP (transport|source|response)/.test(error.message)) throw error;
    throw new Error("MCP server request failed or returned an unsupported response.");
  } finally {
    unlink.forEach(release => release());
    try { await client.close(); } catch { /* closing an already failed transport is best-effort */ }
  }
}
