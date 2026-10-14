import { z } from "zod";
import { CONSENSUS_METRICS } from "./consensusService";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import { assertNotAborted, sourceScopeAllowsProjectData } from "./conversationRuntimeCore";
import { getProject } from "./projectStore";
import { getEstimateRecommendationEvidence } from "./estimateRecommendationEvidence";

const tenantSchema = z.object({
  userId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "internal_compliance", "client_admin", "client_user"]),
}).strict();

const fiscalPeriodPattern = /^(?:FY\d{4}(?:Q[1-4]|H[1-2])?|\d{4}(?:Q[1-4]|H[1-2])?|Q[1-4]FY\d{4}|CURRENT)$/i;

export const estimateRecommendationEvidenceToolInputSchema = z.object({
  symbol: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9.^_=-]+$/).transform((value) => value.toUpperCase()),
  metric: z.enum(CONSENSUS_METRICS),
  fiscalPeriod: z.string().trim().min(1).max(40).regex(fiscalPeriodPattern).transform((value) => value.toUpperCase()),
  asOf: z.string().datetime({ offset: true }).optional(),
  seriesLimit: z.number().int().min(1).max(10).default(10),
  revisionLimit: z.number().int().min(1).max(50).default(25),
}).strict();

const outputSchema = z.custom<Record<string, unknown>>(
  (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value),
  "Expected estimate recommendation evidence output.",
);

export const estimateRecommendationEvidenceToolOutputSchema = z.object({
  output: outputSchema,
  summary: z.string().trim().max(2_000),
  deterministic: z.literal(true),
  sourceRefs: z.array(z.string().trim().min(1).max(2_000)).max(250),
}).strict();

function boundedSourceRefs(result: Awaited<ReturnType<typeof getEstimateRecommendationEvidence>>): string[] {
  const refs = [
    ...result.evidence.contributorVintages.map((item) => item.sourceReference),
    ...result.aggregates.map((item) => item.sourceUrl ?? item.sourceName),
    ...result.provenance.benchmarks.map((item) => item.sourceUrl ?? item.sourceName),
  ].filter((value): value is string => Boolean(value));
  return [...new Set(refs)].slice(0, 250);
}

export const estimateRecommendationEvidenceTool: ConversationToolDefinition = {
  id: "lios.research.estimate_evidence",
  label: "Inspect source-separated estimate, rating and price-target revision evidence",
  kind: "retrieve",
  permissionClass: "safe_auto",
  access: "read",
  sideEffect: "none",
  replaySafe: true,
  inputSchema: estimateRecommendationEvidenceToolInputSchema,
  outputSchema: estimateRecommendationEvidenceToolOutputSchema.transform((value): ConversationToolResult => value),
  maxOutputBytes: 192 * 1024,
  cancel: null,
  invoke: async (input, signal, call): Promise<ConversationToolResult> => {
    assertNotAborted(signal);
    if (call.source !== "agent" || !call.requestId) {
      throw new Error("Estimate recommendation evidence requires an authenticated governed agent call.");
    }
    if (!sourceScopeAllowsProjectData(call.sourceScope ?? "auto")) {
      throw new Error("Estimate recommendation evidence requires Auto or My Data Project scope.");
    }
    const tenant = tenantSchema.parse(call.tenant);
    if (!["internal_admin", "internal_analyst", "internal_compliance"].includes(tenant.role)) {
      throw new Error("Estimate recommendation evidence is restricted to the existing internal consensus-reader roles.");
    }
    if (call.userId !== tenant.userId) {
      throw new Error("Estimate recommendation evidence owner scope does not match the governed call.");
    }
    const projectId = Number(call.projectId);
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      throw new Error("Estimate recommendation evidence requires an active Project.");
    }
    await getProject(tenant, projectId);

    const parsed = estimateRecommendationEvidenceToolInputSchema.parse(input);
    const result = await getEstimateRecommendationEvidence({
      organizationId: tenant.organizationId,
      symbol: parsed.symbol,
      metric: parsed.metric,
      fiscalPeriod: parsed.fiscalPeriod,
      asOf: parsed.asOf ? new Date(parsed.asOf) : undefined,
      page: 1,
      limit: parsed.seriesLimit,
      targetUse: "ai_assistance",
    });
    assertNotAborted(signal);

    const revisions = result.evidence.contributorVintages
      .slice()
      .sort((left, right) => right.vintageAt.localeCompare(left.vintageAt)
        || left.contributor.localeCompare(right.contributor)
        || left.provider.localeCompare(right.provider))
      .slice(0, parsed.revisionLimit);

    const groups = result.groups.slice(0, parsed.seriesLimit).map((group) => ({
      key: group.key,
      latest: group.latest.slice(0, 25),
      dispersion: group.dispersion,
      breadth: group.breadth,
      revisionMomentum: group.revisionMomentum,
      actual: group.actual,
      internalDivergence: group.internalDivergence,
      estimateVsInternalDivergence: group.estimateVsInternalDivergence,
      contributorAccuracy: group.contributorAccuracy.slice(0, 25),
      observationCount: group.observations.length,
    }));

    const output = {
      symbol: result.symbol,
      metric: result.metric,
      fiscalPeriod: result.fiscalPeriod,
      asOf: result.asOf,
      targetUse: result.targetUse,
      groups,
      revisions,
      aggregates: result.aggregates.slice(0, parsed.seriesLimit),
      coverage: result.coverage,
      counts: result.count,
      evidencePolicy: {
        ratingLabelPolicy: result.evidence.ratingLabelPolicy,
        aggregateIdentityPolicy: result.evidence.aggregateIdentityPolicy,
        blockedByRights: result.evidence.blockedByRights,
        note: "Recommendation labels/actions are source-declared only. Numeric recommendation scores are never mapped to invented labels.",
      },
      provenance: {
        snapshots: result.provenance.snapshots.slice(0, 100),
        benchmarks: result.provenance.benchmarks.slice(0, 100),
      },
      truncation: {
        seriesLimit: parsed.seriesLimit,
        revisionLimit: parsed.revisionLimit,
        revisionsReturned: revisions.length,
        totalPermittedContributorObservations: result.count.contributorObservations,
        provenanceSnapshotLimit: 100,
        provenanceBenchmarkLimit: 100,
      },
    };

    const sourceRefs = boundedSourceRefs(result);
    return {
      output,
      summary: result.coverage.state === "available"
        ? `Returned source-separated ${result.metric} evidence for ${result.symbol} ${result.fiscalPeriod}: ${result.count.contributorObservations} explicit contributor observation(s), ${result.count.aggregateOnly} aggregate-only snapshot(s), ${result.evidence.blockedByRights.count} source record(s) blocked from AI transmission by rights policy.`
        : `No AI-permitted ${result.metric} estimate evidence is available for ${result.symbol} ${result.fiscalPeriod}. ${result.coverage.reason ?? ""}`.trim(),
      deterministic: true,
      sourceRefs,
    };
  },
};
