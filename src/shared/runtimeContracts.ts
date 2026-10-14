import { z } from "zod";
import { artifactActionSchema, artifactKindSchema } from "./artifactContracts";

export const LIOS_RUNTIME_CONTRACT_VERSION = "1" as const;

export const runtimeComponentKindSchema = z.enum([
  "ai_provider",
  "data_provider",
  "connector",
  "tool",
  "agent",
  "artifact_renderer",
  "backtest_engine",
  "finance_engine",
  "workspace_adapter",
  "job_runtime",
  "permission_policy",
  "plugin",
  "skill",
  "runtime_pack",
  // GM-02 provider seams (blueprint §5). Descriptors only: behavioural
  // interfaces are defined by the owning GM task when first implemented.
  "database_provider",
  "storage_provider",
  "secret_provider",
  "execution_backend",
  "identity_provider",
  "license_provider",
  "network_provider",
  "backup_provider",
  "notification_provider",
  "browser_provider",
]);
export type RuntimeComponentKind = z.infer<typeof runtimeComponentKindSchema>;

export const runtimeLifecycleSchema = z.enum([
  "builtin",
  "managed",
  "optional",
  "external",
  "donor_candidate",
]);
export type RuntimeLifecycle = z.infer<typeof runtimeLifecycleSchema>;

export const runtimeExecutionScopeSchema = z.enum([
  "renderer",
  "electron_main",
  "node_worker",
  "python_sidecar",
  "external_process",
  "local_api",
  "remote_api",
  "declarative",
]);
export type RuntimeExecutionScope = z.infer<typeof runtimeExecutionScopeSchema>;

export const runtimeHealthStateSchema = z.enum([
  "available",
  "configurable",
  "not_installed",
  "degraded",
  "unavailable",
  "disabled",
]);
export type RuntimeHealthState = z.infer<typeof runtimeHealthStateSchema>;

export const runtimePermissionClassSchema = z.enum([
  "safe_auto",
  "user_confirm",
  "admin_confirm",
  "denied",
]);
export type RuntimePermissionClass = z.infer<typeof runtimePermissionClassSchema>;

const runtimeIdSchema = z.string().trim().min(1).max(300).regex(/^[a-z0-9][a-z0-9._:-]*$/);
const runtimeVersionSchema = z.string().trim().min(1).max(100);
const runtimeReferenceSchema = z.union([
  z.string().trim().min(1).max(300),
  z.number().int().nonnegative(),
]);

export const runtimeSourceSchema = z.object({
  origin: z.enum(["lios", "oss", "user", "external"]),
  repository: z.string().trim().min(1).max(500).optional(),
  commitSha: z.string().regex(/^[a-f0-9]{40}$/).optional(),
  license: z.string().trim().min(1).max(120).optional(),
  importedPaths: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
  modified: z.boolean().default(false),
}).strict().superRefine((value, ctx) => {
  if (value.commitSha && !value.repository) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["repository"],
      message: "A pinned commit requires an upstream repository.",
    });
  }
  if (value.origin === "oss" && (!value.repository || !value.license)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["origin"],
      message: "OSS runtime sources require repository and license metadata.",
    });
  }
});
export type RuntimeSource = z.infer<typeof runtimeSourceSchema>;

export const runtimeComponentDescriptorSchema = z.object({
  contractVersion: z.literal(LIOS_RUNTIME_CONTRACT_VERSION),
  id: runtimeIdSchema,
  kind: runtimeComponentKindSchema,
  name: z.string().trim().min(1).max(300),
  version: runtimeVersionSchema,
  lifecycle: runtimeLifecycleSchema,
  executionScopes: z.array(runtimeExecutionScopeSchema).min(1).max(8),
  capabilities: z.array(runtimeIdSchema).max(500).default([]),
  permissions: z.array(runtimeIdSchema).max(200).default([]),
  runtimePackId: runtimeIdSchema.nullable().default(null),
  replaceable: z.boolean().default(true),
  source: runtimeSourceSchema,
}).strict().superRefine((value, ctx) => {
  if (new Set(value.executionScopes).size !== value.executionScopes.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["executionScopes"],
      message: "Execution scopes must be unique.",
    });
  }
  if (new Set(value.capabilities).size !== value.capabilities.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["capabilities"],
      message: "Runtime capabilities must be unique.",
    });
  }
});
export type RuntimeComponentDescriptor = z.infer<typeof runtimeComponentDescriptorSchema>;

export const runtimeHealthReportSchema = z.object({
  componentId: runtimeIdSchema,
  state: runtimeHealthStateSchema,
  detail: z.string().trim().min(1).max(2_000),
  checkedAt: z.string().datetime({ offset: true }),
}).strict();
export type RuntimeHealthReport = z.infer<typeof runtimeHealthReportSchema>;

