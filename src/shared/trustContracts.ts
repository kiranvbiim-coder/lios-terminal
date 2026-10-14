import { z } from "zod";
import { conversationSourceScopeSchema } from "./sourceScope";
import { canonicalDataRequestSchema } from "./universalDataFabric";

export const trustFreshnessSchema = z.enum([
  "current",
  "delayed",
  "daily",
  "reference",
  "feed",
  "schedule",
  "snapshot",
  "manual",
  "ai_generated",
  "unknown",
]);
export type TrustFreshness = z.infer<typeof trustFreshnessSchema>;

export const trustQualitySchema = z.enum(["high", "medium", "low", "unknown"]);
export type TrustQuality = z.infer<typeof trustQualitySchema>;

export const trustConfidenceSchema = z.enum(["high", "medium", "low", "unknown"]);
export type TrustConfidence = z.infer<typeof trustConfidenceSchema>;

export const trustConflictStateSchema = z.enum([
  "none",
  "not_evaluated_single_source",
  "minor",
  "material",
]);
export type TrustConflictState = z.infer<typeof trustConflictStateSchema>;

/**
 * P3 extends the existing canonical Universal Data Fabric request instead of
 * creating a second provider/request model. Source scope and partial/max-age
 * posture are conversation/trust concerns layered onto that canonical request.
 */
export const universalDataRequestSchema = canonicalDataRequestSchema.extend({
  sourceScope: conversationSourceScopeSchema.default("auto"),
  allowPartial: z.boolean().default(true),
  maxAgeMs: z.number().int().positive().max(365 * 24 * 60 * 60_000).nullable().default(null),
}).strict();
export type UniversalDataRequest = z.infer<typeof universalDataRequestSchema>;
export type UniversalDataRequestInput = z.input<typeof universalDataRequestSchema>;

export const universalProviderCandidateSchema = z.object({
  connectorId: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(300),
  contractFamily: z.string().trim().min(1).max(120),
  fields: z.array(z.string().trim().min(1).max(120)).max(200).default([]),
  coverage: z.string().trim().max(500).nullable().default(null),
  runtimeState: z.enum([
    "catalog_only",
    "adapter_available",
    "credential_configured",
    "live_verified",
    "degraded",
    "rate_limited",
    "disabled",
  ]),
  operational: z.boolean(),
  requiresConnection: z.boolean(),
  rank: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(1_000),
}).strict();
export type UniversalProviderCandidate = z.infer<typeof universalProviderCandidateSchema>;

export const universalDataPlanSchema = z.object({
  schemaVersion: z.literal("1"),
  request: universalDataRequestSchema,
  candidates: z.array(universalProviderCandidateSchema).max(200).default([]),
  selectedCandidateIds: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  availability: z.enum(["ready", "partial", "not_connected", "unavailable", "source_scope_blocked"]),
  missingFields: z.array(z.string().trim().min(1).max(120)).max(200).default([]),
  recoveryActions: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  plannedAt: z.string().datetime({ offset: true }),
}).strict();
export type UniversalDataPlan = z.infer<typeof universalDataPlanSchema>;

export const evidenceObservationSchema = z.object({
  evidenceId: z.string().uuid(),
  sourceRef: z.string().trim().min(1).max(1_000),
  providerId: z.string().trim().max(120).nullable().default(null),
  providerLabel: z.string().trim().min(1).max(300),
  kind: z.enum(["provider", "project", "file", "manual", "engine", "ai", "identity"]),
  observedAt: z.string().datetime({ offset: true }),
  asOf: z.string().datetime({ offset: true }).nullable().default(null),
  freshness: trustFreshnessSchema,
  quality: trustQualitySchema,
  confidence: trustConfidenceSchema,
  connectorState: z.string().trim().max(120).nullable().default(null),
  isFallback: z.boolean().default(false),
  access: z.object({
    state: z.string().trim().min(1).max(120),
    servedTier: z.string().trim().max(120).nullable().default(null),
    bestAvailableTier: z.string().trim().max(120).nullable().default(null),
    entitlementRequired: z.boolean().nullable().default(null),
    upgradeConnectorId: z.string().trim().max(120).nullable().default(null),
    upgradeConnectorLabel: z.string().trim().max(300).nullable().default(null),
    reason: z.string().trim().max(1_000).nullable().default(null),
  }).strict().nullable().default(null),
  fields: z.array(z.string().trim().min(1).max(120)).max(500).default([]),
  valueHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  notes: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
}).strict();
export type EvidenceObservation = z.infer<typeof evidenceObservationSchema>;

export const evidenceConflictSchema = z.object({
  field: z.string().trim().min(1).max(200),
  state: z.enum(["minor", "material"]),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).min(2).max(20),
  relativeDifference: z.number().finite().nonnegative().nullable().default(null),
  summary: z.string().trim().min(1).max(1_000),
}).strict();
export type EvidenceConflict = z.infer<typeof evidenceConflictSchema>;

export const evidenceClaimSchema = z.object({
  claimId: z.string().uuid(),
  label: z.string().trim().min(1).max(300),
  path: z.string().trim().min(1).max(500),
  status: z.enum(["supported", "partial", "unsupported", "conflicted"]),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(200).default([]),
  receiptIds: z.array(z.string().uuid()).max(200).default([]),
  formulaRefs: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
  assumptionRefs: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
  confidence: trustConfidenceSchema,
  explanation: z.string().trim().min(1).max(1_500),
}).strict();
export type EvidenceClaim = z.infer<typeof evidenceClaimSchema>;

export const methodologyStepSchema = z.object({
  step: z.number().int().positive(),
  label: z.string().trim().min(1).max(300),
  componentId: z.string().trim().max(300).nullable().default(null),
  deterministic: z.boolean(),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(200).default([]),
  receiptIds: z.array(z.string().uuid()).max(200).default([]),
  notes: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
}).strict();
export type MethodologyStep = z.infer<typeof methodologyStepSchema>;

export const trustManifestSchema = z.object({
  schemaVersion: z.literal("1"),
  trustId: z.string().uuid(),
  requestId: z.string().uuid(),
  generatedAt: z.string().datetime({ offset: true }),
  sourceScope: conversationSourceScopeSchema,
  summary: z.object({
    freshness: trustFreshnessSchema,
    quality: trustQualitySchema,
    confidence: trustConfidenceSchema,
    conflictState: trustConflictStateSchema,
    evidenceCoveragePct: z.number().min(0).max(100),
    sourceCount: z.number().int().nonnegative(),
    receiptCount: z.number().int().nonnegative(),
    missingCount: z.number().int().nonnegative(),
  }).strict(),
  evidence: z.array(evidenceObservationSchema).max(1_000).default([]),
  claims: z.array(evidenceClaimSchema).max(1_000).default([]),
  conflicts: z.array(evidenceConflictSchema).max(500).default([]),
  methodology: z.array(methodologyStepSchema).max(500).default([]),
  assumptions: z.array(z.object({
    ref: z.string().trim().min(1).max(300),
    label: z.string().trim().min(1).max(300),
    value: z.unknown(),
    source: z.enum(["user", "engine_default", "provider", "project"]),
  }).strict()).max(500).default([]),
  missing: z.array(z.object({
    field: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(1_000),
    recoveryActions: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  }).strict()).max(500).default([]),
  warnings: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
}).strict();
export type TrustManifest = z.infer<typeof trustManifestSchema>;
