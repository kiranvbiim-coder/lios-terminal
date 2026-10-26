import type { SourceConnection, User } from "@shared/schema";
import type { CanonicalDataCapability } from "@shared/universalDataFabric";
import type { LiOSDataProviderAdapter, ProviderSdkRegistry } from "./providerSdk";
import {
  callExternalMcpTool,
  externalMcpConfigForSourceConnection,
  externalMcpToolsRequireGovernedApproval,
  initializeExternalMcpClient,
  listExternalMcpTools,
  readExternalMcpResource,
} from "./externalMcpClient";
import { fetchCloudObject } from "./cloudStorageConnector";
import { resolveCredential } from "./credentialVault";
import { hashLedgerValue } from "./ledgerStore";
import { createFileProviderAdapter } from "./fileSourceProvider";
import { assertSourceConnectionScope } from "./sourceConnectionScope";
import {
  fetchApiSourceConnection,
  mapApiSourceConnection,
  queryDatabaseSource,
} from "./sourceConnectionService";

const CONTRACT_BY_CAPABILITY: Partial<Record<CanonicalDataCapability, string>> = {
  statements: "financial_statements",
  prices: "market_data",
  portfolios: "portfolio",
  transactions: "transactions",
  provider_extension: "operations",
};

function providerId(connection: SourceConnection): string {
  return `source:${connection.id}`;
}

