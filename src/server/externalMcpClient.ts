import crypto from "node:crypto";
import { currentConversationSignal, linkAbortSignal } from "./exec/execution-scope";
import type { SourceConnection } from "@shared/schema";
import {
  mcpClientPolicySchema,
  mcpServerExposureContractSchema,
  type McpClientPolicy,
  type McpServerExposureContract,
} from "@shared/universalDataFabric";
import { resolveCredential } from "./credentialVault";
import { fetchWithEndpointPolicy, isDesktopMcpLoopbackEndpoint, readBoundedText, validateMcpSourceEndpoint } from "./sourceConnectionPolicy";
import { sanitizeLedgerPayload } from "./ledgerStore";
import { withOfficialMcpClient } from "./sdkExternalMcpClient";

export const LIOS_MCP_PROTOCOL_VERSION = "2026-07-28";

export interface ExternalMcpServerConfig {
  endpoint: string;
  policy: McpClientPolicy;
}

export interface McpJsonRpcRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpJsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export type McpHttpTransport = (
  endpoint: string,
  request: McpJsonRpcRequest,
  bearer: string | null,
  signal?: AbortSignal,
) => Promise<McpJsonRpcResponse>;

async function defaultTransport(
  endpoint: string,
  request: McpJsonRpcRequest,
  bearer: string | null,
  signal?: AbortSignal,
): Promise<McpJsonRpcResponse> {
  const policy = await validateMcpSourceEndpoint(endpoint);
  if (!policy.valid || !policy.normalizedEndpoint) throw new Error(`MCP endpoint rejected: ${policy.reason}.`);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "MCP-Protocol-Version": LIOS_MCP_PROTOCOL_VERSION,
  };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const response = await fetchWithEndpointPolicy(policy.normalizedEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
    signal,
  }, isDesktopMcpLoopbackEndpoint(policy.normalizedEndpoint), 0);
  const text = await readBoundedText(response, 10 * 1024 * 1024);
  if (!response.ok) throw new Error(`MCP server returned HTTP ${response.status}.`);
  // A response is untrusted until rpc() validates its JSON-RPC envelope
  // against the exact request ID. In particular, do not accept an error
  // message from an unrelated, spoofed response.
  return JSON.parse(text) as McpJsonRpcResponse;
}

/**
 * External MCP transports are untrusted even when provided by an approved
 * source connection. Reject mismatched, batched, malformed, or ambiguous
 * responses BEFORE treating any result as a successful agent/tool observation.
 * Correlation follows JSON-RPC 2.0 and the MCP request/response contract.
 */
export function validateExternalMcpRpcResponse(
  request: McpJsonRpcRequest,
  value: unknown,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MCP transport returned an invalid JSON-RPC response.");
  }
  const response = value as Record<string, unknown>;
  if (response.jsonrpc !== "2.0" || response.id !== request.id) {
    throw new Error("MCP transport returned a mismatched JSON-RPC response.");
  }
  const hasResult = Object.prototype.hasOwnProperty.call(response, "result");
  const hasError = Object.prototype.hasOwnProperty.call(response, "error");
  if (hasResult === hasError) {
    throw new Error("MCP transport returned an ambiguous JSON-RPC response.");
  }
  if (hasError) {
    const error = response.error;
    if (!error || typeof error !== "object" || Array.isArray(error)
      || typeof (error as Record<string, unknown>).code !== "number"
      || !Number.isSafeInteger((error as { code: number }).code)
      || typeof (error as Record<string, unknown>).message !== "string") {
      throw new Error("MCP transport returned a malformed JSON-RPC error.");
    }
    // Remote messages may include server secrets or attacker-controlled text.
    // The governed caller receives a stable, non-secret failure instead.
    throw new Error(`MCP tool transport returned JSON-RPC error ${(error as Record<string, unknown>).code}.`);
  }
  return response.result;
}

function credential(policy: McpClientPolicy): string | null {
  return policy.credentialRef ? resolveCredential("", policy.credentialRef) : null;
}

export function externalMcpConfigForSourceConnection(
  connection: Pick<SourceConnection, "id" | "sourceType" | "config" | "credentialRef">,
): ExternalMcpServerConfig {
  if (connection.sourceType !== "mcp") throw new Error("Source connection is not an MCP server.");
  const endpoint = typeof connection.config.endpoint === "string" ? connection.config.endpoint : null;
  const projectId = typeof connection.config.projectId === "number" ? connection.config.projectId : null;
  if (!endpoint || !projectId || !Number.isInteger(projectId) || projectId <= 0) {
    throw new Error("MCP source requires endpoint and positive Project ID.");
  }
  const csv = (value: unknown): string[] => typeof value === "string"
    ? value.split(",").map((item) => item.trim()).filter(Boolean)
    : [];
  return {
    endpoint,
    policy: mcpClientPolicySchema.parse({
      projectId,
      serverId: `source:${connection.id}`,
      allowedToolIds: csv(connection.config.allowedToolIds),
      allowedResourcePrefixes: csv(connection.config.allowedResourcePrefixes),
      credentialRef: connection.credentialRef ?? null,
      requireApprovalForTools: connection.config.requireApprovalForTools !== false,
      healthTimeoutMs: typeof connection.config.healthTimeoutMs === "number"
        ? connection.config.healthTimeoutMs
        : 5_000,
    }),
  };
}

