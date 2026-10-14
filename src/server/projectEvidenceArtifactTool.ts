import { z } from "zod";
import { researchArtifactContentSchema } from "@shared/artifactContracts";
import type { P7SearchHit } from "@shared/p7ResearchContracts";
import type { ConversationToolDefinition } from "./conversationRuntime";
import { assertNotAborted, sourceScopeAllowsProjectData } from "./conversationRuntimeCore";
import { createArtifact } from "./artifactStore";
import { listProjectIntelligenceDocuments, searchProjectIntelligence } from "./p7ProjectIntelligenceStore";
import { tenantContext } from "./tenantContext";
import { buildProjectEvidenceTruth, formatProjectEvidenceTruthSummary } from "./projectEvidenceTruth";
import { detectExplicitContradictions } from "./p7ProjectIntelligence";
import { fingerprintRecordedExcerpt } from "./langalphaExcerptProvenance";

const evidenceInputSchema = z.object({
  query: z.string().trim().min(1).max(2_000),
  title: z.string().trim().min(1).max(300),
}).strict();
export const projectEvidenceArtifactOutputSchema = z.object({
  output: z.object({ artifactId: z.string().startsWith("artifact:"), version: z.number().int().positive(), evidenceCount: z.number().int().positive() }).strict(),
  summary: z.string().max(2_000),
  deterministic: z.literal(true),
  sourceRefs: z.array(z.string().min(1).max(1_000)).max(100),
}).strict();
const tenantSchema = z.object({
  userId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
});

/** Extractive, not AI-authored: every quote is an unchanged permitted P7 search excerpt. */
export function projectEvidenceArtifactContent(query: string, hits: readonly P7SearchHit[], allowedSourceRefs: readonly string[]) {
  return researchArtifactContentSchema.parse({
    kind: "research",
    question: query,
    plan: { status: "completed", steps: [{ id: "project-evidence", objective: "Collect matching permitted Project excerpts without inferred claims.", status: "done", sourceKinds: ["project"] }] },
    blocks: [
      { id: "method", type: "callout", text: "Deterministic evidence digest: these are bounded search excerpts, not an AI summary or verification of the underlying claims. No missing information was invented." },
      ...hits.flatMap((hit, index) => [
        { id: `source-${index}`, type: "heading", text: hit.title },
        { id: `quote-${index}`, type: "quote", text: hit.excerpt, attrs: { sourceRef: hit.sourceRef, documentId: hit.documentId, ...fingerprintRecordedExcerpt(hit.excerpt) } },
        { id: `citation-${index}`, type: "paragraph", text: `Source: ${hit.sourceRef}${hit.occurredAt ? ` · recorded ${hit.occurredAt}` : " · date unavailable"}` },
      ]),
    ],
    claims: [],
    evidence: hits.map((hit, index) => ({ id: `evidence-${index}`, title: hit.title, snippet: hit.excerpt, sourceRef: hit.sourceRef, sourceType: "project", observedAt: hit.occurredAt })),
    sourcePolicy: { mode: allowedSourceRefs.length ? "only_refs" : "connected_sources", allowedSourceRefs: [...allowedSourceRefs] },
  });
}

