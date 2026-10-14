import { z } from "zod";
import { researchArtifactContentSchema } from "@shared/artifactContracts";
import type { P7ProjectDocument } from "@shared/p7ResearchContracts";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import { createArtifact } from "./artifactStore";
import { listProjectIntelligenceDocuments } from "./p7ProjectIntelligenceStore";
import { buildProjectEvidenceTruth, formatProjectEvidenceTruthSummary } from "./projectEvidenceTruth";
import { tenantContext } from "./tenantContext";
import { assertNotAborted } from "./conversationRuntimeCore";
import { fingerprintRecordedExcerpt } from "./langalphaExcerptProvenance";

const webResearchInputSchema = z.object({
  query: z.string().trim().min(1).max(2_000),
  title: z.string().trim().min(1).max(300),
  sourceUrls: z.array(z.string().url().max(2_000)).min(1).max(10),
}).strict();

export const webResearchArtifactOutputSchema = z.object({
  output: z.object({
    artifactId: z.string().startsWith("artifact:"),
    version: z.number().int().positive(),
    sourceCount: z.number().int().positive(),
  }).strict(),
  summary: z.string().trim().max(2_000),
  deterministic: z.literal(true),
  sourceRefs: z.array(z.string().url().max(2_000)).min(1).max(20),
}).strict();

const tenantSchema = z.object({
  userId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
}).strict();

type ResearchArtifactContent = z.infer<typeof researchArtifactContentSchema>;

const PROVENANCE_KEYS = [
  "provider",
  "sourceUrl",
  "requestedUrl",
  "resolvedUrl",
  "retrievedAt",
  "publishedAt",
  "effectiveAt",
  "originClass",
  "evidenceKind",
  "freshnessState",
  "freshnessAssessedAt",
  "freshnessReason",
  "availabilityState",
  "entitlementState",
  "certaintyState",
  "extraction",
  "extractionCompleteness",
  "acquisitionRef",
  "acquisitionOutputHash",
] as const;

function uniqueUrls(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()))];
}

function webExcerpt(body: string): string {
  const clean = body.replace(/\s+/g, " ").trim();
  return clean.length <= 4_000 ? clean : clean.slice(0, 4_000) + "…";
}

function isCapturedWebDocument(doc: P7ProjectDocument): boolean {
  return doc.sourceType === "research_evidence"
    && doc.metadata.sourceUrl === doc.sourceRef
    && (doc.metadata.resolvedUrl === undefined || doc.metadata.resolvedUrl === doc.sourceRef)
    && doc.metadata.originClass === "untrusted"
    && typeof doc.metadata.retrievedAt === "string"
    && typeof doc.metadata.acquisitionRef === "string"
    && typeof doc.metadata.acquisitionOutputHash === "string";
}

function webDocumentMatchesUrl(doc: P7ProjectDocument, url: string): boolean {
  return isCapturedWebDocument(doc)
    && (doc.sourceRef === url
      || doc.sourceRefs.includes(url)
      || doc.metadata.requestedUrl === url
      || doc.metadata.resolvedUrl === url);
}

function selectCapturedWebDocuments(
  documents: readonly P7ProjectDocument[],
  sourceUrls: readonly string[],
): P7ProjectDocument[] {
  const selected = sourceUrls.map((url) => {
    const matches = documents.filter((candidate) => webDocumentMatchesUrl(candidate, url));
    if (matches.length === 0) {
      throw new Error(`Requested web source was not captured through the governed browser: ${url}`);
    }
    if (matches.length > 1) {
      throw new Error(`Requested web source matched multiple governed browser captures: ${url}`);
    }
    return matches[0];
  });
  const canonical = selected.map((doc) => doc.sourceRef);
  if (new Set(canonical).size !== canonical.length) {
    throw new Error("Web evidence URLs must resolve to distinct captured sources.");
  }
  return selected;
}

