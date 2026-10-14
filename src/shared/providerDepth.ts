import { z } from "zod";

/**
 * V4-08 Provider-depth contract.
 *
 * The audit is deliberately field based. A connector may be listed in the
 * catalog without every advertised field being retrieved, mapped, or used by
 * an engine. Keeping the evidence at each stage prevents a catalog entry from
 * being mistaken for an integrated provider.
 */
export const PROVIDER_DEPTH_SCHEMA_VERSION = "1" as const;

export const providerDepthStageSchema = z.enum([
  "exposed",
  "retrievable",
  "mapped",
  "visible",
  "engine_integrated",
]);
export type ProviderDepthStage = z.infer<typeof providerDepthStageSchema>;

export const providerDepthMaturitySchema = z.number().int().min(0).max(5);
export type ProviderDepthMaturity = z.infer<typeof providerDepthMaturitySchema>;

export const providerDepthFieldSchema = z.object({
  fieldKey: z.string().trim().min(1).max(300),
  exposed: z.boolean(),
  retrievable: z.boolean(),
  mapped: z.boolean(),
  visible: z.boolean(),
  engineIntegrated: z.boolean(),
  evidence: z.array(z.string().trim().min(1).max(500)).max(20),
  gaps: z.array(z.string().trim().min(1).max(500)).max(20),
}).strict();
export type ProviderDepthField = z.infer<typeof providerDepthFieldSchema>;

export const providerDepthStageCountsSchema = z.object({
  exposed: z.number().int().nonnegative(),
  retrievable: z.number().int().nonnegative(),
  mapped: z.number().int().nonnegative(),
  visible: z.number().int().nonnegative(),
  engineIntegrated: z.number().int().nonnegative(),
}).strict();
export type ProviderDepthStageCounts = z.infer<typeof providerDepthStageCountsSchema>;

export const providerDepthLossSchema = z.object({
  exposedToRetrievable: z.number().int().nonnegative(),
  retrievableToMapped: z.number().int().nonnegative(),
  mappedToVisible: z.number().int().nonnegative(),
  visibleToEngineIntegrated: z.number().int().nonnegative(),
}).strict();
export type ProviderDepthLoss = z.infer<typeof providerDepthLossSchema>;

export const providerDepthMarketingSchema = z.object({
  eligible: z.boolean(),
  reasons: z.array(z.string().trim().min(1).max(500)).max(20),
}).strict();
export type ProviderDepthMarketing = z.infer<typeof providerDepthMarketingSchema>;

export const providerDepthAuditSchema = z.object({
  schemaVersion: z.literal(PROVIDER_DEPTH_SCHEMA_VERSION),
  providerId: z.string().trim().min(1).max(120),
  providerName: z.string().trim().min(1).max(240),
  connectorId: z.string().trim().min(1).max(120).nullable(),
  category: z.string().trim().min(1).max(80),
  sourceType: z.string().trim().min(1).max(80),
  custodyMode: z.string().trim().min(1).max(80),
  adapterImplemented: z.boolean(),
  runtimeState: z.string().trim().min(1).max(80).nullable(),
  maturityLevel: providerDepthMaturitySchema,
  stageCounts: providerDepthStageCountsSchema,
  loss: providerDepthLossSchema,
  fields: z.array(providerDepthFieldSchema).max(2_000),
  evidenceFiles: z.array(z.string().trim().min(1).max(500)).max(100),
  notes: z.array(z.string().trim().min(1).max(1_000)).max(50),
  marketing: providerDepthMarketingSchema,
}).strict();
export type ProviderDepthAudit = z.infer<typeof providerDepthAuditSchema>;

export const providerDepthReportSchema = z.object({
  schemaVersion: z.literal(PROVIDER_DEPTH_SCHEMA_VERSION),
  generatedAt: z.string().datetime({ offset: true }),
  evidencePolicy: z.literal("static-code-evidence"),
  providers: z.array(providerDepthAuditSchema),
  summary: z.object({
    providerCount: z.number().int().nonnegative(),
    totalFieldsExposed: z.number().int().nonnegative(),
    totalFieldsRetrievable: z.number().int().nonnegative(),
    totalFieldsMapped: z.number().int().nonnegative(),
    totalFieldsVisible: z.number().int().nonnegative(),
    totalFieldsEngineIntegrated: z.number().int().nonnegative(),
    marketingEligibleProviderIds: z.array(z.string().trim().min(1).max(120)).max(500),
    blockedProviderIds: z.array(z.string().trim().min(1).max(120)).max(500),
  }).strict(),
}).strict();
export type ProviderDepthReport = z.infer<typeof providerDepthReportSchema>;

export const PROVIDER_DEPTH_STAGES: readonly ProviderDepthStage[] = [
  "exposed",
  "retrievable",
  "mapped",
  "visible",
  "engine_integrated",
] as const;

/** A stable field key is a contract family plus its provider-advertised field. */
export function providerFieldKey(contractFamily: string, field: string): string {
  return `${contractFamily}.${field}`;
}

export function emptyProviderDepthCounts(): ProviderDepthStageCounts {
  return { exposed: 0, retrievable: 0, mapped: 0, visible: 0, engineIntegrated: 0 };
}

/**
 * Maturity is the deepest stage with at least one evidenced field. Level 0 is
 * reserved for a provider with no exposed fields (or a pure catalog target).
 * This is intentionally conservative: a single field reaching a stage does
 * not imply the rest of the provider does.
 */
export function maturityFromStageCounts(counts: ProviderDepthStageCounts): ProviderDepthMaturity {
  if (counts.exposed === 0) return 0;
  if (counts.retrievable === 0) return 1;
  if (counts.mapped === 0) return 2;
  if (counts.visible === 0) return 3;
  if (counts.engineIntegrated === 0) return 4;
  return 5;
}

export function calculateProviderDepthLoss(counts: ProviderDepthStageCounts): ProviderDepthLoss {
  return {
    exposedToRetrievable: Math.max(0, counts.exposed - counts.retrievable),
    retrievableToMapped: Math.max(0, counts.retrievable - counts.mapped),
    mappedToVisible: Math.max(0, counts.mapped - counts.visible),
    visibleToEngineIntegrated: Math.max(0, counts.visible - counts.engineIntegrated),
  };
}

/**
 * Marketing is a separate decision from runtime availability. A provider is
 * not eligible for prominent logo treatment until the audit reaches level 4
 * or 5, has adapter code, and its redistribution/entitlement decision is
 * explicitly known. Unknown licensing is therefore a visible blocker rather
 * than an implicit approval.
 */
export function evaluateProviderMarketingEligibility(input: {
  maturityLevel: ProviderDepthMaturity;
  adapterImplemented: boolean;
  redistribution: "unknown" | "restricted" | "permitted";
  runtimeState?: string | null;
}): ProviderDepthMarketing {
  const reasons: string[] = [];
  if (input.maturityLevel < 4) reasons.push("Provider-depth maturity is below level 4 (visible/usable)." );
  if (!input.adapterImplemented) reasons.push("No adapter is implemented in this build.");
  if (input.redistribution !== "permitted") {
    reasons.push(input.redistribution === "restricted"
      ? "Provider data is license-restricted; confirm the customer's entitlement before marketing it."
      : "Redistribution entitlement is unknown; verify the provider terms before marketing it.");
  }
  if (input.runtimeState === "disabled" || input.runtimeState === "degraded" || input.runtimeState === "rate_limited") {
    reasons.push(`Current runtime state is ${input.runtimeState}.`);
  }
  return { eligible: reasons.length === 0, reasons };
}
