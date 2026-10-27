import type { SourceConnection } from "@shared/schema";
import type { TenantContext } from "./tenantContext";

/**
 * A provider registry is built per request, but an adapter may outlive that
 * request (cache/deduplication, held registry or an async continuation).
 * Explicitly guard the closed-over source before any private I/O.
 */
export function assertSourceConnectionScope(
  connection: Pick<SourceConnection, "userId" | "organizationId">,
  tenant: Pick<TenantContext, "userId" | "organizationId">,
): void {
  if (connection.userId !== tenant.userId || connection.organizationId !== tenant.organizationId) {
    throw new Error("Source connection is not available for the current user and organization.");
  }
}
