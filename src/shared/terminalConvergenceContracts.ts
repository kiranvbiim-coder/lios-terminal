/**
 * Terminal Convergence canonical contract (TC-01).
 *
 * Source of truth: docs/LIOS_EXECUTION_ROADMAP.md §0.0.2 "Locked product behavior".
 * This module encodes those locked decisions as typed, testable values so source
 * contract tests can detect architectural drift before visual work accumulates.
 * It introduces no runtime router, context engine, store or shell of its own.
 */
import { z } from "zod";
import { conversationScopeSchema, conversationSourceScopeSchema } from "./conversationRuntime";

/** PROJECT → CHAT → INTENT → ROUTE → COMPUTE → EXPLAIN → ARTIFACT → NEXT ACTION */
export const TERMINAL_CONVERGENCE_LOOP = [
  "project",
  "chat",
  "intent",
  "route",
  "compute",
  "explain",
  "artifact",
  "next_action",
] as const;
export type TerminalConvergenceStage = (typeof TERMINAL_CONVERGENCE_LOOP)[number];

/** Exactly one primary authenticated shell; Workbench is an expansion of it. */
export const PRIMARY_AUTHENTICATED_SHELL = "ProjectExperienceShell" as const;
export const AUTHENTICATED_SURFACES = ["projects", "workbench"] as const;
export type AuthenticatedSurface = (typeof AUTHENTICATED_SURFACES)[number];
export const WORKBENCH_ROLE = "expansion" as const;

/** Fields Expand Workspace must carry over unchanged, and restore on return. */
export const WORKBENCH_CONTINUITY_FIELDS = [
  "projectId",
  "chatId",
  "workingContext",
  "activeArtifactVersion",
  "entitySet",
  "assumptions",
  "sourcePosture",
  "sessionState",
] as const;

/** Hidden Working Context: internal orchestration object, never a user inspector. */
export const WORKING_CONTEXT_FIELDS = [
  "projectScope",
  "chatScope",
  "inferredEntities",
  "activeArtifactVersion",
  "selectedElement",
  "objective",
  "sourcePosture",
  "assumptionRefs",
  "asOfPosture",
  "resolvedCapabilities",
  "aiPosture",
  "recentReceiptRefs",
  "inferenceConfidence",
  "workspaceSessionRef",
] as const;

export const workingContextPolicySchema = z.object({
  userVisibleInspector: z.literal(false),
  activeEntitySelector: z.literal(false),
  temporaryChatPersistence: z.literal("memory_only"),
  crossProjectBleed: z.literal(false),
  credentialsAllowed: z.literal(false),
  restoreOnInvalidState: z.literal("fail_closed"),
  askOnMaterialAmbiguity: z.literal(true),
}).strict();
export type WorkingContextPolicy = z.infer<typeof workingContextPolicySchema>;

export const WORKING_CONTEXT_POLICY: WorkingContextPolicy = workingContextPolicySchema.parse({
  userVisibleInspector: false,
  activeEntitySelector: false,
  temporaryChatPersistence: "memory_only",
  crossProjectBleed: false,
  credentialsAllowed: false,
  restoreOnInvalidState: "fail_closed",
  askOnMaterialAmbiguity: true,
});

/** One visible LiOS identity; specialist agents stay internal. */
export const VISIBLE_ASSISTANT_IDENTITIES = ["LiOS"] as const;

/** Global/new chat stays minimal; Project Home is the rich adaptive surface. */
export const SURFACE_RICHNESS = {
  globalNewChat: "minimal",
  projectHome: "rich_adaptive",
} as const;

/** Default composer controls; everything else is contextual or via ⌘/Ctrl+K. */
export const DEFAULT_COMPOSER_CONTROLS = ["tools", "input", "voice_when_available", "send"] as const;
export const PROGRESSIVELY_DISCLOSED_CONTROLS = [
  "source_scope",
  "deterministic_only",
  "ai_direct",
  "provider_selection",
  "session_controls",
  "resource_controls",
  "workbench_expansion",
] as const;

/** High proactivity inside permission/budget/governance limits. */
export const proactivityPolicySchema = z.object({
  level: z.literal("high"),
  readOnlyDeterministicAutonomous: z.literal(true),
  backgroundByoaiRequiresProjectPermission: z.literal(true),
  backgroundByoaiRequiresBudget: z.literal(true),
  dedupeAndCooldown: z.literal(true),
  routineIntelligenceStaysInApp: z.literal(true),
  consequentialActionsSilent: z.literal(false),
  brokerageExecution: z.literal(false),
}).strict();
export type ProactivityPolicy = z.infer<typeof proactivityPolicySchema>;

export const PROACTIVITY_POLICY: ProactivityPolicy = proactivityPolicySchema.parse({
  level: "high",
  readOnlyDeterministicAutonomous: true,
  backgroundByoaiRequiresProjectPermission: true,
  backgroundByoaiRequiresBudget: true,
  dedupeAndCooldown: true,
  routineIntelligenceStaysInApp: true,
  consequentialActionsSilent: false,
  brokerageExecution: false,
});

