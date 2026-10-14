import { z } from "zod";

export const P5_DATA_FABRIC_VERSION = "1" as const;

export const canonicalDataCapabilitySchema = z.enum([
  "security_resolution",
  "prices",
  "statements",
  "estimates",
  "filings",
  "options",
  "curves",
  "macro",
  "fx",
  "portfolios",
  "transactions",
  "provider_extension",
]);
export type CanonicalDataCapability = z.infer<typeof canonicalDataCapabilitySchema>;

export const providerSdkOperationSchema = z.enum([
  "capability",
  "search",
  "fetch",
  "stream",
  "health",
  "quota",
  "entitlement",
  "normalize",
]);
export type ProviderSdkOperation = z.infer<typeof providerSdkOperationSchema>;

export const pointInTimeModeSchema = z.enum(["latest", "as_known_on", "revision_exact"]);
export type PointInTimeMode = z.infer<typeof pointInTimeModeSchema>;

export const pointInTimePolicySchema = z.object({
  mode: pointInTimeModeSchema.default("latest"),
  asKnownOn: z.string().datetime({ offset: true }).nullable().default(null),
  revision: z.string().trim().min(1).max(240).nullable().default(null),
  requirePublicationTime: z.boolean().default(false),
  allowLaterRevisions: z.boolean().default(false),
}).strict().superRefine((value, ctx) => {
  if (value.mode === "as_known_on" && !value.asKnownOn) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["asKnownOn"], message: "as_known_on requires an asKnownOn timestamp." });
  }
  if (value.mode === "revision_exact" && !value.revision) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["revision"], message: "revision_exact requires a revision identifier." });
  }
});
export type PointInTimePolicy = z.infer<typeof pointInTimePolicySchema>;

export const providerQuotaSchema = z.object({
  limit: z.number().int().nonnegative().nullable(),
  remaining: z.number().int().nonnegative().nullable(),
  resetAt: z.string().datetime({ offset: true }).nullable(),
  retryAfterMs: z.number().int().nonnegative().nullable(),
  source: z.enum(["response_headers", "provider_config", "unknown"]),
}).strict();
export type ProviderQuota = z.infer<typeof providerQuotaSchema>;

export const providerHealthSchema = z.object({
  state: z.enum(["unknown", "healthy", "degraded", "rate_limited", "unreachable", "disabled"]),
  checkedAt: z.string().datetime({ offset: true }),
  latencyMs: z.number().nonnegative().nullable(),
  detail: z.string().trim().max(2_000).nullable(),
}).strict();
export type ProviderHealth = z.infer<typeof providerHealthSchema>;

export const providerEntitlementDecisionSchema = z.object({
  decision: z.enum(["allowed", "denied", "unknown"]),
  policyId: z.string().trim().max(240).nullable(),
  permittedUses: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  reasons: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
}).strict();
export type ProviderEntitlementDecision = z.infer<typeof providerEntitlementDecisionSchema>;

export const providerAuthModeSchema = z.enum(["none", "secret_ref", "oauth", "user_session", "local_state", "unknown"]);
export type ProviderAuthMode = z.infer<typeof providerAuthModeSchema>;

export const providerDataLocalitySchema = z.enum(["lios_local", "user_owned", "remote_provider", "mixed", "unknown"]);
export type ProviderDataLocality = z.infer<typeof providerDataLocalitySchema>;

export const providerUseRightSchema = z.enum(["permitted", "restricted", "unknown"]);
export type ProviderUseRight = z.infer<typeof providerUseRightSchema>;

export const providerAccessProfileSchema = z.object({
  authMode: providerAuthModeSchema.default("unknown"),
  credentialRequirement: z.enum(["required", "not_required", "unknown"]).default("unknown"),
  locality: providerDataLocalitySchema.default("unknown"),
  aiTransmission: providerUseRightSchema.default("unknown"),
  internalUse: providerUseRightSchema.default("unknown"),
  redistribution: providerUseRightSchema.default("unknown"),
  notes: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
}).strict();
export type ProviderAccessProfile = z.infer<typeof providerAccessProfileSchema>;

