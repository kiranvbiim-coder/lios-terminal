import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { p7ProjectDocumentSchema, type P7ProjectDocument } from "@shared/p7ResearchContracts";
import {
  composeResearchSources,
  researchSourceForDocument,
} from "./researchSourceComposition";

function fixtureDocument(input: {
  id: string;
  sourceRef: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}): P7ProjectDocument {
  return p7ProjectDocumentSchema.parse({
    schemaVersion: "1",
    id: input.id,
    projectId: 1,
    sourceType: "research_evidence",
    sourceRef: input.sourceRef,
    title: input.title,
    body: input.body,
    contentHash: crypto.createHash("sha256").update(input.body).digest("hex"),
    occurredAt: "2026-10-06T10:00:00.000Z",
    sourceRefs: [input.sourceRef],
    entityRefs: ["entity:ACME"],
    contextRefs: {},
    metadata: input.metadata ?? {},
    embedding: null,
  });
}

const allowedRights = {
  entitlement: {
    decision: "allowed" as const,
    policyId: "policy:research",
    permittedUses: ["internal_research"],
    reasons: ["Entitled research source."],
  },
  aiTransmission: "permitted" as const,
  internalUse: "permitted" as const,
  redistribution: "restricted" as const,
};

test("SI-03.25 composes explicit broker/internal sources without flattening source identity", () => {
  const broker = fixtureDocument({
    id: "broker-doc",
    sourceRef: "broker:alpha:note-1",
    title: "Alpha Securities note",
    body: "Margin outlook improves after mix shift.",
    metadata: {
      researchSource: {
        class: "broker_research",
        identity: {
          sourceId: "note-1",
          providerId: "alpha-research",
          organization: "Alpha Securities",
          author: "Jane Analyst",
          analystId: "analyst-42",
          expertId: null,
          url: "https://research.example.test/note-1",
        },
        rights: allowedRights,
      },
    },
  });
  const internal = fixtureDocument({
    id: "internal-doc",
    sourceRef: "internal:desk:thesis-7",
    title: "Internal desk thesis",
    body: "Internal channel checks support the margin outlook.",
    metadata: {
      researchSource: {
        class: "internal_research",
        identity: {
          sourceId: "thesis-7",
          providerId: null,
          organization: "LiOS Research Desk",
          author: "Internal Analyst",
          analystId: "desk-7",
          expertId: null,
          url: null,
        },
        rights: allowedRights,
      },
    },
  });

  const result = composeResearchSources({
    documents: [broker, internal],
    targetUse: "ai_assistance",
  });
  assert.equal(result.counts.included, 2);
  assert.equal(result.counts.blocked, 0);
  assert.deepEqual(result.included.map((item) => item.sourceClass), ["broker_research", "internal_research"]);
  assert.equal(result.included[0].identity.providerId, "alpha-research");
  assert.equal(result.included[0].identity.analystId, "analyst-42");
  assert.equal(result.included[1].identity.organization, "LiOS Research Desk");
  assert.equal(result.included[0].rights.redistribution, "restricted");
});

test("SI-03.25 user-file local availability does not imply AI transmission or redistribution rights", () => {
  const file = fixtureDocument({
    id: "file-doc",
    sourceRef: "prjres:file-1",
    title: "Uploaded diligence notes",
    body: "Private diligence notes.",
    metadata: {
      kind: "chat_attachment",
      resourceRef: "project-attachment:file-1",
    },
  });
  const source = researchSourceForDocument(file);
  assert.ok(source);
  assert.equal(source.class, "user_file");
  assert.equal(source.rights.entitlement.decision, "allowed");
  assert.equal(source.rights.internalUse, "permitted");
  assert.equal(source.rights.aiTransmission, "unknown");
  assert.equal(source.rights.redistribution, "unknown");

  const local = composeResearchSources({ documents: [file], targetUse: "internal_research" });
  assert.equal(local.included.length, 1);
  const ai = composeResearchSources({ documents: [file], targetUse: "ai_assistance" });
  assert.equal(ai.included.length, 0);
  assert.equal(ai.blocked[0].reason, "ai_transmission_unknown");
  const redistribution = composeResearchSources({ documents: [file], targetUse: "redistribution" });
  assert.equal(redistribution.included.length, 0);
  assert.equal(redistribution.blocked[0].reason, "redistribution_unknown");
});

