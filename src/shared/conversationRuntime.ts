import { z } from "zod";
import {
  conversationSourceScopeSchema,
  CONVERSATION_SOURCE_SCOPE_LABELS,
  type ConversationSourceScope,
} from "./sourceScope";
import { trustManifestSchema } from "./trustContracts";
import {
  runtimeActionRequestSchema,
  runtimeExecutionReceiptSchema,
  runtimePermissionClassSchema,
  type RuntimeActionRequest,
  type RuntimeExecutionReceipt,
  type RuntimePermissionClass,
} from "./runtimeContracts";
import { p6PersonalFinanceRequestSchema } from "./p6FinanceContracts";

export const conversationExecutionModeSchema = z.enum([
  "deterministic_first",
  "ai_assisted",
  "ai_direct",
]);
export type ConversationExecutionMode = z.infer<typeof conversationExecutionModeSchema>;

export const conversationScopeSchema = z.enum(["project", "quick", "temporary"]);
export type ConversationScope = z.infer<typeof conversationScopeSchema>;

export { conversationSourceScopeSchema, CONVERSATION_SOURCE_SCOPE_LABELS };
export type { ConversationSourceScope };

export const conversationSelectionSchema = z.object({
  kind: z.enum(["entity", "security", "portfolio", "artifact", "dataset", "text", "panel", "other"]),
  id: z.string().trim().min(1).max(300).nullable().default(null),
  label: z.string().trim().min(1).max(300).nullable().default(null),
  text: z.string().max(8_000).nullable().default(null),
  view: z.string().trim().max(120).nullable().default(null),
  symbol: z.string().trim().max(120).nullable().default(null),
}).strict();
export type ConversationSelection = z.infer<typeof conversationSelectionSchema>;

/**
 * P2 canonical five-level context envelope.
 *
 * The five levels are intentionally explicit:
 * 1. identity    — who is acting;
 * 2. project     — durable Project boundary and approved resources;
 * 3. conversation— current chat/branch;
 * 4. workspace   — current Session/view/symbol;
 * 5. active      — focused objects and user selection.
 *
 * Provider/framework state is deliberately absent.
 */
export const conversationContextEnvelopeSchema = z.object({
  schemaVersion: z.literal("1"),
  identity: z.object({
    userId: z.number().int().positive(),
    organizationId: z.number().int().positive().nullable(),
    role: z.string().trim().min(1).max(80),
  }).strict(),
  project: z.object({
    projectId: z.number().int().positive().nullable(),
    name: z.string().trim().max(240).nullable().default(null),
    instructionIncluded: z.boolean().default(false),
    resourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
  }).strict(),
  conversation: z.object({
    chatId: z.number().int().positive().nullable(),
    scope: conversationScopeSchema,
    sourceScope: conversationSourceScopeSchema.default("auto"),
    branchId: z.string().trim().max(240).nullable().default(null),
  }).strict(),
  workspace: z.object({
    sessionId: z.string().trim().max(240).nullable().default(null),
    view: z.string().trim().max(120).nullable().default(null),
    symbol: z.string().trim().max(120).nullable().default(null),
  }).strict(),
  active: z.object({
    objectRefs: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
    selection: conversationSelectionSchema.nullable().default(null),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.conversation.scope === "project" && value.project.projectId === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["project", "projectId"], message: "Project conversations require a Project id." });
  }
  if (value.conversation.scope !== "project" && value.project.projectId !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["project", "projectId"], message: "Quick and temporary conversations cannot silently inherit Project scope." });
  }
});
export type ConversationContextEnvelope = z.infer<typeof conversationContextEnvelopeSchema>;

