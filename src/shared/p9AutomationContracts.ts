import { z } from "zod";
import { conversationRequestSchema } from "./conversationRuntime";

export const P9_AUTOMATION_SCHEMA_VERSION = "1" as const;

export const p9WorkflowTemplateSchema = z.enum([
  "custom",
  "filing_monitor",
  "earnings_monitor",
  "thesis_refresh",
  "valuation_refresh",
  "portfolio_monitor",
  "provider_health",
  "report_refresh",
]);
export type P9WorkflowTemplate = z.infer<typeof p9WorkflowTemplateSchema>;

export const p9AutomationEventTypeSchema = z.enum([
  "filing",
  "earnings",
  "data_refresh",
  "price_threshold",
  "risk_threshold",
  "provider_health",
]);
export type P9AutomationEventType = z.infer<typeof p9AutomationEventTypeSchema>;

const p9EventFilterValueSchema = z.union([z.string().max(1_000), z.number().finite(), z.boolean()]);
export const p9EventFiltersSchema = z.record(p9EventFilterValueSchema).superRefine((value, ctx) => {
  if (Object.keys(value).length > 50) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Event filters are limited to 50 keys." });
  }
});

export const p9WorkflowTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manual") }).strict(),
  z.object({
    type: z.literal("schedule"),
    schedule: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("interval"),
        everyMinutes: z.number().int().min(5).max(10_080),
      }).strict(),
      z.object({
        kind: z.literal("daily_utc"),
        hour: z.number().int().min(0).max(23),
        minute: z.number().int().min(0).max(59),
      }).strict(),
    ]),
  }).strict(),
  z.object({
    type: z.literal("event"),
    eventType: p9AutomationEventTypeSchema,
    filters: p9EventFiltersSchema.default({}),
  }).strict(),
]);
export type P9WorkflowTrigger = z.infer<typeof p9WorkflowTriggerSchema>;

const savedConversationRequestSchema = conversationRequestSchema.omit({
  requestId: true,
  continuationOf: true,
});

export const p9AcceptedArtifactSchema = z.object({
  artifactId: z.string().regex(/^artifact:[0-9a-f-]{36}$/i),
  version: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type P9AcceptedArtifact = z.infer<typeof p9AcceptedArtifactSchema>;

export const p9WorkflowActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("conversation_rerun"),
    chatId: z.number().int().positive(),
    request: savedConversationRequestSchema,
    acceptedArtifact: p9AcceptedArtifactSchema.optional(),
    currentPersonalFinanceResourceId: z.string().trim().min(1).max(300).optional(),
  }).strict(),
  z.object({
    kind: z.literal("project_what_changed"),
  }).strict(),
  z.object({
    kind: z.literal("thesis_refresh"),
    artifactId: z.string().trim().min(1).max(300),
  }).strict(),
  z.object({
    kind: z.literal("provider_health"),
  }).strict(),
]);
export type P9WorkflowAction = z.infer<typeof p9WorkflowActionSchema>;

export const p9NotificationReasonSchema = z.enum([
  "success",
  "failure",
  "condition_met",
  "change_detected",
]);
export type P9NotificationReason = z.infer<typeof p9NotificationReasonSchema>;

export const p9NotificationPolicySchema = z.object({
  enabled: z.boolean().default(true),
  channels: z.array(z.enum(["in_app"])).min(1).max(5).default(["in_app"]),
  notifyOn: z.array(p9NotificationReasonSchema).min(1).max(4).default(["failure", "condition_met", "change_detected"]),
  minimumRelevanceScore: z.number().finite().min(0).max(1).default(0.5),
  cooldownMinutes: z.number().int().min(0).max(43_200).default(60),
  suppressUnchanged: z.boolean().default(true),
}).strict();
export type P9NotificationPolicy = z.infer<typeof p9NotificationPolicySchema>;

export const P9_ACCEPTED_FINANCE_TEMPLATES: readonly P9WorkflowTemplate[] = [
  "filing_monitor", "earnings_monitor", "valuation_refresh", "portfolio_monitor", "report_refresh",
];