/** Living Artifacts: durable change appends an immutable revision. */
export const artifactRevisionPolicySchema = z.object({
  durableChange: z.literal("append_revision"),
  overwriteHistory: z.literal(false),
  aiMaterialMutation: z.literal("review_required"),
  directDeterministicManipulation: z.literal("recompute_and_record"),
  upstreamChange: z.literal("refresh_compare_surface_delta"),
  trustTriad: z.tuple([z.literal("artifact"), z.literal("evidence"), z.literal("history")]),
}).strict();
export type ArtifactRevisionPolicy = z.infer<typeof artifactRevisionPolicySchema>;

export const ARTIFACT_REVISION_POLICY: ArtifactRevisionPolicy = artifactRevisionPolicySchema.parse({
  durableChange: "append_revision",
  overwriteHistory: false,
  aiMaterialMutation: "review_required",
  directDeterministicManipulation: "recompute_and_record",
  upstreamChange: "refresh_compare_surface_delta",
  trustTriad: ["artifact", "evidence", "history"],
});

/** No fabricated observations: gaps and conflicts are surfaced, never filled. */
export const observationTruthPolicySchema = z.object({
  missingData: z.literal("structured_data_gap"),
  sourceConflict: z.literal("preserve_both_unless_deterministically_reconcilable"),
  staleRefresh: z.literal("show_last_verified_as_of"),
  inventedValues: z.literal(false),
  publicPreviewExecutable: z.literal(false),
}).strict();
export type ObservationTruthPolicy = z.infer<typeof observationTruthPolicySchema>;

export const OBSERVATION_TRUTH_POLICY: ObservationTruthPolicy = observationTruthPolicySchema.parse({
  missingData: "structured_data_gap",
  sourceConflict: "preserve_both_unless_deterministically_reconcilable",
  staleRefresh: "show_last_verified_as_of",
  inventedValues: false,
  publicPreviewExecutable: false,
});

// ─── Roadmap §0.0.12 reconciliation (owner decisions 2026-10-02) ──────────────
// These contracts are the interfaces TC-02 and later tasks implement against.
// They reuse the canonical conversation scope and source-scope enums.

/** Retrieval/context scope per conversation scope. Storage and mutation stay Project-isolated. */
export const conversationScopePolicySchema = z.object({
  scope: conversationScopeSchema,
  retrieval: z.enum(["all_permitted_sources", "explicit_session_sources"]),
  defaultSourceScope: conversationSourceScopeSchema,
  inheritsPrivateContext: z.boolean(),
  durableMemory: z.boolean(),
  crossTenant: z.literal(false),
  mutateOtherProjects: z.literal(false),
  explicitExclusionsAuthoritative: z.literal(true),
  sourceAttributionRequired: z.literal(true),
}).strict().superRefine((value, ctx) => {
  if (value.scope === "temporary" && (value.durableMemory || value.inheritsPrivateContext || value.retrieval !== "explicit_session_sources")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Temporary chats use explicit session sources only, inherit no private context and contribute no durable memory." });
  }
});
export type ConversationScopePolicy = z.infer<typeof conversationScopePolicySchema>;

export const CONVERSATION_SCOPE_POLICIES = {
  project: conversationScopePolicySchema.parse({ scope: "project", retrieval: "all_permitted_sources", defaultSourceScope: "auto", inheritsPrivateContext: true, durableMemory: true, crossTenant: false, mutateOtherProjects: false, explicitExclusionsAuthoritative: true, sourceAttributionRequired: true }),
  quick: conversationScopePolicySchema.parse({ scope: "quick", retrieval: "all_permitted_sources", defaultSourceScope: "auto", inheritsPrivateContext: true, durableMemory: true, crossTenant: false, mutateOtherProjects: false, explicitExclusionsAuthoritative: true, sourceAttributionRequired: true }),
  temporary: conversationScopePolicySchema.parse({ scope: "temporary", retrieval: "explicit_session_sources", defaultSourceScope: "auto", inheritsPrivateContext: false, durableMemory: false, crossTenant: false, mutateOtherProjects: false, explicitExclusionsAuthoritative: true, sourceAttributionRequired: true }),
} as const satisfies Record<z.infer<typeof conversationScopeSchema>, ConversationScopePolicy>;

/** Migration of older retrieval defaults keeps any explicit narrower restriction. */
export const scopeMigrationPolicySchema = z.object({
  preserveExplicitNarrowerRestriction: z.literal(true),
  recordConsentChange: z.literal(true),
}).strict();

/** Initial setup consent: relevant excerpts may go to approved cloud providers until revoked. */
export const cloudTransmissionConsentSchema = z.object({
  consentId: z.string().trim().min(1).max(200),
  grantedAt: z.string().datetime({ offset: true }),
  revokedAt: z.string().datetime({ offset: true }).nullable().default(null),
  scope: z.literal("relevant_excerpts"),
  approvedProviders: z.array(z.string().trim().min(1).max(120)).max(50),
  sourceRestrictionsOverride: z.literal(true),
  routinePrompting: z.literal(false),
}).strict().superRefine((value, ctx) => {
  if (value.revokedAt && Date.parse(value.revokedAt) < Date.parse(value.grantedAt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["revokedAt"], message: "Consent cannot be revoked before it was granted." });
  }
});
export type CloudTransmissionConsent = z.infer<typeof cloudTransmissionConsentSchema>;

