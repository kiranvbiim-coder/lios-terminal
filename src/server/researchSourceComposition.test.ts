import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
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
  const { users, projectIntelligenceDocuments, projectIntelligenceDocumentVersions, projectIntelligenceSnapshots } = await import("@shared/schema");
  const { createProject, getProject, touchProjectActivity } = await import("./projectStore");
  const { indexProjectDocument, searchProjectIntelligence } = await import("./p7ProjectIntelligenceStore");
  const {
    researchSourceCompositionTool,
    researchSourceCompositionToolInputSchema,
    researchSourceCompositionToolOutputSchema,
  } = await import("./researchSourceCompositionTool");

  assert.match(researchSourceCompositionTool.planningHint ?? "", /Allowed keys are query, limit, sourceClasses, facets only/);
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

  await t.test("workflow identity discovery receives the active ResearchArtifact provider and exact-reference policy", async () => {
    // These modules capture data-root state: load only after this test initializes its isolated database.
    const { createArtifact } = await import("./artifactStore");
    const { researchArtifactContentSchema } = await import("@shared/artifactContracts");
    const { executeConversationRuntime, getConversationTool, registerConversationTool } = await import("./conversationRuntime");
    const identityTool = getConversationTool("lios.instrument-master");
    assert.ok(identityTool, "exercise the registered identity tool, not a replacement resolver");
    try {
      for (const mode of ["connected_sources", "only_refs"] as const) {
        const sourcePolicy = {
          mode,
          allowedSourceRefs: ["internal:synthetic:identity-scope"],
          providerAllow: [],
          providerDeny: ["lse", "sec_edgar", "openfigi"],
        };
        const saved = await createArtifact(ctx, {
          projectId: project.id,
          title: "Synthetic identity source policy",
          content: researchArtifactContentSchema.parse({
            kind: "research", question: "Synthetic identity scope", blocks: [], claims: [], evidence: [],
            sourcePolicy,
          }),
        });
        let invoked = 0;
        registerConversationTool({
          ...identityTool,
          invoke: async (input, signal, governedCall) => {
            invoked += 1;
            assert.equal(governedCall.sourceScope, "auto");
            assert.equal(governedCall.researchSourcePolicy?.mode, mode);
            assert.deepEqual(governedCall.researchSourcePolicy?.providerDeny, sourcePolicy.providerDeny);
            assert.equal(governedCall.researchSourcePolicyBinding?.artifactId, saved.artifact.id);
            const result = await identityTool.invoke(input, signal, governedCall);
            assert.equal(result.output, null, "denied/exact-reference policy cannot discover an external identity");
            return result;
          },
        });
        await executeConversationRuntime({
          tenant: ctx, scope: "project", chatId: null, projectId: project.id, resources: [], history: [],
          request: {
            requestId: crypto.randomUUID(), continuationOf: null,
            message: "resolve SYNTHX", executionMode: "deterministic_first",
            aiDirectApproved: false, approvals: [], attachments: [], sourceScope: "auto",
            context: { activeObjectRefs: [saved.artifact.id] },
            transmissionPolicy: {
              mode: "configured", providerAllow: [], providerDeny: [],
              allowProjectInstructions: true, allowResourceReferences: true,
              allowSelection: true, allowToolCalling: true, dataClassification: "private",
            },
          },
          aiCompletion: async () => { throw new Error("deterministic identity must not invoke inference"); },
          emit: () => undefined,
        });
        assert.equal(invoked, 1);
      }
    } finally {
      registerConversationTool(identityTool);
    }
  });

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
      { query: "margin outlook", limit: 20, facets: ["margin", "unknown ratio"] },
      new AbortController().signal,
      call,
    ),
  );
  assert.equal(result.output.sourceCount, 2);
  assert.equal(result.output.blockedCount, 1);
  assert.equal(result.output.comparison.length, 2);
  assert.equal(result.output.comparison[0].facet, "margin");
  assert.equal(result.output.comparison[0].matchingSources, 2);
  assert.equal(result.output.comparison[1].status, "not_observed_in_retrieved_excerpts");
  assert.equal(result.output.comparison[0].agreement, "not_assessed");
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
  assert.equal(serialized.includes("expert:restricted:call-9"), false);
  assert.equal(result.output.comparison.some(facet =>
    facet.rows.some(row => row.sourceRef.startsWith("expert:"))), false);
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
      const permitted = documents[1]!;
      const currentPermitted = await indexProjectDocument(ctx, {
        projectId: project.id, sourceType: permitted.sourceType, sourceRef: permitted.sourceRef,
        title: permitted.title, body: permitted.body, metadata: permitted.metadata,
        sourceRefs: [permitted.sourceRef, forbidden.sourceRef, "unverified:private:xerophyte-reference"],
      });
      assert.notEqual(currentPermitted.contentHash, permitted.contentHash, "referenced-source changes create a distinct source revision");
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
      for (const [index, document] of [documents[0]!, currentPermitted].entries()) {
        assert.ok(review.includes(passages[index]), "the actual governed review prompt must contain the late matching passage");
        assert.ok(review.includes(document.contentHash), "each passage retains its current source revision");
        assert.ok(review.includes(document.sourceRef));
      }
      for (const secret of [...Object.values(forbidden), "unverified:private:xerophyte-reference", "ARBITRARY-OUTPUT-DO-NOT-SEND", "ARBITRARY-INPUT-DO-NOT-SEND"]) {
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
        queries?: string[];
        context?: ConversationRuntimeInput["request"]["context"];
        beforeReview?: () => Promise<void>;
        repair?: () => Promise<void>;
        repairCount?: number;
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
          agentLoop: { maxSteps: 12, maxAiCalls: 8, maxRevisions: 5, ledger: async (event) => { ledger.push(event); } },
          aiCompletion: async (completion) => {
            prompts.push(JSON.stringify(completion));
            let text: string;
            if (prompts.length === 1) {
              const queries = options.queries ?? [options.query ?? "xerophyte"];
              const reads = queries.map((query, index) => ({
                id: `compose-${index}`, toolId: "lios.research.compose_sources", label: "Read sources",
                input: { query, limit: 50 }, dependsOn: [],
              }));
              text = JSON.stringify({ steps: [
                ...reads,
                { id: "boundary", toolId: "test.research.change-current-policy", label: "Fixture boundary",
                  input: {}, dependsOn: reads.map((read) => read.id) },
              ] });
            } else {
              reviewCalls += 1;
              if (reviewCalls <= (options.repairCount ?? 1) && options.repair) {
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
      const refreshedRef = "internal:fresh-provenance-record";
      const refreshed = await capture({
        query: "balsamfresh",
        beforeReview: async () => {
          await indexProjectDocument(ctx, {
            projectId: project.id, sourceType: "research_evidence", sourceRef: refreshedRef,
            title: "Fresh provenance source", body: "Balsamfresh evidence was added after the original composition.",
            sourceRefs: [refreshedRef],
            metadata: { researchSource: {
              class: "internal_research",
              identity: { sourceId: refreshedRef, providerId: null, organization: null,
                author: null, analystId: null, expertId: null, url: null },
              rights: allowedRights,
            } },
          });
        },
      });
      assert.ok(refreshed.prompts[1]!.includes("Balsamfresh evidence was added"));
      const refreshedReceipt = refreshed.events.find((event) =>
        typeof event === "object" && event !== null && "type" in event && event.type === "receipt"
      ) as { receipt: { sourceRefs: string[] } } | undefined;
      assert.ok(refreshedReceipt);
      assert.ok(refreshedReceipt.receipt.sourceRefs.includes(refreshedRef),
        "Final receipt must attribute sources admitted by the fresh review, not only original tool outcomes");
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
      const credentialUrls = [
        "https://alice:hunter2@example.com/report",
        "https://alice:pass'word@example.test/report",
        "https://storage.example.test/report?sv=2025-01-01&sp=r&sig=do-not-transmit-sas-signature",
        "https://cdn.example.test/report?Expires=9999999999&Signature=do-not-transmit-cloudfront-signature&Key-Pair-Id=fixture-key",
        "https://example.test/report?%74oken=do-not-transmit-encoded-token",
        "https://s3.example.test/report?X-Amz-Signature=do-not-transmit-aws-signature",
        "https://cdn.example.test/report?%53ignature=do-not-transmit-encoded-signature",
        "https://example.test/report#key=do-not-transmit-fragment-key",
        "https://example.test/report#sig=do-not-transmit-fragment-signature",
        "https://example.test/report#%74oken=do-not-transmit-fragment-token",
        "https://example.test/#/download?sig=do-not-transmit-routed-fragment-signature",
      ];
      const credentialBodies = [
        "Megaflora password=do-not-transmit-credential",
        "Megaflora https://example.test/report?token=do-not-transmit-query",
        "Megaflora -----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----",
        "Megaflora client_secret=do-not-transmit-client-secret",
        "Megaflora AWS_SECRET_ACCESS_KEY=do-not-transmit-aws-secret",
        "Megaflora token: do-not-transmit-colon-token",
        'Megaflora {"clientSecret":"do-not-transmit-json-client-secret"}',
        'Megaflora {"databasePassword":"do-not-transmit-json-database-password"}',
        "Megaflora passWord=do-not-transmit-mixed-case-password",
        'Megaflora {"passWord":"do-not-transmit-json-mixed-case-password"}',
        "Megaflora token: pending",
        "Megaflora secret: none",
        "Megaflora //fixture-user:do-not-transmit-scheme-password@example.com/report",
        "Megaflora //example.com/report?sig=do-not-transmit-scheme-signature",
        'Megaflora {"credentials":"do-not-transmit-plural-json"}',
        "Megaflora credentials=do-not-transmit-plural-assignment",
        "Megaflora /download?sig=do-not-transmit-relative-signature",
        "Megaflora ./download?Signature=do-not-transmit-dot-relative-signature",
        "Megaflora /download#key=do-not-transmit-relative-fragment-key",
        "Megaflora SharedAccessSignature sr=https%3A%2F%2Fexample.test&sig=do-not-transmit-standalone-sas&se=9999999999&skn=fixture-key",
        "Megaflora SharedAccessSignature=do-not-transmit-sas-assignment",
        ...credentialUrls.map((_url, index) => `Megaflora credential-bearing URL identity ${index} must remain local.`),
      ];
      // Keep every credential case inside the canonical 50-result search cap.
      const safeBulkCount = 50 - credentialBodies.length;
      assert.ok(safeBulkCount >= 15, "retain enough multibyte safe sources to exercise the global byte cap");
      for (let index = 0; index < safeBulkCount + credentialBodies.length; index += 1) {
        const sourceRef = `internal:megaflora:${index}`;
        const document = await indexProjectDocument(ctx, {
          projectId: project.id, sourceType: "research_evidence", sourceRef,
          title: `Megaflora survey ${index}`, sourceRefs: [sourceRef],
          body: index < safeBulkCount ? `Megaflora passage record ${index}. ${"植".repeat(1_500)}` : credentialBodies[index - safeBulkCount],
          metadata: { researchSource: {
            class: "internal_research",
            identity: { sourceId: sourceRef, providerId: null, organization: null,
              author: null, analystId: null, expertId: null,
              url: index >= safeBulkCount + credentialBodies.length - credentialUrls.length
                ? credentialUrls[index - (safeBulkCount + credentialBodies.length - credentialUrls.length)] : null },
            rights: allowedRights,
          } },
        });
        if (index < safeBulkCount) safeBulk.push(document);
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
      for (const secret of ["do-not-transmit-credential", "do-not-transmit-query", "not-a-real-key",
        "do-not-transmit-client-secret", "do-not-transmit-aws-secret", "do-not-transmit-colon-token",
        "do-not-transmit-json-client-secret", "do-not-transmit-json-database-password",
        "do-not-transmit-mixed-case-password", "do-not-transmit-json-mixed-case-password",
        "token: pending", "secret: none", "alice", "hunter2", "do-not-transmit-scheme-password",
        "do-not-transmit-scheme-signature", "do-not-transmit-plural-json", "do-not-transmit-plural-assignment",
        "do-not-transmit-relative-signature", "do-not-transmit-dot-relative-signature", "do-not-transmit-relative-fragment-key",
        "do-not-transmit-standalone-sas", "do-not-transmit-sas-assignment",
        ...credentialUrls, ...credentialBodies.slice(-credentialUrls.length)]) {
        assert.equal(bulk.prompts[1]!.includes(secret), false);
      }
      for (let index = safeBulkCount; index < safeBulkCount + credentialBodies.length; index += 1) {
        assert.equal(framed.includes(`internal:megaflora:${index}`), false, "credential source identities are omitted with their records");
      }
      assert.equal(JSON.stringify([bulk.events, bulk.ledger]).includes("植".repeat(20)), false);
      const benignUrl = "https://example.test/report?year=2026&section=margin";
      await indexProjectDocument(ctx, {
        projectId: project.id, sourceType: "research_evidence", sourceRef: "internal:benignurl:report",
        title: "Benignurl public locator", body: "Benignurl noncredential query parameters remain usable. Relative locator /download?year=2026&section=margin is ordinary source data.",
        sourceRefs: ["internal:benignurl:report"],
        metadata: { researchSource: {
          class: "internal_research",
          identity: { sourceId: "benignurl-report", providerId: null, organization: null,
            author: null, analystId: null, expertId: null, url: benignUrl },
          rights: allowedRights,
        } },
      });
      const benignLocator = await capture({ query: "benignurl" });
      assert.ok(benignLocator.prompts[1]!.includes(benignUrl));
      assert.ok(benignLocator.prompts[1]!.includes("Benignurl noncredential query parameters remain usable."));
      assert.ok(benignLocator.prompts[1]!.includes("/download?year=2026&section=margin"));

      const nestedGrantCases = [
        { id: "api-keys-object", body: 'Ulmusgrant {"apiKeys":{"primary":"do-not-transmit-api-keys-object"}}', url: null },
        { id: "tokens-array", body: 'Ulmusgrant {"tokens":["do-not-transmit-token-array"]}', url: null },
        { id: "secrets-assignment", body: "Ulmusgrant secrets=do-not-transmit-secrets-assignment", url: null },
        { id: "encoded-url-value", body: "Ulmusgrant nested URL bearer identity must stay local.",
          url: "https://example.test/redirect?next=https%3A%2F%2Fstorage.example.test%2Ffile%3Fsig%3Ddo-not-transmit-nested-url-signature" },
        { id: "plus-client-secret-fragment", body: "Ulmusgrant form-encoded client secret fragment must stay local.",
          url: "https://example.test/report#client+secret=do-not-transmit-plus-client-secret" },
        { id: "plus-api-key-fragment", body: "Ulmusgrant form-encoded API key fragment must stay local.",
          url: "https://example.test/report#api+key=do-not-transmit-plus-api-key" },
        { id: "plus-routed-fragment", body: "Ulmusgrant routed form-encoded credential fragment must stay local.",
          url: "https://example.test/report#/route?client+secret=do-not-transmit-plus-route-secret" },
        { id: "plus-relative-fragment", body: "Ulmusgrant /download#api+key=do-not-transmit-plus-relative-key", url: null },
        { id: "npmrc-auth-token", body: "Ulmusgrant //registry.npmjs.org/:_authToken=npm_fixture_secret", url: null },
        { id: "underscore-auth-token-json", body: 'Ulmusgrant {"_authToken":"npm_fixture_json_secret"}', url: null },
        { id: "npmrc-bare-auth", body: "Ulmusgrant //registry.npmjs.org/:_auth=dXNlcjpwYXNz", url: null },
        { id: "docker-json-auth", body: 'Ulmusgrant {"auths":{"registry.example.test":{"auth":"dXNlcjpwYXNz"}}}', url: null },
      ];
      for (const source of nestedGrantCases) {
        await indexProjectDocument(ctx, {
          projectId: project.id, sourceType: "research_evidence",
          sourceRef: `internal:ulmusgrant:${source.id}`, title: `Ulmusgrant credential source ${source.id}`,
          body: source.body, sourceRefs: [`internal:ulmusgrant:${source.id}`],
          metadata: { researchSource: {
            class: "internal_research",
            identity: { sourceId: source.id, providerId: null, organization: null,
              author: null, analystId: null, expertId: null, url: source.url },
            rights: allowedRights,
          } },
        });
      }
      const benignEncodedUrl = "https://example.test/redirect?next=https%3A%2F%2Fexample.test%2Freport%3Fyear%3D2026";
      await indexProjectDocument(ctx, {
        projectId: project.id, sourceType: "research_evidence", sourceRef: "internal:ulmusgrant:benign",
        title: "Ulmusgrant benign encoded locator", body: "Ulmusgrant harmless encoded URL remains usable.",
        sourceRefs: ["internal:ulmusgrant:benign"],
        metadata: { researchSource: {
          class: "internal_research",
          identity: { sourceId: "benign-encoded-url", providerId: null, organization: null,
            author: null, analystId: null, expertId: null, url: benignEncodedUrl },
          rights: allowedRights,
        } },
      });
      const nestedGrants = await capture({ query: "ulmusgrant" });
      for (const source of nestedGrantCases) {
        for (const value of [source.body, source.id, source.url].filter((value): value is string => value !== null)) {
          assert.equal(nestedGrants.prompts[1]!.includes(value), false, "plural or nested URL credential records must be omitted whole");
        }
      }
      assert.ok(nestedGrants.prompts[1]!.includes(benignEncodedUrl));
      assert.ok(nestedGrants.prompts[1]!.includes("Ulmusgrant harmless encoded URL remains usable."));
      const nestedObservation = findObservation(JSON.parse(nestedGrants.prompts[1]!));
      assert.ok(nestedObservation);
      const nestedJson = nestedObservation.split("\n").find((line) => line.startsWith("{"));
      assert.ok(nestedJson);
      const nestedSummary = z.object({
        sources: z.array(z.object({ sourceRef: z.string() }).passthrough()),
        omittedSourceCountByCredentialPolicy: z.number(),
      }).passthrough().parse(JSON.parse(nestedJson));
      assert.equal(nestedSummary.omittedSourceCountByCredentialPolicy, nestedGrantCases.length);
      assert.deepEqual(nestedSummary.sources.map((source) => source.sourceRef), ["internal:ulmusgrant:benign"]);

      async function persistedIntelligence() {
        return Promise.all([
          getDb().select().from(projectIntelligenceDocuments)
            .where(eq(projectIntelligenceDocuments.projectId, project.id)).orderBy(projectIntelligenceDocuments.id),
          getDb().select().from(projectIntelligenceDocumentVersions)
            .where(eq(projectIntelligenceDocumentVersions.projectId, project.id)).orderBy(projectIntelligenceDocumentVersions.id),
          getDb().select().from(projectIntelligenceSnapshots)
            .where(eq(projectIntelligenceSnapshots.projectId, project.id)).orderBy(projectIntelligenceSnapshots.id),
        ]);
      }
      let beforeRefresh: string | undefined;
      const stale = await capture({ beforeReview: async () => {
        await touchProjectActivity(ctx, project.id);
        const currentProject = await getProject(ctx, project.id);
        const persisted = await persistedIntelligence();
        const latestSnapshot = persisted[2].reduce((latest, snapshot) =>
          Math.max(latest, snapshot.generatedAt.getTime()), 0);
        assert.ok(latestSnapshot > 0);
        assert.ok(currentProject.lastActivityAt.getTime() >= latestSnapshot, "fixture must trigger the stale Project activity path");
        beforeRefresh = JSON.stringify(persisted);
      } });
      assert.ok(beforeRefresh);
      assert.ok(stale.prompts[1]!.includes(passages[1]), "stale activity still permits current read-only evidence retrieval");
      assert.equal(JSON.stringify(await persistedIntelligence()), beforeRefresh,
        "ephemeral review must not rewrite current index rows, append document versions, or persist a new snapshot");


      const overlapSources = [
        { sourceRef: "internal:pinus:overlap", title: "Pinusoverlap primary",
          body: `Pinusoverlap repeated-query passage. ${"植".repeat(1_800)}` },
        { sourceRef: "internal:pinus:distinct", title: "Pinusdistinct final",
          body: "Pinusdistinct later-query evidence must remain admitted." },
      ];
      for (const source of overlapSources) {
        await indexProjectDocument(ctx, {
          projectId: project.id, sourceType: "research_evidence", ...source,
          sourceRefs: [source.sourceRef], metadata: documents[1]!.metadata,
        });
      }
      const overlap = await capture({ queries: [...Array<string>(8).fill("pinusoverlap"), "pinusdistinct"] });
      const overlapTransport = findObservation(JSON.parse(overlap.prompts[1]!));
      assert.ok(overlapTransport);
      const overlapJson = overlapTransport.split("\n").find((line) => line.startsWith("{"));
      assert.ok(overlapJson);
      const deduplicated = z.object({
        sources: z.array(z.object({ sourceRef: z.string(), stepIds: z.array(z.string()) }).passthrough()),
        omittedSourceCountByByteLimit: z.number(),
        currentSourceCount: z.number(),
        deduplicatedSourceCount: z.number(),
      }).passthrough().parse(JSON.parse(overlapJson));
      assert.equal(deduplicated.sources.length, 2, "repeated identical document passages occupy one source record");
      assert.equal(deduplicated.omittedSourceCountByByteLimit, 0);
      assert.equal(deduplicated.currentSourceCount, 9);
      assert.equal(deduplicated.deduplicatedSourceCount, 7);
      assert.deepEqual(deduplicated.sources.find((source) => source.sourceRef === overlapSources[0].sourceRef)?.stepIds,
        Array.from({ length: 8 }, (_, index) => `compose-${index}`));
      assert.deepEqual(deduplicated.sources.find((source) => source.sourceRef === overlapSources[1].sourceRef)?.stepIds, ["compose-8"]);
      assert.ok(overlapTransport.includes(overlapSources[1].body), "deduplication preserves distinct later evidence within the byte budget");

      let cumulativeBatch = -1;
      let cumulativeDocuments: P7ProjectDocument[] = [];
      async function replaceCumulativeBatch() {
        for (const document of cumulativeDocuments) {
          await getDb().delete(projectIntelligenceDocuments).where(eq(projectIntelligenceDocuments.id, document.id));
        }
        cumulativeDocuments = [];
        cumulativeBatch += 1;
        for (let index = 0; index < 25; index += 1) {
          const sourceRef = `internal:cumulative:${cumulativeBatch}:${index}`;
          cumulativeDocuments.push(await indexProjectDocument(ctx, {
            projectId: project.id, sourceType: "research_evidence", sourceRef,
            title: `Cumulativebatch ${cumulativeBatch} ${index}`,
            body: `Cumulativebatch passage ${cumulativeBatch} ${index}.`,
            sourceRefs: [sourceRef], metadata: documents[1]!.metadata,
          }));
        }
      }
      const cumulative = await capture({
        query: "cumulativebatch", beforeReview: replaceCumulativeBatch,
        repair: replaceCumulativeBatch, repairCount: 4,
      });
      assert.equal(cumulative.prompts.length, 6, "five reviews exercise more than one hundred potential source references");
      const transmittedRefs = new Set<string>();
      let lastReferenceOmissions = 0;
      for (const prompt of cumulative.prompts.slice(1)) {
        const transport = findObservation(JSON.parse(prompt));
        assert.ok(transport);
        const json = transport.split("\n").find((line) => line.startsWith("{"));
        assert.ok(json);
        const observed = z.object({
          sources: z.array(z.object({ sourceRef: z.string() }).passthrough()),
          omittedSourceCountByReferenceLimit: z.number(),
        }).passthrough().parse(JSON.parse(json));
        for (const source of observed.sources) transmittedRefs.add(source.sourceRef);
        lastReferenceOmissions = observed.omittedSourceCountByReferenceLimit;
      }
      assert.equal(transmittedRefs.size, 100);
      assert.equal(lastReferenceOmissions, 25, "the final twenty-five new references must be omitted before model transport");
      assert.equal(cumulative.prompts.at(-1)!.includes("Cumulativebatch passage 4 "), false);
      const cumulativeReceipt = cumulative.events.find((event) =>
        typeof event === "object" && event !== null && "type" in event && event.type === "receipt");
      assert.ok(cumulativeReceipt);
      const receipt = z.object({ receipt: z.object({ sourceRefs: z.array(z.string()) }).passthrough() })
        .passthrough().parse(cumulativeReceipt);
      for (const ref of transmittedRefs) assert.ok(receipt.receipt.sourceRefs.includes(ref),
        "every source actually transmitted across reviews must survive in final receipt provenance");

      const providerSources = [
        { sourceRef: "internal:agathis:approved", providerId: "agathis-approved-provider",
          title: "Approved Agathis Provider Note", body: "Agathis approved provider passage remains available." },
        { sourceRef: "internal:agathis:excluded", providerId: "agathis-excluded-provider",
          title: "Excluded Agathis Provider Note", body: "Agathis excluded provider passage must stay local." },
      ];
      for (const source of providerSources) {
        await indexProjectDocument(ctx, {
          projectId: project.id, sourceType: "research_evidence", sourceRef: source.sourceRef,
          title: source.title, body: source.body, sourceRefs: [source.sourceRef],
          metadata: { researchSource: {
            class: "internal_research",
            identity: { sourceId: source.sourceRef, providerId: source.providerId, organization: null,
              author: null, analystId: null, expertId: null, url: null },
            rights: allowedRights,
          } },
        });
      }
      for (const mode of ["connected_sources", "only_refs"] as const) {
        for (const filter of ["allow", "deny"] as const) {
          const initial = researchArtifactContentSchema.parse({
            kind: "research", question: "Agathis provider research", blocks: [], claims: [], evidence: [],
            sourcePolicy: { mode, allowedSourceRefs: providerSources.map((source) => source.sourceRef),
              providerAllow: [], providerDeny: [] },
          });
          const policyArtifact = await createArtifact(ctx, {
            projectId: project.id, title: `Provider policy ${mode} ${filter}`, content: initial,
          });
          const providerFiltered = await capture({
            query: "agathis", context: { activeObjectRefs: [policyArtifact.artifact.id] },
            repair: async () => {
              await createArtifactVersion(ctx, {
                artifactId: policyArtifact.artifact.id, baseVersion: 1,
                content: { ...initial, sourcePolicy: {
                  ...initial.sourcePolicy,
                  providerAllow: filter === "allow" ? [providerSources[0].providerId] : providerSources.map((source) => source.providerId),
                  providerDeny: filter === "deny" ? [providerSources[1].providerId] : [],
                } },
              });
            },
          });
          const before = providerFiltered.prompts[1]!;
          const after = providerFiltered.prompts[2]!;
          for (const source of providerSources) assert.ok(before.includes(source.body));
          for (const value of Object.values(providerSources[0])) {
            assert.ok(after.includes(value), `${mode} ${filter} must retain permitted source provenance and passage`);
          }
          for (const value of Object.values(providerSources[1])) {
            assert.equal(after.includes(value), false, `${mode} ${filter} must exclude forbidden provider content and identity after policy refresh`);
          }
        }
      }

      const { artifactInspectTool, artifactMaintenanceTool } = await import("./artifactMaintenance");
      const benign = await createArtifact(ctx, {
        projectId: project.id, title: "Ordinary status labels",
        content: researchArtifactContentSchema.parse({
          kind: "research", question: "token: pending; secret: none",
          blocks: [], claims: [], evidence: [],
        }),
      });
      const benignCall = { ...call, resourceTransmissionAllowed: true,
        activeArtifactRefs: [benign.artifact.id], stepId: "benign-maintenance" };
      const inspected = await artifactInspectTool.invoke(
        { artifactId: benign.artifact.id, paths: [["question"]] }, new AbortController().signal, benignCall,
      );
      assert.ok(JSON.stringify(inspected.output).includes("token: pending; secret: none"));
      const proposed = await artifactMaintenanceTool.invoke({
        artifactId: benign.artifact.id, baseVersion: 1, baseHash: benign.version.contentHash,
        summary: "Clarify ordinary status labels",
        edits: [{ op: "set", path: ["question"], value: "token: pending; secret: none; review complete" }],
      }, new AbortController().signal, benignCall);
      assert.equal(z.object({ changed: z.boolean() }).passthrough().parse(proposed.output).changed, true,
        "broad outbound research filtering must not make benign existing Artifacts uninspectable or uneditable");
    });

    await nested.test("public agent planning cannot downgrade refreshed Project research at the actual enterprise provider boundary", async () => {
      // Enterprise policy and runtime must load after this test's isolated database setup.
      const { executeConversationRuntime } = await import("./conversationRuntime");
      const { organizations, domains } = await import("@shared/schema");
      const { DEFAULT_ENTERPRISE_POLICY } = await import("@shared/enterpriseContracts");
      const { saveEnterprisePolicy } = await import("./enterprisePolicyService");
      const { runWithRequestIdentity } = await import("./requestContext");
      const { invokeAIRoutedCompletion } = await import("./byoaiTransport");
      const { createArtifact, createArtifactVersion } = await import("./artifactStore");
      const { researchArtifactContentSchema } = await import("@shared/artifactContracts");
      const { getConnectorVerification } = await import("./connectorVerification");
      const [organization] = await getDb().insert(organizations).values({
        name: "Research routing policy", slug: `research-routing-${crypto.randomUUID()}`,
      }).returning();
      const [actor] = await getDb().insert(users).values({
        email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only",
        role: "internal_admin", organizationId: organization.id, name: "Routing owner",
      }).returning();
      const tenant = { userId: actor.id, organizationId: organization.id, role: actor.role };
      const researchProject = await createProject(tenant, { name: "Private research without selected resources" });
      const privatePassage = "Sequoia internal findings are organization-owned evidence.";
      const originalSource = await indexProjectDocument(tenant, {
        projectId: researchProject.id, sourceType: "research_evidence", sourceRef: "internal:sequoia:routing",
        title: "Sequoia research", body: privatePassage, sourceRefs: ["internal:sequoia:routing"],
        metadata: { researchSource: {
          class: "internal_research",
          identity: { sourceId: "sequoia-routing", providerId: null, organization: null,
            author: null, analystId: null, expertId: null, url: null },
          rights: allowedRights,
        } },
      });
      const priorFetch = globalThis.fetch;
      const priorCredentialStore = process.env.LIMURIA_CREDENTIAL_STORE;
      const priorHostedSecret = process.env.LIMURIA_HOSTED_VAULT_SECRET;
      const { setOrganizationCredential, loadOrganizationCredentials } = await import("./organizationCredentialVault");
      const { beginAIChatVerification, publishAIChatVerification } = await import("./connectorVerification");
      const { updateEnvironmentSetup } = await import("./environmentSetupService");
      const { updateEnvironmentSetupSchema } = await import("@shared/schema");
      const { setMasterAiPreference } = await import("./personaPreferenceService");
      const { masterAiAuthorizationGeneration, masterAiAuthorizationRevision } = await import("./masterAiGate");
      const attempted: Array<{ provider: string; body: string }> = [];
      let reviewReached = false;
      let raceHealthBaseline: unknown;
      process.env.LIMURIA_CREDENTIAL_STORE = "organization";
      process.env.LIMURIA_HOSTED_VAULT_SECRET = "research-policy-isolated-credential-fixture-only";
      await getDb().insert(domains).values({ slug: "finance", name: "Finance", active: true }).onConflictDoNothing();
      await setOrganizationCredential(organization.id, "openaiApiKey", "fixture-openai-key");
      await setOrganizationCredential(organization.id, "geminiApiKey", "fixture-gemini-key");
      await updateEnvironmentSetup(actor.id, organization.id, updateEnvironmentSetupSchema.parse({ aiProviderId: "openai", aiModelId: "gpt-4o" }), actor);
      const attempt = beginAIChatVerification({ userId: actor.id, organizationId: organization.id, provider: "openai", credentialName: "openaiApiKey" });
      assert.equal(publishAIChatVerification(attempt, "gpt-4o", crypto.createHash("sha256").update("fixture-openai-key").digest("hex")), true);
      await setMasterAiPreference(actor, { state: "on", mode: "ai_assist", updatedAt: new Date().toISOString(), authorization: {
        generation: masterAiAuthorizationGeneration, revision: masterAiAuthorizationRevision(actor.id), verificationAttemptId: attempt.attemptId,
      } });
      globalThis.fetch = (async (url, init) => {
        const endpoint = String(url);
        const provider = endpoint.includes("api.openai.com") ? "openai"
          : endpoint.includes("generativelanguage.googleapis.com") ? "gemini" : "unexpected";
        assert.notEqual(provider, "unexpected", "fixture must never contact an unrecognized endpoint");
        const body = String(init?.body ?? "");
        attempted.push({ provider, body });
        if (body.includes("BEGIN_CURRENT_RESEARCH_OBSERVATIONS")) {
          reviewReached = true;
          return new Response("rate limited", { status: 429 });
        }
        const text = JSON.stringify({ steps: [{
          id: "compose", toolId: "lios.research.compose_sources", label: "Read current permitted sources",
          input: { query: "sequoia" }, dependsOn: [],
        }] });
        return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
      }) as typeof fetch;
      async function invokeWithPolicy(allowExternalData: boolean, race?: {
        artifactId?: string;
        observedPassage?: string;
        excludedPassage?: string;
        beforeRelease: () => Promise<void>;
        duringTransmission?: () => Promise<void>;
      }) {
        await saveEnterprisePolicy(organization.id, {
          ...DEFAULT_ENTERPRISE_POLICY,
          ai: { ...DEFAULT_ENTERPRISE_POLICY.ai, allowedProviders: ["openai", "gemini"],
            allowedModels: [], endpointMode: "hosted", endpointUrl: "https://api.openai.com",
            allowExternalData, requireApproval: false },
        }, { id: actor.id, email: actor.email });
        return runWithRequestIdentity({
          userId: actor.id, organizationId: organization.id,
          credentials: await loadOrganizationCredentials(organization.id),
          selectedConnectorIds: [],
        }, () => executeConversationRuntime({
          tenant, scope: "project", chatId: null, projectId: researchProject.id,
          resources: [], history: [], preferredProvider: "openai", preferredModel: "gpt-4o",
          request: {
            requestId: crypto.randomUUID(), continuationOf: null, message: "Compare sequoia research findings.",
            executionMode: "ai_assisted", aiDirectApproved: false, approvals: [], attachments: [],
            sourceScope: "my_data",
            ...(race?.artifactId ? { context: { activeObjectRefs: [race.artifactId] } } : {}),
            transmissionPolicy: { mode: "configured", providerAllow: ["openai", "gemini"], providerDeny: [],
              allowProjectInstructions: true, allowResourceReferences: true, allowSelection: true,
              allowToolCalling: true, dataClassification: "public" },
          },
          ...(race ? { aiCompletion: async (completion) => {
            if (completion.messages.some((message) => message.content.includes("BEGIN_CURRENT_RESEARCH_OBSERVATIONS"))) {
              if (race.observedPassage) {
                assert.ok(JSON.stringify(completion).includes(race.observedPassage), "race must begin only after the source passage was composed for review");
              }
              if (race.excludedPassage) assert.equal(JSON.stringify(completion).includes(race.excludedPassage), false);
              assert.equal(getConnectorVerification("openai")?.ok, true, "planning establishes a healthy provider before the policy race");
              raceHealthBaseline = getConnectorVerification("openai");
              await race.beforeRelease();
              const duringTransmission = race.duringTransmission;
              if (duringTransmission) return invokeAIRoutedCompletion({
                ...completion,
                beforeTransmission: async () => {
                  await completion.beforeTransmission?.();
                  await duringTransmission();
                },
              });
            }
            return invokeAIRoutedCompletion(completion);
          } } : {}),
          agentLoop: {}, emit: () => undefined,
        }));
      }
      try {
        await assert.rejects(invokeWithPolicy(false), /organization data|policy|private/i);
        assert.deepEqual(attempted.map(({ provider }) => provider), ["openai"],
          "public planning may reach the provider, but organization research must be denied before transport");
        assert.equal(reviewReached, false);
        assert.equal(attempted.some(({ body }) => body.includes(privatePassage)), false);

        attempted.length = 0;
        await assert.rejects(invokeWithPolicy(true), /rate|provider|private/i);
        assert.equal(reviewReached, true, "permissive enterprise policy must reach the actual research review transport");
        assert.deepEqual(attempted.map(({ provider }) => provider), ["openai", "openai"],
          "private research review must not fall back to configured Gemini after the preferred provider fails");
        assert.ok(attempted[1]!.body.includes(privatePassage));
        assert.equal(getConnectorVerification("openai")?.ok, false, "actual provider 429 must still degrade connector health");

        for (const change of ["external-data", "allowed-provider", "endpoint"] as const) {
          attempted.length = 0;
          reviewReached = false;
          let policyChangedInsideCallback = false;
          await assert.rejects(invokeWithPolicy(true, {
            observedPassage: privatePassage, beforeRelease: async () => undefined,
            duringTransmission: async () => {
              await saveEnterprisePolicy(organization.id, {
                ...DEFAULT_ENTERPRISE_POLICY,
                ai: { ...DEFAULT_ENTERPRISE_POLICY.ai,
                  allowedProviders: change === "allowed-provider" ? ["gemini"] : ["openai", "gemini"],
                  allowedModels: [],
                  endpointMode: change === "endpoint" ? "configured_private" : "hosted",
                  endpointUrl: change === "endpoint" ? "https://private.example.test" : "https://api.openai.com",
                  allowExternalData: change !== "external-data", requireApproval: false },
              }, { id: actor.id, email: actor.email });
              policyChangedInsideCallback = true;
            },
          }), /policy|organization|provider|endpoint|private|approved/i);
          assert.equal(policyChangedInsideCallback, true, "fixture changes stored policy during the canonical pre-dispatch callback");
          assert.equal(reviewReached, false, "enterprise policy must be rechecked after asynchronous source validation");
          assert.deepEqual(attempted.map(({ provider }) => provider), ["openai"], "no private review or fallback may dispatch under revoked enterprise policy");
          assert.deepEqual(getConnectorVerification("openai"), raceHealthBaseline, "local policy revocation must preserve connector health");
        }
        const indirectBody = "Sequoia unselected document merely cites the approved source.";
        const indirectTitle = "Sequoia Unselected Indirect Citation";
        const indirectRef = "internal:sequoia:unselected";
        await indexProjectDocument(tenant, {
          projectId: researchProject.id, sourceType: "research_evidence", sourceRef: indirectRef,
          title: indirectTitle, body: indirectBody, sourceRefs: [originalSource.sourceRef],
          metadata: originalSource.metadata,
        });
        const exactOnly = await createArtifact(tenant, {
          projectId: researchProject.id, title: "Exact selected sources",
          content: researchArtifactContentSchema.parse({
            kind: "research", question: "Sequoia exact selection", blocks: [], claims: [], evidence: [],
            sourcePolicy: { mode: "only_refs", allowedSourceRefs: [originalSource.sourceRef] },
          }),
        });
        attempted.length = 0;
        reviewReached = false;
        let exactReleaseReached = false;
        await assert.rejects(invokeWithPolicy(true, {
          artifactId: exactOnly.artifact.id, observedPassage: privatePassage, excludedPassage: indirectBody,
          beforeRelease: async () => { exactReleaseReached = true; },
        }), /rate|provider|private/i);
        assert.equal(exactReleaseReached, true);
        assert.equal(reviewReached, true, "exact allowed source must pass the final release fence");
        assert.ok(attempted[1]!.body.includes(privatePassage));
        for (const forbidden of [indirectBody, indirectTitle, indirectRef]) {
          assert.equal(attempted[1]!.body.includes(forbidden), false, "indirect citations cannot broaden exact only_refs selection");
        }
        assert.deepEqual(attempted.map(({ provider }) => provider), ["openai", "openai"]);
        const initial = researchArtifactContentSchema.parse({
          kind: "research", question: "Sequoia race", blocks: [], claims: [], evidence: [],
          sourcePolicy: { mode: "only_refs", allowedSourceRefs: ["internal:sequoia:routing"] },
        });
        const active = await createArtifact(tenant, {
          projectId: researchProject.id, title: "Concurrent source policy", content: initial,
        });
        attempted.length = 0;
        reviewReached = false;
        let changedHead = false;
        await assert.rejects(invokeWithPolicy(true, {
          artifactId: active.artifact.id,
          beforeRelease: async () => {
            await createArtifactVersion(tenant, {
              artifactId: active.artifact.id, baseVersion: 1,
              content: { ...initial, sourcePolicy: { ...initial.sourcePolicy, allowedSourceRefs: [] } },
            });
            changedHead = true;
          },
        }), /head|changed|policy|source/i);
        assert.equal(changedHead, true, "barrier commits the denying head after observations are built but before canonical transport");
        assert.equal(reviewReached, false, "canonical before-transmission validation must reject stale observations");
        assert.deepEqual(attempted.map(({ provider }) => provider), ["openai"], "no private review or stale fallback reaches any provider");
        assert.equal(attempted.some(({ body }) => body.includes(privatePassage)), false);
        assert.deepEqual(getConnectorVerification("openai"), raceHealthBaseline, "local head-change refusal must not mark the healthy connector failed");

        async function assertSourceRace(mutate: () => Promise<void>, observedPassage = privatePassage) {
          attempted.length = 0;
          reviewReached = false;
          let mutated = false;
          await assert.rejects(invokeWithPolicy(true, {
            observedPassage,
            beforeRelease: async () => { await mutate(); mutated = true; },
          }), /changed|policy|source|research|transmission/i);
          assert.equal(mutated, true, "source mutation must happen after composition without an active Artifact");
          assert.equal(reviewReached, false);
          assert.deepEqual(attempted.map(({ provider }) => provider), ["openai"],
            "changed source custody must refuse before private provider transport and fallback");
          assert.equal(attempted.some(({ body }) => body.includes(observedPassage)), false);
          assert.deepEqual(getConnectorVerification("openai"), raceHealthBaseline, "local source-custody refusal must preserve the exact connector health baseline");
        }
        const sourceMetadata = (rights = allowedRights) => ({ researchSource: {
          class: "internal_research",
          identity: { sourceId: "sequoia-routing", providerId: null, organization: null,
            author: null, analystId: null, expertId: null, url: null },
          rights,
        } });
        async function restoreSource() {
          await indexProjectDocument(tenant, {
            projectId: researchProject.id, sourceType: "research_evidence", sourceRef: originalSource.sourceRef,
            title: originalSource.title, body: originalSource.body, sourceRefs: originalSource.sourceRefs,
            metadata: sourceMetadata(),
          });
        }
        await assertSourceRace(async () => {
          await indexProjectDocument(tenant, {
            projectId: researchProject.id, sourceType: "research_evidence", sourceRef: originalSource.sourceRef,
            title: originalSource.title, body: originalSource.body, sourceRefs: originalSource.sourceRefs,
            metadata: { researchSource: {
              ...sourceMetadata().researchSource, rights: { ...allowedRights, aiTransmission: "restricted" },
            } },
          });
        });
        await restoreSource();
        await assertSourceRace(async () => {
          await indexProjectDocument(tenant, {
            projectId: researchProject.id, sourceType: "research_evidence", sourceRef: originalSource.sourceRef,
            title: originalSource.title, body: originalSource.body, sourceRefs: originalSource.sourceRefs,
            metadata: { researchSource: {
              ...sourceMetadata().researchSource, rights: {
                ...allowedRights, entitlement: { ...allowedRights.entitlement, decision: "denied" },
              },
            } },
          });
        });
        await restoreSource();
        await assertSourceRace(async () => {
          await indexProjectDocument(tenant, {
            projectId: researchProject.id, sourceType: "research_evidence", sourceRef: originalSource.sourceRef,
            title: originalSource.title, body: `${originalSource.body} Materially revised source custody.`,
            sourceRefs: originalSource.sourceRefs, metadata: sourceMetadata(),
          });
        });
        await restoreSource();
        await assertSourceRace(async () => {
          await getDb().delete(projectIntelligenceDocuments).where(eq(projectIntelligenceDocuments.id, originalSource.id));
        });
        await restoreSource();

        const { createProjectResource, setProjectResourceContextMode } = await import("./projectResourceStore");
        const resourcePassage = "Sequoia current resource eligibility must be checked before release.";
        const resource = await createProjectResource(tenant, {
          projectId: researchProject.id, kind: "note", label: "Sequoia eligibility note",
          contextMode: "project", metadata: { text: resourcePassage, ...sourceMetadata() },
        });
        await assertSourceRace(async () => {
          await setProjectResourceContextMode(tenant, resource.id, "excluded");
        }, resourcePassage);
      } finally {
        globalThis.fetch = priorFetch;
        if (priorHostedSecret === undefined) delete process.env.LIMURIA_HOSTED_VAULT_SECRET;
        else process.env.LIMURIA_HOSTED_VAULT_SECRET = priorHostedSecret;
        if (priorCredentialStore === undefined) delete process.env.LIMURIA_CREDENTIAL_STORE;
        else process.env.LIMURIA_CREDENTIAL_STORE = priorCredentialStore;
      }
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
