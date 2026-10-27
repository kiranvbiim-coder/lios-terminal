import type { SourceConnection } from "@shared/schema";
import type { InstalledPluginSnapshot } from "./p13PluginManager";
import { chatExtensionCatalogSchema, type ChatExtensionCatalog } from "@shared/chatExtensionCatalog";

/**
 * Read-only, bounded projection of canonical P13/P11 and user-owned MCP
 * installations. This is NOT a secondary package registry or permission
 * authority: the existing P13 owner, MCP Project policy and GM/L4 grants
 * still decide installation and execution.
 */
export function chatExtensionCatalog(input: {
  plugins: readonly InstalledPluginSnapshot[];
  connections: readonly SourceConnection[];
  userId: number;
  organizationId: number | null;
}): ChatExtensionCatalog {
  return chatExtensionCatalogSchema.parse({
    plugins: input.plugins.slice(0, 100).map((plugin) => ({
      id: plugin.id,
      name: plugin.manifest.name,
      version: plugin.version,
      skillCount: plugin.manifest.skills.length,
      artifactCount: plugin.manifest.artifacts.length,
      trusted: plugin.trust.state === "trusted",
      registered: plugin.trust.state === "trusted" && plugin.componentIds.length > 0,
      // A P13 component is not automatically a canonical Chat tool.
      executableFromChat: false as const,
    })),
    mcpConnections: input.connections
      .filter((connection) => connection.userId === input.userId
        && connection.organizationId === input.organizationId
        && connection.sourceType === "mcp")
      .slice(0, 100)
      .map((connection) => ({
        id: connection.id,
        name: connection.name,
        status: connection.status,
        projectRequired: true as const,
        explicitApprovalRequired: true as const,
      })),
    installationManagedByHomeOwner: true as const,
  });
}
