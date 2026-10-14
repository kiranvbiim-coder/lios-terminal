import assert from "node:assert/strict";
import test from "node:test";
import { artifactContentSchema } from "@shared/artifactContracts";
import {
  createP7ResearchBranchingService,
  researchBranchStatus,
} from "./p7ResearchBranching";

const research = (question: string) => artifactContentSchema.parse({
  kind: "research",
  question,
  blocks: [],
});

function artifact(input: {
  id: string;
  headVersion: number;
  origin?: "direct" | "fork";
  forkedFromArtifactId?: string | null;
  forkedFromVersion?: number | null;
  kind?: "research" | "report";
}) {
  return {
    id: input.id,
    projectId: 1,
    kind: input.kind ?? "research",
    title: input.id,
    origin: input.origin ?? "direct",
    headVersion: input.headVersion,
    forkedFromArtifactId: input.forkedFromArtifactId ?? null,
    forkedFromVersion: input.forkedFromVersion ?? null,
  };
}

function version(artifactId: string, versionNumber: number, content = research(`question-v${versionNumber}`)) {
  return {
    id: `${artifactId}@v${versionNumber}`,
    artifactId,
    version: versionNumber,
    content,
    contentHash: `${artifactId}-${versionNumber}`,
    sourceRefs: [],
    executionReceiptIds: [],
    assumptionRefs: [],
    trustManifest: null,
  };
}

const ctx = { userId: 1, organizationId: null } as any;

test("SI-03.20 status is current only while canonical parent remains on the exact branch base", () => {
  const branch = artifact({
    id: "artifact:branch",
    headVersion: 3,
    origin: "fork",
    forkedFromArtifactId: "artifact:parent",
    forkedFromVersion: 2,
  });
  const current = researchBranchStatus(artifact({ id: "artifact:parent", headVersion: 2 }), branch);
  assert.equal(current.state, "current");
  assert.equal(current.canProposePromotion, true);
  assert.equal(current.branchHeadVersion, 3);
  assert.equal(current.baseVersion, 2);

  const diverged = researchBranchStatus(artifact({ id: "artifact:parent", headVersion: 4 }), branch);
  assert.equal(diverged.state, "diverged");
  assert.equal(diverged.canProposePromotion, false);
});

test("SI-03.20 creates a research branch through exact-version P4 fork authority without touching parent state", async () => {
  const parent = artifact({ id: "artifact:parent", headVersion: 2 });
  const before = structuredClone(parent);
  const calls: any[] = [];
  const service = createP7ResearchBranchingService({
    getArtifact: async (_ctx, id) => id === parent.id ? parent : (() => { throw new Error("unexpected artifact"); })(),
    getArtifactVersion: async (_ctx, id, v) => {
      calls.push(["getVersion", id, v]);
      return version(id, v ?? 0);
    },
    forkArtifact: async (_ctx, input) => {
      calls.push(["fork", input]);
      return {
        artifact: artifact({
          id: "artifact:branch",
          headVersion: 1,
          origin: "fork",
          forkedFromArtifactId: parent.id,
          forkedFromVersion: input.version,
        }),
        version: version("artifact:branch", 1),
      };
    },
    createArtifactProposal: async () => { throw new Error("proposal must not be created during branch creation"); },
  });

  const created = await service.createBranch(ctx, { artifactId: parent.id, baseVersion: 1, title: "Bear case" });
  assert.equal(created.artifact.id, "artifact:branch");
  assert.deepEqual(parent, before, "branch creation must not mutate canonical parent state");
  assert.deepEqual(calls.at(-1), ["fork", { artifactId: parent.id, version: 1, title: "Bear case", projectId: parent.projectId }]);
});

