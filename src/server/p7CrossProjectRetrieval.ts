import { z } from "zod";
import type { P7SearchHit } from "@shared/p7ResearchContracts";
import type { TenantContext } from "./tenantContext";
import { getProject } from "./projectStore";
import { searchProjectIntelligence } from "./p7ProjectIntelligenceStore";

export const p7CrossProjectSearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(2_000),
  projectIds: z.array(z.number().int().positive()).min(1).max(20),
  limit: z.number().int().min(1).max(100).default(30),
  allowedSourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(5_000).default([]),
}).strict();

export type P7CrossProjectSearchRequest = z.infer<typeof p7CrossProjectSearchRequestSchema>;
export type P7CrossProjectSearchHit = P7SearchHit & { projectId: number };

export interface P7CrossProjectRetrievalDependencies {
  assertProjectAccess: (ctx: TenantContext, projectId: number) => Promise<unknown>;
  searchProject: (
    ctx: TenantContext,
    projectId: number,
    request: { query: string; limit: number; allowedSourceRefs: string[] },
  ) => Promise<P7SearchHit[]>;
}

const DEFAULT_DEPENDENCIES: P7CrossProjectRetrievalDependencies = {
  assertProjectAccess: getProject,
  searchProject: searchProjectIntelligence,
};

function rankCrossProjectHits(a: P7CrossProjectSearchHit, b: P7CrossProjectSearchHit): number {
  return b.combinedScore - a.combinedScore
    || b.lexicalScore - a.lexicalScore
    || a.projectId - b.projectId
    || a.sourceRef.localeCompare(b.sourceRef);
}

/**
 * SI-03.05 bounded cross-Project retrieval.
 *
 * Project IDs are explicit input to the governed operation. This helper never
 * discovers or expands that set. Every requested Project is authorized through
 * the canonical Project owner/org check before the first target search starts,
 * so a mixed authorized/unauthorized request fails closed without partial
 * retrieval. The P7 index remains the existing derived authority.
 */
export async function searchExplicitProjectIntelligence(
  ctx: TenantContext,
  anchorProjectId: number,
  request: unknown,
  dependencies: P7CrossProjectRetrievalDependencies = DEFAULT_DEPENDENCIES,
): Promise<P7CrossProjectSearchHit[]> {
  if (!Number.isInteger(anchorProjectId) || anchorProjectId <= 0) {
    throw new Error("Cross-Project retrieval requires a valid current Project.");
  }

  const parsed = p7CrossProjectSearchRequestSchema.parse(request);
  const projectIds = [...new Set(parsed.projectIds)];
  if (!projectIds.some((projectId) => projectId !== anchorProjectId)) {
    throw new Error("Cross-Project retrieval requires at least one explicitly selected Project other than the current Project.");
  }

  // Validate the run's current Project and every exact target before any P7
  // query/rebuild is allowed to execute. Do not return partial authorized data
  // when another requested Project is outside the current tenant authority.
  await dependencies.assertProjectAccess(ctx, anchorProjectId);
  for (const projectId of projectIds) {
    await dependencies.assertProjectAccess(ctx, projectId);
  }

  const allowedSourceRefs = [...new Set(parsed.allowedSourceRefs.map((value) => value.trim()).filter(Boolean))];
  const perProject = await Promise.all(projectIds.map(async (projectId) => {
    const hits = await dependencies.searchProject(ctx, projectId, {
      query: parsed.query,
      limit: parsed.limit,
      allowedSourceRefs,
    });
    return hits.map((hit) => ({ projectId, ...hit }));
  }));

  return perProject.flat().sort(rankCrossProjectHits).slice(0, parsed.limit);
}
