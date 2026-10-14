import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-living-thesis-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { thesisArtifactContentSchema, reportArtifactContentSchema } = await import("@shared/artifactContracts");
const { createProject } = await import("./projectStore");
const { createArtifact, createArtifactVersion } = await import("./artifactStore");
const { livingThesisTool, livingThesisToolOutputSchema } = await import("./livingThesisTool");
const { buildLivingThesisReview } = await import("./p7LivingThesis");

test("SI-03.27 living thesis persists exact changed-since-last-review state", async (t) => {
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
      name: "Living thesis owner",
    }).returning().then((rows) => rows[0]),
    getDb().insert(users).values({
      email: `${crypto.randomUUID()}@example.test`,
      passwordHash: "test-hash",
      role: "internal_analyst",
      name: "Other owner",
    }).returning().then((rows) => rows[0]),
  ]);

  const tenant = { userId: owner.id, organizationId: null, role: owner.role };
  const project = await createProject(tenant, { name: "Living Thesis Project" });

  const v1Content = thesisArtifactContentSchema.parse({
    kind: "thesis",
    entityRef: "lios:entity:1",
    status: "active",
    summary: "Margins improve as mix shifts.",
    claims: [{
      id: "claim-margin",
      text: "Margins expand",
      status: "open",
      confidence: 0.55,
      evidenceRefs: [],
      counterEvidenceRefs: [],
      updatedAt: null,
    }],
    expectedOutcomes: [{
      id: "outcome-margin",
      text: "Gross margin expands",
      status: "open",
      dueAt: "2027-01-15T00:00:00.000Z",
      evidenceRefs: [],
    }],
    catalysts: [{
      id: "cat-launch",
      text: "New product launch",
      status: "open",
      dueAt: "2026-12-01T00:00:00.000Z",
      evidenceRefs: [],
    }],
    risks: [{
      id: "risk-inputs",
      text: "Input costs rise",
      status: "open",
      evidenceRefs: [],
    }],
    invalidationConditions: [{
      id: "inv-margin",
      text: "Gross margin contracts for two quarters",
      triggered: false,
      evidenceRefs: [],
    }],
    openQuestions: [{
      id: "q-demand",
      text: "Is demand durable?",
      status: "open",
      evidenceRefs: [],
    }],
  });

  const created = await createArtifact(tenant, {
    projectId: project.id,
    title: "Northwind Investment Thesis",
    content: v1Content,
    assumptionRefs: ["assumption:mix-shift", "assumption:stable-input-costs"],
    sourceRefs: ["document:base-note"],
  });

  const v2Content = thesisArtifactContentSchema.parse({
    ...v1Content,
    summary: "Margins are supported, but input-cost risk has materialized.",
    claims: [{
      ...v1Content.claims[0],
      status: "supported",
      confidence: 0.7,
      evidenceRefs: ["filing:q3"],
      counterEvidenceRefs: ["expert:cost-pressure"],
      updatedAt: "2026-10-06T14:00:00.000Z",
    }],
    expectedOutcomes: [{
      ...v1Content.expectedOutcomes[0],
      status: "occurred",
      evidenceRefs: ["filing:q3"],
    }],
    catalysts: [{
      ...v1Content.catalysts[0],
      status: "occurred",
      evidenceRefs: ["press:launch"],
    }],
    risks: [{
      ...v1Content.risks[0],
      status: "materialized",
      evidenceRefs: ["expert:cost-pressure"],
    }],
    invalidationConditions: [{
      ...v1Content.invalidationConditions[0],
      triggered: true,
      evidenceRefs: ["filing:q3"],
    }],
    openQuestions: [{
      ...v1Content.openQuestions[0],
      status: "answered",
      evidenceRefs: ["survey:demand"],
    }],
  });

  const v2 = await createArtifactVersion(tenant, {
    artifactId: created.artifact.id,
    baseVersion: 1,
    content: v2Content,
    assumptionRefs: ["assumption:mix-shift", "assumption:pricing-power"],
    sourceRefs: ["document:base-note", "filing:q3", "expert:cost-pressure"],
  });

  const call = {
    source: "agent" as const,
    userId: owner.id,
    tenant: { userId: owner.id, organizationId: null, role: "internal_analyst" as const },
    projectId: project.id,
    requestId: crypto.randomUUID(),
    sourceScope: "my_data" as const,
  };

  await t.test("v2 review exposes persistent state and exact adjacent-version changes", async () => {
    const result = livingThesisToolOutputSchema.parse(await livingThesisTool.invoke(
      { artifactId: created.artifact.id },
      new AbortController().signal,
      call,
    ));
    assert.equal(result.output.review && typeof result.output.review, "object");
    const review = result.output.review as any;
    assert.equal(result.output.reviewedVersion, 2);
    assert.equal(result.output.previousVersion, 1);
    assert.equal(review.current.artifactRef, `${created.artifact.id}@v2`);
    assert.equal(review.current.contentHash, v2.contentHash);
    assert.equal(review.current.status, "active");
    assert.equal(review.current.posture, "invalidated");
    assert.deepEqual(review.current.assumptions, ["assumption:mix-shift", "assumption:pricing-power"]);
    assert.equal(review.current.claims[0].confidence, 0.7);
    assert.deepEqual(review.current.claims[0].evidenceRefs, ["filing:q3"]);
    assert.deepEqual(review.current.claims[0].counterEvidenceRefs, ["expert:cost-pressure"]);

    assert.equal(review.changedSinceLastReview.baseline, false);
    assert.equal(review.changedSinceLastReview.changed, true);
    assert.deepEqual(review.changedSinceLastReview.posture, { from: "unrated", to: "invalidated" });
    assert.deepEqual(review.changedSinceLastReview.assumptions, {
      added: ["assumption:pricing-power"],
      removed: ["assumption:stable-input-costs"],
    });
    assert.deepEqual(review.changedSinceLastReview.claims, [{
      id: "claim-margin",
      change: "changed",
      fields: ["status", "confidence", "evidenceRefs", "counterEvidenceRefs"],
    }]);
    assert.equal(review.changedSinceLastReview.expectedOutcomes[0].id, "outcome-margin");
    assert.equal(review.changedSinceLastReview.catalysts[0].id, "cat-launch");
    assert.equal(review.changedSinceLastReview.risks[0].id, "risk-inputs");
    assert.equal(review.changedSinceLastReview.invalidationConditions[0].id, "inv-margin");
    assert.equal(review.changedSinceLastReview.openQuestions[0].id, "q-demand");
    assert.match(result.summary, /against v1/);
    assert.ok(result.sourceRefs.includes(`${created.artifact.id}@v2`));
    assert.ok(result.sourceRefs.includes("assumption:pricing-power"));
  });

  await t.test("exact historical v1 is an explicit baseline, not synthesized history", async () => {
    const result = livingThesisToolOutputSchema.parse(await livingThesisTool.invoke(
      { artifactId: created.artifact.id, version: 1 },
      new AbortController().signal,
      call,
    ));
    const review = result.output.review as any;
    assert.equal(result.output.reviewedVersion, 1);
    assert.equal(result.output.previousVersion, null);
    assert.equal(review.previous, null);
    assert.equal(review.changedSinceLastReview.baseline, true);
    assert.equal(review.changedSinceLastReview.changed, false, "baseline does not synthesize a prior review");
    assert.deepEqual(review.changedSinceLastReview.assumptions, { added: [], removed: [] });
    assert.deepEqual(review.changedSinceLastReview.claims, []);
    assert.match(result.summary, /baseline living thesis/);
  });

  await t.test("repeated reads are deterministic and side-effect free", async () => {
    const one = livingThesisToolOutputSchema.parse(await livingThesisTool.invoke(
      { artifactId: created.artifact.id, version: 2 },
      new AbortController().signal,
      call,
    ));
    const two = livingThesisToolOutputSchema.parse(await livingThesisTool.invoke(
      { artifactId: created.artifact.id, version: 2 },
      new AbortController().signal,
      call,
    ));
    assert.deepEqual(one.output.review, two.output.review);
    assert.equal(livingThesisTool.access, "read");
    assert.equal(livingThesisTool.sideEffect, "none");
    assert.equal(livingThesisTool.replaySafe, true);
  });

  await t.test("non-thesis and cross-owner Project access fail closed", async () => {
    const report = await createArtifact(tenant, {
      projectId: project.id,
      title: "Report",
      content: reportArtifactContentSchema.parse({
        kind: "report",
        blocks: [],
        sections: [],
      }),
    });
    await assert.rejects(
      () => livingThesisTool.invoke(
        { artifactId: report.artifact.id },
        new AbortController().signal,
        call,
      ),
      /requires a ThesisArtifact/,
    );
    await assert.rejects(
      () => livingThesisTool.invoke(
        { artifactId: created.artifact.id },
        new AbortController().signal,
        {
          ...call,
          userId: other.id,
          tenant: { userId: other.id, organizationId: null, role: "internal_analyst" as const },
        },
      ),
      /not owned|not found/i,
    );
  });

  await t.test("pure review reports no changed state when adjacent versions are identical", () => {
    const pure = buildLivingThesisReview({
      current: {
        artifactId: created.artifact.id,
        version: 2,
        contentHash: "a".repeat(64),
        assumptionRefs: ["assumption:one"],
        content: v1Content,
      },
      previous: {
        artifactId: created.artifact.id,
        version: 1,
        contentHash: "b".repeat(64),
        assumptionRefs: ["assumption:one"],
        content: v1Content,
      },
    });
    assert.equal(pure.changedSinceLastReview.changed, false);
    assert.equal(pure.changedSinceLastReview.posture, null);
    assert.deepEqual(pure.changedSinceLastReview.claims, []);
  });
});
