import { z } from "zod";
import {
  composedResearchSourceSchema,
  researchCompositionBlockReasonSchema,
  researchSourceClassSchema,
} from "@shared/researchSourceComposition";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import { assertNotAborted, sourceScopeAllowsProjectData } from "./conversationRuntimeCore";
import {
  currentPermittedProjectSearchDocuments,
  listProjectIntelligenceDocuments,
  searchProjectIntelligence,
} from "./p7ProjectIntelligenceStore";
import { searchProjectDocuments } from "./p7ProjectIntelligence";
import { composeResearchSources } from "./researchSourceComposition";
import { tenantContext } from "./tenantContext";
import {
  permittedEvidenceLinkSchema, permittedEvidenceNeighborhoodSchema,
  rankPermittedEvidenceLinks, buildPermittedEvidenceNeighborhoods,
} from "./graphragPermittedEvidenceLinks";

const tenantSchema = z.object({
  userId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
}).strict();

export const researchSourceCompositionToolInputSchema = z.object({
  query: z.string().trim().min(1).max(2_000),
  limit: z.number().int().min(1).max(50).default(20),
  sourceClasses: z.array(researchSourceClassSchema).max(5).default([]),
}).strict();

const blockedAggregateSchema = z.object({
  sourceClass: researchSourceClassSchema.nullable(),
  reason: researchCompositionBlockReasonSchema,
  count: z.number().int().positive(),
}).strict();

export const researchSourceCompositionToolOutputSchema = z.object({
  output: z.object({
    query: z.string().trim().min(1).max(2_000),
    targetUse: z.literal("ai_assistance"),
    sources: z.array(composedResearchSourceSchema).max(50),
    blocked: z.array(blockedAggregateSchema).max(100),
    graphLinks: z.array(permittedEvidenceLinkSchema).max(50),
    graphNeighborhoods: z.array(permittedEvidenceNeighborhoodSchema).max(50),
    sourceCount: z.number().int().nonnegative(),
    blockedCount: z.number().int().nonnegative(),
  }).strict(),
  summary: z.string().trim().max(2_000),
  deterministic: z.literal(true),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500),
}).strict();

function aggregateBlocked(
  blocked: ReturnType<typeof composeResearchSources>["blocked"],
): Array<z.infer<typeof blockedAggregateSchema>> {
  const counts = new Map<string, { sourceClass: z.infer<typeof researchSourceClassSchema> | null; reason: z.infer<typeof researchCompositionBlockReasonSchema>; count: number }>();
  for (const item of blocked) {
    const key = `${item.sourceClass ?? "unknown"}\0${item.reason}`;
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { sourceClass: item.sourceClass, reason: item.reason, count: 1 });
  }
  return [...counts.values()].sort((left, right) =>
    (left.sourceClass ?? "").localeCompare(right.sourceClass ?? "")
    || left.reason.localeCompare(right.reason)
  );
}

/**
 * AI-facing research composition is deliberately stricter than local Project access:
 * only sources explicitly permitted for AI transmission can return content/identity.
 * Blocked sources are aggregate-only so restricted metadata is not itself transmitted.
 */
