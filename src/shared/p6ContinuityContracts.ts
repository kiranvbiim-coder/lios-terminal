import { z } from "zod";

export const P6_CONTINUITY_SCHEMA_VERSION = "1" as const;

export const p6ContinuityNodeKindSchema = z.enum([
  "project",
  "chat",
  "message",
  "resource",
  "session",
  "artifact",
  "ledger_event",
  "evidence",
  "filing",
  "assumption",
  "decision",
  "report",
  "thesis",
  "entity",
  "metric",
  "period",
  "date",
  "event",
  "portfolio",
  "benchmark",
  "scenario",
  "geography",
  "currency",
  "document",
  "automation",
  "monitor",
]);
export type P6ContinuityNodeKind = z.infer<typeof p6ContinuityNodeKindSchema>;

export const p6ContinuityEdgeTypeSchema = z.enum([
  "contains",
  "branches_from",
  "configured_by",
  "mentions",
  "derived_from",
  "supports",
  "contradicts",
  "supersedes",
  "changes",
  "references",
  "decides",
  "assumes",
  "evidences",
  "depends_on",
  "monitors",
  "refreshes",
  "produces",
  "continues",
]);
export type P6ContinuityEdgeType = z.infer<typeof p6ContinuityEdgeTypeSchema>;

export const p6ContinuityNodeSchema = z.object({
  id: z.string().trim().min(1).max(1_000),
  kind: p6ContinuityNodeKindSchema,
  label: z.string().trim().min(1).max(1_000),
  sourceRef: z.string().trim().max(1_000).nullable().default(null),
  occurredAt: z.string().datetime({ offset: true }).nullable().default(null),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  metadata: z.record(z.unknown()).default({}),
}).strict();
export type P6ContinuityNode = z.infer<typeof p6ContinuityNodeSchema>;

export const p6ContinuityEdgeSchema = z.object({
  id: z.string().trim().min(1).max(1_000),
  from: z.string().trim().min(1).max(1_000),
  to: z.string().trim().min(1).max(1_000),
  type: p6ContinuityEdgeTypeSchema,
  evidenceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
  metadata: z.record(z.unknown()).default({}),
}).strict();

export type P6ContinuityEdge = z.infer<typeof p6ContinuityEdgeSchema>;

export const p6ContinuityGraphSchema = z.object({
  projectId: z.number().int().positive(),
  nodes: z.array(p6ContinuityNodeSchema).max(250_000),
  edges: z.array(p6ContinuityEdgeSchema).max(600_000),
}).strict();
export type P6ContinuityGraph = z.infer<typeof p6ContinuityGraphSchema>;

export const p6SessionSummarySchema = z.object({
  sessionId: z.string().trim().min(1).max(500),
  name: z.string().trim().min(1).max(1_000),
  status: z.enum(["active", "archived"]),
  chatId: z.number().int().positive().nullable(),
  parentSessionId: z.string().trim().max(500).nullable(),
  updatedAt: z.string().datetime({ offset: true }),
  sourcePolicyRef: z.string().trim().max(500).nullable(),
  strategyRef: z.string().trim().max(500).nullable(),
  backtestRef: z.string().trim().max(500).nullable(),
  assumptionRefs: z.array(z.string().trim().min(1).max(500)).max(500),
  artifactVersionRefs: z.array(z.string().trim().min(1).max(500)).max(1_000),
}).strict();
export type P6SessionSummary = z.infer<typeof p6SessionSummarySchema>;

const p6LinkedRefsSchema = z.object({
  models: z.array(z.string().trim().min(1).max(1_000)).max(1_000).default([]),
  sources: z.array(z.string().trim().min(1).max(1_000)).max(1_000).default([]),
  scenarios: z.array(z.string().trim().min(1).max(1_000)).max(1_000).default([]),
  backtests: z.array(z.string().trim().min(1).max(1_000)).max(1_000).default([]),
  monitors: z.array(z.string().trim().min(1).max(1_000)).max(1_000).default([]),
}).strict();