export const runtimeExecutionContextSchema = z.object({
  requestId: z.string().uuid(),
  userId: z.number().int().positive().nullable().default(null),
  organizationId: z.number().int().positive().nullable().default(null),
  projectId: runtimeReferenceSchema.nullable().default(null),
  sessionId: runtimeReferenceSchema.nullable().default(null),
  conversationId: runtimeReferenceSchema.nullable().default(null),
  activeObjectId: runtimeReferenceSchema.nullable().default(null),
  dataClassification: z.enum(["public", "organization", "private"]).default("private"),
  approvedActions: z.array(runtimeIdSchema).max(500).default([]),
}).strict();
export type RuntimeExecutionContext = z.infer<typeof runtimeExecutionContextSchema>;

export const runtimeActionRequestSchema = z.object({
  id: runtimeIdSchema,
  componentId: runtimeIdSchema,
  action: runtimeIdSchema,
  permissionClass: runtimePermissionClassSchema,
  reversible: z.boolean().default(false),
  externalSideEffect: z.boolean().default(false),
  targetRef: runtimeReferenceSchema.nullable().default(null),
  summary: z.string().trim().min(1).max(1_000),
  arguments: z.record(z.unknown()).default({}),
}).strict().superRefine((value, ctx) => {
  if (value.permissionClass === "safe_auto" && value.externalSideEffect) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["permissionClass"],
      message: "Actions with external side effects cannot be SAFE_AUTO.",
    });
  }
});
export type RuntimeActionRequest = z.infer<typeof runtimeActionRequestSchema>;

export const runtimePermissionDecisionSchema = z.object({
  actionId: runtimeIdSchema,
  decision: z.enum(["allow", "confirm", "deny"]),
  policyClass: runtimePermissionClassSchema,
  reason: z.string().trim().min(1).max(2_000),
  scope: z.enum(["request", "session", "project", "organization"]),
  expiresAt: z.string().datetime({ offset: true }).nullable().default(null),
}).strict().superRefine((value, ctx) => {
  if (value.policyClass === "denied" && value.decision !== "deny") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["decision"],
      message: "DENIED policy class must resolve to deny.",
    });
  }
  if (value.policyClass === "safe_auto" && value.decision === "confirm") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["decision"],
      message: "SAFE_AUTO actions must not require confirmation.",
    });
  }
});
export type RuntimePermissionDecision = z.infer<typeof runtimePermissionDecisionSchema>;

export const runtimeExecutionReceiptSchema = z.object({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  componentId: runtimeIdSchema,
  operation: runtimeIdSchema,
  status: z.enum(["completed", "failed", "cancelled"]),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  deterministic: z.boolean(),
  aiDerived: z.boolean(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  outputHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  inputEvidence: z.record(z.unknown()).nullable().default(null),
  outputEvidence: z.record(z.unknown()).nullable().default(null),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
  warnings: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
}).strict().superRefine((value, ctx) => {
  if (value.deterministic && value.aiDerived) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["aiDerived"],
      message: "A receipt cannot label the same result both deterministic and AI-derived.",
    });
  }
  if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["completedAt"],
      message: "completedAt must not precede startedAt.",
    });
  }
});
export type RuntimeExecutionReceipt = z.infer<typeof runtimeExecutionReceiptSchema>;

export const artifactEnvelopeSchema = z.object({
  schemaVersion: z.literal("1"),
  artifactId: runtimeReferenceSchema,
  artifactType: artifactKindSchema,
  projectId: runtimeReferenceSchema,
  sessionId: runtimeReferenceSchema.nullable().default(null),
  branchId: runtimeReferenceSchema.nullable().default(null),
  version: z.number().int().positive(),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(1_000).default([]),
  executionReceiptIds: z.array(z.string().uuid()).max(500).default([]),
  assumptionRefs: z.array(z.string().trim().min(1).max(500)).max(500).default([]),
  supportedActions: z.array(artifactActionSchema).max(200).default([]),
}).strict();
export type ArtifactEnvelope = z.infer<typeof artifactEnvelopeSchema>;

