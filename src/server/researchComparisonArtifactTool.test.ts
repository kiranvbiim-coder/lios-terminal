import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-comparison-artifact-"));
process.env.LIMURIA_DATA_DIR = dataDir;

// P4/P7 data roots are selected before any store module is loaded.
const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { indexProjectDocument } = await import("./p7ProjectIntelligenceStore");
const { getArtifact, getArtifactVersion, createArtifactVersion, listProjectArtifacts } = await import("./artifactStore");
const { researchArtifactContentSchema } = await import("@shared/artifactContracts");
const { composedResearchSourceSchema } = await import("@shared/researchSourceComposition");
const { saveResearchComparisonTool, saveResearchComparisonInputSchema, saveResearchComparisonOutputSchema,
  researchComparisonArtifactContent } = await import("./researchComparisonArtifactTool");

const allowedRights = {
  entitlement: {
    decision: "allowed" as const,
    policyId: "source-policy:test",
    permittedUses: ["internal_research"],
    reasons: ["Explicit authorized test source."],
  },
  aiTransmission: "permitted" as const,
  internalUse: "permitted" as const,
  redistribution: "restricted" as const,
};
const sourceMetadata = (ref: string, allowed: boolean) => ({
  researchSource: {
    class: "internal_research",
    identity: {
      sourceId: ref, providerId: "test-internal", organization: null,
      author: null, analystId: null, expertId: null, url: null,
    },
    rights: { ...allowedRights, aiTransmission: allowed ? "permitted" : "restricted" },
  },
});