export const aiTransmissionPolicySchema = z.object({
  mode: z.enum(["configured", "local_only", "any_configured"]).default("configured"),
  providerAllow: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  providerDeny: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  allowProjectInstructions: z.boolean().default(true),
  allowResourceReferences: z.boolean().default(true),
  allowSelection: z.boolean().default(true),
  allowToolCalling: z.boolean().default(true),
  dataClassification: z.enum(["public", "organization", "private"]).default("private"),
  maxProviderAttempts: z.number().int().min(1).max(3).optional(),
  maxAiOutputTokens: z.number().int().min(64).max(8_192).optional(),
}).strict().superRefine((value, ctx) => {
  const denied = new Set(value.providerDeny.map((item) => item.toLowerCase()));
  for (const provider of value.providerAllow) {
    if (denied.has(provider.toLowerCase())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["providerAllow"], message: `Provider "${provider}" cannot be both allowed and denied.` });
    }
  }
});
export type AITransmissionPolicy = z.infer<typeof aiTransmissionPolicySchema>;

export const DEFAULT_AI_TRANSMISSION_POLICY: AITransmissionPolicy = aiTransmissionPolicySchema.parse({});

export const conversationIntentActionSchema = z.enum([
  "resolve",
  "retrieve",
  "compare",
  "calculate",
  "model",
  "screen",
  "research",
  "explain",
  "edit_artifact",
  "save",
  "monitor",
  "export",
  "chat",
]);
export type ConversationIntentAction = z.infer<typeof conversationIntentActionSchema>;

export const structuredConversationIntentSchema = z.object({
  action: conversationIntentActionSchema,
  confidence: z.number().min(0).max(1),
  entityRefs: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
  parameters: z.record(z.unknown()).default({}),
  requiresAI: z.boolean().default(false),
  requiresDeterministicCompute: z.boolean().default(false),
}).strict();
export type StructuredConversationIntent = z.infer<typeof structuredConversationIntentSchema>;

export const conversationCapabilityIdSchema = z.enum([
  "instrument.resolve",
  "security.overview",
  "company.research",
  "company.fundamentals",
  "company.valuation",
  "financial_modeling.three_statement",
  "portfolio.risk",
  "fixed_income.analytics",
  "derivatives.analytics",
  "macro_fx.analytics",
  "research.report",
  "market.technical",
  "strategy.backtest",
  "personal_finance.snapshot",
  "project.search",
  "project.changes",
  "project.insight_lens",
  "project.continuity",
  "deterministic.engine",
  "artifact.edit",
  "ai.answer",
]);
export type ConversationCapabilityId = z.infer<typeof conversationCapabilityIdSchema>;

export const conversationCapabilityMatchSchema = z.object({
  id: conversationCapabilityIdSchema,
  label: z.string().trim().min(1).max(240),
  confidence: z.number().min(0).max(1),
  reason: z.string().trim().min(1).max(500),
  entityQuery: z.string().trim().max(300).nullable().default(null),
  symbol: z.string().trim().max(120).nullable().default(null),
  permissionClass: runtimePermissionClassSchema.default("safe_auto"),
  availability: z.enum(["ready", "needs_input", "needs_approval", "requires_ai"]).default("ready"),
  requiredInputs: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  missingInputs: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  requiresAI: z.boolean().default(false),
  requiresDeterministicCompute: z.boolean().default(false),
  sourceKinds: z.array(z.enum(["project", "files", "connected", "ai"])).max(4).default([]),
  sourceScopeCompatible: z.boolean().default(true),
  sourceScopeReason: z.string().trim().min(1).max(300).nullable().default(null),
  parameters: z.record(z.unknown()).default({}),
}).strict();
export type ConversationCapabilityMatch = z.infer<typeof conversationCapabilityMatchSchema>;

export const workflowStepSchema = z.object({
  id: z.string().trim().min(1).max(120),
  kind: z.enum(["resolve", "retrieve", "calculate", "agent", "ai", "action", "artifact"]),
  label: z.string().trim().min(1).max(300),
  componentId: z.string().trim().min(1).max(300).nullable().default(null),
  permissionClass: runtimePermissionClassSchema.default("safe_auto"),
  dependsOn: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
}).strict();
export type WorkflowStep = z.infer<typeof workflowStepSchema>;

