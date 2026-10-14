import assert from "node:assert/strict";
import test from "node:test";
import { inspectSp03ResearchArtifact, type Sp03ArtifactDetailLike } from "./sp03_packaged_inspection";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const REF_A = "https://www.microsoft.com/en-us/Investor";
const REF_B = "https://www.sec.gov/Archives/edgar/data/789019/example.htm";

function truth(input: {
  provider: string;
  asOf: string;
  entitlement?: "entitled" | "unentitled" | "unknown";
  availability?: "available" | "unavailable" | "inaccessible" | "unknown";
  unknowns?: string[];
}) {
  return {
    provenance: {
      provider: input.provider,
      retrievedAt: "2026-10-07T05:00:00.000Z",
      publishedAt: input.asOf,
    },
    truth: {
      temporal: {
        observedAt: "2026-10-07T05:00:00.000Z",
        retrievedAt: "2026-10-07T05:00:00.000Z",
        publishedAt: input.asOf,
        effectiveAt: null,
        asOfAt: input.asOf,
        asOfBasis: "published_at",
        modelPeriod: null,
      },
      sourceQuality: {
        originClass: "untrusted",
        evidenceKind: "claim",
        tier: "unverified_web",
        claimVerification: "not_verified_by_digest",
      },
      freshness: {
        state: "fresh",
        basis: "computed_horizon",
        assessedAt: "2026-10-07T05:00:00.000Z",
        reason: "test",
      },
      access: {
        availability: input.availability ?? "available",
        entitlement: input.entitlement ?? "entitled",
      },
      certainty: "unknown",
      unknowns: input.unknowns ?? ["effective_at", "model_period", "certainty"],
      knowledge: {
        classification: "qualified",
        qualifiers: ["certainty:unknown"],
      },
    },
  };
}

function detail(overrides: Partial<Sp03ArtifactDetailLike["version"]> = {}): Sp03ArtifactDetailLike {
  const a = truth({ provider: "microsoft.com", asOf: "2026-10-01T00:00:00.000Z" });
  const b = truth({ provider: "sec.gov", asOf: "2026-09-30T00:00:00.000Z" });
  return {
    artifact: {
      id: "artifact:research-sp03",
      projectId: 7,
      kind: "research",
      origin: "conversation",
      headVersion: 1,
      title: "Microsoft Research Alpha",
    },
    version: {
      version: 1,
      contentHash: "a".repeat(64),
      sourceRefs: [REF_A, REF_B],
      dependencyRefs: [REF_A, REF_B],
      executionReceiptIds: [],
      trustManifest: null,
      content: {
        kind: "research",
        question: "Research Microsoft Corporation",
        plan: {
          status: "completed",
          steps: [{
            id: "web-evidence",
            objective: "Collect permitted independent evidence",
            status: "done",
            sourceKinds: ["web"],
          }],
        },
        blocks: [
          {
            id: "quote-a",
            type: "quote",
            text: "First source excerpt",
            attrs: { sourceRef: REF_A, evidenceId: "evidence-a", provenance: a.provenance, truth: a.truth },
          },
          {
            id: "quote-b",
            type: "quote",
            text: "Second source excerpt",
            attrs: { sourceRef: REF_B, evidenceId: "evidence-b", provenance: b.provenance, truth: b.truth },
          },
          {
            id: "unknowns",
            type: "callout",
            text: "Unknown model period remains explicit.",
            attrs: {},
          },
        ],
        claims: [{
          id: "claim-a",
          text: "A source-backed observation.",
          sourceRefs: [REF_A],
          provenance: "source_backed",
        }],
        evidence: [
          {
            id: "evidence-a",
            title: "Microsoft IR",
            snippet: "First source excerpt",
            sourceRef: REF_A,
            url: REF_A,
            sourceType: "web",
            observedAt: "2026-10-07T05:00:00.000Z",
          },
          {
            id: "evidence-b",
            title: "SEC filing",
            snippet: "Second source excerpt",
            sourceRef: REF_B,
            url: REF_B,
            sourceType: "web",
            observedAt: "2026-10-07T05:00:00.000Z",
          },
        ],
        sourcePolicy: {
          mode: "only_refs",
          allowedSourceRefs: [REF_A, REF_B],
          providerAllow: [],
          providerDeny: [],
        },
        contradictions: [],
        executionTrail: [{
          at: "2026-10-07T05:01:00.000Z",
          action: "Collected exact governed-browser evidence.",
          sourceRefs: [REF_A, REF_B],
          receiptId: null,
        }],
        editorPreference: "builtin",
      },
      ...overrides,
    },
  };
}

