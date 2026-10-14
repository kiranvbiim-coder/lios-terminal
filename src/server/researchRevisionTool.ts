import { fingerprintRecordedExcerpt } from "./langalphaExcerptProvenance";
import { z } from "zod";
import { researchArtifactContentSchema } from "@shared/artifactContracts";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import { createArtifactVersion, getArtifact, getArtifactVersion } from "./artifactStore";
import { listProjectIntelligenceDocuments, searchProjectIntelligence } from "./p7ProjectIntelligenceStore";
import { projectEvidenceArtifactContent } from "./projectEvidenceArtifactTool";
import { buildProjectEvidenceTruth } from "./projectEvidenceTruth";
import { assertNotAborted, sourceScopeAllowsProjectData } from "./conversationRuntimeCore";
import { tenantContext } from "./tenantContext";

const inputSchema = z.object({
  artifactId: z.string().trim().min(1).max(200),
  expectedVersion: z.number().int().positive(),
  query: z.string().trim().min(1).max(2_000),
}).strict();

const tenantSchema = z.object({
  userId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
}).strict();

const outputSchema = z.object({
  output: z.object({
    artifactId: z.string(),
    version: z.number().int().positive(),
    changed: z.boolean(),
    addedEvidence: z.number().int().nonnegative(),
  }).strict(),
  summary: z.string().max(2_000),
  deterministic: z.literal(true),
  sourceRefs: z.array(z.string().max(1_000)).max(100),
}).strict();

async function target(input: Record<string, unknown>, call: Parameters<ConversationToolDefinition["invoke"]>[2]) {
  const parsed = inputSchema.parse(input);
  const tenant = tenantSchema.parse(call.tenant);
  if (call.source !== "agent" || call.userId !== tenant.userId || !call.requestId || !call.projectId) {
    throw new Error("Research refresh requires authenticated Project agent context.");
  }
  if (call.resourceTransmissionAllowed === false) {
    throw new Error("Project resource transmission is disabled; no research evidence was read.");
  }
  if (!sourceScopeAllowsProjectData(call.sourceScope ?? "auto")) {
    throw new Error("Research refresh requires Auto or My Data source scope.");
  }

  const ctx = tenantContext({
    id: tenant.userId,
    organizationId: tenant.organizationId,
    role: tenant.role,
  });
  const artifact = await getArtifact(ctx, parsed.artifactId);
  if (artifact.projectId !== call.projectId || artifact.status !== "active") {
    throw new Error("Research Artifact is not active in this Project.");
  }
  if (artifact.kind !== "research") throw new Error("Research refresh requires a Research Artifact.");
  if (artifact.headVersion !== parsed.expectedVersion) {
    throw new Error("Research Artifact changed; review its current version before refreshing.");
  }

  const version = await getArtifactVersion(ctx, artifact.id, parsed.expectedVersion);
  const content = researchArtifactContentSchema.parse(version.content);

  const artifactRefs = content.sourcePolicy.allowedSourceRefs;
  const callRefs = call.allowedSourceRefs ?? [];
  if (content.sourcePolicy.mode === "only_refs" && !artifactRefs.length) {
    throw new Error("Research source policy permits no source references.");
  }
  const allowedSourceRefs = artifactRefs.length && callRefs.length
    ? artifactRefs.filter((ref) => callRefs.includes(ref))
    : artifactRefs.length ? artifactRefs : callRefs;
  if (artifactRefs.length && callRefs.length && !allowedSourceRefs.length) {
    throw new Error("Research source policies have no permitted overlap.");
  }

  return { parsed, ctx, artifact, version, content, allowedSourceRefs };
}

/**
 * SI-03.22: explicit, owner-reviewed ResearchArtifact refresh.
 * It only appends newly observed source versions through canonical P4 immutable versions.
 */