export const workflowPlanSchema = z.object({
  schemaVersion: z.literal("1"),
  requestId: z.string().uuid(),
  intent: structuredConversationIntentSchema,
  capabilities: z.array(conversationCapabilityMatchSchema).max(20).default([]),
  steps: z.array(workflowStepSchema).min(1).max(50),
  budget: z.object({
    maxSteps: z.number().int().min(1).max(50).default(12),
    maxDurationMs: z.number().int().min(1_000).max(300_000).default(90_000),
    maxAiCalls: z.number().int().min(0).max(20).default(2),
  }).strict(),
}).strict();
export type WorkflowPlan = z.infer<typeof workflowPlanSchema>;

export const conversationActionNameSchema = z.enum([
  "OpenArtifact",
  "OpenPanel",
  "ChangeAssumption",
  "RunValuation",
  "RunBacktest",
  "CreateScenario",
  "ForkSession",
  "InspectSource",
  "SaveWorkflow",
  "AIDirectEstimate",
]);
export type ConversationActionName = z.infer<typeof conversationActionNameSchema>;

export const mutationReviewDecisionSchema = z.enum(["review", "apply", "cancel"]);
export type MutationReviewDecision = z.infer<typeof mutationReviewDecisionSchema>;

export const stateMutationProposalSchema = z.object({
  mutationId: z.string().uuid(),
  action: conversationActionNameSchema,
  summary: z.string().trim().min(1).max(1_000),
  reversible: z.boolean(),
  before: z.record(z.unknown()).nullable().default(null),
  after: z.record(z.unknown()),
}).strict();
export type StateMutationProposal = z.infer<typeof stateMutationProposalSchema>;

export const ACTION_POLICY_CLASS: Record<ConversationActionName, RuntimePermissionClass> = {
  OpenArtifact: "safe_auto",
  OpenPanel: "safe_auto",
  ChangeAssumption: "user_confirm",
  RunValuation: "user_confirm",
  RunBacktest: "user_confirm",
  CreateScenario: "user_confirm",
  ForkSession: "user_confirm",
  InspectSource: "safe_auto",
  SaveWorkflow: "user_confirm",
  AIDirectEstimate: "user_confirm",
};

export const approvalGrantSchema = z.object({
  action: conversationActionNameSchema,
  scope: z.enum(["once", "project"]),
}).strict();
export type ApprovalGrant = z.infer<typeof approvalGrantSchema>;

export const conversationAttachmentRefSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["document", "image", "screenshot"]),
  sourceRef: z.string().trim().min(1).max(1_000),
  fileName: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().min(1).max(200),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  byteLength: z.number().int().positive().max(100 * 1024 * 1024),
  textPreview: z.string().max(20_000).nullable().default(null),
}).strict();
export type ConversationAttachmentRef = z.infer<typeof conversationAttachmentRefSchema>;

export const conversationRequestSchema = z.object({
  requestId: z.string().uuid(),
  continuationOf: z.string().uuid().nullable().default(null),
  message: z.string().trim().min(1).max(50_000),
  sourceScope: conversationSourceScopeSchema.default("auto"),
  executionMode: conversationExecutionModeSchema.default("deterministic_first"),
  aiDirectApproved: z.boolean().default(false),
  approvals: z.array(approvalGrantSchema).max(50).default([]),
  transmissionPolicy: aiTransmissionPolicySchema.default(DEFAULT_AI_TRANSMISSION_POLICY),
  attachments: z.array(conversationAttachmentRefSchema).max(20).default([]),
  context: z.object({
    symbol: z.string().trim().max(120).optional(),
    view: z.string().trim().max(120).optional(),
    sessionId: z.string().trim().max(240).optional(),
    activeObjectRefs: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
    selection: conversationSelectionSchema.nullable().optional(),
    personalFinance: p6PersonalFinanceRequestSchema.optional(),
  }).strict().optional(),
}).strict();
export type ConversationRequest = z.infer<typeof conversationRequestSchema>;