/** Credential-shaped values that must never enter memory, prompts or logs. */
export const CREDENTIAL_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bbearer\s+[A-Za-z0-9._~+/-]{16,}/i,
  /\b(password|passwd|api[_-]?key|secret)\s*[:=]\s*\S+/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
];

/** Broad automatic memory: inspectable, correctable, deletable; never financial evidence. */
export const memoryItemSchema = z.object({
  id: z.string().trim().min(1).max(200),
  origin: z.enum(["user_stated", "inferred", "imported"]),
  scope: z.enum(["user", "project"]),
  projectId: z.number().int().positive().nullable(),
  sourceConversationScope: conversationScopeSchema,
  kind: z.enum(["goal", "preference", "project_context", "assumption"]),
  content: z.string().trim().min(1).max(4_000),
  confidence: z.number().min(0).max(1),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
  deletedAt: z.string().datetime({ offset: true }).nullable().default(null),
  financialEvidence: z.literal(false),
}).strict().superRefine((value, ctx) => {
  if (value.sourceConversationScope === "temporary") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceConversationScope"], message: "Temporary chats contribute no durable memory." });
  }
  if ((value.scope === "project") !== (value.projectId !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["projectId"], message: "Project memory requires a Project id; user memory has none." });
  }
  if (CREDENTIAL_SHAPES.some((pattern) => pattern.test(value.content))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["content"], message: "Secrets and credentials are never stored in memory." });
  }
});
export type MemoryItem = z.infer<typeof memoryItemSchema>;

/** Every assertion is classified; only facts and calculations can be authoritative. */
export const assertionKindSchema = z.enum(["fact", "user_assertion", "calculation", "ai_interpretation"]);
export type AssertionKind = z.infer<typeof assertionKindSchema>;

/** Retrieved evidence keeps identity, revision, location, time and access posture. */
export const evidenceRecordSchema = z.object({
  evidenceId: z.string().trim().min(1).max(300),
  sourceId: z.string().trim().min(1).max(1_000),
  sourceClass: z.enum(["web", "filing", "private_document", "database", "connector", "deterministic_engine", "user_input"]),
  contentHash: z.string().trim().min(8).max(200),
  location: z.string().trim().min(1).max(1_000),
  excerpt: z.string().max(8_000).nullable().default(null),
  publishedAt: z.string().datetime({ offset: true }).nullable().default(null),
  effectiveAt: z.string().datetime({ offset: true }).nullable().default(null),
  retrievedAt: z.string().datetime({ offset: true }),
  entity: z.string().trim().max(300).nullable().default(null),
  period: z.string().trim().max(120).nullable().default(null),
  accessPolicy: z.string().trim().min(1).max(300),
  extraction: z.enum(["complete", "partial", "truncated", "failed"]),
}).strict();
export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>;

/** A cited assertion must point at evidence that actually supports it. */
export const citedAssertionSchema = z.object({
  text: z.string().trim().min(1).max(8_000),
  kind: assertionKindSchema,
  evidenceIds: z.array(z.string().trim().min(1).max(300)).max(50),
  supportState: z.enum(["supported", "conflicting", "missing", "not_checked"]),
}).strict().superRefine((value, ctx) => {
  if (value.supportState === "supported" && value.evidenceIds.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["evidenceIds"], message: "A supported assertion must cite evidence." });
  }
});
export type CitedAssertion = z.infer<typeof citedAssertionSchema>;

/** Connector/plugin readiness states shown in plain language. */
export const capabilitySetupStateSchema = z.enum([
  "available",
  "installing",
  "finish_setup",
  "ready",
  "reconnect",
  "unavailable",
  "disabled_by_policy",
]);
export type CapabilitySetupState = z.infer<typeof capabilitySetupStateSchema>;

/** A request blocked on setup is preserved and resumed exactly once after verified readiness. */
export const pendingSetupContinuationSchema = z.object({
  requestId: z.string().trim().min(1).max(200),
  conversationScope: conversationScopeSchema,
  chatId: z.number().int().positive().nullable(),
  prompt: z.string().min(1).max(200_000),
  requiredCapability: z.string().trim().min(1).max(200),
  capabilityState: capabilitySetupStateSchema,
  createdAt: z.string().datetime({ offset: true }),
  resumedAt: z.string().datetime({ offset: true }).nullable().default(null),
  resumeCount: z.number().int().min(0).max(1),
}).strict().superRefine((value, ctx) => {
  if (value.resumeCount > 0 && value.capabilityState !== "ready") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["capabilityState"], message: "A pending request resumes only after verified readiness." });
  }
  if ((value.resumeCount > 0) !== (value.resumedAt !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["resumedAt"], message: "resumedAt records the single resume." });
  }
  if (value.conversationScope !== "temporary" && value.chatId === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["chatId"], message: "Persisted conversations resume into their chat." });
  }
});
export type PendingSetupContinuation = z.infer<typeof pendingSetupContinuationSchema>;