export const researchRevisionTool: ConversationToolDefinition = {
  id: "lios.research.refresh",
  label: "Refresh cited Research Artifact evidence",
  kind: "calculate",
  permissionClass: "user_confirm",
  allowProjectApproval: false,
  access: "write",
  sideEffect: "internal_write",
  replaySafe: false,
  inputSchema,
  outputSchema: outputSchema.transform((value): ConversationToolResult => ({ ...value, output: value.output })),
  maxOutputBytes: 16 * 1024,
  cancel: null,
  invoke: async (input, signal, call) => {
    assertNotAborted(signal);
    const { parsed, ctx, artifact, version, content, allowedSourceRefs } = await target(input, call);

    const hits = await searchProjectIntelligence(ctx, artifact.projectId, {
      query: parsed.query,
      limit: 10,
      allowedSourceRefs,
      providerAllow: content.sourcePolicy.providerAllow,
      providerDeny: content.sourcePolicy.providerDeny,
    });
    assertNotAborted(signal);

    const documents = new Map(
      (await listProjectIntelligenceDocuments(ctx, artifact.projectId)).map((document) => [document.id, document]),
    );
    const knownVersions = new Set(
      content.blocks.flatMap((block) =>
        typeof block.attrs.evidenceVersionRef === "string" ? [block.attrs.evidenceVersionRef] : []),
    );

    const additions = hits.flatMap((hit) => {
      const document = documents.get(hit.documentId);
      if (!document || !hit.contentHash || document.contentHash !== hit.contentHash) {
        throw new Error("Research source changed during retrieval; refresh again before saving.");
      }
      const evidenceVersionRef = `${hit.sourceRef}@${document.contentHash}`;
      return knownVersions.has(evidenceVersionRef) ? [] : [{ hit, document, evidenceVersionRef }];
    });

    if (!additions.length) {
      return {
        output: {
          artifactId: artifact.id,
          version: version.version,
          changed: false,
          addedEvidence: 0,
        },
        summary: "No new or changed permitted evidence matched. No version was written; existing claims remain unverified by this refresh.",
        deterministic: true,
        sourceRefs: [`${artifact.id}@v${version.version}`],
      };
    }

    const prefix = `refresh-v${version.version + 1}-`;
    const digest = projectEvidenceArtifactContent(
      parsed.query,
      additions.map((item) => item.hit),
      allowedSourceRefs,
    );
    digest.blocks = digest.blocks.map((block) => ({ ...block, id: prefix + block.id }));
    digest.evidence = digest.evidence.map((item) => ({ ...item, id: prefix + item.id }));

    for (const [index, { hit, document, evidenceVersionRef }] of additions.entries()) {
      const evidence = digest.evidence[index];
      const quote = digest.blocks.find((block) => block.id === `${prefix}quote-${index}`);
      if (!evidence || !quote) throw new Error("Research refresh could not bind deterministic evidence output.");
      const prior = [...content.blocks].reverse().find(
        (block) => block.type === "quote" && block.attrs.sourceRef === hit.sourceRef,
      );
      quote.attrs = {
        ...quote.attrs,
        evidenceId: evidence.id,
        contentHash: document.contentHash,
        evidenceVersionRef,
        ...fingerprintRecordedExcerpt(quote.text),
        evidenceClass: "source",
        provenance: document.metadata,
        truth: buildProjectEvidenceTruth({
          observedAt: document.occurredAt,
          metadata: document.metadata,
        }),
        ...(typeof prior?.attrs.evidenceVersionRef === "string"
          ? { previousEvidenceVersionRef: prior.attrs.evidenceVersionRef }
          : {}),
      };
      if (
        typeof document.metadata.sourceUrl === "string"
        && z.string().url().safeParse(document.metadata.sourceUrl).success
      ) {
        evidence.url = document.metadata.sourceUrl;
      }
    }

    const next = researchArtifactContentSchema.parse({
      ...content,
      blocks: [...content.blocks, ...digest.blocks],
      evidence: [...content.evidence, ...digest.evidence],
      executionTrail: [
        ...content.executionTrail,
        {
          at: new Date().toISOString(),
          action: `Append ${additions.length} cited evidence version(s); existing claims not reverified.`,
          sourceRefs: additions.map((item) => item.hit.sourceRef),
          receiptId: null,
        },
      ],
    });

    const refs = [...new Set(additions.flatMap(({ hit }) => [hit.sourceRef, ...hit.sourceRefs]))];
    assertNotAborted(signal);
    const saved = await createArtifactVersion(ctx, {
      artifactId: artifact.id,
      baseVersion: parsed.expectedVersion,
      content: next,
      actorType: "conversation",
      requestId: call.requestId,
      sourceRefs: [...new Set([...(version.sourceRefs ?? []), ...refs])],
      dependencyRefs: [...new Set([...(version.dependencyRefs ?? []), ...refs])],
      note: "Owner-approved extractive research refresh; historical citations preserved; claims not reverified.",
    });

    return {
      output: {
        artifactId: artifact.id,
        version: saved.version,
        changed: true,
        addedEvidence: additions.length,
      },
      summary: `Appended ${additions.length} cited evidence version(s) to ${artifact.id}@v${saved.version}; earlier versions and claims are preserved, not reverified.`,
      deterministic: true,
      sourceRefs: [`${artifact.id}@v${saved.version}`, ...refs].slice(0, 100),
    };
  },
};