export const conversationArtifactDraftSchema = z.object({
  schemaVersion: z.literal("1"),
  artifactId: z.string().uuid(),
  artifactType: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(300),
  projectId: z.number().int().positive().nullable(),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
  executionReceiptIds: z.array(z.string().uuid()).max(100).default([]),
  data: z.record(z.unknown()).default({}),
  persistence: z.enum(["ephemeral", "project_candidate"]).default("ephemeral"),
}).strict();
export type ConversationArtifactDraft = z.infer<typeof conversationArtifactDraftSchema>;

/**
 * TC-02 Hidden Working Context: the bounded, versioned orchestration state of one conversation. It is derived by the server
 * after each turn and never shown to the user. Saved chats keep the latest snapshot in the assistant message metadata;
 * Temporary chats hold it in client memory only. Credentials are rejected by `restoreWorkingContext`, not by this shape.
 */
export const WORKING_CONTEXT_VERSION = 1 as const;
export const workingContextEntitySchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9][A-Z0-9.\-]{0,15}$/),
  source: z.enum(["message", "selection", "carried", "workspace"]),
}).strict();
export const workingContextSnapshotSchema = z.object({
  version: z.literal(WORKING_CONTEXT_VERSION),
  scope: z.enum(["project", "quick", "temporary"]),
  projectId: z.number().int().positive().nullable(),
  chatId: z.number().int().positive().nullable(),
  turn: z.number().int().min(1).max(1_000_000),
  updatedAt: z.string().datetime({ offset: true }),
  /** Current subject set, most relevant first; older accumulated history is narrowed on restoration/use. */
  entities: z.array(workingContextEntitySchema).max(8),
  activeArtifact: z.string().regex(/^artifact:[0-9a-f-]{36}$/i).nullable(),
  selectedElement: z.object({
    kind: conversationSelectionSchema.shape.kind,
    id: z.string().max(300).nullable(),
    label: z.string().max(120).nullable(),
  }).strict().nullable(),
  objective: z.string().max(240).nullable(),
  sourcePosture: conversationSourceScopeSchema,
  assumptionRefs: z.array(z.string().max(160)).max(24),
  /** Governed as-of posture; null when this conversation path has no as-of producer. */
  asOf: z.object({ posture: z.enum(["latest", "as_known_on"]), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }).strict().nullable(),
  capabilityIds: z.array(z.string().max(80)).max(12),
  aiPosture: z.object({ executionMode: conversationExecutionModeSchema, providerId: z.string().max(80).nullable() }).strict(),
  receiptRefs: z.array(z.string().uuid()).max(10),
  workspaceSessionRef: z.string().max(240).nullable(),
  confidence: z.number().min(0).max(1),
}).strict();
export type WorkingContextSnapshot = z.infer<typeof workingContextSnapshotSchema>;

const baseEventSchema = z.object({
  requestId: z.string().uuid(),
  at: z.string().datetime({ offset: true }),
});

export const conversationDataGapSchema = z.object({
  field: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(2_000),
  reason: z.enum(["unavailable", "not_connected", "entitlement", "quota", "frequency", "unsupported"]),
  providersChecked: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
  nextActions: z.array(z.string().trim().min(1).max(500)).max(10).default([]),
}).strict();
export type ConversationDataGap = z.infer<typeof conversationDataGapSchema>;

export const governedToolReviewDecisionSchema = z.enum(["allow_once", "allow_project", "deny"]);
export type GovernedToolReviewDecision = z.infer<typeof governedToolReviewDecisionSchema>;