test("SI-03.20 compares branch head against the exact parent base and keeps sibling forks isolated", async () => {
  const parent = artifact({ id: "artifact:parent", headVersion: 1 });
  const branchA = artifact({ id: "artifact:branch-a", headVersion: 2, origin: "fork", forkedFromArtifactId: parent.id, forkedFromVersion: 1 });
  const branchB = artifact({ id: "artifact:branch-b", headVersion: 1, origin: "fork", forkedFromArtifactId: parent.id, forkedFromVersion: 1 });
  const artifacts = new Map([[parent.id, parent], [branchA.id, branchA], [branchB.id, branchB]]);
  const contents = new Map([
    [`${parent.id}@1`, version(parent.id, 1, research("Base hypothesis"))],
    [`${branchA.id}@2`, version(branchA.id, 2, research("Bear hypothesis"))],
    [`${branchB.id}@1`, version(branchB.id, 1, research("Bull hypothesis"))],
  ]);
  const service = createP7ResearchBranchingService({
    getArtifact: async (_ctx, id) => artifacts.get(id)!,
    getArtifactVersion: async (_ctx, id, v) => contents.get(`${id}@${v}`)!,
    forkArtifact: async () => { throw new Error("not used"); },
    createArtifactProposal: async () => { throw new Error("not used"); },
  });

  const a = await service.compareBranch(ctx, { branchArtifactId: branchA.id });
  const b = await service.compareBranch(ctx, { branchArtifactId: branchB.id });
  assert.equal(a.comparison.changed, true);
  assert.equal(b.comparison.changed, true);
  assert.equal(a.branchArtifactId, branchA.id);
  assert.equal(b.branchArtifactId, branchB.id);
  assert.notEqual(a.branchArtifactId, b.branchArtifactId);
});

test("SI-03.20 promotion creates only a parent proposal and never silently accepts it", async () => {
  const parent = artifact({ id: "artifact:parent", headVersion: 2 });
  const branch = artifact({ id: "artifact:branch", headVersion: 3, origin: "fork", forkedFromArtifactId: parent.id, forkedFromVersion: 2 });
  const artifacts = new Map([[parent.id, parent], [branch.id, branch]]);
  const versions = new Map([
    [`${parent.id}@2`, version(parent.id, 2, research("Base hypothesis"))],
    [`${branch.id}@3`, version(branch.id, 3, research("Alternative hypothesis"))],
  ]);
  const proposals: any[] = [];
  const service = createP7ResearchBranchingService({
    getArtifact: async (_ctx, id) => artifacts.get(id)!,
    getArtifactVersion: async (_ctx, id, v) => versions.get(`${id}@${v}`)!,
    forkArtifact: async () => { throw new Error("not used"); },
    createArtifactProposal: async (_ctx, input) => {
      proposals.push(input);
      return { id: "proposal:1", ...input, status: "pending" };
    },
  });

  const result = await service.proposePromotion(ctx, {
    branchArtifactId: branch.id,
    summary: "Promote the explicitly reviewed alternate hypothesis",
  });
  assert.equal(result.proposal.id, "proposal:1");
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].artifactId, parent.id);
  assert.equal(proposals[0].baseVersion, 2);
  assert.equal(proposals[0].type, "artifact_patch");
  assert.equal(proposals[0].patch.question, "Alternative hypothesis");
  assert.equal("kind" in proposals[0].patch, false, "branch promotion must preserve parent Artifact kind authority");
  assert.equal(result.requiresExplicitAcceptance, true);
});

test("SI-03.20 promotion fails closed when canonical parent advanced after branch creation", async () => {
  const parent = artifact({ id: "artifact:parent", headVersion: 3 });
  const branch = artifact({ id: "artifact:branch", headVersion: 2, origin: "fork", forkedFromArtifactId: parent.id, forkedFromVersion: 2 });
  let proposals = 0;
  const service = createP7ResearchBranchingService({
    getArtifact: async (_ctx, id) => id === parent.id ? parent : branch,
    getArtifactVersion: async (_ctx, id, v) => version(id, v ?? 0),
    forkArtifact: async () => { throw new Error("not used"); },
    createArtifactProposal: async () => { proposals += 1; return {}; },
  });

  await assert.rejects(
    service.proposePromotion(ctx, { branchArtifactId: branch.id, summary: "stale promotion" }),
    /advanced|diverged/i,
  );
  assert.equal(proposals, 0, "stale branch must never create a canonical-state proposal");
});

test("SI-03.20 refuses non-research artifacts and non-fork artifacts", async () => {
  const report = artifact({ id: "artifact:report", headVersion: 1, kind: "report" });
  const service = createP7ResearchBranchingService({
    getArtifact: async () => report,
    getArtifactVersion: async (_ctx, id, v) => version(id, v ?? 1),
    forkArtifact: async () => { throw new Error("must not fork"); },
    createArtifactProposal: async () => { throw new Error("must not propose"); },
  });
  await assert.rejects(service.createBranch(ctx, { artifactId: report.id, baseVersion: 1 }), /Research Artifact/);
  assert.throws(() => researchBranchStatus(artifact({ id: "artifact:parent", headVersion: 1 }), artifact({ id: "artifact:not-fork", headVersion: 1 })), /fork/i);
});
