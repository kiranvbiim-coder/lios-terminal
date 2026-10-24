/**
 * SI-03 / P7 -> P4: save an editable, cited comparison from current
 * entitlement-gated P7 evidence. Not a new research engine or Artifact store.
 * No model-authored findings or source references are accepted as input.
 */
import { z } from "zod";
import { researchArtifactContentSchema } from "@shared/artifactContracts";
import type { ComposedResearchSource } from "@shared/researchSourceComposition";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import { assertNotAborted, sourceScopeAllowsProjectData } from "./conversationRuntimeCore";
import { createArtifact } from "./artifactStore";
import { researchSourceCompositionTool, researchSourceCompositionToolOutputSchema } from "./researchSourceCompositionTool";
import { researchComparisonFacetsSchema, researchEvidenceComparisonFacetSchema, RESEARCH_EVIDENCE_COMPARISON_LIMITATION } from "./researchEvidenceComparison";
import { composeResearchSources } from "./researchSourceComposition";
import { currentPermittedProjectSearchDocuments } from "./p7ProjectIntelligenceStore";
import { fingerprintRecordedExcerpt } from "./langalphaExcerptProvenance";
import { tenantContext } from "./tenantContext";

export const saveResearchComparisonInputSchema = z.object({
  query: z.string().trim().min(1).max(2_000),
  title: z.string().trim().min(1).max(300),
  facets: researchComparisonFacetsSchema.pipe(z.array(z.string()).min(1)),
  limit: z.number().int().min(1).max(20).default(20),
}).strict();

const tenantSchema = z.object({
  userId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
}).strict();

export const saveResearchComparisonOutputSchema = z.object({
  output: z.object({
    artifactId: z.string().startsWith("artifact:"),
    version: z.number().int().positive(),
    sourceCount: z.number().int().min(1).max(50),
    evidenceCount: z.number().int().min(1).max(72),
    facetCount: z.number().int().min(1).max(6),
  }).strict(),
  summary: z.string().max(2_000),
  deterministic: z.literal(true),
  sourceRefs: z.array(z.string().min(1).max(1_000)).max(100),
}).strict();

type Facet = z.infer<typeof researchEvidenceComparisonFacetSchema>;
type Source = ComposedResearchSource;

/**
 * Creates Tiptap-compatible canonical P4 rich blocks, not a JSON-only report.
 * Every quote is the exact matched excerpt and carries both the current
 * document hash and a fingerprint of the saved quote bytes.
 */
export function researchComparisonArtifactContent(
  query: string,
  facets: readonly Facet[],
  sources: readonly Source[],
  providerPolicy: { providerAllow?: readonly string[]; providerDeny?: readonly string[] } = {},
) {
  const byDoc = new Map(sources.map(source => [source.documentId, source]));
  const refs = new Set<string>();
  const blocks: Array<z.infer<typeof researchArtifactContentSchema>["blocks"][number]> = [
    { id: "comparison-title", type: "heading", text: "Research evidence comparison" },
    { id: "comparison-scope", type: "paragraph", text: "Research question: " + query },
    { id: "comparison-method", type: "callout", text: RESEARCH_EVIDENCE_COMPARISON_LIMITATION },
  ];
  const evidence: Array<z.infer<typeof researchArtifactContentSchema>["evidence"][number]> = [];

  for (const [i, facet] of facets.entries()) {
    blocks.push({ id: "facet-" + i, type: "heading", text: facet.facet });
    if (!facet.rows.length) {
      blocks.push({ id: "gap-" + i, type: "paragraph", text: "Evidence gap: no exact passage matched among " + facet.inspectedSources + " permitted retrieved source(s). This is not proof the topic is absent." });
      continue;
    }
    for (const [j, row] of facet.rows.entries()) {
      const source = byDoc.get(row.documentId);
      if (!source || source.sourceRef !== row.sourceRef || source.contentHash !== row.contentHash) {
        throw new Error("Research comparison source identity or revision changed; rerun before saving.");
      }
      refs.add(source.sourceRef);
      const evidenceId = "comparison-evidence-" + i + "-" + j;
      const quoteId = "comparison-quote-" + i + "-" + j;
      blocks.push({
        id: quoteId,
        type: "quote",
        text: row.passage,
        attrs: {
          sourceRef: source.sourceRef,
          documentId: source.documentId,
          evidenceId,
          contentHash: source.contentHash,
          evidenceVersionRef: source.sourceRef + "@" + source.contentHash,
          sourceClass: source.sourceClass,
          evidenceClass: "source",
          ...fingerprintRecordedExcerpt(row.passage),
        },
      });
      blocks.push({
        id: "comparison-citation-" + i + "-" + j,
        type: "paragraph",
        text: "Source: " + source.sourceRef + (source.occurredAt ? " · recorded " + source.occurredAt : " · source date unavailable"),
      });
      evidence.push({
        id: evidenceId,
        title: source.title,
        snippet: row.passage,
        sourceRef: source.sourceRef,
        url: source.identity.url,
        sourceType: "project",
        observedAt: source.occurredAt,
      });
    }
    if (facet.omittedMatches) {
      blocks.push({ id: "more-matches-" + i, type: "paragraph", text: String(facet.omittedMatches) + " additional matching source(s) omitted by the presentation limit. Rerun with a narrower question to inspect them." });
    }
  }
  if (!refs.size || !evidence.length) throw new Error("No permitted cited comparison evidence matched; no empty Artifact was created.");
  const sourceRefs = [...refs];
  return {
    content: researchArtifactContentSchema.parse({
      kind: "research",
      question: query,
      plan: { status: "completed", steps: [
        { id: "compare-permitted-evidence", objective: "Compare source-backed excerpts, without inferred factual claims.", status: "done", sourceKinds: ["project"] },
      ] },
      blocks,
      claims: [],
      evidence,
      sourcePolicy: {
        mode: "only_refs",
        allowedSourceRefs: sourceRefs,
        providerAllow: [...(providerPolicy.providerAllow ?? [])],
        providerDeny: [...(providerPolicy.providerDeny ?? [])],
      },
    }),
    sourceRefs,
  };
}