export const providerAccessPostureSchema = z.object({
  providerId: z.string().trim().min(1).max(120),
  capability: canonicalDataCapabilitySchema,
  availability: z.object({
    state: z.enum(["available", "unavailable", "degraded", "unknown"]),
    reason: z.enum([
      "returned",
      "not_evaluated",
      "empty",
      "unsupported_point_in_time",
      "entitlement_denied",
      "quota_exhausted",
      "rate_limited",
      "mapping_required",
      "policy_denied",
      "provider_failed",
      "unknown",
    ]),
    detail: z.string().trim().max(2_000).nullable().default(null),
  }).strict(),
  authentication: z.object({
    mode: providerAuthModeSchema,
    credentialRequirement: z.enum(["required", "not_required", "unknown"]),
    secretMaterialExposed: z.literal(false),
  }).strict(),
  locality: providerDataLocalitySchema,
  entitlement: providerEntitlementDecisionSchema,
  rights: z.object({
    aiTransmission: providerUseRightSchema,
    internalUse: providerUseRightSchema,
    redistribution: providerUseRightSchema,
  }).strict(),
  pointInTime: z.object({
    requestedMode: pointInTimeModeSchema,
    supportedModes: z.array(pointInTimeModeSchema).max(10),
    compatible: z.boolean(),
  }).strict(),
  notes: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
}).strict();
export type ProviderAccessPosture = z.infer<typeof providerAccessPostureSchema>;

export const canonicalDataRequestSchema = z.object({
  schemaVersion: z.literal(P5_DATA_FABRIC_VERSION),
  requestId: z.string().uuid(),
  projectId: z.number().int().positive().nullable().default(null),
  capability: canonicalDataCapabilitySchema,
  entity: z.object({
    ref: z.string().trim().min(1).max(500),
    symbol: z.string().trim().max(80).nullable().default(null),
    identifiers: z.record(z.string().trim().max(500)).default({}),
  }).strict(),
  fields: z.array(z.string().trim().min(1).max(500)).max(2_000).default([]),
  parameters: z.record(z.unknown()).default({}),
  pointInTime: pointInTimePolicySchema.default({ mode: "latest", asKnownOn: null, revision: null, requirePublicationTime: false, allowLaterRevisions: false }),
  providerAllow: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  providerDeny: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
}).strict();
export type CanonicalDataRequest = z.infer<typeof canonicalDataRequestSchema>;

export const providerAttemptSchema = z.object({
  providerId: z.string().trim().min(1).max(120),
  status: z.enum(["returned", "empty", "unsupported", "entitlement_denied", "quota_exhausted", "rate_limited", "stale_only", "mapping_required", "policy_denied", "failed"]),
  detail: z.string().trim().max(2_000).nullable().default(null),
  latencyMs: z.number().nonnegative().nullable().default(null),
  quota: providerQuotaSchema.nullable().default(null),
  entitlement: providerEntitlementDecisionSchema.nullable().default(null),
}).strict();
export type ProviderAttempt = z.infer<typeof providerAttemptSchema>;

export const structuredDataGapSchema = z.object({
  schemaVersion: z.literal(P5_DATA_FABRIC_VERSION),
  capability: canonicalDataCapabilitySchema,
  entityRef: z.string().trim().min(1).max(500),
  reason: z.enum([
    "unavailable",
    "unsupported",
    "entitlement_required",
    "quota_exhausted",
    "rate_limited",
    "stale_only",
    "point_in_time_unavailable",
    "mapping_required",
    "provider_error",
    "policy_denied",
  ]),
  providersChecked: z.array(providerAttemptSchema).max(100),
  requestedPointInTime: pointInTimePolicySchema,
  nextActions: z.array(z.object({
    action: z.enum(["connect_provider", "review_entitlement", "adjust_as_known_on", "confirm_mapping", "retry_later", "use_alternate_source", "import_data"]),
    providerId: z.string().trim().max(120).nullable().default(null),
    label: z.string().trim().min(1).max(500),
  }).strict()).max(20).default([]),
}).strict();
export type StructuredDataGap = z.infer<typeof structuredDataGapSchema>;

export const providerObservationSchema = z.object({
  providerId: z.string().trim().min(1).max(120),
  capability: canonicalDataCapabilitySchema,
  entityRef: z.string().trim().min(1).max(500),
  data: z.unknown(),
  sourceRefs: z.array(z.string().trim().min(1).max(2_000)).max(2_000).default([]),
  clocks: z.object({
    effectiveAt: z.string().datetime({ offset: true }).nullable(),
    publishedAt: z.string().datetime({ offset: true }).nullable(),
    retrievedAt: z.string().datetime({ offset: true }),
    availableAt: z.string().datetime({ offset: true }).nullable(),
  }).strict(),
  revision: z.string().trim().max(240).nullable(),
  quota: providerQuotaSchema.nullable(),
  entitlement: providerEntitlementDecisionSchema,
  normalized: z.boolean(),
  warnings: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
}).strict();
export type ProviderObservation = z.infer<typeof providerObservationSchema>;