function objectArgument(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function createPrivateApiProviderAdapter(input: {
  connectionId: number;
  providerId: string;
  label: string;
  actor: Pick<User, "id" | "email">;
}): LiOSDataProviderAdapter {
  return {
    id: input.providerId,
    label: input.label,
    priority: 50,
    capabilities: Object.keys(CONTRACT_BY_CAPABILITY) as CanonicalDataCapability[],
    pointInTimeModes: ["latest"],
    async fetch(request, context) {
      if (context.userId !== input.actor.id) throw new Error("Source connection does not belong to this user.");
      const family = CONTRACT_BY_CAPABILITY[request.capability];
      if (!family) return null;
      const result = family === "operations"
        ? await fetchApiSourceConnection(context.userId, input.connectionId, input.actor)
        : await mapApiSourceConnection(context.userId, input.connectionId, family, input.actor, { symbol: request.entity.symbol ?? undefined });
      const records = "records" in result ? result.records : [];
      if (!records.length) return null;
      return {
        providerId: input.providerId,
        data: result,
        sourceRefs: [`source-connection:${input.connectionId}`, `snapshot:${result.snapshotId}`],
        normalized: Boolean("normalizedObservations" in result && result.normalizedObservations),
        entitlement: {
          decision: "unknown",
          policyId: null,
          permittedUses: [],
          reasons: ["Private API rights are defined by the user's source agreement."],
        },
      };
    },
  };
}

export function createDatabaseProviderAdapter(input: {
  connectionId: number;
  providerId: string;
  label: string;
  actor: Pick<User, "id" | "email">;
}): LiOSDataProviderAdapter {
  return {
    id: input.providerId,
    label: input.label,
    priority: 50,
    capabilities: ["statements", "portfolios", "transactions", "provider_extension"],
    pointInTimeModes: ["latest"],
    async fetch(request, context) {
      if (context.userId !== input.actor.id) throw new Error("Source connection does not belong to this user.");
      const query = typeof request.parameters.query === "string" ? request.parameters.query : null;
      if (!query) return null;
      const params = Array.isArray(request.parameters.params) ? request.parameters.params : [];
      const result = await queryDatabaseSource(context.userId, input.connectionId, query, params, input.actor);
      if (!result.rows.length) return null;
      return {
        providerId: input.providerId,
        data: result,
        sourceRefs: [`source-connection:${input.connectionId}`, `snapshot:${result.snapshotId}`],
        normalized: false,
        entitlement: {
          decision: "unknown",
          policyId: null,
          permittedUses: [],
          reasons: ["Database rights are controlled by the connecting organization."],
        },
      };
    },
  };
}

export function createCloudStorageProviderAdapter(
  connection: SourceConnection,
): LiOSDataProviderAdapter {
  return {
    id: providerId(connection),
    label: connection.name,
    priority: 60,
    capabilities: ["provider_extension"],
    pointInTimeModes: ["latest"],
    async fetch(_request, context) {
      assertSourceConnectionScope(connection, context);
      const endpoint = typeof connection.config.endpoint === "string" ? connection.config.endpoint : null;
      if (!endpoint) return null;
      const bearer = connection.credentialRef ? resolveCredential("", connection.credentialRef) : null;
      const result = await fetchCloudObject({
        endpoint,
        bearer,
        maxBytes: typeof connection.config.maxBytes === "number" ? connection.config.maxBytes : undefined,
      });
      return {
        providerId: providerId(connection),
        data: result.value,
        // Signed URLs can contain credential query parameters. A stable
        // fingerprint identifies the object without disclosing its URL.
        sourceRefs: [`source-connection:${connection.id}`, `cloud-object:${hashLedgerValue(result.endpoint)}`],
        availableAt: result.retrievedAt,
        revision: result.etag,
        normalized: false,
        entitlement: {
          decision: "unknown",
          policyId: null,
          permittedUses: [],
          reasons: ["Cloud/object-storage rights are controlled by the connecting user or organization."],
        },
      };
    },
  };
}

export function createMcpProviderAdapter(connection: SourceConnection): LiOSDataProviderAdapter {
  return {
    id: providerId(connection),
    label: connection.name,
    priority: 60,
    capabilities: ["provider_extension"],
    pointInTimeModes: ["latest"],
    async search(request, context) {
      assertSourceConnectionScope(connection, context);
      const config = externalMcpConfigForSourceConnection(connection);
      const tools = await listExternalMcpTools(config);
      const query = request.query.trim().toLowerCase();
      return {
        providerId: providerId(connection),
        rows: tools.filter((tool) => !query || String(tool.name ?? "").toLowerCase().includes(query)),
        sourceRefs: [`mcp-server:${config.policy.serverId}`],
      };
    },
    async health(context) {
      assertSourceConnectionScope(connection, context);
      const checkedAt = new Date().toISOString();
      const started = Date.now();
      try {
        await initializeExternalMcpClient(externalMcpConfigForSourceConnection(connection));
        return {
          state: "healthy",
          checkedAt,
          latencyMs: Date.now() - started,
          detail: "MCP initialize handshake succeeded.",
        };
      } catch (error) {
        return {
          state: "degraded",
          checkedAt,
          latencyMs: Date.now() - started,
          detail: error instanceof Error ? error.message : "MCP initialize failed.",
        };
      }
    },
    async fetch(request, context) {
      assertSourceConnectionScope(connection, context);
      const config = externalMcpConfigForSourceConnection(connection);
      const toolId = typeof request.parameters.toolId === "string" ? request.parameters.toolId : null;
      const resourceUri = typeof request.parameters.resourceUri === "string" ? request.parameters.resourceUri : null;
      if (toolId) {
        // Approval authority is GM-11a through the governed-tool decision, never a request parameter. A server whose policy
        // requires approval for tools cannot be called through this data-fabric path; it fails closed until the governed
        // external-tool adapter (L10) is the caller.
        if (externalMcpToolsRequireGovernedApproval(config)) {
          throw new Error("MCP tool calls that need approval must go through the governed tool path.");
        }
        const output = await callExternalMcpTool(
          config,
          toolId,
          objectArgument(request.parameters.arguments),
        );
        return {
          providerId: providerId(connection),
          data: output,
          sourceRefs: [`mcp-tool:${toolId}`, `mcp-server:${config.policy.serverId}`],
          normalized: false,
          entitlement: {
            decision: "unknown",
            policyId: null,
            permittedUses: [],
            reasons: ["External MCP output rights inherit the connected server/tool/source terms."],
          },
        };
      }
      if (resourceUri) {
        const output = await readExternalMcpResource(config, resourceUri);
        return {
          providerId: providerId(connection),
          data: output,
          sourceRefs: [`mcp-resource:${hashLedgerValue(resourceUri)}`, `mcp-server:${config.policy.serverId}`],
          normalized: false,
          entitlement: {
            decision: "unknown",
            policyId: null,
            permittedUses: [],
            reasons: ["External MCP resource rights inherit the connected server/source terms."],
          },
        };
      }
      return {
        providerId: providerId(connection),
        data: { tools: await listExternalMcpTools(config) },
        sourceRefs: [`mcp-server:${config.policy.serverId}`],
        normalized: false,
        entitlement: {
          decision: "unknown",
          policyId: null,
          permittedUses: [],
          reasons: ["External MCP metadata only; tool execution still requires Project policy and approval."],
        },
      };
    },
  };
}

export function registerSourceConnectionProviders(
  registry: ProviderSdkRegistry,
  connections: readonly SourceConnection[],
  actor: Pick<User, "id" | "email">,
): void {
  for (const connection of connections) {
    if (connection.userId !== actor.id) throw new Error("Cannot register a source connection for a different user.");
    const id = providerId(connection);
    if (registry.get(id)) continue;
    if (connection.sourceType === "file") {
      registry.register(createFileProviderAdapter(connection));
    } else if (connection.sourceType === "private_api") {
      registry.register(createPrivateApiProviderAdapter({ connectionId: connection.id, providerId: id, label: connection.name, actor }));
    } else if (connection.sourceType === "database") {
      registry.register(createDatabaseProviderAdapter({ connectionId: connection.id, providerId: id, label: connection.name, actor }));
    } else if (connection.sourceType === "cloud_storage") {
      registry.register(createCloudStorageProviderAdapter(connection));
    } else if (connection.sourceType === "mcp") {
      registry.register(createMcpProviderAdapter(connection));
    }
  }
}