export const workspaceSessionEnvelopeSchema = z.object({
  schemaVersion: z.literal("1"),
  projectId: runtimeReferenceSchema,
  sessionId: runtimeReferenceSchema,
  parentSessionId: runtimeReferenceSchema.nullable().default(null),
  conversationId: runtimeReferenceSchema.nullable().default(null),
  workspaceAdapterId: runtimeIdSchema.nullable().default(null),
  layoutVersion: z.string().trim().min(1).max(100).nullable().default(null),
  activeArtifactIds: z.array(runtimeReferenceSchema).max(500).default([]),
  sourcePolicyRef: z.string().trim().min(1).max(500).nullable().default(null),
  strategyRef: z.string().trim().min(1).max(500).nullable().default(null),
  backtestRef: z.string().trim().min(1).max(500).nullable().default(null),
}).strict().superRefine((value, ctx) => {
  if (value.parentSessionId !== null && String(value.parentSessionId) === String(value.sessionId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["parentSessionId"],
      message: "A session cannot be its own parent.",
    });
  }
});
export type WorkspaceSessionEnvelope = z.infer<typeof workspaceSessionEnvelopeSchema>;

export const runtimeJobSchema = z.object({
  schemaVersion: z.literal("1"),
  jobId: z.string().uuid(),
  kind: runtimeIdSchema,
  componentId: runtimeIdSchema,
  state: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  createdAt: z.string().datetime({ offset: true }),
  startedAt: z.string().datetime({ offset: true }).nullable().default(null),
  completedAt: z.string().datetime({ offset: true }).nullable().default(null),
  cancellable: z.boolean().default(true),
  checkpointRef: z.string().trim().min(1).max(1_000).nullable().default(null),
}).strict();
export type RuntimeJob = z.infer<typeof runtimeJobSchema>;

export const backtestRequestSchema = z.object({
  schemaVersion: z.literal("1"),
  strategyRef: z.string().trim().min(1).max(1_000),
  instrumentRefs: z.array(z.string().trim().min(1).max(300)).min(1).max(10_000),
  startDate: z.string().date(),
  endDate: z.string().date(),
  frequency: z.string().trim().min(1).max(80),
  startingCapital: z.number().finite().positive(),
  benchmarkRef: z.string().trim().min(1).max(300).nullable().default(null),
  assumptions: z.object({
    feesBps: z.number().finite().nonnegative().default(0),
    slippageBps: z.number().finite().nonnegative().default(0),
    seed: z.number().int().nullable().default(null),
  }).strict(),
  pointInTimeRequired: z.boolean().default(true),
}).strict().superRefine((value, ctx) => {
  if (value.startDate > value.endDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: "Backtest endDate must be on or after startDate.",
    });
  }
});
export type BacktestRequest = z.infer<typeof backtestRequestSchema>;

export const backtestResultSchema = z.object({
  schemaVersion: z.literal("1"),
  engineId: runtimeIdSchema,
  reproducibilityId: z.string().uuid(),
  equityCurveRef: z.string().trim().min(1).max(1_000),
  tradesRef: z.string().trim().min(1).max(1_000),
  metrics: z.record(z.number().finite()).default({}),
  benchmarkRef: z.string().trim().min(1).max(1_000).nullable().default(null),
  pointInTimeVerified: z.boolean(),
  warnings: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
}).strict();
export type BacktestResult = z.infer<typeof backtestResultSchema>;

export const financeEngineRequestSchema = z.object({
  schemaVersion: z.literal("1"),
  operation: runtimeIdSchema,
  inputRefs: z.array(z.string().trim().min(1).max(1_000)).max(1_000).default([]),
  parameters: z.record(z.unknown()).default({}),
  asOf: z.string().date().nullable().default(null),
  seed: z.number().int().nullable().default(null),
}).strict();
export type FinanceEngineRequest = z.infer<typeof financeEngineRequestSchema>;

export const financeEngineResultSchema = z.object({
  schemaVersion: z.literal("1"),
  engineId: runtimeIdSchema,
  outputRef: z.string().trim().min(1).max(1_000),
  deterministic: z.literal(true),
  warnings: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
}).strict();
export type FinanceEngineResult = z.infer<typeof financeEngineResultSchema>;

export interface RuntimeAdapter {
  descriptor: RuntimeComponentDescriptor;
  health?: () => Promise<RuntimeHealthReport> | RuntimeHealthReport;
}

export interface ToolAdapter extends RuntimeAdapter {
  invoke: (
    input: Record<string, unknown>,
    context: RuntimeExecutionContext,
  ) => Promise<unknown>;
}

/**
 * A skill is a reusable, permission-bound procedure the agent can select (SI-02.16). It carries no executable code:
 * everything it does goes through the governed tool registry, and it may only name tools it declares here.
 */
export interface SkillDefinition {
  skillId: string;
  description: string;
  requiredInputs: string[];
  supportedObjectKinds: string[];
  /** Governed tool ids this skill may invoke. Empty means the skill is descriptive and can invoke nothing. */
  toolIds: string[];
}

