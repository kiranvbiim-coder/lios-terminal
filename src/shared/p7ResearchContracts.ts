import { z } from "zod";

export const P7_SCHEMA_VERSION = "1" as const;

export const p7SourceTypeSchema = z.enum([
  "chat",
  "chat_message",
  "resource",
  "artifact",
  "ledger_event",
  "research_evidence",
  "filing",
  "assumption",
  "decision",
  "report",
  "thesis",
  "document",
]);
export type P7SourceType = z.infer<typeof p7SourceTypeSchema>;


export const p7ContextDimensionSchema = z.enum([
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
]);
export type P7ContextDimension = z.infer<typeof p7ContextDimensionSchema>;

const p7ContextRefArraySchema = z.array(z.string().trim().min(1).max(500)).max(2_000).default([]);
export const p7ContextRefsSchema = z.object({
  entity: p7ContextRefArraySchema,
  metric: p7ContextRefArraySchema,
  period: p7ContextRefArraySchema,
  date: p7ContextRefArraySchema,
  event: p7ContextRefArraySchema,
  portfolio: p7ContextRefArraySchema,
  benchmark: p7ContextRefArraySchema,
  scenario: p7ContextRefArraySchema,
  geography: p7ContextRefArraySchema,
  currency: p7ContextRefArraySchema,
}).strict().default({});
export type P7ContextRefs = z.infer<typeof p7ContextRefsSchema>;

export const p7ProjectDocumentSchema = z.object({
  schemaVersion: z.literal(P7_SCHEMA_VERSION),
  id: z.string().trim().min(1).max(300),
  projectId: z.number().int().positive(),
  sourceType: p7SourceTypeSchema,
  sourceRef: z.string().trim().min(1).max(1_000),
  title: z.string().trim().min(1).max(1_000),
  body: z.string().max(2_000_000),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  occurredAt: z.string().datetime({ offset: true }).nullable().default(null),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(2_000).default([]),
  entityRefs: z.array(z.string().trim().min(1).max(500)).max(500).default([]),
  contextRefs: p7ContextRefsSchema,
  metadata: z.record(z.unknown()).default({}),
  embedding: z.array(z.number().finite()).max(8_192).nullable().default(null),
}).strict();
export type P7ProjectDocument = z.infer<typeof p7ProjectDocumentSchema>;

export const p7ContextNodeKindSchema = z.enum([
  "project",
  "chat",
  "message",
  "resource",
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
]);
export type P7ContextNodeKind = z.infer<typeof p7ContextNodeKindSchema>;

export const p7ContextNodeSchema = z.object({
  id: z.string().trim().min(1).max(1_000),
  kind: p7ContextNodeKindSchema,
  label: z.string().trim().min(1).max(1_000),
  sourceRef: z.string().trim().max(1_000).nullable().default(null),
  occurredAt: z.string().datetime({ offset: true }).nullable().default(null),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  metadata: z.record(z.unknown()).default({}),
}).strict();
export type P7ContextNode = z.infer<typeof p7ContextNodeSchema>;

export const p7ContextEdgeTypeSchema = z.enum([
  "contains",
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
]);
export type P7ContextEdgeType = z.infer<typeof p7ContextEdgeTypeSchema>;

export const p7ContextEdgeSchema = z.object({
  id: z.string().trim().min(1).max(1_000),
  from: z.string().trim().min(1).max(1_000),
  to: z.string().trim().min(1).max(1_000),
  type: p7ContextEdgeTypeSchema,
  evidenceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
  metadata: z.record(z.unknown()).default({}),
}).strict();
export type P7ContextEdge = z.infer<typeof p7ContextEdgeSchema>;

export const p7ContextGraphSchema = z.object({
  schemaVersion: z.literal(P7_SCHEMA_VERSION),
  projectId: z.number().int().positive(),
  generatedAt: z.string().datetime({ offset: true }),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  nodes: z.array(p7ContextNodeSchema).max(200_000),
  edges: z.array(p7ContextEdgeSchema).max(500_000),
}).strict();
export type P7ContextGraph = z.infer<typeof p7ContextGraphSchema>;

export const p7InsightKindSchema = z.enum([
  "change",
  "contradiction",
  "stale_evidence",
  "open_question",
  "risk",
  "catalyst",
  "decision",
  "anomaly",
  "trend",
  "percentile",
  "revision",
  "correlation",
  "curve",
  "regime",
]);
export const p7InsightSchema = z.object({
  id: z.string().trim().min(1).max(500),
  kind: p7InsightKindSchema,
  title: z.string().trim().min(1).max(1_000),
  summary: z.string().max(20_000),
  severity: z.enum(["info", "watch", "material"]).default("info"),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
  entityRefs: z.array(z.string().trim().min(1).max(500)).max(500).default([]),
  deterministic: z.literal(true),
  occurredAt: z.string().datetime({ offset: true }).nullable().default(null),
}).strict();
export type P7Insight = z.infer<typeof p7InsightSchema>;

export const p7InsightLensSchema = z.object({
  schemaVersion: z.literal(P7_SCHEMA_VERSION),
  projectId: z.number().int().positive(),
  generatedAt: z.string().datetime({ offset: true }),
  insights: z.array(p7InsightSchema).max(50_000),
  counts: z.record(z.number().int().nonnegative()),
}).strict();
export type P7InsightLens = z.infer<typeof p7InsightLensSchema>;

