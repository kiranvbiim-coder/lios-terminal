import { z } from "zod";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import { assertNotAborted, sourceScopeAllowsProjectData } from "./conversationRuntimeCore";
import { getProject } from "./projectStore";
import { listProjectIntelligenceDocuments } from "./p7ProjectIntelligenceStore";
import { searchProjectDocuments } from "./p7ProjectIntelligence";
import { buildProjectEvidenceTruth, SOURCE_QUALITY_TIERS } from "./projectEvidenceTruth";

const tenantSchema = z.object({
  userId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
}).strict();

export const knowledgeStateToolInputSchema = z.object({
  query: z.string().trim().min(1).max(2_000),
  limit: z.number().int().min(1).max(20).default(10),
}).strict();

const knowledgeSchema = z.object({
  classification: z.enum(["known", "qualified"]),
  qualifiers: z.array(z.string().trim().min(1).max(200)).max(50),
}).strict();

const truthSchema = z.object({
  temporal: z.object({
    observedAt: z.string().nullable(),
    retrievedAt: z.string().nullable(),
    publishedAt: z.string().nullable(),
    effectiveAt: z.string().nullable(),
    asOfAt: z.string().nullable(),
    asOfBasis: z.enum(["effective_at", "published_at", "observed_at", "unknown"]),
    modelPeriod: z.string().nullable(),
  }).strict(),
  sourceQuality: z.object({
    originClass: z.string().nullable(),
    evidenceKind: z.string().nullable(),
    tier: z.enum(SOURCE_QUALITY_TIERS),
    claimVerification: z.literal("not_verified_by_digest"),
  }).strict(),
  freshness: z.object({
    state: z.enum(["fresh", "stale", "unknown"]),
    basis: z.enum(["declared", "computed_horizon", "none"]),
    assessedAt: z.string().nullable(),
    reason: z.string().nullable(),
  }).strict(),
  access: z.object({
    availability: z.enum(["available", "unavailable", "inaccessible", "unknown"]),
    entitlement: z.enum(["entitled", "unentitled", "unknown"]),
  }).strict(),
  certainty: z.enum(["verified", "uncertain", "disputed", "unknown"]),
  unknowns: z.array(z.string()),
  knowledge: knowledgeSchema,
}).strict();

const matchSchema = z.object({
  documentId: z.string(),
  sourceRef: z.string(),
  sourceType: z.string(),
  title: z.string(),
  excerpt: z.string(),
  contentHash: z.string(),
  occurredAt: z.string().nullable(),
  truth: truthSchema,
}).strict();

export const knowledgeStateToolOutputSchema = z.object({
  output: z.object({
    state: z.enum(["known", "qualified", "unknown"]),
    matches: z.array(matchSchema).max(20),
    counts: z.object({
      known: z.number().int().nonnegative(),
      qualified: z.number().int().nonnegative(),
    }).strict(),
    unknownReason: z.enum(["no_permitted_matching_evidence"]).nullable(),
  }).strict(),
  summary: z.string().trim().max(2_000),
  deterministic: z.literal(true),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(100),
}).strict();

export const knowledgeStateTool: ConversationToolDefinition = {
  id: "lios.project.knowledge_state",
  label: "Classify matching Project evidence as known, qualified, or unknown",
  kind: "retrieve",
  permissionClass: "safe_auto",
  access: "read",
  sideEffect: "none",
  replaySafe: true,
  inputSchema: knowledgeStateToolInputSchema,
  outputSchema: knowledgeStateToolOutputSchema.transform((value): ConversationToolResult => value),
  maxOutputBytes: 128 * 1024,
  cancel: null,
  invoke: async (input, signal, call): Promise<ConversationToolResult> => {
    assertNotAborted(signal);
    if (call.source !== "agent" || !call.requestId) {
      throw new Error("Project knowledge-state inspection requires an authenticated governed agent call.");
    }
    if (!sourceScopeAllowsProjectData(call.sourceScope ?? "auto")) {
      throw new Error("Project knowledge-state inspection requires Auto or My Data Project scope.");
    }

    const tenant = tenantSchema.parse(call.tenant);
    if (call.userId !== tenant.userId) {
      throw new Error("Project knowledge-state owner scope does not match the governed call.");
    }
    const projectId = Number(call.projectId);
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      throw new Error("Project knowledge-state inspection requires an active Project.");
    }
    await getProject(tenant, projectId);

    const parsed = knowledgeStateToolInputSchema.parse(input);
    const documents = await listProjectIntelligenceDocuments(tenant, projectId);
    assertNotAborted(signal);

    const allowedRefs = new Set(call.allowedSourceRefs ?? []);
    const permitted = allowedRefs.size
      ? documents.filter((doc) =>
          allowedRefs.has(doc.sourceRef) || doc.sourceRefs.some((sourceRef) => allowedRefs.has(sourceRef))
        )
      : documents;

    const hits = searchProjectDocuments(permitted, {
      query: parsed.query,
      limit: parsed.limit,
      allowedSourceRefs: [],
    });
    const byId = new Map(permitted.map((doc) => [doc.id, doc]));

    const matches = hits.map((hit) => {
      const doc = byId.get(hit.documentId);
      if (!doc) throw new Error("Selected Project evidence is no longer available.");
      const truth = buildProjectEvidenceTruth({ observedAt: doc.occurredAt, metadata: doc.metadata });
      return {
        documentId: doc.id,
        sourceRef: doc.sourceRef,
        sourceType: doc.sourceType,
        title: doc.title,
        excerpt: hit.excerpt,
        contentHash: doc.contentHash,
        occurredAt: doc.occurredAt,
        truth,
      };
    });

    const known = matches.filter((item) => item.truth.knowledge.classification === "known").length;
    const qualified = matches.length - known;
    const state = matches.length === 0
      ? "unknown" as const
      : qualified > 0
        ? "qualified" as const
        : "known" as const;

    const sourceRefs = [...new Set(matches.flatMap((item) => {
      const doc = byId.get(item.documentId);
      if (!doc) return [item.sourceRef];
      const dependencyRefs = allowedRefs.size
        ? doc.sourceRefs.filter((sourceRef) => allowedRefs.has(sourceRef))
        : doc.sourceRefs;
      return [doc.sourceRef, ...dependencyRefs];
    }))].slice(0, 100);

    return {
      output: {
        state,
        matches,
        counts: { known, qualified },
        unknownReason: matches.length === 0 ? "no_permitted_matching_evidence" : null,
      },
      summary: matches.length === 0
        ? "No permitted Project evidence matched; knowledge state is unknown without inventing an access, entitlement, or certainty reason."
        : `Knowledge state ${state}: ${known} known and ${qualified} qualified matching evidence item${matches.length === 1 ? "" : "s"}.`,
      deterministic: true,
      sourceRefs,
    };
  },
};
