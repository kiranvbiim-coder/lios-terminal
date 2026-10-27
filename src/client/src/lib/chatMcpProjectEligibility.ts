import type { ChatExtensionCatalog } from "@shared/chatExtensionCatalog";

type McpCatalogRow = ChatExtensionCatalog["mcpConnections"][number];

/**
 * A connection belonging to another Project must never look actionable in
 * the currently selected Chat. Server-side Project ownership and canonical
 * GM/L4 grants still revalidate before any MCP operation.
 */
export function canInspectMcpInChat(projectId: number | null, connection: Pick<McpCatalogRow, "projectId" | "status">): boolean {
  return projectId !== null
    && Number.isSafeInteger(projectId)
    && projectId > 0
    && connection.projectId === projectId
    && connection.status !== "invalid";
}