export const conversationRuntimeEventSchema = z.discriminatedUnion("type", [
  baseEventSchema.extend({ type: z.literal("plan"), plan: workflowPlanSchema }).strict(),
  baseEventSchema.extend({ type: z.literal("status"), stepId: z.string().max(120).nullable().default(null), message: z.string().max(1_000), state: z.enum(["queued", "running", "completed", "cancelled"]) }).strict(),
  baseEventSchema.extend({ type: z.literal("tool_start"), stepId: z.string().max(120), label: z.string().max(300), componentId: z.string().max(300) }).strict(),
  baseEventSchema.extend({ type: z.literal("tool_result"), stepId: z.string().max(120), label: z.string().max(300), summary: z.string().max(2_000), deterministic: z.boolean(), sourceRefs: z.array(z.string().max(1_000)).max(100).default([]) }).strict(),
  baseEventSchema.extend({ type: z.literal("approval_required"), action: conversationActionNameSchema, actionRequest: runtimeActionRequestSchema, choices: z.array(z.enum(["allow_once", "allow_project", "deny"])).min(1), message: z.string().max(1_000) }).strict(),
  /**
   * SI-02 L4: generic governed-tool review. Exact operation identity remains
   * server-side in GM-11a; the client receives only an opaque review id and
   * bounded display metadata.
   */
  baseEventSchema.extend({
    type: z.literal("governed_tool_approval_required"),
    reviewId: z.string().uuid(),
    /** Safe display text only; exact tool/run/input identity remains in GM-11a pending state. */
    label: z.string().trim().min(1).max(300),
    permissionClass: z.enum(["user_confirm", "admin_confirm"]),
    /** Descriptor-derived L5 facts; never client authority. Optional for backward-compatible replay of older events. */
    sideEffect: z.enum(["none", "internal_write", "external"]).optional(),
    replaySafe: z.boolean().optional(),
    externalSideEffect: z.boolean().optional(),
    blastRadius: z.string().trim().min(1).max(500).optional(),
    choices: z.array(governedToolReviewDecisionSchema).min(1).max(3),
    expiresAt: z.string().datetime().nullable(),
    message: z.string().max(1_000),
  }).strict(),
  baseEventSchema.extend({ type: z.literal("mutation_review"), proposal: stateMutationProposalSchema, choices: z.tuple([z.literal("review"), z.literal("apply"), z.literal("cancel")]) }).strict(),
  baseEventSchema.extend({
    type: z.literal("artifact"),
    artifact: conversationArtifactDraftSchema,
    persistedArtifact: z.object({
      id: z.string().regex(/^artifact:[0-9a-f-]{36}$/i),
      version: z.number().int().positive(),
    }).strict().optional(),
  }).strict(),
  baseEventSchema.extend({ type: z.literal("text"), text: z.string().max(200_000), label: z.enum(["deterministic", "observed_source", "ai_derived", "manual"]) }).strict(),
  baseEventSchema.extend({ type: z.literal("receipt"), receipt: runtimeExecutionReceiptSchema }).strict(),
  baseEventSchema.extend({ type: z.literal("data_gap"), gap: conversationDataGapSchema }).strict(),
  baseEventSchema.extend({ type: z.literal("trust"), manifest: trustManifestSchema }).strict(),
  baseEventSchema.extend({ type: z.literal("error"), message: z.string().max(4_000), code: z.string().max(120) }).strict(),
  baseEventSchema.extend({
    type: z.literal("done"),
    status: z.enum(["completed", "cancelled", "failed", "waiting_approval"]),
    /** The turn's validated Working Context; null explicitly clears stale client-held context. */
    workingContext: workingContextSnapshotSchema.nullable().optional(),
  }).strict(),
]);
export type ConversationRuntimeEvent = z.infer<typeof conversationRuntimeEventSchema>;

export const AGENT_ROLE_REGISTRY = [
  "research",
  "fundamental",
  "valuation",
  "quant",
  "technical",
  "macro",
  "portfolio",
  "risk",
  "backtest",
  "filing_document",
  "data",
  "reporting",
] as const;
export type AgentRole = (typeof AGENT_ROLE_REGISTRY)[number];

export const agentRuntimeTaskSchema = z.object({
  requestId: z.string().uuid(),
  role: z.enum(AGENT_ROLE_REGISTRY),
  objective: z.string().trim().min(1).max(5_000),
  maxSteps: z.number().int().min(1).max(50).default(12),
  maxDurationMs: z.number().int().min(1_000).max(300_000).default(90_000),
  checkpointRef: z.string().trim().max(1_000).nullable().default(null),
}).strict();

export type { RuntimeActionRequest, RuntimeExecutionReceipt };
