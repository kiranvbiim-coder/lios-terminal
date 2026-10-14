import { z } from "zod";
import {
  hiddenEnginePackDataPlaneSchema,
  hiddenEnginePackManifestV1Schema,
  hiddenEnginePackPlatformSchema,
  type HiddenEnginePackManifestV1,
  type HiddenEnginePackPlatform,
} from "./hiddenEnginePackManifest";

export const LIOS_ENGINE_PROTOCOL_VERSION = "1" as const;

export const engineIntegrationDecisionSchema = z.enum([
  "library",
  "vendor",
  "sidecar",
  "connector",
  "reference",
  "reject",
]);
export type EngineIntegrationDecision = z.infer<typeof engineIntegrationDecisionSchema>;

export const engineCapabilityRoleSchema = z.enum(["primary", "validator", "fallback"]);
export type EngineCapabilityRole = z.infer<typeof engineCapabilityRoleSchema>;

export const enginePackInstallStateSchema = z.enum([
  "absent",
  "installable",
  "downloading",
  "verified",
  "installed_inactive",
  "health_check",
  "active",
  "updating",
  "rolled_back",
  "degraded",
  "incompatible",
  "disabled",
  "unavailable",
]);
export type EnginePackInstallState = z.infer<typeof enginePackInstallStateSchema>;

const capabilityPrefixes = new Set([
  "finance",
  "portfolio",
  "pricing",
  "risk",
  "quant",
  "forecast",
  "strategy",
  "backtest",
  "research",
  "document",
  "documents",
  "data",
  "provider",
  "broker",
  "reporting",
  "modeling",
  "local-ai",
]);

export const engineCapabilitySchema = z.string().trim().min(3).max(240).superRefine((value, ctx) => {
  if (!/^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9_-]*)+$/.test(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Capability must be a lowercase dot-qualified identifier.",
    });
    return;
  }
  const prefix = value.split(".", 1)[0];
  if (!capabilityPrefixes.has(prefix)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Capability prefix is not part of the frozen P11 namespace.",
    });
  }
});
export type EngineCapability = z.infer<typeof engineCapabilitySchema>;

export const runtimePackComponentMetadataSchema = z.object({
  packId: z.string().trim().min(1).max(160),
  packVersion: z.string().trim().min(1).max(100),
  adapterVersion: z.string().trim().min(1).max(100),
  inputSchemaVersion: z.string().trim().min(1).max(100),
  outputSchemaVersion: z.string().trim().min(1).max(100),
  supportedPlatforms: z.array(hiddenEnginePackPlatformSchema).min(1).max(12),
  installState: enginePackInstallStateSchema,
  visibility: z.literal("internal"),
  provenance: z.object({
    decision: engineIntegrationDecisionSchema,
    upstreamRepository: z.string().trim().min(1).max(500).nullable().default(null),
    upstreamCommit: z.string().regex(/^[a-f0-9]{40}$/).nullable().default(null),
    license: z.string().trim().min(1).max(160),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.provenance.upstreamCommit && !value.provenance.upstreamRepository) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["provenance", "upstreamRepository"],
      message: "Pinned upstream commit requires an upstream repository.",
    });
  }
});
export type RuntimePackComponentMetadata = z.infer<typeof runtimePackComponentMetadataSchema>;

export const capabilityRouteTargetSchema = z.object({
  componentId: z.string().trim().min(1).max(300),
  packId: z.string().trim().min(1).max(160),
}).strict();
export type CapabilityRouteTarget = z.infer<typeof capabilityRouteTargetSchema>;

export const capabilityRouteSchema = z.object({
  capability: engineCapabilitySchema,
  deterministic: z.boolean(),
  primary: capabilityRouteTargetSchema,
  validator: capabilityRouteTargetSchema.nullable().default(null),
  fallback: capabilityRouteTargetSchema.nullable().default(null),
  entitlement: z.string().trim().min(1).max(160).nullable().default(null),
}).strict().superRefine((value, ctx) => {
  const ids = [value.primary, value.validator, value.fallback]
    .filter((item): item is CapabilityRouteTarget => item !== null)
    .map((item) => item.componentId);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["primary"],
      message: "Primary, validator and fallback components must be distinct.",
    });
  }
});
export type CapabilityRoute = z.infer<typeof capabilityRouteSchema>;