test("P7 cited comparison is saved as a real editable, versioned P4 Research Artifact", async t => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const [user] = await getDb().insert(users).values({
    email: crypto.randomUUID() + "@example.test",
    passwordHash: "test-hash",
    role: "internal_analyst",
    name: "Comparison test user",
  }).returning();
  const ctx = { userId: user.id, organizationId: null, role: user.role };
  const project = await createProject(ctx, { name: "Non-financial product research" });

  await indexProjectDocument(ctx, {
    projectId: project.id,
    sourceType: "research_evidence",
    sourceRef: "internal:study:permitted",
    title: "Permitted field evidence",
    body: "Customer retention improved during the pilot. Customer retention was discussed in the second week.",
    metadata: sourceMetadata("study-permitted", true),
  });
  await indexProjectDocument(ctx, {
    projectId: project.id,
    sourceType: "research_evidence",
    sourceRef: "internal:study:restricted",
    title: "Restricted field evidence",
    body: "Customer retention SECRET_RESTRICTED_INSIGHT from restricted source.",
    metadata: sourceMetadata("study-restricted", false),
  });
  const input = {
    query: "customer retention",
    title: "Customer retention evidence comparison",
    facets: ["customer retention", "churn rate"],
  };
  const call = {
    source: "agent" as const,
    userId: user.id,
    tenant: ctx,
    projectId: project.id,
    requestId: crypto.randomUUID(),
    sourceScope: "my_data" as const,
  };
  const signal = new AbortController().signal;

  await t.test("tool is governed, input-bounded and not replay safe", () => {
    assert.equal(saveResearchComparisonTool.id, "lios.research.save_comparison");
    assert.equal(saveResearchComparisonTool.sideEffect, "internal_write");
    assert.equal(saveResearchComparisonTool.replaySafe, false);
    assert.equal(saveResearchComparisonTool.permissionClass, "safe_auto");
    assert.equal(saveResearchComparisonInputSchema.safeParse(input).success, true);
    assert.equal(saveResearchComparisonInputSchema.safeParse({ ...input, sourceRefs: ["internal:study:restricted"] }).success, false);
    assert.equal(saveResearchComparisonInputSchema.safeParse({ ...input, claims: ["invented"] }).success, false);
    assert.equal(saveResearchComparisonInputSchema.safeParse({ ...input, facets: [] }).success, false);
  });

  let artifactId = "";
  await t.test("saves only current AI-entitled citations, keeps gaps explicit and reopens editable blocks", async () => {
    const result = saveResearchComparisonOutputSchema.parse(
      await saveResearchComparisonTool.invoke(input, signal, call),
    );
    artifactId = result.output.artifactId;
    assert.equal(result.output.version, 1);
    assert.equal(result.output.facetCount, 2);
    assert.equal(result.output.sourceCount, 1);
    assert.ok(result.output.evidenceCount >= 1);
    assert.ok(result.sourceRefs.includes("internal:study:permitted"));
    assert.equal(result.sourceRefs.includes("internal:study:restricted"), false);

    const artifact = await getArtifact(ctx, artifactId);
    assert.equal(artifact.kind, "research");
    assert.equal(artifact.projectId, project.id);
    const version = await getArtifactVersion(ctx, artifactId);
    const content = researchArtifactContentSchema.parse(version.content);
    assert.deepEqual(content.claims, []);
    assert.deepEqual(version.sourceRefs, ["internal:study:permitted"]);
    assert.deepEqual(version.dependencyRefs, ["internal:study:permitted"]);
    assert.ok(content.blocks.some(block => block.type === "quote"
      && block.text.includes("Customer retention")));
    assert.ok(content.blocks.some(block => block.id === "gap-1"
      && block.text.includes("no exact passage matched")));
    assert.ok(content.blocks.some(block => block.type === "quote"
      && block.attrs.contentHash && block.attrs.excerptSha256));
    assert.deepEqual(content.sourcePolicy.allowedSourceRefs, ["internal:study:permitted"]);
    assert.equal(content.sourcePolicy.mode, "only_refs");
    const serialized = JSON.stringify(content);
    assert.equal(serialized.includes("SECRET_RESTRICTED_INSIGHT"), false);
    assert.equal(serialized.includes("internal:study:restricted"), false);

    const edited = researchArtifactContentSchema.parse({
      ...content,
      blocks: [...content.blocks, {
        id: "user-edit",
        type: "paragraph",
        text: "A user can add their interpretation in the existing editable Workbench.",
      }],
    });
    const next = await createArtifactVersion(ctx, {
      artifactId,
      baseVersion: 1,
      content: edited,
      sourceRefs: version.sourceRefs,
      dependencyRefs: version.dependencyRefs,
      actorType: "user",
      note: "User edited comparison using existing versioned Artifact mechanics.",
    });
    assert.equal(next.version, 2);
    const reopened = await getArtifactVersion(ctx, artifactId);
    assert.equal(reopened.version, 2);
    assert.ok(researchArtifactContentSchema.parse(reopened.content).blocks
      .some(block => block.id === "user-edit"));
    const initial = await getArtifactVersion(ctx, artifactId, 1);
    assert.equal(researchArtifactContentSchema.parse(initial.content).blocks
      .some(block => block.id === "user-edit"), false);
  });

  await t.test("rejects read-only, wrong source scope and revoked matching citations before saving", async () => {
    const before = (await listProjectArtifacts(ctx, project.id)).length;
    await assert.rejects(
      () => saveResearchComparisonTool.invoke(input, signal, { ...call, sourceScope: "web" as const }),
      /Auto or My Data/,
    );
    await assert.rejects(
      () => saveResearchComparisonTool.invoke(input, signal, { ...call, researchReadOnly: true }),
      /writable Project/,
    );
    await assert.rejects(
      () => saveResearchComparisonTool.invoke(input, signal, { ...call, resourceTransmissionAllowed: false }),
      /writable Project/,
    );
    await assert.rejects(
      () => saveResearchComparisonTool.invoke(input, signal, { ...call, allowedSourceRefs: ["internal:study:restricted"] }),
      /No AI-permitted Project research sources matched/,
    );
    await assert.rejects(
      () => saveResearchComparisonTool.invoke(
        { ...input, facets: ["nonexistent mystery"] }, signal, call,
      ),
      /No permitted cited comparison evidence matched/,
    );
    assert.equal((await listProjectArtifacts(ctx, project.id)).length, before);
  });
});

test("Standalone builder refuses forged source revision and empty grids", () => {
  const source = composedResearchSourceSchema.parse({
    documentId: "doc-1", sourceRef: "source:1", contentHash: "a".repeat(64),
    title: "Evidence", sourceClass: "internal_research" as const,
    occurredAt: null, sourceType: "research_evidence" as const,
    entityRefs: [], sourceRefs: [], excerpt: "Retention findings.",
    rights: allowedRights,
    identity: {
      sourceId: "doc-1", providerId: null, organization: null,
      author: null, analystId: null, expertId: null, url: null,
    },
  });
  assert.throws(() => researchComparisonArtifactContent("retention", [], [source]), /No permitted cited comparison evidence/);
  assert.throws(() => researchComparisonArtifactContent("retention", [{
    facet: "retention", status: "observed_in_retrieved_excerpts",
    matchingSources: 1, inspectedSources: 1, omittedMatches: 0,
    agreement: "not_assessed", rows: [{
      documentId: "doc-1", sourceRef: "source:1",
      contentHash: "b".repeat(64), sourceClass: "internal_research",
      occurredAt: null, passage: "Retention improved.",
    }],
  }], [source]), /source identity or revision changed/);
});
