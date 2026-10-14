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
import { fetchWithEndpointPolicy, readBoundedText, validateSourceEndpoint } from "./sourceConnectionPolicy";
import { sanitizeLedgerPayload } from "./ledgerStore";

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
  const policy = await validateSourceEndpoint(endpoint, false);
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
  }, false);
  const text = await readBoundedText(response, 10 * 1024 * 1024);
  if (!response.ok) throw new Error(`MCP server returned HTTP ${response.status}.`);
  const parsed = JSON.parse(text) as McpJsonRpcResponse;
  if (parsed.error) throw new Error(`MCP error ${parsed.error.code ?? ""}: ${parsed.error.message ?? "unknown error"}`);
  return parsed;
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
    const response = await transport(
      config.endpoint,
      { jsonrpc: "2.0", id: crypto.randomUUID(), method, params },
      credential(policy),
      controller.signal,
    );
    return sanitizeLedgerPayload(response.result ?? null);
  } finally {
    for (const release of detach) release();
  }
}

export async function initializeExternalMcpClient(
  config: ExternalMcpServerConfig,
  transport: McpHttpTransport = defaultTransport,
) {
  return rpc(config, "initialize", {
    protocolVersion: LIOS_MCP_PROTOCOL_VERSION,
    capabilities: { tools: {}, resources: {} },
    clientInfo: { name: "LiOS", version: "1.0.0" },
  }, transport);
}

export async function listExternalMcpTools(config: ExternalMcpServerConfig, transport: McpHttpTransport = defaultTransport) {
  const result = await rpc(config, "tools/list", {}, transport) as { tools?: Array<{ name?: string }> } | null;
  const allowed = new Set(config.policy.allowedToolIds);
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
  return rpc(config, "tools/call", { name: toolId, arguments: argumentsValue }, transport, signal);
}

export async function readExternalMcpResource(
  config: ExternalMcpServerConfig,
  uri: string,
  transport: McpHttpTransport = defaultTransport,
) {
  const policy = mcpClientPolicySchema.parse(config.policy);
  assertResourceAllowed(policy, uri);
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
