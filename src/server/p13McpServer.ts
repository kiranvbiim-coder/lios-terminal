import {
  mcpServerExposureContractSchema,
  type McpServerExposureContract,
} from "@shared/universalDataFabric";
import { RuntimeRegistry } from "@shared/runtimeRegistry";
import { LIOS_MCP_PROTOCOL_VERSION } from "./externalMcpClient";

export interface P13McpJsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface P13McpJsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface P13McpServerPolicy {
  exposure: McpServerExposureContract;
  // The single tenant this server instance is bound to. tenantScoped in the
  // exposure contract is enforced here: every request must originate from
  // this exact organization, independent of the allowedProjectIds check
  // below, so a static project allowlist can never be reused to serve a
  // different organization's request.
  organizationId: number;
  allowedProjectIds: Array<string | number>;
  rightsApprovedToolIds: string[];
  requireExplicitApproval: boolean;
}

export interface P13McpRequestContext {
  userId: number;
  organizationId: number | null;
  projectId: string | number;
  sessionId?: string | number | null;
  dataClassification?: "public" | "organization" | "private";
}


function failure(id: string | number | null, code: number, message: string): P13McpJsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export class P13McpServer {
  private readonly exposure: McpServerExposureContract;
  private readonly projectIds: Set<string>;
  private readonly rightsApprovedTools: Set<string>;

  constructor(
    private readonly registry: RuntimeRegistry,
    private readonly policy: P13McpServerPolicy,
  ) {
    if (!policy.requireExplicitApproval) throw new Error("P13 MCP requires canonical governed approval.");
    this.exposure = mcpServerExposureContractSchema.parse(policy.exposure);
    this.projectIds = new Set(policy.allowedProjectIds.map(String));
    this.rightsApprovedTools = new Set(policy.rightsApprovedToolIds);
  }

  private visibleToolIds(): string[] {
    const exposed = new Set(this.exposure.exposedTools);
    return this.registry.list("tool")
      .map((descriptor) => descriptor.id)
      .filter((id) => exposed.has(id) && this.rightsApprovedTools.has(id))
      .sort();
  }

  async handle(
    request: P13McpJsonRpcRequest,
    context: P13McpRequestContext,
  ): Promise<P13McpJsonRpcResponse> {
    if (request.jsonrpc !== "2.0") return failure(request.id, -32600, "Invalid JSON-RPC version.");

    try {
      if (request.method === "initialize") {
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: LIOS_MCP_PROTOCOL_VERSION,
            serverInfo: { name: "LiOS governed MCP", version: "1" },
            capabilities: { tools: {} },
          },
        };
      }

      if (this.exposure.tenantScoped && context.organizationId !== this.policy.organizationId) {
        return failure(request.id, -32005, "Request organization does not match this MCP server's tenant scope.");
      }
      if (!this.projectIds.has(String(context.projectId))) {
        return failure(request.id, -32001, "Project is outside MCP server exposure policy.");
      }

      if (request.method === "tools/list") {
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            tools: this.visibleToolIds().map((name) => ({
              name,
              description: "LiOS governed tool",
              inputSchema: { type: "object", additionalProperties: true },
            })),
          },
        };
      }

      if (request.method !== "tools/call") {
        return failure(request.id, -32601, "MCP method is not exposed.");
      }

      const name = typeof request.params?.name === "string" ? request.params.name : "";

      if (!this.exposure.exposedTools.includes(name)) {
        return failure(request.id, -32002, "Tool is not exposed by LiOS MCP policy.");
      }
      if (!this.rightsApprovedTools.has(name)) {
        return failure(request.id, -32003, "Tool lacks external data-rights approval.");
      }
      // This adapter has no canonical GM-11a approval continuation. External
      // callers cannot authorize execution by supplying approved tool IDs.
      return failure(request.id, -32004, "Tool requires canonical governed approval.");

    } catch {
      return failure(request.id, -32099, "MCP execution failed.");
    }
  }

  snapshot(): McpServerExposureContract {
    return mcpServerExposureContractSchema.parse(JSON.parse(JSON.stringify(this.exposure)));
  }
}
