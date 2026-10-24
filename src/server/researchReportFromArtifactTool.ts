/**
 * P4 / SI-04: saved Research Artifact -> editable professional Report Artifact.
 * Reuses the P4 immutable Artifact store, reportEngine, rich report projection,
 * existing P7 indexed source custody and the already-imported LangAlpha quote
 * fingerprint. No second report engine, model-generated citation or new store.
 */
import { z } from "zod";
import { researchArtifactContentSchema, reportArtifactContentSchema } from "@shared/artifactContracts";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import { assertNotAborted, sourceScopeAllowsProjectData } from "./conversationRuntimeCore";
 import { getArtifact, getArtifactVersion, createArtifact } from "./artifactStore";
import { getArtifactExportPlan } from "./artifactExport";
import { requiresChromiumUnicodePdf } from "../client/src/lib/artifactUnicodePdf";
import { currentPermittedProjectSearchDocuments } from "./p7ProjectIntelligenceStore";
import { composeResearchSources } from "./researchSourceComposition";
import { matchesRecordedExcerptFingerprint } from "./langalphaExcerptProvenance";
import { generateReportPack } from "./reportEngine";
import { projectReportSections } from "./reportSectionProjection";
import { tenantContext } from "./tenantContext";

export const researchReportFromArtifactInputSchema = z.object({
  artifactId: z.string().trim().startsWith("artifact:").max(200),
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(300),
}).strict();

const tenantSchema = z.object({
  userId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
}).strict();

export const researchReportFromArtifactOutputSchema = z.object({
  output: z.object({
    artifactId: z.string().startsWith("artifact:"),
    version: z.number().int().positive(),
    researchArtifactId: z.string().startsWith("artifact:"),
    researchVersion: z.number().int().positive(),
    citedSourceCount: z.number().int().positive().max(100),
    excerptCount: z.number().int().positive().max(100),
    editorPreference: z.literal("tiptap"),
    docxDownloadPath: z.string().startsWith("/api/artifacts/").max(400),
    pdfDownloadPath: z.string().startsWith("/api/artifacts/").max(400).nullable(),
    unicodePdfDesktopRequired: z.boolean(),
  }).strict(),
  summary: z.string().trim().max(2_000),
  deterministic: z.literal(true),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(102),
}).strict();

type Research = z.infer<typeof researchArtifactContentSchema>;

export function buildReportFromResearchArtifact(input: {
  source: Research;
  title: string;
  artifactId: string;
  version: number;
  contentHash: string;
}) {
  const { source, title, artifactId, version, contentHash } = input;
  if (!source.evidence.length || !source.blocks.length) {
    throw new Error("Research Artifact has no reportable source evidence.");
  }
  if (source.blocks.length > 300 || source.evidence.length > 100) {
    throw new Error("Research Artifact exceeds the bounded report evidence budget.");
  }
  const sourceRefs = [...new Set(source.evidence.map(item => item.sourceRef))];
  if (sourceRefs.length === 0 || sourceRefs.length > 100) {
    throw new Error("Report requires one to 100 exact cited sources.");
  }
  if (source.sourcePolicy.mode === "only_refs"
    && (!source.sourcePolicy.allowedSourceRefs.length
      || sourceRefs.some(ref => !source.sourcePolicy.allowedSourceRefs.includes(ref)))) {
    throw new Error("Research report evidence exceeds the saved source restrictions.");
  }

  let verifiedQuotes = 0;
  for (const block of source.blocks) {
    if (block.type !== "quote") continue;
    const ref = block.attrs.sourceRef;
    if (typeof ref !== "string" || !sourceRefs.includes(ref)
      || typeof block.attrs.contentHash !== "string"
      || !/^[0-9a-f]{64}$/.test(block.attrs.contentHash)
      || !matchesRecordedExcerptFingerprint(block.text, {
        excerptSha256: block.attrs.excerptSha256,
        excerptByteLength: block.attrs.excerptByteLength,
      })) {
      throw new Error("Research report quotes must retain a cited source, current document hash and exact excerpt fingerprint.");
    }
    verifiedQuotes += 1;
  }
  if (verifiedQuotes === 0 || verifiedQuotes > 100) {
    throw new Error("Research report requires one to 100 source-bound, fingerprinted excerpts.");
  }

  const sourceArtifactVersionRef = artifactId + "@v" + version;
  const gaps = source.blocks
    .filter(block => block.id.startsWith("gap-") || block.attrs.missing === true)
    .map(block => block.text.trim()).filter(Boolean).slice(0, 60);
  const limitations = [
    "This report reproduces recorded Research Artifact evidence and edits. It does not independently verify facts or endorse user-authored interpretations.",
    "The cited Project source, rights and current source revision must remain available to the owner; source excerpts are evidence candidates, not proof of agreement.",
    ...gaps,
  ];
  const pack = generateReportPack({
    templateId: "research_evidence_report",
    title,
    subtitle: "Based on saved Research Artifact " + sourceArtifactVersionRef,
    sectionData: {
      summary: "Research question: " + (source.question || "Not recorded")
        + ". Includes " + sourceRefs.length + " cited source(s) and " + verifiedQuotes
        + " recorded excerpt(s). No synthetic findings or recommendation were added.",
      // This is the existing reportSectionProjection's trusted authored-block
      // path. It copies exact block text, attrs, citation hashes and structure
      // into editable report blocks instead of serializing the Research JSON.
      text: { kind: "research", blocks: source.blocks },
      limitations,
      sources: source.evidence.map(item => ({
        title: item.title, sourceRef: item.sourceRef, observedAt: item.observedAt,
        url: item.url, snippet: item.snippet,
      })),
    },
  });
  const projection = projectReportSections(pack, {
    attrs: {
      researchArtifactRef: sourceArtifactVersionRef,
      researchArtifactContentHash: contentHash,
      researchOutputHash: pack.metadata.outputHash,
      evidenceStatus: "source_recorded_not_independently_verified",
    },
  });
  return {
    content: reportArtifactContentSchema.parse({
      kind: "report",
      templateId: "research_evidence_report",
      blocks: projection.blocks,
      sections: projection.sections,
      editorPreference: "tiptap",
    }),
    sourceRefs,
    excerptCount: verifiedQuotes,
    sourceArtifactVersionRef,
  };
}