/** Register this descriptor in the existing conversation registry; it owns neither a loop nor a store. */
export const projectEvidenceArtifactTool: ConversationToolDefinition = {
  id: "lios.project.evidence_artifact",
  label: "Save cited Project evidence digest (query and title; no ticker required)",
  kind: "calculate",
  permissionClass: "safe_auto",
  access: "write",
  sideEffect: "internal_write",
  replaySafe: false,
  inputSchema: evidenceInputSchema,
  outputSchema: projectEvidenceArtifactOutputSchema,
  maxOutputBytes: 16 * 1024,
  cancel: null,
  invoke: async (input, signal, call) => {
    assertNotAborted(signal);
    if (!sourceScopeAllowsProjectData(call.sourceScope ?? "auto")) {
      throw new Error("Project evidence digest requires Auto or My Data scope; Files and Web cannot read the Project index.");
    }
    const tenant = tenantSchema.parse(call.tenant);
    const ctx = tenantContext({ id: tenant.userId, organizationId: tenant.organizationId, role: tenant.role });
    if (call.userId !== ctx.userId || !Number.isSafeInteger(call.projectId) || (call.projectId ?? 0) <= 0 || !call.requestId) {
      throw new Error("Project evidence digest requires server-owned user, Project and request scope.");
    }
    const projectId = call.projectId!;
    const { query, title } = evidenceInputSchema.parse(input);
    const allowedSourceRefs = call.allowedSourceRefs ?? [];
    const hits = await searchProjectIntelligence(ctx, projectId, { query, limit: 10, allowedSourceRefs });
    assertNotAborted(signal);
    if (!hits.length) throw new Error("No permitted Project evidence matched; no Artifact was created.");
    const documents = new Map((await listProjectIntelligenceDocuments(ctx, projectId)).map((doc) => [doc.id, doc]));
    const selectedDocuments = hits.map((hit) => {
      const doc = documents.get(hit.documentId);
      if (!doc) throw new Error("Selected research evidence is no longer available.");
      return doc;
    });
    const content = projectEvidenceArtifactContent(query, hits, allowedSourceRefs);
    for (const [index, hit] of hits.entries()) {
      const doc = selectedDocuments[index];
      const truth = buildProjectEvidenceTruth({ observedAt: hit.occurredAt, metadata: doc.metadata });
      const block = content.blocks.find((item) => item.id === `quote-${index}`);
      if (block) {
        const provenance = Object.fromEntries(
          [
            "provider", "sourceUrl", "requestedUrl", "resolvedUrl", "retrievedAt", "publishedAt", "effectiveAt", "originClass", "evidenceKind",
            "modelPeriod", "sourceTier", "freshnessState", "freshnessAssessedAt", "freshnessReason", "availabilityState", "entitlementState", "certaintyState",
            "extraction", "extractionCompleteness", "acquisitionRef", "acquisitionOutputHash",
          ]
            .filter((key) => doc.metadata[key] !== undefined)
            .map((key) => [key, doc.metadata[key]]),
        );
        block.attrs = { ...block.attrs, contentHash: doc.contentHash, provenance, truth };
      }
      const citation = content.blocks.find((item) => item.id === `citation-${index}`);
      if (citation) citation.text = `Source: ${hit.sourceRef} · ${formatProjectEvidenceTruthSummary(truth)}`;
      const url = z.string().url().safeParse(doc.metadata.sourceUrl);
      if (url.success) content.evidence[index].url = url.data;
    }

    const selectedSourceRefs = new Set(hits.map((hit) => hit.sourceRef));
    const contradictions = detectExplicitContradictions(selectedDocuments)
      .filter((item) => item.sourceRefs.every((sourceRef) => selectedSourceRefs.has(sourceRef)));
    content.contradictions = contradictions.map((item) => ({
      id: item.id,
      summary: item.summary,
      claimRefs: [],
      evidenceRefs: item.sourceRefs,
      status: "open",
    }));
    content.blocks.push(...contradictions.map((item) => ({
      id: `contradiction-${item.id.slice("contradiction:".length)}`,
      type: "callout" as const,
      text: `Contradiction to review: ${item.summary}`,
      attrs: { deterministic: true, evidenceRefs: item.sourceRefs },
    })));

    assertNotAborted(signal);
    const sourceRefs = [...new Set(hits.flatMap((hit) => [hit.sourceRef, ...hit.sourceRefs]))];
    const saved = await createArtifact(ctx, {
      projectId, title,
      content,
      origin: "conversation", sourceRefs, dependencyRefs: sourceRefs,
      actorType: "conversation", requestId: call.requestId,
      note: "Deterministic extractive digest from permitted Project Intelligence search; no AI-authored claims.",
    });
    // The P4 transaction is the commit boundary. Do not invent a rollback after a concurrent cancellation.
    return {
      output: { artifactId: saved.artifact.id, version: saved.version.version, evidenceCount: hits.length },
      summary: `Saved ${hits.length} cited Project excerpt(s) with ${contradictions.length} explicit contradiction(s) to ${saved.artifact.id}@v${saved.version.version}. No inferred claims.`,
      deterministic: true,
      sourceRefs: [...sourceRefs, `${saved.artifact.id}@v${saved.version.version}`],
    };
  },
};
