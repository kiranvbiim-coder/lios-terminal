import test from "node:test";
import assert from "node:assert/strict";
import type { ResearchEvidence } from "@shared/schema";
import {
  buildDeepResearchOrchestration,
  buildResearchBrief,
  calculateSourceQualityScore,
  canAccessResearchOrganization,
  citationIssues,
  compareEvidenceSnapshots,
  createEvidenceFingerprint,
  DEEP_RESEARCH_MAX_ITERATIONS,
  defaultSourceQuality,
  snapshotEvidence,
} from "./researchService";

function evidence(overrides: Partial<ResearchEvidence> = {}): ResearchEvidence {
  return {
    id: 1,
    investigationId: 3,
    evidenceType: "filing",
    evidenceKind: "fact",
    title: "ACME 10-K filed 2026-01-30",
    excerpt: "Revenue increased year over year.",
    annotation: null,
    sourceName: "U.S. Securities and Exchange Commission",
    provider: "SEC EDGAR",
    sourceUrl: "https://www.sec.gov/filing",
    sourceExternalId: "accession-1",
    contentFingerprint: "fingerprint-1",
    publishedAt: new Date("2026-01-30T00:00:00.000Z"),
    effectiveAt: new Date("2025-12-31T00:00:00.000Z"),
    retrievedAt: new Date("2026-02-01T00:00:00.000Z"),
    sourceQuality: defaultSourceQuality("filing", "SEC EDGAR", true),
    relevanceScore: 1,
    metadata: { formType: "10-K" },
    addedByUserId: 2,
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    ...overrides,
  };
}

function deepResearchInvestigation(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    title: "ACME durability review",
    question: "Is demand durable?",
    thesis: "Demand remains resilient.",
    status: "active",
    ...overrides,
  };
}

