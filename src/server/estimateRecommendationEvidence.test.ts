import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-estimate-evidence-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { captureProviderConsensus } = await import("./consensusProviderCapture");
const { getEstimateRecommendationEvidence } = await import("./estimateRecommendationEvidence");
const {
  estimateRecommendationEvidenceTool,
  estimateRecommendationEvidenceToolInputSchema,
  estimateRecommendationEvidenceToolOutputSchema,
} = await import("./estimateRecommendationEvidenceTool");

function researchSource(provider: string, aiTransmission: "permitted" | "restricted" | "unknown" = "permitted") {
  return {
    class: "broker_research",
    identity: {
      sourceId: `source:${provider}`,
      providerId: provider,
      organization: "Broker Research",
      author: null,
      analystId: null,
      expertId: null,
      url: `https://${provider}.example/research`,
    },
    rights: {
      entitlement: {
        decision: "allowed",
        policyId: `policy:${provider}`,
        permittedUses: ["internal_research", "ai_assistance"],
        reasons: ["Test entitlement."],
      },
      aiTransmission,
      internalUse: "permitted",
      redistribution: "restricted",
    },
  };
}

test("SI-03.29 preserves analyst estimate/recommendation evidence without hiding source differences", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const [user] = await getDb().insert(users).values({
    email: `${crypto.randomUUID()}@example.test`,
    passwordHash: "test-hash",
    role: "internal_analyst",
    name: "Estimate evidence owner",
  }).returning();
  const tenant = { userId: user.id, organizationId: null, role: user.role };
  const project = await createProject(tenant, { name: "Estimate Evidence Project" });

  await captureProviderConsensus({
    symbol: "ACME",
    provider: "broker-a",
    sourceName: "Broker A estimates",
    sourceUrl: "https://broker-a.example/consensus",
    methodology: "Explicit analyst vintages.",
    retrievedAt: new Date("2026-02-02T00:00:00Z"),
    observations: [{
      metric: "recommendation_score",
      fiscalPeriod: "FY2027",
      unit: "score",
      currency: null,
      mean: 2,
      median: 2,
      high: 2,
      low: 2,
      contributorCount: 1,
      metadata: {
        researchSource: researchSource("broker-a"),
        vintageObservations: [
          {
            contributor: "Analyst A",
            analystId: "analyst:a",
            value: 3,
            recommendationLabel: "Hold",
            recommendationAction: "reiterate",
            provider: "broker-a",
            sourceReference: "https://broker-a.example/note-1",
            publishedAt: "2026-01-01T00:00:00Z",
            retrievedAt: "2026-01-02T00:00:00Z",
            vintageAt: "2026-01-02T00:00:00Z",
          },
          {
            contributor: "Analyst A",
            analystId: "analyst:a",
            value: 2,
            recommendationLabel: "Buy",
            recommendationAction: "upgrade",
            provider: "broker-a",
            sourceReference: "https://broker-a.example/note-2",
            publishedAt: "2026-02-01T00:00:00Z",
            retrievedAt: "2026-02-02T00:00:00Z",
            vintageAt: "2026-02-02T00:00:00Z",
          },
        ],
      },
    }],
  }, user.id);

  await captureProviderConsensus({
    symbol: "ACME",
    provider: "aggregate-feed",
    sourceName: "Aggregate consensus",
    sourceUrl: "https://aggregate.example/consensus",
    methodology: "Aggregate only.",
    retrievedAt: new Date("2026-02-03T00:00:00Z"),
    observations: [{
      metric: "recommendation_score",
      fiscalPeriod: "FY2027",
      unit: "score",
      currency: null,
      mean: 2.4,
      median: 2.5,
      high: 4,
      low: 1,
      contributorCount: 12,
      metadata: { researchSource: researchSource("aggregate-feed") },
    }],
  }, user.id);

  await captureProviderConsensus({
    symbol: "ACME",
    provider: "restricted-broker",
    sourceName: "Restricted estimate",
    sourceUrl: "https://restricted-broker.example/consensus",
    methodology: "Restricted for AI transmission.",
    retrievedAt: new Date("2026-02-04T00:00:00Z"),
    observations: [{
      metric: "recommendation_score",
      fiscalPeriod: "FY2027",
      unit: "score",
      currency: null,
      mean: 1,
      median: 1,
      high: 1,
      low: 1,
      contributorCount: 1,
      metadata: {
        researchSource: researchSource("restricted-broker", "restricted"),
        vintageObservations: [{
          contributor: "Restricted Analyst",
          analystId: "analyst:restricted",
          value: 1,
          recommendationLabel: "Strong Buy",
          provider: "restricted-broker",
          sourceReference: "https://restricted-broker.example/note",
          publishedAt: "2026-02-03T00:00:00Z",
          retrievedAt: "2026-02-04T00:00:00Z",
          vintageAt: "2026-02-04T00:00:00Z",
        }],
      },
    }],
  }, user.id);

  await t.test("human projection keeps contributors separate and aggregate snapshots identity-free", async () => {
    const result = await getEstimateRecommendationEvidence({
      organizationId: null,
      symbol: "ACME",
      metric: "recommendation_score",
      fiscalPeriod: "FY2027",
      targetUse: "human_internal",
    });
    assert.equal(result.count.snapshots, 3);
    assert.equal(result.count.contributorObservations, 3);
    assert.equal(result.count.aggregateOnly, 1);
    const analyst = result.evidence.contributorVintages.filter((item) => item.contributor === "Analyst A");
    assert.equal(analyst.length, 2);
    assert.equal(analyst[0].analystId, "analyst:a");
    assert.equal(analyst[0].recommendationLabel, "Hold");
    assert.equal(analyst[1].recommendationLabel, "Buy");
    assert.equal(analyst[1].recommendationAction, "upgrade");
    assert.equal(analyst[1].revisionDirection, "down");
    assert.equal(result.aggregates[0].aggregateOnly, true);
    assert.equal(result.aggregates[0].analystIdentityAvailable, false);
    assert.equal((result.aggregates[0] as any).contributor, undefined);
  });

  await t.test("AI projection blocks restricted source and never maps numeric scores to invented labels", async () => {
    const result = await getEstimateRecommendationEvidence({
      organizationId: null,
      symbol: "ACME",
      metric: "recommendation_score",
      fiscalPeriod: "FY2027",
      targetUse: "ai_assistance",
    });
    assert.equal(result.evidence.blockedByRights.count, 1);
    assert.equal(result.evidence.blockedByRights.byReason.ai_transmission_restricted, 1);
    assert.equal(result.evidence.contributorVintages.some((item) => item.contributor === "Restricted Analyst"), false);
    assert.equal(JSON.stringify(result).includes("restricted-broker.example"), false);
    assert.equal(result.aggregates[0].analystIdentityAvailable, false);
    assert.equal(result.evidence.ratingLabelPolicy, "explicit_only");
  });

  await t.test("point-in-time cutoff excludes later vintages by canonical availability clock", async () => {
    const result = await getEstimateRecommendationEvidence({
      organizationId: null,
      symbol: "ACME",
      metric: "recommendation_score",
      fiscalPeriod: "FY2027",
      asOf: new Date("2026-02-02T12:00:00Z"),
      targetUse: "human_internal",
    });
    assert.equal(result.count.snapshots, 1);
    assert.equal(result.evidence.contributorVintages.length, 2);
    assert.equal(result.aggregates.length, 0);
  });

  await t.test("as-of projection never leaks a contributor vintage later than the cutoff", async () => {
    await captureProviderConsensus({
      symbol: "ACME",
      provider: "future-vintage-feed",
      sourceName: "Future vintage aggregate",
      sourceUrl: "https://future-vintage.example/consensus",
      methodology: "Aggregate existed before the embedded contributor vintage.",
      retrievedAt: new Date("2026-01-15T00:00:00Z"),
      observations: [{
        metric: "recommendation_score",
        fiscalPeriod: "FY2027",
        unit: "score",
        currency: null,
        mean: 2.8,
        median: 2.8,
        high: 3,
        low: 2.5,
        contributorCount: 1,
        metadata: {
          researchSource: researchSource("future-vintage-feed"),
          vintageObservations: [{
            contributor: "Future Analyst",
            analystId: "analyst:future",
            value: 1,
            recommendationLabel: "Strong Buy",
            provider: "future-vintage-feed",
            sourceReference: "https://future-vintage.example/note",
            publishedAt: "2026-03-01T00:00:00Z",
            retrievedAt: "2026-03-02T00:00:00Z",
            vintageAt: "2026-03-02T00:00:00Z",
          }],
        },
      }],
    }, user.id);

    const result = await getEstimateRecommendationEvidence({
      organizationId: null,
      symbol: "ACME",
      metric: "recommendation_score",
      fiscalPeriod: "FY2027",
      asOf: new Date("2026-02-01T00:00:00Z"),
      targetUse: "human_internal",
    });
    assert.equal(result.evidence.contributorVintages.some((item) => item.contributor === "Future Analyst"), false);
    assert.equal(result.aggregates.some((item) => item.provider === "future-vintage-feed"), true);
  });

  await t.test("governed tool is internal-only, Project-scoped and returns only AI-permitted evidence", async () => {
    assert.equal(estimateRecommendationEvidenceTool.permissionClass, "safe_auto");
    assert.equal(estimateRecommendationEvidenceTool.access, "read");
    assert.equal(estimateRecommendationEvidenceTool.sideEffect, "none");
    assert.equal(estimateRecommendationEvidenceTool.replaySafe, true);
    assert.equal(estimateRecommendationEvidenceToolInputSchema.safeParse({
      symbol: "ACME",
      metric: "recommendation_score",
      fiscalPeriod: "FY2027",
    }).success, true);
    assert.equal(estimateRecommendationEvidenceToolInputSchema.safeParse({
      symbol: "ACME",
      metric: "recommendation_score",
      fiscalPeriod: "FY2027",
      organizationId: 999,
    }).success, false);

    const result = estimateRecommendationEvidenceToolOutputSchema.parse(await estimateRecommendationEvidenceTool.invoke(
      {
        symbol: "ACME",
        metric: "recommendation_score",
        fiscalPeriod: "FY2027",
        seriesLimit: 10,
        revisionLimit: 10,
      },
      new AbortController().signal,
      {
        source: "agent",
        userId: user.id,
        tenant: { userId: user.id, organizationId: null, role: "internal_analyst" },
        projectId: project.id,
        requestId: crypto.randomUUID(),
        sourceScope: "auto",
      },
    ));
    const output = result.output as any;
    assert.equal(output.evidencePolicy.blockedByRights.count, 1);
    assert.equal(output.revisions.some((item: any) => item.contributor === "Restricted Analyst"), false);
    assert.equal(JSON.stringify(result).includes("restricted-broker.example"), false);
    assert.ok(result.sourceRefs.includes("https://broker-a.example/note-1"));
  });

  await t.test("client role is denied before estimate evidence is returned", async () => {
    await assert.rejects(
      () => estimateRecommendationEvidenceTool.invoke(
        { symbol: "ACME", metric: "recommendation_score", fiscalPeriod: "FY2027" },
        new AbortController().signal,
        {
          source: "agent",
          userId: user.id,
          tenant: { userId: user.id, organizationId: null, role: "client_user" },
          projectId: project.id,
          requestId: crypto.randomUUID(),
          sourceScope: "auto",
        },
      ),
      /restricted to the existing internal consensus-reader roles/,
    );
  });
});