/** Existing governed Chat agent discovers this tool via canonical registration. */
export const saveResearchComparisonTool: ConversationToolDefinition = {
  id: "lios.research.save_comparison",
  label: "Save editable research comparison with current permitted citations in the existing Workbench",
  planningHint: [
    'Input only {"query":"<research question>","title":"<Artifact title>","facets":["<exact topic phrase>"]}.',
    "Use one to six distinct facets, drawn from the user question. No sourceRefs, draft claims, hidden identifiers, external URLs or SQL.",
    "Saves actual cited excerpts as an editable Research Artifact; never calls these matches verified facts.",
  ].join(" "),
  kind: "calculate",
  permissionClass: "safe_auto",
  access: "write",
  sideEffect: "internal_write",
  replaySafe: false,
  inputSchema: saveResearchComparisonInputSchema,
  outputSchema: saveResearchComparisonOutputSchema.transform((value): ConversationToolResult => value),
  maxOutputBytes: 16 * 1024,
  cancel: null,
  invoke: async (input, signal, call): Promise<ConversationToolResult> => {
    assertNotAborted(signal);
    if (call.researchReadOnly || call.resourceTransmissionAllowed === false) {
      throw new Error("Saving a research comparison requires authorized writable Project evidence access.");
    }
    if (!sourceScopeAllowsProjectData(call.sourceScope ?? "auto")) {
      throw new Error("Research comparison requires Auto or My Data source scope.");
    }
    const tenant = tenantSchema.parse(call.tenant);
    if (call.source !== "agent" || call.userId !== tenant.userId
      || !call.requestId || !Number.isSafeInteger(call.projectId)
      || (call.projectId ?? 0) <= 0) {
      throw new Error("Saving research comparison requires the authenticated owner, Project and agent request.");
    }
    const ctx = tenantContext({
      id: tenant.userId, organizationId: tenant.organizationId, role: tenant.role,
    });
    const parsed = saveResearchComparisonInputSchema.parse(input);
    // Invoke the existing governed P7 composer, not a second retrieval
    // implementation. This enforces exact source/provider policy, current
    // source custody and explicit AI-transmission rights.
    const composedResult = researchSourceCompositionToolOutputSchema.parse(
      await researchSourceCompositionTool.invoke({
        query: parsed.query, facets: parsed.facets, limit: parsed.limit,
      }, signal, call),
    );
    if (!composedResult.output.sources.length) {
      throw new Error("No AI-permitted Project research sources matched; no Artifact was created.");
    }
    assertNotAborted(signal);
    const current = await currentPermittedProjectSearchDocuments(ctx, call.projectId!, { readOnly: true });
    const currentById = new Map(current.map(item => [item.id, item]));
    const verifiedDocuments = composedResult.output.sources.map(source => {
      const document = currentById.get(source.documentId);
      if (!document || document.sourceRef !== source.sourceRef
        || document.contentHash !== source.contentHash) {
        throw new Error("Research evidence changed or lost permission before save; rerun the comparison.");
      }
      return document;
    });
    const rechecked = composeResearchSources({
      documents: verifiedDocuments,
      targetUse: "ai_assistance",
    });
    if (rechecked.included.length !== verifiedDocuments.length ||
      rechecked.included.some((source, index) =>
        source.documentId !== verifiedDocuments[index]!.id
        || source.contentHash !== verifiedDocuments[index]!.contentHash)) {
      throw new Error("Research use rights changed before saving; rerun the comparison.");
    }
    const { content, sourceRefs } = researchComparisonArtifactContent(
      parsed.query,
      composedResult.output.comparison,
      composedResult.output.sources,
      {
        providerAllow: call.researchSourcePolicy?.providerAllow,
        providerDeny: call.researchSourcePolicy?.providerDeny,
      },
    );
    assertNotAborted(signal);
    const created = await createArtifact(ctx, {
      projectId: call.projectId!,
      title: parsed.title,
      content,
      origin: "conversation",
      actorType: "conversation",
      requestId: call.requestId,
      sourceRefs,
      dependencyRefs: sourceRefs,
      note: "Extractive multi-source comparison. Source custody and AI-transmission rights rechecked; factual agreement not adjudicated.",
    });
    return {
      output: {
        artifactId: created.artifact.id,
        version: created.version.version,
        sourceCount: sourceRefs.length,
        evidenceCount: content.evidence.length,
        facetCount: parsed.facets.length,
      },
      summary: "Saved editable cited Research Artifact " + created.artifact.id
        + "@v" + created.version.version + " with " + sourceRefs.length
        + " source(s) and " + content.evidence.length
        + " matching passage(s). Facts and source agreement are not independently verified.",
      deterministic: true,
      sourceRefs: [created.artifact.id + "@v" + created.version.version, ...sourceRefs].slice(0, 100),
    };
  },
};
