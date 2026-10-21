import {
  artifactContentSchema,
  type ArtifactContent,
} from "@shared/artifactContracts";
import { compareArtifactContents } from "./artifactDiff";
import {
  createArtifactProposal,
  forkArtifact,
  getArtifact,
  getArtifactVersion,
} from "./artifactStore";
import type { TenantContext } from "./tenantContext";

export interface P7ResearchBranchArtifactLike {
  id: string;
  projectId: number;
  kind: string;
  title: string;
  origin: string;
  headVersion: number;
  forkedFromArtifactId: string | null;
  forkedFromVersion: number | null;
}

export interface P7ResearchBranchVersionLike {
  id: string;
  artifactId: string;
  version: number;
  content: unknown;
}

export interface P7ResearchBranchStatus {
  parentArtifactId: string;
  branchArtifactId: string;
  baseVersion: number;
  canonicalHeadVersion: number;
  branchHeadVersion: number;
  state: "current" | "diverged";
  canProposePromotion: boolean;
}

export interface P7ResearchBranchingDeps {
  getArtifact(ctx: TenantContext, artifactId: string): Promise<P7ResearchBranchArtifactLike>;
  getArtifactVersion(ctx: TenantContext, artifactId: string, version?: number): Promise<P7ResearchBranchVersionLike>;
  forkArtifact(
    ctx: TenantContext,
    input: { artifactId: string; version: number; title?: string | null; projectId: number },
  ): Promise<{ artifact: P7ResearchBranchArtifactLike; version: P7ResearchBranchVersionLike }>;
  createArtifactProposal(
    ctx: TenantContext,
    input: {
      artifactId: string;
      baseVersion: number;
      type: "artifact_patch";
      summary: string;
      patch: Record<string, unknown>;
      actorType: "user";
      requestId?: string | null;
    },
  ): Promise<unknown>;
}

function assertResearchArtifact(artifact: P7ResearchBranchArtifactLike, label: string): void {
  if (artifact.kind !== "research") throw new Error(`${label} must be a canonical Research Artifact.`);
}

function exactResearchContent(version: P7ResearchBranchVersionLike, label: string): ArtifactContent {
  const content = artifactContentSchema.parse(version.content);
  if (content.kind !== "research") throw new Error(`${label} must contain canonical Research Artifact content.`);
  return content;
}

export function researchBranchStatus(
  parent: P7ResearchBranchArtifactLike,
  branch: P7ResearchBranchArtifactLike,
): P7ResearchBranchStatus {
  assertResearchArtifact(parent, "Research branch parent");
  assertResearchArtifact(branch, "Research branch");
  if (branch.origin !== "fork" || !branch.forkedFromArtifactId || !branch.forkedFromVersion) {
    throw new Error("Research branch must be a canonical Artifact fork with exact ancestry.");
  }
  if (branch.forkedFromArtifactId !== parent.id) {
    throw new Error("Research branch ancestry does not match the supplied canonical parent.");
  }
  if (branch.projectId !== parent.projectId) {
    throw new Error("Research branch and canonical parent must remain inside one Project.");
  }
  if (parent.headVersion < branch.forkedFromVersion) {
    throw new Error("Research branch base is newer than the canonical parent head.");
  }
  const state = parent.headVersion === branch.forkedFromVersion ? "current" : "diverged";
  return {
    parentArtifactId: parent.id,
    branchArtifactId: branch.id,
    baseVersion: branch.forkedFromVersion,
    canonicalHeadVersion: parent.headVersion,
    branchHeadVersion: branch.headVersion,
    state,
    canProposePromotion: state === "current",
  };
}

export function researchBranchPromotionPatch(content: ArtifactContent): Record<string, unknown> {
  if (content.kind !== "research") throw new Error("Only Research Artifact content can be promoted from a research branch.");
  const { kind: _kind, ...patch } = content;
  return patch;
}

async function resolveBranch(
  deps: P7ResearchBranchingDeps,
  ctx: TenantContext,
  branchArtifactId: string,
) {
  const branch = await deps.getArtifact(ctx, branchArtifactId);
  assertResearchArtifact(branch, "Research branch");
  if (branch.origin !== "fork" || !branch.forkedFromArtifactId || !branch.forkedFromVersion) {
    throw new Error("Research branch must be a canonical Artifact fork with exact ancestry.");
  }
  const parent = await deps.getArtifact(ctx, branch.forkedFromArtifactId);
  const status = researchBranchStatus(parent, branch);
  return { branch, parent, status };
}