export function webResearchArtifactContent(input: {
  query: string;
  documents: readonly P7ProjectDocument[];
  sourceUrls: readonly string[];
  generatedAt?: string;
}): ResearchArtifactContent {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const requestedUrls = uniqueUrls(input.sourceUrls);
  const documents = selectCapturedWebDocuments(input.documents, requestedUrls);
  const sourceUrls = documents.map((doc) => doc.sourceRef);

  const blocks: ResearchArtifactContent["blocks"] = [{
    id: "method",
    type: "callout",
    text: "Web evidence collection: each source below is a bounded governed-browser extraction preserved separately with acquisition provenance. Source text is untrusted evidence, not verified fact, and LiOS does not infer agreement merely because sources are shown together.",
    attrs: {},
  }];
  const evidence: ResearchArtifactContent["evidence"] = [];

  documents.forEach((doc, index) => {
    const truth = buildProjectEvidenceTruth({ observedAt: doc.occurredAt, metadata: doc.metadata });
    const provenance = Object.fromEntries(
      PROVENANCE_KEYS
        .filter((key) => doc.metadata[key] !== undefined)
        .map((key) => [key, doc.metadata[key]]),
    );
    const excerpt = webExcerpt(doc.body);
    blocks.push(
      { id: `source-${index}`, type: "heading", text: doc.title || doc.sourceRef, attrs: {} },
      {
        id: `quote-${index}`,
        type: "quote",
        text: excerpt,
        attrs: {
          sourceRef: doc.sourceRef,
          documentId: doc.id,
          contentHash: doc.contentHash,
          ...fingerprintRecordedExcerpt(excerpt),
          provenance,
          truth,
        },
      },
      {
        id: `citation-${index}`,
        type: "paragraph",
        text: `Source: ${doc.sourceRef} · ${formatProjectEvidenceTruthSummary(truth)}`,
        attrs: { sourceRef: doc.sourceRef },
      },
    );
    evidence.push({
      id: `evidence-${index}`,
      title: doc.title || doc.sourceRef,
      snippet: excerpt,
      sourceRef: doc.sourceRef,
      url: doc.sourceRef,
      sourceType: "web",
      observedAt: doc.occurredAt,
    });
  });

  if (documents.length > 1) {
    blocks.push({
      id: "comparison-boundary",
      type: "callout",
      text: "Cross-source comparison boundary: sources remain separately cited. Differences in wording are not automatically treated as contradictions, and agreement is not treated as verification.",
      attrs: { sourceRefs: sourceUrls, deterministic: true },
    });
  }

  return researchArtifactContentSchema.parse({
    kind: "research",
    question: input.query,
    plan: {
      status: "completed",
      steps: [{
        id: "web-evidence",
        objective: "Collect exact governed-browser web evidence and preserve source-specific citations/provenance.",
        status: "done",
        sourceKinds: ["web"],
      }],
    },
    blocks,
    claims: [],
    evidence,
    sourcePolicy: { mode: "only_refs", allowedSourceRefs: sourceUrls, providerAllow: [], providerDeny: [] },
    contradictions: [],
    executionTrail: [{
      at: generatedAt,
      action: "Collected exact governed-browser web evidence into a citation-ready ResearchArtifact.",
      sourceRefs: sourceUrls,
      receiptId: null,
    }],
  });
}

export const webResearchArtifactTool: ConversationToolDefinition = {
  id: "lios.web.evidence_artifact",
  label: "Save exact captured web evidence as a cited ResearchArtifact",
  kind: "calculate",
  permissionClass: "safe_auto",
  access: "write",
  sideEffect: "internal_write",
  replaySafe: false,
  inputSchema: webResearchInputSchema,
  outputSchema: webResearchArtifactOutputSchema.transform((value): ConversationToolResult => value),
  maxOutputBytes: 24 * 1024,
  cancel: null,
  invoke: async (input, signal, call): Promise<ConversationToolResult> => {
    assertNotAborted(signal);
    if (call.source !== "agent") throw new Error("Web evidence Artifact creation is available only to the bounded agent loop.");
    if (call.sourceScope !== "auto") {
      throw new Error("Durable web research requires Auto scope. Web-only browser use is intentionally non-persistent.");
    }
    const tenant = tenantSchema.parse(call.tenant);
    const ctx = tenantContext({ id: tenant.userId, organizationId: tenant.organizationId, role: tenant.role });
    if (call.userId !== ctx.userId || !Number.isSafeInteger(call.projectId) || (call.projectId ?? 0) <= 0 || !call.requestId) {
      throw new Error("Web evidence Artifact creation requires authenticated user, Project and request scope.");
    }

    const parsed = webResearchInputSchema.parse(input);
    const sourceUrls = uniqueUrls(parsed.sourceUrls);
    if (sourceUrls.length !== parsed.sourceUrls.length) {
      throw new Error("Web evidence source URLs must be unique.");
    }
    const projectId = call.projectId!;
    const documents = await listProjectIntelligenceDocuments(ctx, projectId);
    assertNotAborted(signal);
    const allowed = call.allowedSourceRefs?.length ? new Set(call.allowedSourceRefs) : null;
    const permittedDocuments = allowed
      ? documents.filter((doc) => [doc.sourceRef, ...doc.sourceRefs].some((ref) => allowed.has(ref)))
      : documents;
    const selected = selectCapturedWebDocuments(permittedDocuments, sourceUrls);

    const canonicalSourceRefs = selected.map((doc) => doc.sourceRef);
    const dependencyRefs = [...new Set(selected.flatMap((doc) => [doc.sourceRef, ...doc.sourceRefs]))];
    const content = webResearchArtifactContent({
      query: parsed.query,
      documents: selected,
      sourceUrls,
    });
    assertNotAborted(signal);
    const saved = await createArtifact(ctx, {
      projectId,
      title: parsed.title,
      content,
      origin: "conversation",
      sourceRefs: canonicalSourceRefs,
      dependencyRefs,
      actorType: "conversation",
      requestId: call.requestId,
      note: "Extractive web research from exact governed-browser captures; no AI-authored claims or implicit verification.",
    });

    return {
      output: {
        artifactId: saved.artifact.id,
        version: saved.version.version,
        sourceCount: canonicalSourceRefs.length,
      },
      summary: `Saved ${canonicalSourceRefs.length} exact governed-browser source${canonicalSourceRefs.length === 1 ? "" : "s"} as citation-ready web evidence in ${saved.artifact.id}@v${saved.version.version}. No claim reconciliation or verification was inferred.`,
      deterministic: true,
      sourceRefs: canonicalSourceRefs,
    };
  },
};
