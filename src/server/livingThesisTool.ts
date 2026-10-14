import { z } from "zod";
import { artifactContentSchema } from "@shared/artifactContracts";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import { getArtifact, getArtifactVersion } from "./artifactStore";
import { buildLivingThesisReview } from "./p7LivingThesis";
import { assertNotAborted, sourceScopeAllowsProjectData } from "./conversationRuntimeCore";

const tenantSchema = z.object({
  userId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
}).strict();

export const livingThesisToolInputSchema = z.object({
  artifactId: z.string().startsWith("artifact:"),
  version: z.number().int().positive().optional(),
}).strict();

export const livingThesisToolOutputSchema = z.object({
  output: z.object({
    artifactId: z.string().startsWith("artifact:"),
    reviewedVersion: z.number().int().positive(),
    previousVersion: z.number().int().positive().nullable(),
    review: z.unknown(),
  }).strict(),
  summary: z.string().trim().max(2_000),
  deterministic: z.literal(true),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(100),
}).strict();

export const livingThesisTool: ConversationToolDefinition = {
  id: "lios.thesis.living_review",
  label: "Review a durable investment thesis and exact changes since its prior version",
  kind: "retrieve",
  permissionClass: "safe_auto",
  access: "read",
  sideEffect: "none",
  replaySafe: true,
  inputSchema: livingThesisToolInputSchema,
  outputSchema: livingThesisToolOutputSchema.transform((value): ConversationToolResult => value),
  maxOutputBytes: 192 * 1024,
  cancel: null,
  invoke: async (input, signal, call): Promise<ConversationToolResult> => {
    assertNotAborted(signal);
    if (call.source !== "agent" || !call.requestId) {
      throw new Error("Living thesis review requires an authenticated governed agent call.");
    }
    if (!sourceScopeAllowsProjectData(call.sourceScope ?? "auto")) {
      throw new Error("Living thesis review requires Auto or My Data Project scope.");
    }
    const tenant = tenantSchema.parse(call.tenant);
    if (call.userId !== tenant.userId) throw new Error("Living thesis owner scope does not match the governed call.");
    const projectId = Number(call.projectId);
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      throw new Error("Living thesis review requires an active Project.");
    }

    const parsed = livingThesisToolInputSchema.parse(input);
    const artifact = await getArtifact(tenant, parsed.artifactId);
    if (artifact.projectId !== projectId) throw new Error("Thesis Artifact belongs to a different Project.");
    if (artifact.kind !== "thesis") throw new Error("Living thesis review requires a ThesisArtifact.");

    const currentVersionNumber = parsed.version ?? artifact.headVersion;
    const currentVersion = await getArtifactVersion(tenant, artifact.id, currentVersionNumber);
    const currentContent = artifactContentSchema.parse(currentVersion.content);
    if (currentContent.kind !== "thesis") throw new Error("Selected Artifact version is not a ThesisArtifact.");

    const previousVersion = currentVersionNumber > 1
      ? await getArtifactVersion(tenant, artifact.id, currentVersionNumber - 1)
      : null;
    const previousContent = previousVersion ? artifactContentSchema.parse(previousVersion.content) : null;
    if (previousContent && previousContent.kind !== "thesis") {
      throw new Error("Previous Artifact version is not a ThesisArtifact.");
    }

    const review = buildLivingThesisReview({
      current: {
        artifactId: artifact.id,
        version: currentVersion.version,
        contentHash: currentVersion.contentHash,
        assumptionRefs: currentVersion.assumptionRefs ?? [],
        content: currentContent,
      },
      previous: previousVersion && previousContent && previousContent.kind === "thesis" ? {
        artifactId: artifact.id,
        version: previousVersion.version,
        contentHash: previousVersion.contentHash,
        assumptionRefs: previousVersion.assumptionRefs ?? [],
        content: previousContent,
      } : null,
    });
    assertNotAborted(signal);

    const delta = review.changedSinceLastReview;
    const changedGroups = [
      delta.status ? 1 : 0,
      delta.posture ? 1 : 0,
      delta.assumptions.added.length + delta.assumptions.removed.length,
      delta.claims.length,
      delta.expectedOutcomes.length,
      delta.catalysts.length,
      delta.risks.length,
      delta.invalidationConditions.length,
      delta.openQuestions.length,
    ].reduce((sum, value) => sum + value, 0);

    return {
      output: {
        artifactId: artifact.id,
        reviewedVersion: currentVersion.version,
        previousVersion: previousVersion?.version ?? null,
        review,
      },
      summary: delta.baseline
        ? `Reviewed baseline living thesis ${artifact.id}@v${currentVersion.version}; there is no prior durable review version.`
        : `Reviewed living thesis ${artifact.id}@v${currentVersion.version} against v${previousVersion?.version}; ${changedGroups} deterministic change item${changedGroups === 1 ? "" : "s"} detected.`,
      deterministic: true,
      sourceRefs: [
        `${artifact.id}@v${currentVersion.version}`,
        ...(previousVersion ? [`${artifact.id}@v${previousVersion.version}`] : []),
        ...(currentVersion.assumptionRefs ?? []),
      ].slice(0, 100),
    };
  },
};
