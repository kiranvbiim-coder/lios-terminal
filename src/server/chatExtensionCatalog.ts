import type { SourceConnection } from "@shared/schema";
import { isCredentialSafeReference } from "@shared/dataFabric";
import type { InstalledPluginSnapshot } from "./p13PluginManager";
import { chatExtensionCatalogSchema, type ChatExtensionCatalog } from "@shared/chatExtensionCatalog";

/**
 * Read-only, bounded projection of canonical P13/P11 and user-owned MCP
 * installations. This is NOT a secondary package registry or permission
 * authority: the existing P13 owner, MCP Project policy and GM/L4 grants
 * still decide installation and execution.
 */
function safeLabel(value: string, fallback: string): string {
  const label = value.trim();
  const lowered = label.toLowerCase();
  const secretLabels = ["secret=", "password=", "token=", "credential=", "api_key=", "apikey=", "authorization="];
  return label && label.length <= 240
    && isCredentialSafeReference(label)
    && !label.includes("://")
    && !label.includes(String.fromCharCode(10))
    && !label.includes(String.fromCharCode(13))
    && !secretLabels.some((prefix) => lowered.includes(prefix))
    ? label : fallback;
}

export function chatExtensionCatalog(input: {
  plugins: readonly InstalledPluginSnapshot[];
  connections: readonly SourceConnection[];
  userId: number;
  organizationId: number | null;
  managementAvailable?: boolean;
}): ChatExtensionCatalog {
  return chatExtensionCatalogSchema.parse({
    plugins: input.plugins.slice(0, 100).map((plugin) => ({
      id: plugin.id,
      name: safeLabel(plugin.manifest.name, "Installed plugin"),
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
        name: safeLabel(connection.name, `MCP connection ${connection.id}`),
        status: connection.status,
        projectRequired: true as const,
        explicitApprovalRequired: true as const,
      })),
    installationManagedByHomeOwner: true as const,
    managementAvailable: input.managementAvailable === true,
  });
}