export const canonicalDataResponseSchema = z.object({
  schemaVersion: z.literal(P5_DATA_FABRIC_VERSION),
  requestId: z.string().uuid(),
  capability: canonicalDataCapabilitySchema,
  entityRef: z.string().trim().min(1).max(500),
  observation: providerObservationSchema.nullable(),
  observations: z.array(providerObservationSchema).max(100).default([]),
  attempts: z.array(providerAttemptSchema).max(100).default([]),
  accessPostures: z.array(providerAccessPostureSchema).max(100).default([]),
  gap: structuredDataGapSchema.nullable(),
  resolvedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, ctx) => {
  if (!value.observation && !value.gap) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gap"], message: "A missing observation must return a structured data gap." });
  }
});
export type CanonicalDataResponse = z.infer<typeof canonicalDataResponseSchema>;

export const coverageLedgerSnapshotSchema = z.object({
  schemaVersion: z.literal(P5_DATA_FABRIC_VERSION),
  generatedAt: z.string().datetime({ offset: true }),
  realUniverseSize: z.number().int().nonnegative(),
  indexedUniverseSize: z.number().int().nonnegative(),
  capacityProofSize: z.number().int().nonnegative(),
  warmSearchP95Ms: z.number().nonnegative().nullable(),
  providers: z.number().int().nonnegative(),
  implementedProviders: z.number().int().nonnegative(),
  capabilityFamilies: z.number().int().nonnegative(),
  fieldStages: z.object({
    exposed: z.number().int().nonnegative(),
    retrievable: z.number().int().nonnegative(),
    mapped: z.number().int().nonnegative(),
    visible: z.number().int().nonnegative(),
    engineIntegrated: z.number().int().nonnegative(),
  }).strict(),
  gaps: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
}).strict();
export type CoverageLedgerSnapshot = z.infer<typeof coverageLedgerSnapshotSchema>;

export const semanticMetricDefinitionSchema = z.object({
  schemaVersion: z.literal(P5_DATA_FABRIC_VERSION),
  metricId: z.string().trim().min(1).max(240),
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(240),
  description: z.string().trim().max(2_000).default(""),
  category: z.string().trim().min(1).max(120),
  unit: z.string().trim().max(120).nullable().default(null),
  aliases: z.array(z.string().trim().min(1).max(240)).max(100).default([]),
  formula: z.string().trim().max(4_000).nullable().default(null),
  sourcePolicy: z.object({
    preferredCapabilities: z.array(canonicalDataCapabilitySchema).max(20).default([]),
    preferredProviders: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
    pointInTimeRequired: z.boolean().default(false),
  }).strict(),
  status: z.enum(["active", "deprecated"]).default("active"),
}).strict();
export type SemanticMetricDefinition = z.infer<typeof semanticMetricDefinitionSchema>;

export const dataQualityReportSchema = z.object({
  schemaVersion: z.literal(P5_DATA_FABRIC_VERSION),
  datasetRef: z.string().trim().min(1).max(500),
  score: z.number().min(0).max(1),
  dimensions: z.object({
    completeness: z.number().min(0).max(1),
    validity: z.number().min(0).max(1),
    consistency: z.number().min(0).max(1),
    uniqueness: z.number().min(0).max(1),
    freshness: z.number().min(0).max(1),
    pointInTimeIntegrity: z.number().min(0).max(1),
  }).strict(),
  issues: z.array(z.object({
    code: z.string().trim().min(1).max(120),
    severity: z.enum(["info", "warning", "critical"]),
    field: z.string().trim().max(500).nullable().default(null),
    detail: z.string().trim().min(1).max(2_000),
  }).strict()).max(2_000).default([]),
  checkedAt: z.string().datetime({ offset: true }),
}).strict();
export type DataQualityReport = z.infer<typeof dataQualityReportSchema>;

