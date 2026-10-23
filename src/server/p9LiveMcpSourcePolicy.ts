import type { SourceConnection } from "@shared/schema";
import type { TenantContext } from "./tenantContext";

/**
 * A P9 evidence reference is not a durable source permission. P9 only
 * revalidates explicitly recorded MCP server/source ids; it never turns them
 * into an unattended external tool grant, and does not contact the endpoint.
 *
 * Refs are accepted only in the two forms produced by the canonical source
 * and governed MCP adapters. All unrelated P9 source IDs remain untouched.
 */
export function assertP9CurrentMcpSourceReferences(
  ctx: TenantContext,
  projectId: number,
  sourceRefs: readonly string[],
  connections: readonly SourceConnection[],
  credentialAvailable: (ref: string) => boolean,
): void {
  const connectionIds = new Set<number>();
  let sawMcpTool = false;
  for (const ref of sourceRefs) {
    if (ref.startsWith("mcp-server:")) {
      const match = /^mcp-server:source:([1-9][0-9]*)$/.exec(ref);
      if (!match || !Number.isSafeInteger(Number(match[1]))) {
        throw new Error("Saved automation MCP source reference is not a current canonical source identity.");
      }
      connectionIds.add(Number(match[1]));
    } else if (ref.startsWith("source-connection:")) {
      const match = /^source-connection:([1-9][0-9]*)$/.exec(ref);
      if (!match || !Number.isSafeInteger(Number(match[1]))) {
        throw new Error("Saved automation source reference is not a canonical source identity.");
      }
      const id = Number(match[1]);
      if (connections.some(connection => connection.id === id && connection.sourceType === "mcp")) {
        connectionIds.add(id);
      } else if (!connections.some(connection => connection.id === id)) {
        // A missing reference could be a revoked or deleted MCP connection.
        // Never silently treat an unresolved source id as a non-MCP source.
        throw new Error("Saved automation source connection is no longer available to its owner.");
      }
    } else if (ref.startsWith("mcp-tool:")) {
      sawMcpTool = true;
    }
  }
  if (sawMcpTool && connectionIds.size === 0) {
    throw new Error("Saved automation MCP tool reference has no owned source identity.");
  }
  for (const id of connectionIds) {
    const source = connections.find(connection => connection.id === id);
    if (!source || source.userId !== ctx.userId || source.organizationId !== ctx.organizationId
      || source.sourceType !== "mcp" || source.status === "invalid") {
      throw new Error("Saved automation MCP source is revoked or outside current owner authority.");
    }
    const configuredProject = source.config.projectId;
    if (configuredProject !== projectId && configuredProject !== String(projectId)) {
      throw new Error("Saved automation MCP source does not belong to this Project.");
    }
    if (source.config.aiTransmission !== "allow" || source.config.aiUsageRights !== "cleared") {
      throw new Error("Saved automation MCP source has no current owner-declared AI release rights.");
    }
    if (source.credentialRef && !credentialAvailable(source.credentialRef)) {
      throw new Error("Saved automation MCP source credential is revoked or unavailable.");
    }
  }
}