export const p9WorkflowDefinitionInputSchema = z.object({
  schemaVersion: z.literal(P9_AUTOMATION_SCHEMA_VERSION).default(P9_AUTOMATION_SCHEMA_VERSION),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4_000).default(""),
  template: p9WorkflowTemplateSchema.default("custom"),
  trigger: p9WorkflowTriggerSchema,
  action: p9WorkflowActionSchema,
  notificationPolicy: p9NotificationPolicySchema.default({}),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
  engineRefs: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  artifactRefs: z.array(z.string().trim().min(1).max(500)).max(200).default([]),
  enabled: z.boolean().default(true),
}).strict().superRefine((value, ctx) => {
  const requiresAcceptance = P9_ACCEPTED_FINANCE_TEMPLATES.includes(value.template);
  if (value.template === "thesis_refresh" && value.action.kind !== "thesis_refresh") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["action"], message: "Thesis refresh template requires the thesis_refresh action." });
  }
  if (value.template === "provider_health" && value.action.kind !== "provider_health") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["action"], message: "Provider health template requires the provider_health action." });
  }
  if (requiresAcceptance && value.action.kind !== "conversation_rerun") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["action"], message: value.template + " requires a saved conversation rerun action." });
  }
  if (requiresAcceptance && value.action.kind === "conversation_rerun" && !value.action.acceptedArtifact) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["action", "acceptedArtifact"], message: "Finance monitors require an explicitly accepted retained Artifact version." });
  }
});
export type P9WorkflowDefinitionInput = z.infer<typeof p9WorkflowDefinitionInputSchema>;

export const p9WorkflowRunStatusSchema = z.enum(["running", "succeeded", "failed", "skipped"]);
export type P9WorkflowRunStatus = z.infer<typeof p9WorkflowRunStatusSchema>;

export const p9WorkflowRunResultSchema = z.object({
  summary: z.string().max(50_000),
  changed: z.boolean().default(false),
  conditionMet: z.boolean().default(false),
  relevanceScore: z.number().finite().min(0).max(1).default(0),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(2_000).default([]),
  engineRefs: z.array(z.string().trim().min(1).max(500)).max(500).default([]),
  artifactRefs: z.array(z.string().trim().min(1).max(500)).max(500).default([]),
  executionReceiptIds: z.array(z.string().trim().min(1).max(500)).max(500).default([]),
  output: z.record(z.unknown()).default({}),
}).strict();
export type P9WorkflowRunResult = z.infer<typeof p9WorkflowRunResultSchema>;

export const p9AutomationEventSchema = z.object({
  eventType: p9AutomationEventTypeSchema,
  occurredAt: z.string().datetime({ offset: true }),
  projectId: z.number().int().positive().nullable().default(null),
  ownerUserId: z.number().int().positive().nullable().default(null),
  organizationId: z.number().int().positive().nullable().default(null),
  sourceRef: z.string().trim().min(1).max(1_000),
  payload: z.record(z.union([z.string().max(10_000), z.number().finite(), z.boolean(), z.null()])).default({}),
}).strict();
export type P9AutomationEvent = z.infer<typeof p9AutomationEventSchema>;

export const P9_CANONICAL_WORKFLOW_TEMPLATES = [
  {
    template: "filing_monitor",
    eventType: "filing",
    description: "Rerun saved filing analysis when a supported filing event arrives.",
  },
  {
    template: "earnings_monitor",
    eventType: "earnings",
    description: "Rerun saved earnings analysis when a supported earnings event arrives.",
  },
  {
    template: "thesis_refresh",
    eventType: "data_refresh",
    description: "Refresh a Thesis Artifact against fresh Project evidence and contradictions.",
  },
  {
    template: "valuation_refresh",
    eventType: "data_refresh",
    description: "Rerun a saved valuation conversation against fresh governed data.",
  },
  {
    template: "portfolio_monitor",
    eventType: "risk_threshold",
    description: "Rerun a saved portfolio/risk analysis when configured risk conditions change.",
  },
  {
    template: "provider_health",
    eventType: "provider_health",
    description: "Inspect configured providers and user-connected source health.",
  },
  {
    template: "report_refresh",
    eventType: "data_refresh",
    description: "Rerun a saved report conversation against fresh Project and provider state.",
  },
] as const;
