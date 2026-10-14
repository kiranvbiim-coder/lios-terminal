import { z } from "zod";
import {
  alternativeEvidenceBlockReasonSchema,
  alternativeEvidenceDataClassSchema,
  normalizedAlternativeEvidenceSchema,
} from "@shared/alternativeEvidence";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import {
  blockReasonForAlternativeEvidence,
  loadAlternativeEvidence,
} from "./alternativeEvidenceAdapter";
import { assertNotAborted, sourceScopeAllowsProjectData } from "./conversationRuntimeCore";
import { getProject } from "./projectStore";

const tenantSchema = z.object({
  userId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
}).strict();

export const alternativeEvidenceToolInputSchema = z.object({
  dataClasses: z.array(alternativeEvidenceDataClassSchema).min(1).max(5).default([
    "private_series",
    "options_chain",
    "commodity_curve",
    "portfolio_holdings",
  ]),
  entityKey: z.string().trim().min(1).max(160).optional(),
  asOf: z.string().datetime({ offset: true }).optional(),
  limitPerClass: z.number().int().min(1).max(20).default(5),
  previewRecords: z.number().int().min(1).max(20).default(10),
}).strict().superRefine((value, ctx) => {
  if (value.asOf && !value.entityKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "asOf requires an explicit entityKey so point-in-time lookup cannot broaden across unrelated datasets.",
      path: ["entityKey"],
    });
  }
});

const blockedCountsSchema = z.record(z.string(), z.number().int().nonnegative());

export const alternativeEvidenceToolOutputSchema = z.object({
  output: z.object({
    included: z.array(normalizedAlternativeEvidenceSchema).max(100),
    counts: z.object({
      included: z.number().int().nonnegative(),
      blocked: z.number().int().nonnegative(),
      byClass: z.record(z.number().int().nonnegative()),
      byBlockReason: blockedCountsSchema,
    }).strict(),
    dataFetchPerformed: z.literal(false),
    providerNetworkUsed: z.literal(false),
  }).strict(),
  summary: z.string().trim().max(2_000),
  deterministic: z.literal(true),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(100),
}).strict();

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

export const alternativeEvidenceTool: ConversationToolDefinition = {
  id: "lios.research.alternative_evidence",
  label: "Inspect permitted alternative and private-market evidence",
  kind: "retrieve",
  permissionClass: "safe_auto",
  access: "read",
  sideEffect: "none",
  replaySafe: true,
  inputSchema: alternativeEvidenceToolInputSchema,
  outputSchema: alternativeEvidenceToolOutputSchema.transform((value): ConversationToolResult => value),
  maxOutputBytes: 96 * 1024,
  cancel: null,
  invoke: async (input, signal, call): Promise<ConversationToolResult> => {
    assertNotAborted(signal);
    if (call.source !== "agent" || !call.requestId) {
      throw new Error("Alternative evidence inspection requires an authenticated governed agent call.");
    }
    if (!sourceScopeAllowsProjectData(call.sourceScope ?? "auto")) {
      throw new Error("Alternative evidence inspection requires Auto or My Data Project scope.");
    }
    const tenant = tenantSchema.parse(call.tenant);
    if (call.userId !== tenant.userId) {
      throw new Error("Alternative evidence owner scope does not match the governed call.");
    }
    const projectId = Number(call.projectId);
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      throw new Error("Alternative evidence inspection requires an active Project.");
    }
    await getProject(tenant, projectId);

    const parsed = alternativeEvidenceToolInputSchema.parse(input);
    const evidence = await loadAlternativeEvidence({
      tenant,
      dataClasses: [...new Set(parsed.dataClasses)],
      entityKey: parsed.entityKey,
      asOf: parsed.asOf,
      limitPerClass: parsed.limitPerClass,
      previewLimit: parsed.previewRecords,
    });
    assertNotAborted(signal);

    const allowed = new Set(call.allowedSourceRefs ?? []);
    const included = [];
    const byClass: Record<string, number> = {};
    const byBlockReason: Record<string, number> = {};
    let blocked = 0;

    for (const item of evidence) {
      increment(byClass, item.evidenceClass);
      const reason = allowed.size && !allowed.has(item.snapshotRef)
        ? "source_policy_denied" as const
        : blockReasonForAlternativeEvidence(item.rights);
      if (reason) {
        blocked += 1;
        increment(byBlockReason, reason);
        continue;
      }
      included.push(item);
    }

    return {
      output: {
        included,
        counts: {
          included: included.length,
          blocked,
          byClass,
          byBlockReason,
        },
        dataFetchPerformed: false,
        providerNetworkUsed: false,
      },
      summary: included.length
        ? `Returned ${included.length} AI-permitted alternative/private evidence snapshot${included.length === 1 ? "" : "s"}; ${blocked} blocked snapshot${blocked === 1 ? "" : "s"} remained aggregate-only. No provider network call or valuation inference occurred.`
        : `No alternative/private snapshot was eligible for model-visible research; ${blocked} blocked snapshot${blocked === 1 ? "" : "s"} remained aggregate-only. No provider network call occurred.`,
      deterministic: true,
      sourceRefs: included.map((item) => item.snapshotRef),
    };
  },
};
