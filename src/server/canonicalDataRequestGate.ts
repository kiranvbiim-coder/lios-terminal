/**
 * One request-policy boundary for both single and batched Data Fabric
 * execution. A prefetch is still an execution and must never skip Project
 * ownership or point-in-time/anti-lookahead constraints.
 *
 * All requests are checked before the caller starts any provider work.
 */
import type { CanonicalDataRequest } from "@shared/universalDataFabric";
import type { TenantContext } from "./tenantContext";
import { getProject } from "./projectStore";
import { assertWorkflowPointInTimePolicy } from "./workflowDataPolicy";

type ProjectAccessCheck = (tenant: TenantContext, projectId: number) => Promise<unknown>;

export async function authorizeCanonicalDataRequests(
  requests: readonly CanonicalDataRequest[],
  tenant: TenantContext,
  checkProjectAccess: ProjectAccessCheck = getProject,
): Promise<void> {
  const projectIds = new Set<number>();
  for (const request of requests) {
    if (request.projectId !== null) {
      if (!Number.isSafeInteger(request.projectId) || request.projectId <= 0) {
        throw new Error("Invalid Project scope.");
      }
      projectIds.add(request.projectId);
    }
    const workflowKind = request.parameters.workflowKind;
    if (workflowKind === "research" || workflowKind === "backtest") {
      assertWorkflowPointInTimePolicy(workflowKind, request.pointInTime);
    }
  }
  // Finish every Project ownership check before any provider call in this
  // batch; do not let a later unauthorized request trigger partial fetching.
  for (const projectId of projectIds) await checkProjectAccess(tenant, projectId);
}