test("evidence fingerprints are stable across case and surrounding whitespace", () => {
  const first = createEvidenceFingerprint({
    provider: "SEC EDGAR",
    sourceExternalId: "0000320193-26-000001",
    sourceUrl: "https://www.sec.gov/filing",
    title: "Apple 10-K",
    publishedAt: "2026-01-30T00:00:00.000Z",
  });
  const second = createEvidenceFingerprint({
    provider: " sec edgar ",
    sourceExternalId: "0000320193-26-000001",
    sourceUrl: "HTTPS://WWW.SEC.GOV/FILING",
    title: " apple 10-k ",
    publishedAt: new Date("2026-01-30T00:00:00.000Z"),
  });

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("evidence fingerprints change when the source identity changes", () => {
  const base = createEvidenceFingerprint({ provider: "Reuters", sourceExternalId: "story-1", title: "Demand rises" });
  const changed = createEvidenceFingerprint({ provider: "Reuters", sourceExternalId: "story-2", title: "Demand rises" });
  assert.notEqual(base, changed);
});

test("official primary sources receive stronger defaults than unattributed claims", () => {
  const official = defaultSourceQuality("filing", "SEC EDGAR", true);
  const claim = defaultSourceQuality("claim", "Manual", false);
  assert.ok(calculateSourceQualityScore(official) > calculateSourceQualityScore(claim));
  assert.equal(official.authority, 1);
  assert.equal(official.directness, 1);
});

test("source quality score uses the documented weighted components", () => {
  assert.equal(calculateSourceQualityScore({
    authority: 1,
    directness: 0.8,
    recency: 0.6,
    corroboration: 0.4,
    extractionConfidence: 0.2,
  }), 0.68);
});

test("brief generation is deterministic and freezes footnote-ready evidence", () => {
  const investigation = {
    title: "ACME durability review",
    question: "Is demand durable?",
    thesis: "Demand remains resilient.",
    primarySymbol: "ACME",
    subjectLabel: "ACME Corp",
  };
  const laterId = evidence({ id: 9, title: "Secondary report", evidenceType: "news", evidenceKind: "counterargument", contentFingerprint: "fingerprint-9" });
  const first = buildResearchBrief(investigation, [laterId, evidence()], new Date("2026-03-01T00:00:00.000Z"));
  const second = buildResearchBrief(investigation, [evidence(), laterId], new Date("2026-03-01T00:00:00.000Z"));

  assert.equal(first.snapshotHash, second.snapshotHash);
  assert.equal(first.markdown, second.markdown);
  assert.deepEqual(first.snapshot.map((item) => item.id), [1, 9]);
  assert.deepEqual(first.citations.map((item) => item.label), ["[E1]", "[E2]"]);
  assert.match(first.markdown, /## Counterarguments/);
  assert.match(first.markdown, /retrieved 2026-02-01/);
});

test("what-changed classifies additions, removals, and annotation edits against a snapshot", () => {
  const original = evidence();
  const previous = snapshotEvidence([original, evidence({ id: 2, contentFingerprint: "fingerprint-2" })]);
  const current = [
    evidence({ annotation: "Validated against the audited statement." }),
    evidence({ id: 3, contentFingerprint: "fingerprint-3", title: "New filing" }),
  ];
  const changed = compareEvidenceSnapshots(previous, current, new Date("2026-03-01T00:00:00.000Z"));

  assert.equal(changed.baseline, true);
  assert.deepEqual(changed.added.map((item) => item.id), [3]);
  assert.deepEqual(changed.removed.map((item) => item.id), [2]);
  assert.deepEqual(changed.modified.map((item) => item.id), [1]);
});

test("what-changed ignores JSONB object key reordering", () => {
  const current = evidence({
    sourceQuality: { authority: 1, directness: 1, recency: 1, corroboration: 0.5, extractionConfidence: 0.9 },
    metadata: { symbol: "ACME", nested: { form: "10-K", score: 1 } },
  });
  const previous = snapshotEvidence([current]);
  previous[0].sourceQuality = { extractionConfidence: 0.9, corroboration: 0.5, recency: 1, directness: 1, authority: 1 };
  previous[0].metadata = { nested: { score: 1, form: "10-K" }, symbol: "ACME" };

  assert.deepEqual(compareEvidenceSnapshots(previous, [current], new Date("2026-03-01T00:00:00.000Z")).modified, []);
});

test("citation diagnostics distinguish missing provenance and stale evidence", () => {
  const snapshot = snapshotEvidence([evidence({
    evidenceType: "claim",
    evidenceKind: "claim",
    sourceUrl: null,
    publishedAt: null,
    effectiveAt: new Date("2024-01-01T00:00:00.000Z"),
    excerpt: null,
  })])[0];
  const issues = citationIssues(snapshot, new Date("2026-03-01T00:00:00.000Z"));
  assert.deepEqual(issues, ["missing_source_url", "stale_over_one_year", "unsupported_claim"]);
});

test("research tenant policy permits internal work and rejects cross-tenant client access", () => {
  assert.equal(canAccessResearchOrganization("internal_analyst", null, 22), true);
  assert.equal(canAccessResearchOrganization("client_admin", 22, 22), true);
  assert.equal(canAccessResearchOrganization("client_user", 21, 22), false);
  assert.equal(canAccessResearchOrganization("client_user", null, null), false);
});

test("deep research orchestration is deterministic and exposes explicit evidence gaps", () => {
  const args = {
    investigation: deepResearchInvestigation(),
    evidence: [] as ResearchEvidence[],
    requiredEvidenceTypes: ["filing", "official_data", "news"] as ResearchEvidence["evidenceType"][],
    iterationsUsed: 0,
  };
  const first = buildDeepResearchOrchestration(args);
  const second = buildDeepResearchOrchestration(args);

  assert.deepEqual(first, second);
  assert.deepEqual(first.plan.map((step) => [step.evidenceType, step.state]), [
    ["filing", "pending"],
    ["official_data", "pending"],
    ["news", "pending"],
  ]);
  assert.deepEqual(first.observedEvidenceTypes, []);
  assert.equal(first.maxIterations, DEEP_RESEARCH_MAX_ITERATIONS);
  assert.equal(first.iterationsRemaining, DEEP_RESEARCH_MAX_ITERATIONS);
  assert.equal(first.canContinue, true);
  assert.equal(first.continuationReason, "gaps_remain");
  assert.ok(first.evidenceGaps.some((gap) => gap.kind === "no_evidence"));
  assert.deepEqual(
    first.evidenceGaps.filter((gap) => gap.kind === "missing_evidence_type").map((gap) => gap.evidenceType),
    ["filing", "official_data", "news"],
  );
});

test("deep research orchestration closes covered steps from investigation-scoped evidence only", () => {
  const state = buildDeepResearchOrchestration({
    investigation: deepResearchInvestigation(),
    evidence: [
      evidence(),
      evidence({
        id: 2,
        evidenceType: "official_data",
        title: "BLS demand series",
        sourceName: "U.S. Bureau of Labor Statistics",
        provider: "BLS",
        sourceUrl: "https://www.bls.gov/example",
        sourceExternalId: "bls-series-1",
        contentFingerprint: "fingerprint-2",
      }),
      evidence({
        id: 3,
        investigationId: 99,
        evidenceType: "news",
        title: "Unrelated investigation story",
        sourceName: "Reuters",
        provider: "Reuters",
        sourceUrl: "https://www.reuters.com/example",
        sourceExternalId: "story-3",
        contentFingerprint: "fingerprint-3",
      }),
    ],
    requiredEvidenceTypes: ["filing", "official_data", "news"],
    iterationsUsed: 1,
  });

  assert.deepEqual(state.plan.map((step) => [step.evidenceType, step.state]), [
    ["filing", "covered"],
    ["official_data", "covered"],
    ["news", "pending"],
  ]);
  assert.deepEqual(state.observedEvidenceTypes, ["filing", "official_data"]);
  assert.deepEqual(state.observedProviders, ["BLS", "SEC EDGAR"]);
  assert.equal(state.iterationsRemaining, DEEP_RESEARCH_MAX_ITERATIONS - 1);
  assert.equal(state.canContinue, true);
  assert.equal(state.continuationReason, "gaps_remain");
  assert.deepEqual(
    state.evidenceGaps.filter((gap) => gap.kind === "missing_evidence_type").map((gap) => gap.evidenceType),
    ["news"],
  );
});

test("deep research orchestration stops when evidence is sufficient, budget is exhausted, or investigation is inactive", () => {
  const completeEvidence = [
    evidence(),
    evidence({ id: 2, evidenceType: "official_data", provider: "BLS", sourceName: "BLS", sourceUrl: "https://www.bls.gov/example", contentFingerprint: "fingerprint-2" }),
    evidence({ id: 3, evidenceType: "news", provider: "Reuters", sourceName: "Reuters", sourceUrl: "https://www.reuters.com/example", contentFingerprint: "fingerprint-3" }),
  ];
  const sufficient = buildDeepResearchOrchestration({
    investigation: deepResearchInvestigation(),
    evidence: completeEvidence,
    requiredEvidenceTypes: ["filing", "official_data", "news"],
    iterationsUsed: 1,
  });
  assert.equal(sufficient.evidenceGaps.length, 0);
  assert.equal(sufficient.canContinue, false);
  assert.equal(sufficient.continuationReason, "sufficient_evidence");

  const exhausted = buildDeepResearchOrchestration({
    investigation: deepResearchInvestigation(),
    evidence: [evidence()],
    requiredEvidenceTypes: ["filing", "news"],
    iterationsUsed: DEEP_RESEARCH_MAX_ITERATIONS,
  });
  assert.equal(exhausted.canContinue, false);
  assert.equal(exhausted.continuationReason, "budget_exhausted");
  assert.equal(exhausted.iterationsRemaining, 0);

  const inactive = buildDeepResearchOrchestration({
    investigation: deepResearchInvestigation({ status: "paused" }),
    evidence: [evidence()],
    requiredEvidenceTypes: ["filing", "news"],
    iterationsUsed: 0,
  });
  assert.equal(inactive.canContinue, false);
  assert.equal(inactive.continuationReason, "inactive");
});