export const researchSourceCompositionTool: ConversationToolDefinition = {
  id: "lios.research.compose_sources",
  label: "Compose permitted broker, expert, internal, public and user research without flattening source rights",
  planningHint: [
    'Input must be exactly {"query":"<research query>"} unless a bounded limit or source-class filter is truly needed.',
    "Allowed keys are query, limit, sourceClasses only; never add sourceRefs, providers, urls, entity, ticker, entitlement, or targetUse.",
    "limit is an integer from 1 to 50.",
    'sourceClasses, when used, may contain only: "public_external", "broker_research", "expert_content", "internal_research", "user_file".',
    "For a broad Project research lookup, omit sourceClasses and let the server enforce rights and allowed-source scope.",
  ].join(" "),
  kind: "retrieve",
  permissionClass: "safe_auto",
  access: "read",
  sideEffect: "none",
  replaySafe: true,
  inputSchema: researchSourceCompositionToolInputSchema,
  outputSchema: researchSourceCompositionToolOutputSchema.transform((value): ConversationToolResult => value),
  maxOutputBytes: 192 * 1024,
  cancel: null,
  invoke: async (input, signal, call): Promise<ConversationToolResult> => {
    assertNotAborted(signal);
    if (!sourceScopeAllowsProjectData(call.sourceScope ?? "auto")) {
      throw new Error("Research source composition requires Auto or My Data scope; Files and Web cannot broaden Project evidence.");
    }
    if (call.source !== "agent" || !call.requestId) {
      throw new Error("Research source composition requires an authenticated governed agent call.");
    }
    const tenant = tenantSchema.parse(call.tenant);
    const ctx = tenantContext({
      id: tenant.userId,
      organizationId: tenant.organizationId,
      role: tenant.role,
    });
    if (call.userId !== ctx.userId || !Number.isSafeInteger(call.projectId) || (call.projectId ?? 0) <= 0) {
      throw new Error("Research source composition requires server-owned user and Project scope.");
    }
    const projectId = call.projectId!;
    const parsed = researchSourceCompositionToolInputSchema.parse(input);
    const allowedSourceRefs = (call.allowedSourceRefs ?? [])
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 5_000);
    const sourcePolicy = call.researchSourcePolicy;
    if (sourcePolicy?.mode === "only_refs" && !sourcePolicy.allowedSourceRefs.length) {
      throw new Error("Active research source policy permits no source references.");
    }
    const allowedRefSet = new Set(allowedSourceRefs);
    const scopedSourceRefs = sourcePolicy?.mode === "only_refs"
      ? sourcePolicy.allowedSourceRefs.filter((ref) => !allowedRefSet.size || allowedRefSet.has(ref))
      : allowedSourceRefs;
    if (sourcePolicy?.mode === "only_refs" && !scopedSourceRefs.length) {
      throw new Error("Current research source restrictions have no permitted intersection.");
    }

    // Review refreshes use one current in-memory document set for both matching and custody; they never rebuild the index.
    const readOnlyDocuments = call.researchReadOnly === true
      ? await currentPermittedProjectSearchDocuments(ctx, projectId, { readOnly: true })
      : null;
    assertNotAborted(signal);
    const searchRequest = {
      query: parsed.query,
      limit: parsed.limit,
      allowedSourceRefs: scopedSourceRefs,
      providerAllow: sourcePolicy?.providerAllow ?? [],
      providerDeny: sourcePolicy?.providerDeny ?? [],
    };
    const hits = readOnlyDocuments
      ? searchProjectDocuments(readOnlyDocuments, searchRequest)
      : await searchProjectIntelligence(ctx, projectId, searchRequest);
    assertNotAborted(signal);

    const documents = new Map(
      (readOnlyDocuments ?? await listProjectIntelligenceDocuments(ctx, projectId)).map((document) => [document.id, document]),
    );
    const matchingExcerpts = new Map<string, string>();
    const rankedDocuments = hits.flatMap((hit) => {
      const document = documents.get(hit.documentId);
      if (!document) return [];
      if (!hit.contentHash || document.contentHash !== hit.contentHash) {
        throw new Error("Research source changed during retrieval; compose again before using its excerpt.");
      }
      matchingExcerpts.set(document.id, hit.excerpt);
      return [document];
    });
    const composition = composeResearchSources({
      documents: rankedDocuments,
      targetUse: "ai_assistance",
      sourceClasses: parsed.sourceClasses,
    });
    // Reuse the matching P7 passage, not the document prefix, without changing source custody.
    for (const source of composition.included) {
      source.excerpt = matchingExcerpts.get(source.documentId)!;
    }
    assertNotAborted(signal);

    const blocked = aggregateBlocked(composition.blocked);
    // Source relationships are computed ONLY from AI-entitled P7 results,
    // never raw project index documents or blocked source identities.
    const graphLinks = rankPermittedEvidenceLinks(composition.included, { maxLinks: 50 });
    const graphNeighborhoods = buildPermittedEvidenceNeighborhoods(composition.included, graphLinks);
    const sourceRefs = [...new Set(composition.included.flatMap((item) => [item.sourceRef, ...item.sourceRefs]))].slice(0, 500);
    return {
      output: {
        query: parsed.query,
        targetUse: "ai_assistance",
        sources: composition.included,
        graphLinks,
        graphNeighborhoods,
        blocked,
        sourceCount: composition.included.length,
        blockedCount: composition.blocked.length,
      },
      summary: composition.included.length
        ? `Composed ${composition.included.length} AI-permitted research source${composition.included.length === 1 ? "" : "s"}; ${composition.blocked.length} matched source${composition.blocked.length === 1 ? "" : "s"} withheld by entitlement/use-right policy.`
        : composition.blocked.length
          ? `No matched research source is explicitly permitted for AI transmission; ${composition.blocked.length} source${composition.blocked.length === 1 ? "" : "s"} remained withheld.`
          : "No permitted Project research source matched the query.",
      deterministic: true,
      sourceRefs,
    };
  },
};
