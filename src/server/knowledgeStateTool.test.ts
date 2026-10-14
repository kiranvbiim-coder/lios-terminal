import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-knowledge-state-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { indexProjectDocument } = await import("./p7ProjectIntelligenceStore");
const {
  knowledgeStateTool,
  knowledgeStateToolInputSchema,
  knowledgeStateToolOutputSchema,
} = await import("./knowledgeStateTool");

test("SI-03.21 Project knowledge state stays explicit and source-policy bounded", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const [owner, other] = await Promise.all([
    getDb().insert(users).values({
      email: `${crypto.randomUUID()}@example.test`,
      passwordHash: "test-hash",
      role: "internal_analyst",
      name: "Knowledge owner",
    }).returning().then((rows) => rows[0]),
    getDb().insert(users).values({
      email: `${crypto.randomUUID()}@example.test`,
      passwordHash: "test-hash",
      role: "internal_analyst",
      name: "Other owner",
    }).returning().then((rows) => rows[0]),
  ]);

  const tenant = { userId: owner.id, organizationId: null, role: owner.role };
  const project = await createProject(tenant, { name: "Knowledge State Project" });

  await indexProjectDocument(tenant, {
    projectId: project.id,
    sourceType: "filing",
    sourceRef: "filing:known",
    title: "Revenue outlook filing",
    body: "Revenue outlook increased after the signed customer expansion.",
    occurredAt: "2026-10-01T12:00:00.000Z",
    metadata: {
      retrievedAt: "2026-10-01T12:05:00.000Z",
      publishedAt: "2026-10-01T11:00:00.000Z",
      effectiveAt: "2026-10-01T10:00:00.000Z",
      originClass: "first_party",
      evidenceKind: "filing",
      sourceTier: "regulatory_filing",
      modelPeriod: "FY2026Q4",
      freshnessState: "fresh",
      freshnessAssessedAt: "2026-10-01T12:05:00.000Z",
      availabilityState: "available",
      entitlementState: "entitled",
      certaintyState: "verified",
    },
  });

  await indexProjectDocument(tenant, {
    projectId: project.id,
    sourceType: "research_evidence",
    sourceRef: "research:qualified",
    title: "Revenue outlook diligence",
    body: "Revenue outlook may improve, but the customer expansion remains disputed.",
    occurredAt: "2026-09-30T12:00:00.000Z",
    metadata: {
      retrievedAt: "2026-10-01T12:05:00.000Z",
      publishedAt: "2026-09-30T11:00:00.000Z",
      effectiveAt: "2026-09-30T10:00:00.000Z",
      originClass: "expert",
      evidenceKind: "claim",
      freshnessState: "stale",
      freshnessAssessedAt: "2026-10-01T12:05:00.000Z",
      freshnessReason: "Superseded by later diligence",
      availabilityState: "available",
      entitlementState: "entitled",
      certaintyState: "disputed",
    },
  });

  await indexProjectDocument(tenant, {
    projectId: project.id,
    sourceType: "document",
    sourceRef: "document:excluded",
    title: "Revenue outlook restricted memo",
    body: "Revenue outlook secret restricted memo must never leak through source-policy filtering.",
    occurredAt: "2026-10-02T12:00:00.000Z",
    metadata: {
      retrievedAt: "2026-10-02T12:05:00.000Z",
      publishedAt: "2026-10-02T11:00:00.000Z",
      effectiveAt: "2026-10-02T10:00:00.000Z",
      originClass: "internal",
      evidenceKind: "document",
      freshnessState: "fresh",
      availabilityState: "available",
      entitlementState: "entitled",
      certaintyState: "verified",
    },
  });

  const baseCall = {
    source: "agent" as const,
    userId: owner.id,
    tenant: { userId: owner.id, organizationId: null, role: "internal_analyst" as const },
    projectId: project.id,
    requestId: crypto.randomUUID(),
    sourceScope: "my_data" as const,
  };

  await t.test("descriptor is deterministic read-only and input cannot smuggle scope", () => {
    assert.equal(knowledgeStateTool.permissionClass, "safe_auto");
    assert.equal(knowledgeStateTool.access, "read");
    assert.equal(knowledgeStateTool.sideEffect, "none");
    assert.equal(knowledgeStateTool.replaySafe, true);
    assert.equal(knowledgeStateToolInputSchema.safeParse({ query: "revenue outlook" }).success, true);
    assert.equal(knowledgeStateToolInputSchema.safeParse({
      query: "revenue outlook",
      allowedSourceRefs: ["document:excluded"],
    }).success, false);
  });

  await t.test("all clean permitted evidence is known", async () => {
    const result = knowledgeStateToolOutputSchema.parse(await knowledgeStateTool.invoke(
      { query: "revenue outlook", limit: 10 },
      new AbortController().signal,
      { ...baseCall, allowedSourceRefs: ["filing:known"] },
    ));
    assert.equal(result.output.state, "known");
    assert.deepEqual(result.output.counts, { known: 1, qualified: 0 });
    assert.equal(result.output.matches.length, 1);
    assert.equal(result.output.matches[0].sourceRef, "filing:known");
    assert.equal(result.output.matches[0].truth.knowledge.classification, "known");
    assert.deepEqual(result.output.matches[0].truth.knowledge.qualifiers, []);
    assert.equal(result.output.matches[0].truth.temporal.modelPeriod, "FY2026Q4");
    assert.equal(result.output.matches[0].truth.sourceQuality.tier, "regulatory_filing");
    assert.equal(result.output.matches[0].truth.freshness.basis, "declared");
    assert.match(result.output.matches[0].contentHash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(result).includes("document:excluded"), false);
  });

  await t.test("any qualified evidence keeps explicit blockers and makes aggregate qualified", async () => {
    const result = knowledgeStateToolOutputSchema.parse(await knowledgeStateTool.invoke(
      { query: "revenue outlook", limit: 10 },
      new AbortController().signal,
      { ...baseCall, allowedSourceRefs: ["filing:known", "research:qualified"] },
    ));
    assert.equal(result.output.state, "qualified");
    assert.deepEqual(result.output.counts, { known: 1, qualified: 1 });
    const qualified = result.output.matches.find((item) => item.sourceRef === "research:qualified");
    assert.ok(qualified);
    assert.equal(qualified.truth.knowledge.classification, "qualified");
    assert.ok(qualified.truth.knowledge.qualifiers.includes("certainty:disputed"));
    assert.ok(qualified.truth.knowledge.qualifiers.includes("freshness:stale"));
    assert.equal(JSON.stringify(result).includes("secret restricted memo"), false);
    assert.equal(result.sourceRefs.includes("document:excluded"), false);
  });

  await t.test("no permitted matching evidence is unknown without fabricated access reason", async () => {
    const result = knowledgeStateToolOutputSchema.parse(await knowledgeStateTool.invoke(
      { query: "revenue outlook", limit: 10 },
      new AbortController().signal,
      { ...baseCall, allowedSourceRefs: ["document:not-permitted"] },
    ));
    assert.equal(result.output.state, "unknown");
    assert.deepEqual(result.output.matches, []);
    assert.deepEqual(result.output.counts, { known: 0, qualified: 0 });
    assert.equal(result.output.unknownReason, "no_permitted_matching_evidence");
    assert.deepEqual(result.sourceRefs, []);
    assert.match(result.summary, /without inventing an access, entitlement, or certainty reason/);
  });

  await t.test("source scope and Project ownership fail closed", async () => {
    await assert.rejects(
      () => knowledgeStateTool.invoke(
        { query: "revenue outlook" },
        new AbortController().signal,
        { ...baseCall, sourceScope: "web", allowedSourceRefs: [] },
      ),
      /requires Auto or My Data/,
    );
    await assert.rejects(
      () => knowledgeStateTool.invoke(
        { query: "revenue outlook" },
        new AbortController().signal,
        {
          ...baseCall,
          userId: other.id,
          tenant: { userId: other.id, organizationId: null, role: "internal_analyst" as const },
          allowedSourceRefs: [],
        },
      ),
      /not owned|does not exist|not found/i,
    );
  });
});
