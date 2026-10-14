import type { TenantContext } from "./tenantContext";
import { listProjectIntelligenceDocuments, rebuildProjectIntelligence } from "./p7ProjectIntelligenceStore";
import { buildP7TimelineIntelligence, type P7TimelineIntelligence } from "./p7TimelineIntelligence";

/**
 * Research-facing SI-03.18 entry point. It consumes the existing tenant-scoped
 * P7 Project Intelligence authority and adds no persistence of its own.
 */
export async function currentProjectTimelineIntelligence(
  ctx: TenantContext,
  projectId: number,
  options: { maxEvents?: number } = {},
): Promise<P7TimelineIntelligence> {
  let documents = await listProjectIntelligenceDocuments(ctx, projectId);
  if (!documents.length) documents = (await rebuildProjectIntelligence(ctx, projectId)).documents;
  return buildP7TimelineIntelligence(documents, options);
}