export const p7SearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(2_000),
  limit: z.number().int().min(1).max(200).default(30),
  sourceTypes: z.array(p7SourceTypeSchema).max(20).default([]),
  allowedSourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(5_000).default([]),
  providerAllow: z.array(z.string().trim().min(1).max(200)).max(500).default([]),
  providerDeny: z.array(z.string().trim().min(1).max(200)).max(500).default([]),
  semanticWeight: z.number().min(0).max(1).default(0),
  queryEmbedding: z.array(z.number().finite()).max(8_192).nullable().default(null),
}).strict();
export type P7SearchRequest = z.infer<typeof p7SearchRequestSchema>;

export const p7SearchHitSchema = z.object({
  documentId: z.string().trim().min(1).max(300),
  sourceType: p7SourceTypeSchema,
  sourceRef: z.string().trim().min(1).max(1_000),
  title: z.string().trim().min(1).max(1_000),
  excerpt: z.string().max(4_000),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  lexicalScore: z.number().finite(),
  semanticScore: z.number().finite().nullable().default(null),
  combinedScore: z.number().finite(),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
  entityRefs: z.array(z.string().trim().min(1).max(500)).max(500).default([]),
  contextRefs: p7ContextRefsSchema,
  occurredAt: z.string().datetime({ offset: true }).nullable().default(null),
}).strict();
export type P7SearchHit = z.infer<typeof p7SearchHitSchema>;

export const p7SnapshotManifestEntrySchema = z.object({
  id: z.string().trim().min(1).max(300),
  sourceType: p7SourceTypeSchema,
  sourceRef: z.string().trim().min(1).max(1_000),
  title: z.string().trim().min(1).max(1_000),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  occurredAt: z.string().datetime({ offset: true }).nullable().default(null),
}).strict();

export const p7ProjectSnapshotSchema = z.object({
  schemaVersion: z.literal(P7_SCHEMA_VERSION),
  id: z.string().trim().min(1).max(300),
  projectId: z.number().int().positive(),
  generatedAt: z.string().datetime({ offset: true }),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  graphHash: z.string().regex(/^[a-f0-9]{64}$/),
  manifest: z.array(p7SnapshotManifestEntrySchema).max(200_000),
}).strict();
export type P7ProjectSnapshot = z.infer<typeof p7ProjectSnapshotSchema>;


export const p7HistoricalStateSchema = z.object({
  snapshot: p7ProjectSnapshotSchema,
  documents: z.array(p7ProjectDocumentSchema).max(200_000),
}).strict();
export type P7HistoricalState = z.infer<typeof p7HistoricalStateSchema>;

export const p7DeltaSchema = z.object({
  schemaVersion: z.literal(P7_SCHEMA_VERSION),
  projectId: z.number().int().positive(),
  fromSnapshotId: z.string().trim().min(1).max(300),
  toSnapshotId: z.string().trim().min(1).max(300),
  added: z.array(p7SnapshotManifestEntrySchema).max(200_000),
  removed: z.array(p7SnapshotManifestEntrySchema).max(200_000),
  changed: z.array(z.object({
    sourceRef: z.string().trim().min(1).max(1_000),
    before: p7SnapshotManifestEntrySchema,
    after: p7SnapshotManifestEntrySchema,
  }).strict()).max(200_000),
}).strict();
export type P7Delta = z.infer<typeof p7DeltaSchema>;

export const p7TimelineEventSchema = z.object({
  id: z.string().trim().min(1).max(500),
  at: z.string().datetime({ offset: true }),
  type: z.enum(["chat", "resource", "artifact", "ledger", "filing", "research", "decision", "thesis", "document"]),
  title: z.string().trim().min(1).max(1_000),
  summary: z.string().max(20_000).default(""),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
  entityRefs: z.array(z.string().trim().min(1).max(500)).max(500).default([]),
  artifactRefs: z.array(z.string().trim().min(1).max(500)).max(500).default([]),
  modelRefs: z.array(z.string().trim().min(1).max(500)).max(500).default([]),
  decisionRef: z.string().trim().max(500).nullable().default(null),
}).strict();
export type P7TimelineEvent = z.infer<typeof p7TimelineEventSchema>;

export const p7FilingSectionSchema = z.object({
  id: z.string().trim().min(1).max(300),
  title: z.string().trim().min(1).max(1_000),
  text: z.string().max(2_000_000),
}).strict();

export const p7FilingDiffSchema = z.object({
  schemaVersion: z.literal(P7_SCHEMA_VERSION),
  filingRef: z.string().trim().min(1).max(1_000),
  priorRef: z.string().trim().min(1).max(1_000),
  generatedAt: z.string().datetime({ offset: true }),
  addedSections: z.array(p7FilingSectionSchema).max(10_000),
  removedSections: z.array(p7FilingSectionSchema).max(10_000),
  changedSections: z.array(z.object({
    id: z.string().trim().min(1).max(300),
    title: z.string().trim().min(1).max(1_000),
    beforeExcerpt: z.string().max(8_000),
    afterExcerpt: z.string().max(8_000),
    addedLines: z.array(z.string().max(4_000)).max(5_000),
    removedLines: z.array(z.string().max(4_000)).max(5_000),
  }).strict()).max(10_000),
  unchangedSectionCount: z.number().int().nonnegative(),
  evidenceRefs: z.array(z.string().trim().min(1).max(1_000)).max(20_000),
}).strict();
export type P7FilingDiff = z.infer<typeof p7FilingDiffSchema>;

export const p7ResearchToolSchema = z.object({
  id: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(500),
  permissionClass: z.enum(["safe_auto", "user_confirm", "admin_confirm", "denied"]),
  deterministic: z.boolean(),
  requiresAI: z.boolean(),
  projectScoped: z.literal(true),
  externalSideEffects: z.literal(false),
}).strict();
export type P7ResearchTool = z.infer<typeof p7ResearchToolSchema>;