test("SI-03.25 unknown/denied entitlements and restricted AI rights fail closed deterministically", () => {
  const restrictedExpert = fixtureDocument({
    id: "expert-doc",
    sourceRef: "expert:call:9",
    title: "Expert call transcript",
    body: "Expert discussed margin normalization.",
    metadata: {
      researchSource: {
        class: "expert_content",
        identity: {
          sourceId: "call-9",
          providerId: "expert-network",
          organization: "Expert Network",
          author: null,
          analystId: null,
          expertId: "expert-9",
          url: null,
        },
        rights: {
          ...allowedRights,
          aiTransmission: "restricted",
        },
      },
    },
  });
  const browser = fixtureDocument({
    id: "web-doc",
    sourceRef: "https://example.test/margins",
    title: "Public web page",
    body: "Public page mentions margins.",
    metadata: {
      provider: "playwright",
      sourceUrl: "https://example.test/margins",
      requestedUrl: "https://example.test/margins",
      resolvedUrl: "https://example.test/margins",
      acquisitionRef: "browser-acquisition:1",
    },
  });

  const first = composeResearchSources({
    documents: [restrictedExpert, browser],
    targetUse: "ai_assistance",
  });
  const second = composeResearchSources({
    documents: [restrictedExpert, browser],
    targetUse: "ai_assistance",
  });
  assert.deepEqual(first, second);
  assert.equal(first.included.length, 0);
  assert.deepEqual(first.blocked.map((item) => item.reason), [
    "ai_transmission_restricted",
    "entitlement_unknown",
  ]);
  assert.equal(first.blocked[0].identity?.expertId, "expert-9", "server-side composition retains source identity");
  assert.equal(first.blocked[1].sourceClass, "public_external");
});

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-research-source-composition-"));
process.env.LIMURIA_DATA_DIR = dataDir;

test("SI-03.25 AI-facing tool emits only AI-permitted sources and aggregates blocked metadata", async (t) => {
  const { initDb, closeDb, getDb } = await import("./db");
  const { users } = await import("@shared/schema");
  const { createProject } = await import("./projectStore");
  const { indexProjectDocument } = await import("./p7ProjectIntelligenceStore");
  const {
    researchSourceCompositionTool,
    researchSourceCompositionToolInputSchema,
    researchSourceCompositionToolOutputSchema,
  } = await import("./researchSourceCompositionTool");

  assert.match(researchSourceCompositionTool.planningHint ?? "", /Allowed keys are query, limit, sourceClasses only/);
  assert.match(researchSourceCompositionTool.planningHint ?? "", /public_external/);
  assert.equal(researchSourceCompositionToolInputSchema.safeParse({ query: "Microsoft Corporation" }).success, true);
  assert.equal(researchSourceCompositionToolInputSchema.safeParse({
    query: "Microsoft Corporation",
    sourceClasses: ["public_external", "internal_research"],
  }).success, true);
  assert.equal(researchSourceCompositionToolInputSchema.safeParse({
    query: "Microsoft Corporation",
    sourceRefs: ["https://example.test"],
  }).success, false);
  assert.equal(researchSourceCompositionToolInputSchema.safeParse({
    query: "Microsoft Corporation",
    sourceClasses: ["public"],
  }).success, false);

  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const [owner] = await getDb().insert(users).values({
    email: `${crypto.randomUUID()}@example.test`,
    passwordHash: "test-hash",
    role: "internal_analyst",
    name: "Research composition owner",
  }).returning();
  const project = await createProject(
    { userId: owner.id, organizationId: null, role: owner.role },
    { name: "Composed Research" },
  );
  const ctx = { userId: owner.id, organizationId: null, role: owner.role };

  await indexProjectDocument(ctx, {
    projectId: project.id,
    sourceType: "research_evidence",
    sourceRef: "broker:alpha:note-1",
    entityRefs: ["entity:ACME"],
    title: "Alpha margin outlook",
    body: "Margin outlook improves after mix shift and pricing discipline.",
    sourceRefs: ["broker:alpha:note-1"],
    metadata: {
      researchSource: {
        class: "broker_research",
        identity: {
          sourceId: "note-1",
          providerId: "alpha-research",
          organization: "Alpha Securities",
          author: "Jane Analyst",
          analystId: "analyst-42",
          expertId: null,
          url: "https://research.example.test/note-1",
        },
        rights: allowedRights,
      },
    },
  });
  await indexProjectDocument(ctx, {
    projectId: project.id,
    sourceType: "research_evidence",
    sourceRef: "expert:restricted:call-9",
    entityRefs: ["entity:ACME"],
    title: "Restricted expert margin discussion",
    body: "Restricted expert margin outlook detail that must not reach AI.",
    sourceRefs: ["expert:restricted:call-9"],
    metadata: {
      researchSource: {
        class: "expert_content",
        identity: {
          sourceId: "secret-call-9",
          providerId: "expert-network",
          organization: "Restricted Expert Network",
          author: null,
          analystId: null,
          expertId: "expert-secret-9",
          url: null,
        },
        rights: {
          ...allowedRights,
          aiTransmission: "restricted",
        },
      },
    },
  });
  await indexProjectDocument(ctx, {
    projectId: project.id,
    sourceType: "research_evidence",
    sourceRef: "internal:desk:margin",
    entityRefs: ["entity:ACME"],
    title: "Internal margin outlook",
    body: "Internal margin outlook supports the broker note.",
    sourceRefs: ["internal:desk:margin"],
    metadata: {
      researchSource: {
        class: "internal_research",
        identity: {
          sourceId: "desk-margin",
          providerId: null,
          organization: "LiOS Research Desk",
          author: "Desk Analyst",
          analystId: "desk-1",
          expertId: null,
          url: null,
        },
        rights: allowedRights,
      },
    },
  });

  const call = {
    source: "agent" as const,
    userId: owner.id,
    tenant: {
      userId: owner.id,
      organizationId: null,
      role: "internal_analyst" as const,
    },
    projectId: project.id,
    requestId: crypto.randomUUID(),
    sourceScope: "my_data" as const,
  };

  const result = researchSourceCompositionToolOutputSchema.parse(
    await researchSourceCompositionTool.invoke(
      { query: "margin outlook", limit: 20 },
      new AbortController().signal,
      call,
    ),
  );
  assert.equal(result.output.sourceCount, 2);
  assert.equal(result.output.blockedCount, 1);
  assert.deepEqual(
    new Set(result.output.sources.map((item) => item.sourceClass)),
    new Set(["broker_research", "internal_research"]),
  );
  assert.deepEqual(result.output.blocked, [{
    sourceClass: "expert_content",
    reason: "ai_transmission_restricted",
    count: 1,
  }]);
  // These GraphRAG-derived neighborhoods are built only after P7 AI-use
  // filtering. The restricted expert is absent even as an edge endpoint.
  assert.equal(result.output.graphLinks.length, 1);
  assert.deepEqual(result.output.graphNeighborhoods, [
    {sourceRef:"broker:alpha:note-1",directSourceRefs:["internal:desk:margin"],
      twoHopSourceRefs:[],directLinkCount:1,sharedEntityMentions:1},
    {sourceRef:"internal:desk:margin",directSourceRefs:["broker:alpha:note-1"],
      twoHopSourceRefs:[],directLinkCount:1,sharedEntityMentions:1},
  ]);
  assert.equal(JSON.stringify(result.output.graphNeighborhoods).includes("expert:restricted:call-9"), false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("expert-secret-9"), false);
  assert.equal(serialized.includes("secret-call-9"), false);
  assert.equal(serialized.includes("Restricted Expert Network"), false);
  assert.equal(serialized.includes("Restricted expert margin outlook detail"), false);
  assert.ok(result.sourceRefs.includes("broker:alpha:note-1"));
  assert.ok(result.sourceRefs.includes("internal:desk:margin"));
  assert.equal(result.sourceRefs.includes("expert:restricted:call-9"), false);

  const narrowed = researchSourceCompositionToolOutputSchema.parse(
    await researchSourceCompositionTool.invoke(
      { query: "margin outlook", limit: 20 },
      new AbortController().signal,
      { ...call, allowedSourceRefs: ["broker:alpha:note-1"] },
    ),
  );
  assert.equal(narrowed.output.sourceCount, 1);
  assert.equal(narrowed.output.blockedCount, 0);
  assert.deepEqual(narrowed.sourceRefs, ["broker:alpha:note-1"]);
  assert.deepEqual(narrowed.output.graphLinks,[]);
  assert.deepEqual(narrowed.output.graphNeighborhoods,[]);

  const classFiltered = researchSourceCompositionToolOutputSchema.parse(
    await researchSourceCompositionTool.invoke(
      { query: "margin outlook", sourceClasses: ["internal_research"] },
      new AbortController().signal,
      call,
    ),
  );
  assert.equal(classFiltered.output.sourceCount, 1);
  assert.equal(classFiltered.output.sources[0].sourceClass, "internal_research");
  assert.deepEqual(classFiltered.output.graphNeighborhoods,[]);

  await assert.rejects(
    () => researchSourceCompositionTool.invoke(
      { query: "margin outlook" },
      new AbortController().signal,
      { ...call, sourceScope: "web" as const },
    ),
    /requires Auto or My Data scope/,
  );
});


