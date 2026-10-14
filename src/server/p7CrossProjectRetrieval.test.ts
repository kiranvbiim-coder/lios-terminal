import assert from "node:assert/strict";
import test from "node:test";
import { p7SearchHitSchema, type P7SearchHit } from "@shared/p7ResearchContracts";
import type { TenantContext } from "./tenantContext";
import {
  searchExplicitProjectIntelligence,
  type P7CrossProjectRetrievalDependencies,
} from "./p7CrossProjectRetrieval";

const ctx: TenantContext = { userId: 7, organizationId: 11, role: "internal_analyst" };

function hit(sourceRef: string, combinedScore: number, lexicalScore = combinedScore): P7SearchHit {
  return p7SearchHitSchema.parse({
    documentId: "doc:" + sourceRef,
    sourceType: "research_evidence",
    sourceRef,
    title: sourceRef,
    excerpt: "matching evidence",
    lexicalScore,
    semanticScore: null,
    combinedScore,
    sourceRefs: [sourceRef],
    entityRefs: [],
    contextRefs: {},
    occurredAt: null,
  });
}

test("cross-Project retrieval validates every exact Project before any target search", async () => {
  const accessCalls: number[] = [];
  const searchCalls: number[] = [];
  const dependencies: P7CrossProjectRetrievalDependencies = {
    assertProjectAccess: async (_ctx, projectId) => {
      accessCalls.push(projectId);
      if (projectId === 9) throw new Error("Project not found.");
    },
    searchProject: async (_ctx, projectId) => {
      searchCalls.push(projectId);
      return [hit("project:" + projectId, 1)];
    },
  };

  await assert.rejects(
    searchExplicitProjectIntelligence(ctx, 1, { query: "margin", projectIds: [2, 9] }, dependencies),
    /Project not found/,
  );
  assert.deepEqual(accessCalls, [1, 2, 9], "current Project and all exact targets are checked by canonical access");
  assert.deepEqual(searchCalls, [], "no authorized target leaks when another requested target fails access");
});

test("cross-Project retrieval searches only explicit deduplicated Projects and preserves source restrictions", async () => {
  const searched: Array<{ projectId: number; allowedSourceRefs: string[]; query: string }> = [];
  const dependencies: P7CrossProjectRetrievalDependencies = {
    assertProjectAccess: async () => undefined,
    searchProject: async (_ctx, projectId, request) => {
      searched.push({ projectId, allowedSourceRefs: request.allowedSourceRefs, query: request.query });
      if (projectId === 3) return [hit("allowed:three", 0.9), hit("allowed:three-low", 0.2)];
      if (projectId === 2) return [hit("allowed:two", 0.95)];
      throw new Error("unselected Project was queried");
    },
  };

  const results = await searchExplicitProjectIntelligence(ctx, 1, {
    query: "cash flow",
    projectIds: [3, 2, 3],
    limit: 2,
    allowedSourceRefs: ["source:filing", "source:filing", "source:internal"],
  }, dependencies);

  assert.deepEqual(searched.map((item) => item.projectId), [3, 2]);
  assert.ok(searched.every((item) => item.query === "cash flow"));
  assert.ok(searched.every((item) => JSON.stringify(item.allowedSourceRefs) === JSON.stringify(["source:filing", "source:internal"])));
  assert.deepEqual(results.map((item) => [item.projectId, item.sourceRef]), [
    [2, "allowed:two"],
    [3, "allowed:three"],
  ]);
});

test("cross-Project retrieval refuses a current-Project-only request instead of widening scope", async () => {
  let accessChecks = 0;
  let searches = 0;
  const dependencies: P7CrossProjectRetrievalDependencies = {
    assertProjectAccess: async () => { accessChecks += 1; },
    searchProject: async () => { searches += 1; return []; },
  };

  await assert.rejects(
    searchExplicitProjectIntelligence(ctx, 4, { query: "evidence", projectIds: [4, 4] }, dependencies),
    /at least one explicitly selected Project other than the current Project/,
  );
  assert.equal(accessChecks, 0);
  assert.equal(searches, 0);
});