const execution = {
  id: REQUEST_ID,
  status: "completed",
  events: [
    {
      kind: "tool_call_started",
      toolCallId: "call-entity",
      stepId: "resolve",
      toolId: "lios.entity.resolve",
      inputSha256: "b".repeat(64),
      decision: "allow",
      permissionClass: "safe_auto",
      sideEffect: "none",
      seq: 1,
      at: "2026-10-07T04:59:00.000Z",
    },
    {
      kind: "evidence",
      role: "source",
      ref: "9f0d4e6a-69f8-4b9b-9988-0e8d0a19d234",
      seq: 2,
      at: "2026-10-07T04:59:01.000Z",
    },
    {
      kind: "tool_call_finished",
      toolCallId: "call-entity",
      status: "succeeded",
      outputRef: "9f0d4e6a-69f8-4b9b-9988-0e8d0a19d234",
      seq: 3,
      at: "2026-10-07T04:59:02.000Z",
    },
  ],
};

test("SP-03 inspection accepts a canonical, independent, truth-explicit ResearchArtifact", () => {
  const inspected = inspectSp03ResearchArtifact({
    detail: detail(),
    execution,
    interactions: [{ requestId: REQUEST_ID, action: "create", fromVersion: null, toVersion: 1 }],
    requestId: REQUEST_ID,
    identitySourceRefs: ["9f0d4e6a-69f8-4b9b-9988-0e8d0a19d234"],
    identityResolved: true,
  });

  assert.equal(inspected.canonicalIdentity.pass, true);
  assert.equal(inspected.multiSourceEvidence.pass, true);
  assert.equal(inspected.rightsFreshnessAsOf.pass, true);
  assert.equal(inspected.contradictionsGapsUnknowns.pass, true);
  assert.equal(inspected.truthClassification.pass, true);
  assert.equal(inspected.researchArtifact.pass, true);
  assert.equal(inspected.lineageInspection.pass, true);
  assert.equal(inspected.noFakeSuccess.pass, true);
  assert.deepEqual(inspected.sources.map((source) => source.provider), ["microsoft.com", "sec.gov"]);
});

test("SP-03 inspection rejects two source refs that collapse to one source/provider identity", () => {
  const collapsed = detail();
  const content = structuredClone(collapsed.version.content) as any;
  content.blocks[1].attrs.provenance.provider = "microsoft.com";
  content.evidence[1].url = "https://www.microsoft.com/second";
  content.evidence[1].sourceRef = "https://www.microsoft.com/second";
  content.blocks[1].attrs.sourceRef = "https://www.microsoft.com/second";
  content.executionTrail[0].sourceRefs[1] = "https://www.microsoft.com/second";
  collapsed.version.content = content;
  collapsed.version.sourceRefs = [REF_A, "https://www.microsoft.com/second"];
  collapsed.version.dependencyRefs = [REF_A, "https://www.microsoft.com/second"];

  const inspected = inspectSp03ResearchArtifact({
    detail: collapsed,
    execution,
    interactions: [{ requestId: REQUEST_ID }],
    requestId: REQUEST_ID,
    identitySourceRefs: ["9f0d4e6a-69f8-4b9b-9988-0e8d0a19d234"],
    identityResolved: true,
  });
  assert.equal(inspected.multiSourceEvidence.pass, false);
});

test("SP-03 inspection fails closed for unentitled evidence", () => {
  const blocked = detail();
  const content = structuredClone(blocked.version.content) as any;
  content.blocks[1].attrs.truth.access.entitlement = "unentitled";
  blocked.version.content = content;

  const inspected = inspectSp03ResearchArtifact({
    detail: blocked,
    execution,
    interactions: [{ requestId: REQUEST_ID }],
    requestId: REQUEST_ID,
    identitySourceRefs: ["9f0d4e6a-69f8-4b9b-9988-0e8d0a19d234"],
    identityResolved: true,
  });
  assert.equal(inspected.noFakeSuccess.pass, false);
});

test("SP-03 inspection rejects unknown-provenance research claims", () => {
  const untyped = detail();
  const content = structuredClone(untyped.version.content) as any;
  content.claims[0].provenance = "unknown";
  untyped.version.content = content;

  const inspected = inspectSp03ResearchArtifact({
    detail: untyped,
    execution,
    interactions: [{ requestId: REQUEST_ID }],
    requestId: REQUEST_ID,
    identitySourceRefs: ["9f0d4e6a-69f8-4b9b-9988-0e8d0a19d234"],
    identityResolved: true,
  });
  assert.equal(inspected.truthClassification.pass, false);
});

test("SP-03 inspection requires canonical P5 identity evidence from the exact run", () => {
  const inspected = inspectSp03ResearchArtifact({
    detail: detail(),
    execution: { id: REQUEST_ID, status: "completed", events: [] },
    interactions: [{ requestId: REQUEST_ID }],
    requestId: REQUEST_ID,
    identitySourceRefs: [],
    identityResolved: false,
  });
  assert.equal(inspected.canonicalIdentity.pass, false);
});

test("SP-03 inspection requires request-bound Artifact interaction lineage", () => {
  const inspected = inspectSp03ResearchArtifact({
    detail: detail(),
    execution,
    interactions: [{ requestId: "22222222-2222-4222-8222-222222222222" }],
    requestId: REQUEST_ID,
  });
  assert.equal(inspected.lineageInspection.pass, false);
});