export const packCapabilityAvailabilitySchema = z.object({
  capability: engineCapabilitySchema,
  executionStatus: z.enum(["available", "planned", "deferred", "policy_blocked"]).default("available"),
  offline: z.enum(["full", "local_data_only", "network_required"]),
  requiresUserData: z.boolean().default(false),
  requiresProvider: z.boolean().default(false),
  requiresModelDownload: z.boolean().default(false),
  requiresEntitlement: z.boolean().default(false),
}).strict();
export type PackCapabilityAvailability = z.infer<typeof packCapabilityAvailabilitySchema>;

export const engineDataPlaneRefSchema = z.object({
  schemaVersion: z.literal("1"),
  id: z.string().uuid(),
  format: hiddenEnginePackDataPlaneSchema,
  path: z.string().trim().min(1).max(2_000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative(),
  rows: z.number().int().nonnegative().nullable().default(null),
  immutable: z.literal(true),
}).strict();
export type EngineDataPlaneRef = z.infer<typeof engineDataPlaneRefSchema>;

const lepBase = {
  protocolVersion: z.literal(LIOS_ENGINE_PROTOCOL_VERSION),
  requestId: z.string().uuid(),
};

export const lepHelloSchema = z.object({
  ...lepBase,
  kind: z.literal("hello"),
  packId: z.string().trim().min(1).max(160),
  packVersion: z.string().trim().min(1).max(100),
  componentId: z.string().trim().min(1).max(300),
  componentVersion: z.string().trim().min(1).max(100),
  capabilities: z.array(engineCapabilitySchema).max(1_000),
  schemaVersions: z.object({
    input: z.string().trim().min(1).max(100),
    output: z.string().trim().min(1).max(100),
  }).strict(),
  platform: z.string().trim().min(1).max(100),
  buildHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
}).strict();

export const lepCapabilitiesSchema = z.object({
  ...lepBase,
  kind: z.literal("capabilities"),
  capabilities: z.array(engineCapabilitySchema).max(1_000),
}).strict();

export const lepHealthSchema = z.object({
  ...lepBase,
  kind: z.literal("health"),
  state: z.enum(["available", "degraded", "unavailable"]),
  detail: z.string().trim().min(1).max(2_000),
}).strict();

export const lepExecuteSchema = z.object({
  ...lepBase,
  kind: z.literal("execute"),
  capability: engineCapabilitySchema,
  executionContextRef: z.string().trim().min(1).max(1_000).nullable().default(null),
  inputSchemaVersion: z.string().trim().min(1).max(100),
  outputSchemaVersion: z.string().trim().min(1).max(100),
  dataRefs: z.array(engineDataPlaneRefSchema).max(128).default([]),
  input: z.unknown(),
  deadlineMs: z.number().int().positive().max(24 * 60 * 60 * 1_000),
}).strict();

export const lepProgressSchema = z.object({
  ...lepBase,
  kind: z.literal("progress"),
  fraction: z.number().min(0).max(1),
  message: z.string().trim().min(1).max(1_000).nullable().default(null),
}).strict();

export const lepResultSchema = z.object({
  ...lepBase,
  kind: z.literal("result"),
  capability: engineCapabilitySchema,
  outputSchemaVersion: z.string().trim().min(1).max(100),
  result: z.unknown(),
  dataRefs: z.array(engineDataPlaneRefSchema).max(128).default([]),
}).strict();

export const lepErrorSchema = z.object({
  ...lepBase,
  kind: z.literal("error"),
  code: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(2_000),
  retryable: z.boolean().default(false),
}).strict();

export const lepCancelSchema = z.object({
  ...lepBase,
  kind: z.literal("cancel"),
  targetRequestId: z.string().uuid(),
}).strict();

export const lepDiagnosticsSchema = z.object({
  ...lepBase,
  kind: z.literal("diagnostics"),
  diagnostics: z.record(z.unknown()).default({}),
}).strict();

export const lepShutdownSchema = z.object({
  ...lepBase,
  kind: z.literal("shutdown"),
  reason: z.string().trim().min(1).max(500).default("requested"),
}).strict();

export const lepMessageSchema = z.discriminatedUnion("kind", [
  lepHelloSchema,
  lepCapabilitiesSchema,
  lepHealthSchema,
  lepExecuteSchema,
  lepProgressSchema,
  lepResultSchema,
  lepErrorSchema,
  lepCancelSchema,
  lepDiagnosticsSchema,
  lepShutdownSchema,
]);
export type LepMessage = z.infer<typeof lepMessageSchema>;

export const engineSemanticConventionsSchema = z.object({
  timezone: z.string().trim().min(1).max(100).default("UTC"),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).nullable().default(null),
  scale: z.number().finite().positive().default(1),
  frequency: z.string().trim().min(1).max(80).nullable().default(null),
  calendar: z.string().trim().min(1).max(120).nullable().default(null),
  dayCount: z.string().trim().min(1).max(120).nullable().default(null),
  adjustedPrices: z.boolean().nullable().default(null),
  asOf: z.string().datetime({ offset: true }).nullable().default(null),
  asKnownOn: z.string().datetime({ offset: true }).nullable().default(null),
}).strict();
export type EngineSemanticConventions = z.infer<typeof engineSemanticConventionsSchema>;

