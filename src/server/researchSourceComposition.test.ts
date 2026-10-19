import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { z } from "zod";
import { createAttribution } from "./byoaiRouter";
import type { ConversationRuntimeInput } from "./conversationRuntime";
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
  // Database modules must load after LIMURIA_DATA_DIR selects this test's isolated root.
  const { initDb, closeDb, getDb } = await import("./db");
  const { users } = await import("@shared/schema");
  const { createProject } = await import("./projectStore");
  const { indexProjectDocument, searchProjectIntelligence } = await import("./p7ProjectIntelligenceStore");
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

  await t.test("query-centered excerpts retain late matching passages and each source revision", async (nested) => {
    const passages = [
      "Xerophyte survey found drought-tolerant vegetation at the north entrance.",
      "Xerophyte review recorded a separate planting trial at the south entrance.",
    ];
    const documents: P7ProjectDocument[] = [];
    for (const [index, passage] of passages.entries()) {
      const sourceRef = `internal:field-survey:${index}`;
      const body = "Administrative preamble without survey findings. ".repeat(100)
        + passage
        + " Methodology appendix without additional findings.".repeat(40);
      assert.ok(body.indexOf(passage) > 1_800);
      documents.push(await indexProjectDocument(ctx, {
        projectId: project.id,
        sourceType: "research_evidence",
        sourceRef,
        title: `Field survey ${index}`,
        body,
        sourceRefs: [sourceRef],
        metadata: {
          researchSource: {
            class: "internal_research",
            identity: {
              sourceId: sourceRef,
              providerId: null,
              organization: "Internal field survey",
              author: null,
              analystId: null,
              expertId: null,
              url: null,
            },
            rights: allowedRights,
          },
        },
      }));
    }
    const hits = await searchProjectIntelligence(ctx, project.id, { query: "xerophyte" });
    const composed = researchSourceCompositionToolOutputSchema.parse(
      await researchSourceCompositionTool.invoke(
        { query: "xerophyte" },
        new AbortController().signal,
        call,
      ),
    );
    assert.equal(composed.output.sourceCount, 2);
    assert.equal(composed.output.blockedCount, 0);
    assert.deepEqual(new Set(composed.sourceRefs), new Set(documents.map((document) => document.sourceRef)));
    for (const [index, document] of documents.entries()) {
      const hit = hits.find((item) => item.documentId === document.id);
      const source = composed.output.sources.find((item) => item.documentId === document.id);
      assert.ok(hit);
      assert.ok(source);
      assert.ok(hit.excerpt.includes(passages[index]));
      assert.ok(source.excerpt.includes(passages[index]), "Composition must return the matching passage, not the document preamble.");
      assert.equal(source.excerpt, hit.excerpt);
      assert.equal(source.contentHash, document.contentHash);
      assert.equal(source.contentHash, hit.contentHash);
      assert.equal(source.sourceRef, document.sourceRef);
      assert.equal(source.identity.sourceId, document.sourceRef);
      assert.equal(source.rights.aiTransmission, "permitted");
    }

    await nested.test("bounded agent review transmits current permitted late passages, not arbitrary tool payloads", async () => {
      // Load the runtime only after this test selects and initializes its isolated database root.
      const { executeConversationRuntime, registerConversationTool } = await import("./conversationRuntime");
      const forbidden = {
        sourceRef: "expert:private:xerophyte",
        title: "Forbidden Xerophyte Expert Title",
        body: "Xerophyte secret passage must stay local.",
      };
      await indexProjectDocument(ctx, {
        projectId: project.id, sourceType: "research_evidence",
        ...forbidden, sourceRefs: [forbidden.sourceRef],
        metadata: { researchSource: {
          class: "expert_content",
          identity: { sourceId: forbidden.sourceRef, providerId: null, organization: null,
            author: null, analystId: null, expertId: null, url: null },
          rights: { ...allowedRights, aiTransmission: "restricted" },
        } },
      });
      registerConversationTool({
        id: "test.research.unrelated-payload", label: "Unrelated read", kind: "retrieve",
        permissionClass: "safe_auto", access: "read", sideEffect: "none", replaySafe: true,
        inputSchema: z.object({ privateArgument: z.string() }).strict(),
        outputSchema: z.object({ output: z.unknown(), summary: z.string(), deterministic: z.boolean(), sourceRefs: z.array(z.string()) }).strict(),
        cancel: null,
        invoke: async () => ({ output: { secret: "ARBITRARY-OUTPUT-DO-NOT-SEND" },
          summary: "Unrelated read completed.", deterministic: true, sourceRefs: [] }),
      });
      const prompts: string[] = [];
      const events: unknown[] = [];
      const ledger: unknown[] = [];
      const completions = [
        JSON.stringify({ steps: [
          { id: "compose", toolId: "lios.research.compose_sources", label: "Read permitted survey sources",
            input: { query: "xerophyte" }, dependsOn: [] },
          { id: "other", toolId: "test.research.unrelated-payload", label: "Unrelated read",
            input: { privateArgument: "ARBITRARY-INPUT-DO-NOT-SEND" }, dependsOn: ["compose"] },
        ] }),
        JSON.stringify({ decision: "complete", answer: "Transport fixture complete." }),
      ];
      await executeConversationRuntime({
        tenant: call.tenant, scope: "project", chatId: null, projectId: project.id,
        resources: [], history: [],
        request: {
          requestId: crypto.randomUUID(), continuationOf: null,
          message: "Compare xerophyte survey findings using the governed research source composition tool.",
          executionMode: "ai_assisted", aiDirectApproved: false, approvals: [], attachments: [],
          sourceScope: "my_data",
          transmissionPolicy: {
            mode: "configured", providerAllow: [], providerDeny: [],
            allowProjectInstructions: true, allowResourceReferences: true,
            allowSelection: true, allowToolCalling: true, dataClassification: "private",
          },
        },
        agentLoop: { ledger: async (event) => { ledger.push(event); } },
        aiCompletion: async (completion) => {
          prompts.push(JSON.stringify(completion));
          const text = completions.shift();
          assert.notEqual(text, undefined, "only planning and review are expected");
          return { provider: "openai", model: "gpt-4o", text: text!,
            attribution: createAttribution({ provider: "openai", model: "gpt-4o", prompt: "transport fixture", output: text! }) };
        },
        emit: (event) => { events.push(event); },
      });
      assert.equal(prompts.length, 2, "injected completion proves outgoing transport, not model synthesis quality");
      const review = prompts[1]!;
      for (const [index, document] of documents.entries()) {
        assert.ok(review.includes(passages[index]), "the actual governed review prompt must contain the late matching passage");
        assert.ok(review.includes(document.contentHash), "each passage retains its current source revision");
        assert.ok(review.includes(document.sourceRef));
      }
      for (const secret of [...Object.values(forbidden), "ARBITRARY-OUTPUT-DO-NOT-SEND", "ARBITRARY-INPUT-DO-NOT-SEND"]) {
        assert.equal(review.includes(secret), false, `review must exclude ${secret}`);
      }
      const durableOrClient = JSON.stringify([events, ledger]);
      for (const passage of passages) assert.equal(durableOrClient.includes(passage), false, "research observations stay ephemeral, outside SSE and the journal");
    });

    await nested.test("research review refreshes database rights and active source policy for every repaired review", async () => {
      // Runtime/store loading must follow the isolated database setup above.
      const { executeConversationRuntime, registerConversationTool } = await import("./conversationRuntime");
      const { createArtifact, createArtifactVersion } = await import("./artifactStore");
      const { researchArtifactContentSchema } = await import("@shared/artifactContracts");
      let mutateBeforeReview: (() => Promise<void>) | undefined;
      registerConversationTool({
        id: "test.research.change-current-policy", label: "Change fixture policy", kind: "retrieve",
        permissionClass: "safe_auto", access: "read", sideEffect: "none", replaySafe: true,
        inputSchema: z.object({}).strict(),
        outputSchema: z.object({ output: z.unknown(), summary: z.string(), deterministic: z.boolean(), sourceRefs: z.array(z.string()) }).strict(),
        cancel: null,
        invoke: async () => {
          await mutateBeforeReview?.();
          return { output: null, summary: "Fixture boundary reached.", deterministic: true, sourceRefs: [] };
        },
      });
      async function capture(options: {
        query?: string;
        context?: ConversationRuntimeInput["request"]["context"];
        beforeReview?: () => Promise<void>;
        repair?: () => Promise<void>;
      } = {}) {
        mutateBeforeReview = options.beforeReview;
        const prompts: string[] = [];
        const events: unknown[] = [];
        const ledger: unknown[] = [];
        let reviewCalls = 0;
        await executeConversationRuntime({
          tenant: call.tenant, scope: "project", chatId: null, projectId: project.id,
          resources: [], history: [],
          request: {
            requestId: crypto.randomUUID(), continuationOf: null, message: "Compare governed research findings.",
            executionMode: "ai_assisted", aiDirectApproved: false, approvals: [], attachments: [],
            sourceScope: "my_data", ...(options.context ? { context: options.context } : {}),
            transmissionPolicy: { mode: "configured", providerAllow: [], providerDeny: [],
              allowProjectInstructions: true, allowResourceReferences: true, allowSelection: true,
              allowToolCalling: true, dataClassification: "private" },
          },
          agentLoop: { ledger: async (event) => { ledger.push(event); } },
          aiCompletion: async (completion) => {
            prompts.push(JSON.stringify(completion));
            let text: string;
            if (prompts.length === 1) {
              text = JSON.stringify({ steps: [
                { id: "compose", toolId: "lios.research.compose_sources", label: "Read sources",
                  input: { query: options.query ?? "xerophyte", limit: 50 }, dependsOn: [] },
                { id: "boundary", toolId: "test.research.change-current-policy", label: "Fixture boundary",
                  input: {}, dependsOn: ["compose"] },
              ] });
            } else {
              reviewCalls += 1;
              if (reviewCalls === 1 && options.repair) {
                await options.repair();
                text = "invalid review requiring a fresh policy check";
              } else text = JSON.stringify({ decision: "complete", answer: "Transport fixture complete." });
            }
            return { provider: "openai", model: "gpt-4o", text,
              attribution: createAttribution({ provider: "openai", model: "gpt-4o", prompt: "transport fixture", output: text }) };
          },
          emit: (event) => { events.push(event); },
        });
        return { prompts, events, ledger };
      }
      const revoked = await capture({ beforeReview: async () => {
        const document = documents[0]!;
        await indexProjectDocument(ctx, {
          projectId: project.id, sourceType: document.sourceType, sourceRef: document.sourceRef,
          title: document.title, body: document.body, sourceRefs: document.sourceRefs,
          metadata: { ...document.metadata, researchSource: {
            ...(document.metadata.researchSource as Record<string, unknown>),
            rights: { ...allowedRights, aiTransmission: "unknown" },
          } },
        });
      } });
      assert.equal(revoked.prompts[1]!.includes(passages[0]), false, "rights revoked after original composition must remove its passage");
      assert.equal(revoked.prompts[1]!.includes(documents[0]!.sourceRef), false, "restricted source identity must not survive via original outcomes");
      assert.ok(revoked.prompts[1]!.includes(passages[1]), "still-permitted sources remain usable");

      const content = researchArtifactContentSchema.parse({
        kind: "research", question: "Xerophyte survey", blocks: [], claims: [], evidence: [],
        sourcePolicy: { mode: "only_refs", allowedSourceRefs: [documents[1]!.sourceRef] },
      });
      const saved = await createArtifact(ctx, { projectId: project.id, title: "Current research scope", content });
      const repaired = await capture({
        context: { activeObjectRefs: [saved.artifact.id] },
        repair: async () => {
          await createArtifactVersion(ctx, {
            artifactId: saved.artifact.id, baseVersion: 1,
            content: { ...content, sourcePolicy: { ...content.sourcePolicy, allowedSourceRefs: [] } },
          });
        },
      });
      assert.ok(repaired.prompts[1]!.includes(passages[1]));
      assert.equal(repaired.prompts[2]!.includes(passages[1]), false, "repair must reread the active allowlist and fail closed when it becomes empty");
      const durable = JSON.stringify([revoked.events, revoked.ledger, repaired.events, repaired.ledger]);
      for (const passage of passages) assert.equal(durable.includes(passage), false);

      const safeBulk: P7ProjectDocument[] = [];
      const credentialBodies = [
        "Megaflora password=do-not-transmit-credential",
        "Megaflora https://example.test/report?token=do-not-transmit-query",
        "Megaflora -----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----",
      ];
      for (let index = 0; index < 30 + credentialBodies.length; index += 1) {
        const sourceRef = `internal:megaflora:${index}`;
        const document = await indexProjectDocument(ctx, {
          projectId: project.id, sourceType: "research_evidence", sourceRef,
          title: `Megaflora survey ${index}`, sourceRefs: [sourceRef],
          body: index < 30 ? `Megaflora passage record ${index}. ${"植".repeat(1_500)}` : credentialBodies[index - 30],
          metadata: { researchSource: {
            class: "internal_research",
            identity: { sourceId: sourceRef, providerId: null, organization: null,
              author: null, analystId: null, expertId: null, url: null },
            rights: allowedRights,
          } },
        });
        if (index < 30) safeBulk.push(document);
      }
      const bulk = await capture({ query: "megaflora" });
      const begin = "BEGIN_CURRENT_RESEARCH_OBSERVATIONS";
      const end = "END_CURRENT_RESEARCH_OBSERVATIONS";
      function findObservation(value: unknown): string | undefined {
        if (typeof value === "string") return value.includes(begin) ? value : undefined;
        if (!value || typeof value !== "object") return undefined;
        for (const child of Object.values(value)) {
          const found = findObservation(child);
          if (found) return found;
        }
        return undefined;
      }
      const transport = findObservation(JSON.parse(bulk.prompts[1]!));
      assert.ok(transport);
      const framed = transport.slice(transport.indexOf(begin), transport.indexOf(end) + end.length);
      assert.ok(Buffer.byteLength(framed, "utf8") <= 24 * 1024, "the global bound includes framing and multibyte source bytes");
      assert.match(framed, /Untrusted source material/);
      assert.match(framed, /NOT the original immutable tool output/);
      const jsonLine = framed.split("\n").find((line) => line.startsWith("{"));
      assert.ok(jsonLine);
      const projection = JSON.parse(jsonLine) as {
        sources: Array<{ sourceRef: string; contentHash: string; excerpt: string }>;
        currentSourceCount: number;
        omittedSourceCountByByteLimit: number;
        omittedSourceCountByCredentialPolicy: number;
      };
      assert.ok(projection.sources.length > 0);
      assert.ok(projection.omittedSourceCountByByteLimit > 0);
      assert.equal(projection.omittedSourceCountByCredentialPolicy, credentialBodies.length);
      assert.equal(projection.currentSourceCount,
        projection.sources.length + projection.omittedSourceCountByByteLimit + projection.omittedSourceCountByCredentialPolicy);
      const current = researchSourceCompositionToolOutputSchema.parse(await researchSourceCompositionTool.invoke(
        { query: "megaflora", limit: 50 }, new AbortController().signal, call,
      ));
      for (const source of projection.sources) {
        const original = current.output.sources.find((candidate) => candidate.sourceRef === source.sourceRef);
        assert.ok(original);
        assert.deepEqual(source.excerpt, original.excerpt, "byte bounding admits whole records, never clips passages");
        assert.equal(source.contentHash, original.contentHash);
        assert.ok(safeBulk.some((document) => document.sourceRef === source.sourceRef));
      }
      for (const secret of ["do-not-transmit-credential", "do-not-transmit-query", "not-a-real-key"]) {
        assert.equal(bulk.prompts[1]!.includes(secret), false);
      }
      for (let index = 30; index < 33; index += 1) {
        assert.equal(framed.includes(`internal:megaflora:${index}`), false, "credential source identities are omitted with their records");
      }
      assert.equal(JSON.stringify([bulk.events, bulk.ledger]).includes("植".repeat(20)), false);
    });
  });
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