/**
 * Single governed Chat action. The source owner may subsequently edit the
 * retained Report directly in existing Workbench/P4 versioning APIs.
 */
export const researchReportFromArtifactTool: ConversationToolDefinition = {
  id: "lios.research.to_report",
  label: "Create an editable, cited professional report from an existing Research Artifact version",
  planningHint: [
    'Input exactly {"artifactId":"artifact:<id>","expectedVersion":1,"title":"<report title>"}.',
    "Use the actual current Research Artifact ID/version; never invent source references, metrics, citations or source content.",
    "This records cited evidence in the canonical report editor; it does not write an AI-authored conclusion.",
  ].join(" "),
  kind: "calculate",
  permissionClass: "safe_auto",
  access: "write",
  sideEffect: "internal_write",
  replaySafe: false,
  inputSchema: researchReportFromArtifactInputSchema,
  outputSchema: researchReportFromArtifactOutputSchema.transform((value): ConversationToolResult => value),
  maxOutputBytes: 16 * 1024,
  cancel: null,
  invoke: async (input, signal, call): Promise<ConversationToolResult> => {
    assertNotAborted(signal);
    if (call.researchReadOnly || call.resourceTransmissionAllowed === false
      || !sourceScopeAllowsProjectData(call.sourceScope ?? "auto")) {
      throw new Error("Research report requires writable authorized Project evidence in Auto or My Data scope.");
    }
    const actor = tenantSchema.parse(call.tenant);
    if (call.source !== "agent" || call.userId !== actor.userId || !call.requestId
      || !Number.isSafeInteger(call.projectId) || (call.projectId ?? 0) <= 0) {
      throw new Error("Research report requires an authenticated user, active Project and governed agent request.");
    }
    const ctx = tenantContext({
      id: actor.userId, organizationId: actor.organizationId, role: actor.role,
    });
    const parsed = researchReportFromArtifactInputSchema.parse(input);
    const artifact = await getArtifact(ctx, parsed.artifactId);
    if (artifact.kind !== "research" || artifact.status !== "active" || artifact.projectId !== call.projectId) {
      throw new Error("Source Research Artifact is not active in the authorized Project.");
    }
    if (artifact.headVersion !== parsed.expectedVersion) {
      throw new Error("Research Artifact version changed; reopen it before creating a report.");
    }
    const version = await getArtifactVersion(ctx, artifact.id, parsed.expectedVersion);
    const source = researchArtifactContentSchema.parse(version.content);
    const report = buildReportFromResearchArtifact({
      source, title: parsed.title, artifactId: artifact.id,
      version: parsed.expectedVersion, contentHash: version.contentHash,
    });

    const callerRefs = new Set(call.allowedSourceRefs ?? []);
    const policy = call.researchSourcePolicy;
    if (policy?.mode === "only_refs" && !policy.allowedSourceRefs.length) {
      throw new Error("Current research source policy permits no source references.");
    }
    const policyRefs = new Set(policy?.allowedSourceRefs ?? []);
    if (report.sourceRefs.some(ref =>
      (callerRefs.size && !callerRefs.has(ref))
      || (policy?.mode === "only_refs" && !policyRefs.has(ref)))) {
      throw new Error("Research Artifact cites sources excluded by the current request.");
    }
    const documents = await currentPermittedProjectSearchDocuments(ctx, artifact.projectId, { readOnly: true });
    const current = new Map(documents.map(doc => [doc.sourceRef, doc]));
    const selected = report.sourceRefs.map(ref => {
      const doc = current.get(ref);
      if (!doc) throw new Error("Cited Research Artifact source is missing or currently inaccessible.");
      return doc;
    });
    const entitled = composeResearchSources({ documents: selected, targetUse: "ai_assistance" });
    if (entitled.blocked.length || entitled.included.length !== selected.length) {
      throw new Error("Research report source rights no longer permit AI assistance.");
    }
    // Quote source hashes are mandatory, not just the source ref string.
    for (const quote of source.blocks.filter(block => block.type === "quote")) {
      const doc = current.get(String(quote.attrs.sourceRef));
      if (!doc || quote.attrs.contentHash !== doc.contentHash) {
        throw new Error("Research report quote source revision changed; refresh Research Artifact first.");
      }
    }
    const providerAllowed = (providerId: string | null, allow: readonly string[], deny: readonly string[]) =>
      !deny.includes(providerId ?? "") && (!allow.length || (!!providerId && allow.includes(providerId)));
    for (const composed of entitled.included) {
      if (!providerAllowed(composed.identity.providerId, source.sourcePolicy.providerAllow, source.sourcePolicy.providerDeny)
        || !providerAllowed(composed.identity.providerId, policy?.providerAllow ?? [], policy?.providerDeny ?? [])) {
        throw new Error("Research report source violates current provider restrictions.");
      }
    }
    assertNotAborted(signal);
    // Reject races where an edit occurred during source revalidation.
    const latest = await getArtifact(ctx, artifact.id);
    if (latest.headVersion !== parsed.expectedVersion) {
      throw new Error("Research Artifact changed during report preparation; reopen the latest version.");
    }
    const created = await createArtifact(ctx, {
      projectId: artifact.projectId,
      title: parsed.title,
      content: report.content,
      origin: "conversation",
      actorType: "conversation",
      requestId: call.requestId,
      sourceRefs: [report.sourceArtifactVersionRef, ...report.sourceRefs],
      dependencyRefs: [report.sourceArtifactVersionRef, ...report.sourceRefs],
      note: "Editable extractive Research Report from exact P7 Research Artifact version; source revisions and AI-use rights rechecked.",
    });
    const savedExportPlan = await getArtifactExportPlan(ctx, created.artifact.id, created.version.version);
    const unicodePdfDesktopRequired = requiresChromiumUnicodePdf(savedExportPlan, report.content);
    return {
      output: {
        artifactId: created.artifact.id,
        version: created.version.version,
        researchArtifactId: artifact.id,
        researchVersion: parsed.expectedVersion,
        citedSourceCount: report.sourceRefs.length,
        excerptCount: report.excerptCount,
        editorPreference: "tiptap",
        docxDownloadPath: "/api/artifacts/" + encodeURIComponent(created.artifact.id)
          + "/report.docx?version=" + created.version.version,
        pdfDownloadPath: unicodePdfDesktopRequired ? null
          : "/api/artifacts/" + encodeURIComponent(created.artifact.id)
            + "/report.pdf?version=" + created.version.version,
        unicodePdfDesktopRequired,
      },
      summary: "Saved editable report " + created.artifact.id + "@v" + created.version.version
        + " from " + report.sourceArtifactVersionRef + " with " + report.sourceRefs.length
        + " cited source(s); source claims are not independently verified.",
      deterministic: true,
      sourceRefs: [created.artifact.id + "@v" + created.version.version,
        report.sourceArtifactVersionRef, ...report.sourceRefs].slice(0, 102),
    };
  },
};