export const canonicalEngineResultSchema = z.object({
  schemaVersion: z.literal("1"),
  capability: engineCapabilitySchema,
  packId: z.string().trim().min(1).max(160),
  componentId: z.string().trim().min(1).max(300),
  engineVersion: z.string().trim().min(1).max(100),
  deterministic: z.boolean(),
  output: z.unknown(),
  dataRefs: z.array(engineDataPlaneRefSchema).max(128).default([]),
  semanticConventions: engineSemanticConventionsSchema,
  warnings: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
  receiptRef: z.string().trim().min(1).max(1_000).nullable().default(null),
}).strict();
export type CanonicalEngineResult = z.infer<typeof canonicalEngineResultSchema>;

export const engineValidationPolicySchema = z.object({
  absoluteTolerance: z.number().finite().nonnegative().default(1e-9),
  relativeTolerance: z.number().finite().nonnegative().default(1e-6),
  units: z.string().trim().min(1).max(80).nullable().default(null),
  conventionsRef: z.string().trim().min(1).max(500).nullable().default(null),
}).strict();
export type EngineValidationPolicy = z.infer<typeof engineValidationPolicySchema>;

export const engineValidationResultSchema = z.object({
  state: z.enum(["match", "discrepancy"]),
  primary: z.number().finite(),
  validator: z.number().finite(),
  absoluteDifference: z.number().finite().nonnegative(),
  relativeDifference: z.number().finite().nonnegative(),
  policy: engineValidationPolicySchema,
}).strict();
export type EngineValidationResult = z.infer<typeof engineValidationResultSchema>;

function parseSemver(value: string): [number, number, number] | null {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemver(a: string, b: string): number {
  const av = parseSemver(a);
  const bv = parseSemver(b);
  if (!av || !bv) throw new Error("P11 compatibility requires semantic versions.");
  for (let i = 0; i < 3; i += 1) {
    if (av[i] !== bv[i]) return av[i] < bv[i] ? -1 : 1;
  }
  return 0;
}

export function isPackCompatible(
  manifestInput: HiddenEnginePackManifestV1,
  coreVersion: string,
  platform: HiddenEnginePackPlatform,
): { compatible: boolean; reason: string } {
  const manifest = hiddenEnginePackManifestV1Schema.parse(manifestInput);
  if (!manifest.platforms.includes(platform)) {
    return { compatible: false, reason: `Pack does not support ${platform}.` };
  }
  if (compareSemver(coreVersion, manifest.liosCore.min) < 0) {
    return { compatible: false, reason: `LiOS Core ${coreVersion} is below pack minimum ${manifest.liosCore.min}.` };
  }
  if (compareSemver(coreVersion, manifest.liosCore.maxExclusive) >= 0) {
    return { compatible: false, reason: `LiOS Core ${coreVersion} is outside pack range < ${manifest.liosCore.maxExclusive}.` };
  }
  return { compatible: true, reason: "compatible" };
}

export function compareEngineScalars(
  primary: number,
  validator: number,
  policyInput: Partial<EngineValidationPolicy> = {},
): EngineValidationResult {
  if (!Number.isFinite(primary) || !Number.isFinite(validator)) {
    throw new Error("Engine validation values must be finite.");
  }
  const policy = engineValidationPolicySchema.parse(policyInput);
  const absoluteDifference = Math.abs(primary - validator);
  const denominator = Math.max(Math.abs(primary), Math.abs(validator), Number.EPSILON);
  const relativeDifference = absoluteDifference / denominator;
  const state = absoluteDifference <= policy.absoluteTolerance || relativeDifference <= policy.relativeTolerance
    ? "match"
    : "discrepancy";
  return engineValidationResultSchema.parse({
    state,
    primary,
    validator,
    absoluteDifference,
    relativeDifference,
    policy,
  });
}
