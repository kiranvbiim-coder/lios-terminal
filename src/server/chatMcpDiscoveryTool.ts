import { z } from "zod";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import { sourceScopeAllowsProjectData, assertNotAborted } from "./conversationRuntimeCore";
import { getProject } from "./projectStore";
import { listSourceConnections } from "./sourceConnectionService";
import { externalMcpConfigForSourceConnection } from "./externalMcpClient";
import type { TenantContext } from "./tenantContext";

const inputSchema = z.object({
  connectionId: z.number().int().positive(),
}).strict();

const outputSchema = z.object({
  output: z.object({
    connectionId: z.number().int().positive(),
    sourceStatus: z.enum(["configured", "healthy", "degraded", "unreachable"]),
    allowedToolIds: z.array(z.string().trim().min(1).max(200)).max(100),
    projectScoped: z.literal(true),
    requiresExactUserApproval: z.literal(true),
    remoteDiscoveryPerformed: z.literal(false),
  }).strict(),
  summary: z.string().trim().max(2_000),
  deterministic: z.literal(true),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(10),
}).strict();

const tenantSchema = z.object({
  userId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
}).strict();

/**
 * Inspect only owner-approved *locally saved* MCP tool IDs. Actual remote
 * discovery and tool invocation remain governed by the canonical MCP
 * transport and lios.external-mcp.call (GM-11/L4 approval/Project policy).
 */
export const chatMcpDiscoveryTool: ConversationToolDefinition = {
  id: "lios.external-mcp.allowed_tools",
  label: "Show locally approved tools on one of my Project MCP connections",
  planningHint: "Input is {\"connectionId\": <positive integer>} copied from my verified/saved connection. This never connects to the MCP server; allowed tool IDs are local configuration only, not proof of server availability. To execute use lios.external-mcp.call and obtain its exact-step approval.",
  kind: "resolve",
  permissionClass: "safe_auto",
  access: "read",
  sideEffect: "none",
  replaySafe: true,
  inputSchema,
  outputSchema: outputSchema.transform((value): ConversationToolResult => value),
  maxOutputBytes: 16 * 1024,
  cancel: null,
  invoke: async (input, signal, call) => {
    assertNotAborted(signal);
    if (call.source !== "agent" || !call.requestId) throw new Error("MCP discovery requires an authenticated governed agent call.");
    if (!sourceScopeAllowsProjectData(call.sourceScope ?? "auto") || call.resourceTransmissionAllowed !== true) {
      throw new Error("MCP metadata requires permitted Project source and transmission scope.");
    }
    const tenant = tenantSchema.parse(call.tenant) as TenantContext;
    if (call.userId !== tenant.userId || !Number.isSafeInteger(call.projectId) || (call.projectId ?? 0) <= 0) {
      throw new Error("MCP discovery requires the authenticated user and a valid Project.");
    }
    const projectId = call.projectId!;
    await getProject(tenant, projectId);
    const { connectionId } = inputSchema.parse(input);
    const connection = (await listSourceConnections(tenant.userId)).find((item) =>
      item.id === connectionId
      && item.userId === tenant.userId
      && item.organizationId === tenant.organizationId
      && item.sourceType === "mcp"
      && item.status !== "invalid",
    );
    if (!connection) throw new Error("MCP connection is not available for this owner.");
    const providerId = `source:${connection.id}`;
    const policy = call.researchSourcePolicy;
    const denied = policy?.providerDeny ?? [];
    const allowed = policy?.providerAllow ?? [];
    const sourceRefs = policy?.allowedSourceRefs ?? [];
    if (denied.includes(providerId)
      || (allowed.length > 0 && !allowed.includes(providerId))
      || (policy?.mode === "only_refs" && !sourceRefs.includes(`source-connection:${connection.id}`))
      || (call.allowedSourceRefs?.length && !call.allowedSourceRefs.includes(`source-connection:${connection.id}`))) {
      throw new Error("MCP connection is excluded by the current research source policy.");
    }
    const config = externalMcpConfigForSourceConnection(connection);
    if (config.policy.projectId !== projectId) {
      throw new Error("MCP connection is outside the current Project.");
    }
    const allowedToolIds = [...new Set(config.policy.allowedToolIds)].slice(0, 100);
    assertNotAborted(signal);
    return {
      output: {
        connectionId: connection.id,
        sourceStatus: connection.status,
        allowedToolIds,
        projectScoped: true as const,
        requiresExactUserApproval: true as const,
        remoteDiscoveryPerformed: false as const,
      },
      summary: `${allowedToolIds.length} tool ID(s) allowed by saved MCP Project policy; this is not a live verification or permission to execute.`,
      deterministic: true as const,
      sourceRefs: [`source-connection:${connection.id}`],
    };
  },
};