export function createP7ResearchBranchingService(deps: P7ResearchBranchingDeps) {
  return {
    async createBranch(
      ctx: TenantContext,
      input: { artifactId: string; baseVersion: number; title?: string | null },
    ) {
      if (!Number.isInteger(input.baseVersion) || input.baseVersion < 1) {
        throw new Error("Research branch requires an exact positive base Artifact version.");
      }
      const parent = await deps.getArtifact(ctx, input.artifactId);
      assertResearchArtifact(parent, "Research branch parent");
      const base = await deps.getArtifactVersion(ctx, parent.id, input.baseVersion);
      exactResearchContent(base, "Research branch base");
      const created = await deps.forkArtifact(ctx, {
        artifactId: parent.id,
        version: input.baseVersion,
        title: input.title,
        projectId: parent.projectId,
      });
      const status = researchBranchStatus(parent, created.artifact);
      if (status.baseVersion !== input.baseVersion) {
        throw new Error("Artifact fork authority returned research branch ancestry that does not match the requested base.");
      }
      return created;
    },

    async inspectBranch(ctx: TenantContext, input: { branchArtifactId: string }) {
      const resolved = await resolveBranch(deps, ctx, input.branchArtifactId);
      return resolved.status;
    },

    async compareBranch(ctx: TenantContext, input: { branchArtifactId: string }) {
      const { branch, parent, status } = await resolveBranch(deps, ctx, input.branchArtifactId);
      const [baseVersion, branchVersion] = await Promise.all([
        deps.getArtifactVersion(ctx, parent.id, status.baseVersion),
        deps.getArtifactVersion(ctx, branch.id, branch.headVersion),
      ]);
      const baseContent = exactResearchContent(baseVersion, "Research branch base");
      const branchContent = exactResearchContent(branchVersion, "Research branch head");
      return {
        parentArtifactId: parent.id,
        branchArtifactId: branch.id,
        status,
        comparison: compareArtifactContents({
          artifactId: branch.id,
          leftVersion: status.baseVersion,
          rightVersion: branch.headVersion,
          left: baseContent,
          right: branchContent,
        }),
      };
    },

    async proposePromotion(
      ctx: TenantContext,
      input: { branchArtifactId: string; summary: string; requestId?: string | null },
    ) {
      const summary = input.summary.trim();
      if (!summary) throw new Error("Research branch promotion requires an explicit summary.");
      const { branch, parent, status } = await resolveBranch(deps, ctx, input.branchArtifactId);
      if (!status.canProposePromotion) {
        throw new Error("Canonical research advanced after this branch was created; the branch is diverged and cannot be promoted blindly.");
      }
      const [baseVersion, branchVersion] = await Promise.all([
        deps.getArtifactVersion(ctx, parent.id, status.baseVersion),
        deps.getArtifactVersion(ctx, branch.id, branch.headVersion),
      ]);
      const baseContent = exactResearchContent(baseVersion, "Research branch base");
      const branchContent = exactResearchContent(branchVersion, "Research branch head");
      const comparison = compareArtifactContents({
        artifactId: branch.id,
        leftVersion: status.baseVersion,
        rightVersion: branch.headVersion,
        left: baseContent,
        right: branchContent,
      });
      if (!comparison.changed) throw new Error("Research branch has no changes to propose for promotion.");

      const proposal = await deps.createArtifactProposal(ctx, {
        artifactId: parent.id,
        baseVersion: status.baseVersion,
        type: "artifact_patch",
        summary,
        patch: researchBranchPromotionPatch(branchContent),
        actorType: "user",
        requestId: input.requestId ?? null,
      });
      return {
        parentArtifactId: parent.id,
        branchArtifactId: branch.id,
        branchHeadVersion: branch.headVersion,
        baseVersion: status.baseVersion,
        comparison,
        proposal,
        requiresExplicitAcceptance: true as const,
      };
    },
  };
}

export const p7ResearchBranchingService = createP7ResearchBranchingService({
  getArtifact: async (ctx, artifactId) => {
    const artifact = await getArtifact(ctx, artifactId);
    if (artifact.projectId === null) throw new Error("Project research branching requires an Artifact in its owning Project.");
    return { ...artifact, projectId: artifact.projectId };
  },
  getArtifactVersion: async (ctx, artifactId, version) => getArtifactVersion(ctx, artifactId, version),
  forkArtifact: async (ctx, input) => forkArtifact(ctx, input),
  createArtifactProposal: async (ctx, input) => createArtifactProposal(ctx, input),
});