test("GraphRAG source links depend on canonical P7 AI-use rights, not unentitled raw documents", async () => {
  const { rankPermittedEvidenceLinks } = await import("./graphragPermittedEvidenceLinks");
  const explicit = (id: string, aiTransmission: "permitted" | "restricted") => fixtureDocument({
    id,
    sourceRef: "broker:" + id,
    title: "Rights-aware " + id,
    body: "Research note " + id,
    metadata: {
      researchSource: {
        class: "broker_research",
        identity: {
          sourceId: id, providerId: "approved-broker", organization: "Broker",
          author: null, analystId: null, expertId: null, url: null,
        },
        rights: { ...allowedRights, aiTransmission },
      },
    },
  });
  const permittedA = explicit("A", "permitted");
  const permittedB = explicit("B", "permitted");
  const blockedC = explicit("C", "restricted");
  const composed = composeResearchSources({
    documents: [permittedA, blockedC, permittedB],
    targetUse: "ai_assistance",
  });
  assert.deepEqual(composed.included.map(s => s.sourceRef), ["broker:A","broker:B"]);
  assert.equal(composed.blocked.length, 1);
  assert.deepEqual(rankPermittedEvidenceLinks(composed.included), [{
    leftSourceRef: "broker:A", rightSourceRef: "broker:B", sharedEntityCount: 1,
  }]);
  const onlyRestricted = composeResearchSources({
    documents: [blockedC], targetUse: "ai_assistance",
  });
  assert.deepEqual(rankPermittedEvidenceLinks(onlyRestricted.included), []);
});