export const dataLineageStageSchema = z.object({
  stage: z.enum(["connector", "normalization", "mapping", "engine", "artifact", "export"]),
  componentId: z.string().trim().min(1).max(240),
  inputRefs: z.array(z.string().trim().min(1).max(2_000)).max(2_000).default([]),
  outputRefs: z.array(z.string().trim().min(1).max(2_000)).max(2_000).default([]),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  at: z.string().datetime({ offset: true }),
  metadata: z.record(z.unknown()).default({}),
}).strict();
export type DataLineageStage = z.infer<typeof dataLineageStageSchema>;

export const dataLineageReceiptSchema = z.object({
  schemaVersion: z.literal(P5_DATA_FABRIC_VERSION),
  id: z.string().uuid(),
  projectId: z.number().int().positive().nullable(),
  requestId: z.string().uuid().nullable(),
  capability: canonicalDataCapabilitySchema,
  entityRef: z.string().trim().min(1).max(500),
  pointInTime: pointInTimePolicySchema,
  stages: z.array(dataLineageStageSchema).min(1).max(100),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type DataLineageReceipt = z.infer<typeof dataLineageReceiptSchema>;

export const streamingLifecycleSchema = z.object({
  id: z.string().uuid(),
  providerId: z.string().trim().min(1).max(120),
  capability: canonicalDataCapabilitySchema,
  state: z.enum(["connecting", "streaming", "polling", "degraded", "stopped"]),
  transport: z.enum(["websocket", "sse", "polling"]),
  pollIntervalMs: z.number().int().min(1_000).max(86_400_000).nullable(),
  quota: providerQuotaSchema.nullable(),
  lastEventAt: z.string().datetime({ offset: true }).nullable(),
  reason: z.string().trim().max(1_000).nullable(),
}).strict();
export type StreamingLifecycle = z.infer<typeof streamingLifecycleSchema>;

export const mcpClientPolicySchema = z.object({
  projectId: z.number().int().positive(),
  serverId: z.string().trim().min(1).max(240),
  allowedToolIds: z.array(z.string().trim().min(1).max(300)).max(500).default([]),
  allowedResourcePrefixes: z.array(z.string().trim().min(1).max(500)).max(500).default([]),
  credentialRef: z.string().trim().max(240).nullable(),
  requireApprovalForTools: z.boolean().default(true),
  healthTimeoutMs: z.number().int().min(500).max(30_000).default(5_000),
}).strict();
export type McpClientPolicy = z.infer<typeof mcpClientPolicySchema>;

export const mcpServerExposureContractSchema = z.object({
  version: z.literal("1"),
  exposedTools: z.array(z.string().trim().min(1).max(300)).max(500).default([]),
  exposedResources: z.array(z.string().trim().min(1).max(500)).max(500).default([]),
  filesystemExposure: z.literal(false),
  secretExposure: z.literal(false),
  internalStateExposure: z.literal(false),
  tenantScoped: z.literal(true),
}).strict();
export type McpServerExposureContract = z.infer<typeof mcpServerExposureContractSchema>;

export const browserConnectorPolicySchema = z.object({
  projectId: z.number().int().positive(),
  allowedDomains: z.array(z.string().trim().min(1).max(253)).min(1).max(100),
  allowDownloads: z.boolean().default(false),
  downloadMaxBytes: z.number().int().nonnegative().max(100_000_000).default(0),
  filesystemWriteRoots: z.array(z.string().trim().min(1).max(1_000)).max(10).default([]),
  navigationTimeoutMs: z.number().int().min(1_000).max(120_000).default(30_000),
  maxPages: z.number().int().min(1).max(10).default(1),
}).strict();
export type BrowserConnectorPolicy = z.infer<typeof browserConnectorPolicySchema>;

export const externalRightsSchema = z.object({
  softwareLicense: z.object({
    spdx: z.string().trim().min(1).max(120).nullable(),
    reviewed: z.boolean(),
  }).strict(),
  apiTerms: z.object({
    provider: z.string().trim().min(1).max(240),
    reviewed: z.boolean(),
    termsUrl: z.string().url().nullable(),
  }).strict(),
  dataRights: z.object({
    redistribution: z.enum(["unknown", "restricted", "permitted"]),
    internalUse: z.enum(["unknown", "restricted", "permitted"]),
    attributionRequired: z.boolean(),
  }).strict(),
  trademarkReviewed: z.boolean(),
}).strict();
export type ExternalRights = z.infer<typeof externalRightsSchema>;