export const p6DecisionMemoryEntrySchema = z.object({
  artifactId: z.string().trim().min(1).max(500),
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(1_000),
  objective: z.string().trim().min(1).max(20_000),
  whatChanged: z.array(z.string().max(10_000)).max(500),
  why: z.array(z.string().max(10_000)).max(500),
  uncertainties: z.array(z.string().max(10_000)).max(500),
  updatedAt: z.string().datetime({ offset: true }),
  selectedAlternativeId: z.string().trim().max(200).nullable(),
  selectedAlternativeLabel: z.string().trim().max(1_000).nullable(),
  constraints: z.array(z.string().max(10_000)).max(500),
  assumptionKeys: z.array(z.string().trim().min(1).max(1_000)).max(2_000),
  nextActions: z.array(z.string().max(10_000)).max(500),
  implementation: z.array(z.string().max(10_000)).max(500),
  monitoring: z.array(z.string().max(10_000)).max(500),
  linkedRefs: p6LinkedRefsSchema,
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(2_000),
  dependencyRefs: z.array(z.string().trim().min(1).max(1_000)).max(2_000),
}).strict();
export type P6DecisionMemoryEntry = z.infer<typeof p6DecisionMemoryEntrySchema>;

export const p6AutomationSummarySchema = z.object({
  workflowId: z.string().trim().min(1).max(500),
  name: z.string().trim().min(1).max(200),
  template: z.string().trim().min(1).max(200),
  enabled: z.boolean(),
  triggerType: z.enum(["manual", "schedule", "event"]),
  actionKind: z.enum(["conversation_rerun", "project_what_changed", "thesis_refresh", "provider_health"]),
  nextRunAt: z.string().datetime({ offset: true }).nullable(),
  lastRunAt: z.string().datetime({ offset: true }).nullable(),
  lastFailureAt: z.string().datetime({ offset: true }).nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  latestRunStatus: z.enum(["running", "succeeded", "failed", "skipped"]).nullable(),
  latestRunSummary: z.string().max(50_000).nullable(),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500),
  engineRefs: z.array(z.string().trim().min(1).max(500)).max(100),
  artifactRefs: z.array(z.string().trim().min(1).max(500)).max(200),
}).strict();
export type P6AutomationSummary = z.infer<typeof p6AutomationSummarySchema>;

export const p6ChangeSummarySchema = z.object({
  fromSnapshotId: z.string().trim().min(1).max(300),
  toSnapshotId: z.string().trim().min(1).max(300),
  added: z.number().int().nonnegative(),
  changed: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(2_000),
}).strict();
export type P6ChangeSummary = z.infer<typeof p6ChangeSummarySchema>;

export const p6ContinuationKindSchema = z.enum([
  "review_change",
  "complete_decision",
  "configure_monitor",
  "automation_failed",
  "open_question",
  "risk_review",
  "refresh_stale_evidence",
]);
export type P6ContinuationKind = z.infer<typeof p6ContinuationKindSchema>;

export const p6ContinuationItemSchema = z.object({
  id: z.string().trim().min(1).max(500),
  kind: p6ContinuationKindSchema,
  priority: z.enum(["high", "medium", "low"]),
  title: z.string().trim().min(1).max(1_000),
  summary: z.string().max(20_000),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
  artifactRefs: z.array(z.string().trim().min(1).max(500)).max(500).default([]),
  decisionArtifactId: z.string().trim().max(500).nullable().default(null),
  workflowId: z.string().trim().max(500).nullable().default(null),
  deterministic: z.literal(true),
}).strict();
export type P6ContinuationItem = z.infer<typeof p6ContinuationItemSchema>;

export const p6DependencySummarySchema = z.object({
  projectId: z.number().int().positive(),
  projectName: z.string().trim().min(1).max(1_000),
  chats: z.number().int().nonnegative(),
  resources: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  artifacts: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
}).strict();

export const p6ProjectContinuitySnapshotSchema = z.object({
  schemaVersion: z.literal(P6_CONTINUITY_SCHEMA_VERSION),
  projectId: z.number().int().positive(),
  generatedAt: z.string().datetime({ offset: true }),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  dependencies: p6DependencySummarySchema,
  graph: p6ContinuityGraphSchema,
  sessions: z.array(p6SessionSummarySchema).max(5_000),
  decisions: z.array(p6DecisionMemoryEntrySchema).max(500),
  automations: z.array(p6AutomationSummarySchema).max(500),
  changeSummary: p6ChangeSummarySchema.nullable(),
  continuationQueue: z.array(p6ContinuationItemSchema).max(500),
  counts: z.object({
    graphNodes: z.number().int().nonnegative(),
    graphEdges: z.number().int().nonnegative(),
    sessions: z.number().int().nonnegative(),
    branchedSessions: z.number().int().nonnegative(),
    decisions: z.number().int().nonnegative(),
    unresolvedDecisions: z.number().int().nonnegative(),
    activeAutomations: z.number().int().nonnegative(),
    failedAutomations: z.number().int().nonnegative(),
    continuationItems: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export type P6ProjectContinuitySnapshot = z.infer<typeof p6ProjectContinuitySnapshotSchema>;