export interface SkillAdapter extends RuntimeAdapter {
  definition: SkillDefinition;
}

export interface AgentAdapter extends RuntimeAdapter {
  run: (
    input: Record<string, unknown>,
    context: RuntimeExecutionContext,
  ) => Promise<unknown>;
  cancel?: (requestId: string) => Promise<void> | void;
}

export interface BacktestEngineAdapter extends RuntimeAdapter {
  runBacktest: (
    request: BacktestRequest,
    context: RuntimeExecutionContext,
  ) => Promise<BacktestResult>;
}

export interface FinanceEngineAdapter extends RuntimeAdapter {
  runFinance: (
    request: FinanceEngineRequest,
    context: RuntimeExecutionContext,
  ) => Promise<FinanceEngineResult>;
}

export interface PermissionPolicyAdapter extends RuntimeAdapter {
  authorize: (
    action: RuntimeActionRequest,
    context: RuntimeExecutionContext,
  ) => Promise<RuntimePermissionDecision> | RuntimePermissionDecision;
}

/**
 * P0 bootstrap-only plugin manifest retained for backward compatibility.
 * External/public plugins must use liosPluginManifestV1Schema from pluginSdk.ts.
 * Do not add new public SDK fields here.
 * @deprecated
 */
export const pluginManifestSchema = z.object({
  apiVersion: z.literal("1"),
  id: runtimeIdSchema,
  name: z.string().trim().min(1).max(300),
  version: runtimeVersionSchema,
  runtime: z.enum(["declarative", "node_worker", "python_sidecar", "external_process"]),
  permissions: z.array(runtimeIdSchema).max(200).default([]),
  capabilities: z.array(runtimeIdSchema).max(500).default([]),
  tools: z.array(runtimeIdSchema).max(500).default([]),
  connectors: z.array(runtimeIdSchema).max(500).default([]),
  artifacts: z.array(runtimeIdSchema).max(500).default([]),
  agents: z.array(runtimeIdSchema).max(500).default([]),
  dependencies: z.array(runtimeIdSchema).max(500).default([]),
  networkAccess: z.boolean().default(false),
  filesystemAccess: z.enum(["none", "project_scoped", "user_selected"]).default("none"),
}).strict();
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export const runtimePackDescriptorSchema = z.object({
  apiVersion: z.literal("1"),
  id: runtimeIdSchema,
  name: z.string().trim().min(1).max(300),
  optional: z.boolean(),
  capabilities: z.array(runtimeIdSchema).max(500).default([]),
  componentIds: z.array(runtimeIdSchema).max(500).default([]),
}).strict();
export type RuntimePackDescriptor = z.infer<typeof runtimePackDescriptorSchema>;


export {
  LIOS_HIDDEN_ENGINE_PACK_MANIFEST_VERSION,
  hiddenEnginePackDataPlaneSchema,
  hiddenEnginePackManifestV1Schema,
  hiddenEnginePackPermissionSchema,
  hiddenEnginePackPlatformSchema,
  hiddenEnginePackResourceBudgetSchema,
  hiddenEnginePackRuntimeKindSchema,
  parseHiddenEnginePackManifestV1,
} from "./hiddenEnginePackManifest";
export type {
  HiddenEnginePackDataPlane,
  HiddenEnginePackManifestV1,
  HiddenEnginePackPermission,
  HiddenEnginePackPlatform,
  HiddenEnginePackResourceBudget,
  HiddenEnginePackRuntimeKind,
} from "./hiddenEnginePackManifest";


export {
  LIOS_ENGINE_PROTOCOL_VERSION,
  canonicalEngineResultSchema,
  capabilityRouteSchema,
  compareEngineScalars,
  compareSemver,
  engineCapabilityRoleSchema,
  engineCapabilitySchema,
  engineDataPlaneRefSchema,
  engineIntegrationDecisionSchema,
  enginePackInstallStateSchema,
  engineSemanticConventionsSchema,
  engineValidationPolicySchema,
  engineValidationResultSchema,
  isPackCompatible,
  lepMessageSchema,
  packCapabilityAvailabilitySchema,
  runtimePackComponentMetadataSchema,
} from "./engineFabricContracts";
export type {
  CanonicalEngineResult,
  CapabilityRoute,
  CapabilityRouteTarget,
  EngineCapability,
  EngineCapabilityRole,
  EngineDataPlaneRef,
  EngineIntegrationDecision,
  EnginePackInstallState,
  EngineSemanticConventions,
  EngineValidationPolicy,
  EngineValidationResult,
  LepMessage,
  PackCapabilityAvailability,
  RuntimePackComponentMetadata,
} from "./engineFabricContracts";