/**
 * Lower-level policy/transport primitive: allowed tool ids, endpoint/credential/data bounds and cancellation only.
 * Approval authority is not here. It lives in the governed-tool decision (GM-11a grants through the L1 registry), so no
 * caller-provided boolean, list or token can approve a call at this layer.
 */
function assertToolAllowed(policy: McpClientPolicy, toolId: string): void {
  if (!policy.allowedToolIds.includes(toolId)) throw new Error(`MCP tool "${toolId}" is outside Project policy.`);
}

/** True when Project policy says tool calls need approval. The decision itself is made by the governed-tool layer, not here. */
export function externalMcpToolsRequireGovernedApproval(config: ExternalMcpServerConfig): boolean {
  return mcpClientPolicySchema.parse(config.policy).requireApprovalForTools;
}

function assertResourceAllowed(policy: McpClientPolicy, uri: string): void {
  if (!policy.allowedResourcePrefixes.some((prefix) => uri.startsWith(prefix))) {
    throw new Error("MCP resource is outside Project policy.");
  }
}

async function rpc(
  config: ExternalMcpServerConfig,
  method: string,
  params: Record<string, unknown>,
  transport: McpHttpTransport,
  signal?: AbortSignal,
): Promise<unknown> {
  const policy = mcpClientPolicySchema.parse(config.policy);
  const controller = new AbortController();
  const detach = [
    linkAbortSignal(AbortSignal.timeout(30_000), controller),
    linkAbortSignal(currentConversationSignal(), controller),
    linkAbortSignal(signal, controller),
  ];
  try {
    const request: McpJsonRpcRequest = { jsonrpc: "2.0", id: crypto.randomUUID(), method, params };
    const response = await transport(
      config.endpoint,
      request,
      credential(policy),
      controller.signal,
    );
    return sanitizeLedgerPayload(validateExternalMcpRpcResponse(request, response) ?? null);
  } finally {
    for (const release of detach) release();
  }
}

export async function initializeExternalMcpClient(
  config: ExternalMcpServerConfig,
  transport: McpHttpTransport = defaultTransport,
) {
  if (transport === defaultTransport) {
    return withOfficialMcpClient(config, async client => sanitizeLedgerPayload({
      serverInfo: client.getServerVersion(),
      capabilities: client.getServerCapabilities(),
    }));
  }
  return rpc(config, "initialize", {
    protocolVersion: LIOS_MCP_PROTOCOL_VERSION,
    capabilities: { tools: {}, resources: {} },
    clientInfo: { name: "LiOS", version: "1.0.0" },
  }, transport);
}

export async function listExternalMcpTools(config: ExternalMcpServerConfig, transport: McpHttpTransport = defaultTransport) {
  const allowed = new Set(config.policy.allowedToolIds);
  if (transport === defaultTransport) {
    return withOfficialMcpClient(config, async (client, signal) => {
      const result = await client.listTools(undefined, { signal });
      const safe = sanitizeLedgerPayload(result.tools.filter(tool => allowed.has(tool.name)));
      // LiOS's ledger sanitizer deliberately returns unknown. Preserve a
      // validated tool-list shape for the existing source connection adapter.
      if (!Array.isArray(safe)) throw new Error("MCP tool catalog was not an array.");
      return safe.filter((tool: unknown): tool is { name: string } =>
        Boolean(tool && typeof tool === "object" && typeof (tool as { name?: unknown }).name === "string"));
    });
  }
  const result = await rpc(config, "tools/list", {}, transport) as { tools?: Array<{ name?: string }> } | null;
  return (result?.tools ?? []).filter((tool) => tool.name && allowed.has(tool.name));
}

export async function callExternalMcpTool(
  config: ExternalMcpServerConfig,
  toolId: string,
  argumentsValue: Record<string, unknown>,
  transport: McpHttpTransport = defaultTransport,
  signal?: AbortSignal,
) {
  const policy = mcpClientPolicySchema.parse(config.policy);
  assertToolAllowed(policy, toolId);
  if (transport === defaultTransport) {
    return withOfficialMcpClient(config, async (client, operationSignal) => {
      const result = await client.callTool({ name: toolId, arguments: argumentsValue }, { signal: operationSignal });
      if (result.isError) throw new Error("MCP tool returned a declared failure.");
      return sanitizeLedgerPayload(result);
    }, signal);
  }
  return rpc(config, "tools/call", { name: toolId, arguments: argumentsValue }, transport, signal);
}

export async function readExternalMcpResource(
  config: ExternalMcpServerConfig,
  uri: string,
  transport: McpHttpTransport = defaultTransport,
) {
  const policy = mcpClientPolicySchema.parse(config.policy);
  assertResourceAllowed(policy, uri);
  if (transport === defaultTransport) {
    return withOfficialMcpClient(config, async (client, signal) =>
      sanitizeLedgerPayload(await client.readResource({ uri }, { signal })));
  }
  return rpc(config, "resources/read", { uri }, transport);
}

export function liosMcpServerExposureContract(input: {
  tools?: string[];
  resources?: string[];
} = {}): McpServerExposureContract {
  return mcpServerExposureContractSchema.parse({
    version: "1",
    exposedTools: input.tools ?? [],
    exposedResources: input.resources ?? [],
    filesystemExposure: false,
    secretExposure: false,
    internalStateExposure: false,
    tenantScoped: true,
  });
}
