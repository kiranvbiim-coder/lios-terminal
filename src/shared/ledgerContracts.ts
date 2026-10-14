import { z } from "zod";

export const LIOS_LEDGER_SCHEMA_VERSION = "1" as const;
export const LIOS_PORTABILITY_MANIFEST_VERSION = 1 as const;

export const ledgerActorTypeSchema = z.enum(["user", "system", "engine", "ai", "provider"]);
export type LedgerActorType = z.infer<typeof ledgerActorTypeSchema>;

export const ledgerEventTypeSchema = z.enum([
  "conversation.requested",
  "conversation.completed",
  "conversation.failed",
  "execution.planned",
  "execution.receipt",
  "execution.approval",
  "decision.recorded",
  "state.changed",
  "state.reverted",
  "session.created",
  "session.updated",
  "session.forked",
  "session.archived",
  "session.restored",
  "source.observed",
  "evidence.assessed",
  "model.executed",
  "artifact.draft.emitted",
  "artifact.created",
  "artifact.versioned",
  "artifact.forked",
  "artifact.reference.created",
  "artifact.proposal.created",
  "artifact.proposal.accepted",
  "artifact.proposal.rejected",
  "artifact.action",
  "artifact.exported",
  "artifact.imported",
  "policy.changed",
]);
export type LedgerEventType = z.infer<typeof ledgerEventTypeSchema>;

export const ledgerLineageNodeKindSchema = z.enum([
  "source",
  "input",
  "formula",
  "engine",
  "model",
  "assumption",
  "provider",
  "conversation",
  "decision",
  "execution",
  "session",
  "artifact",
  "policy",
  "workspace",
  "evidence",
  "claim",
]);
export type LedgerLineageNodeKind = z.infer<typeof ledgerLineageNodeKindSchema>;

export const ledgerLineageNodeSchema = z.object({
  kind: ledgerLineageNodeKindSchema,
  ref: z.string().trim().min(1).max(1_000),
  version: z.string().trim().min(1).max(200).nullable().default(null),
  hash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  asOf: z.string().datetime({ offset: true }).nullable().default(null),
  metadata: z.record(z.unknown()).default({}),
}).strict();
export type LedgerLineageNode = z.infer<typeof ledgerLineageNodeSchema>;

export const ledgerLineageRelationSchema = z.enum([
  "used",
  "derived_from",
  "produced",
  "changed",
  "forked_from",
  "supersedes",
  "observed_at",
  "configured_by",
  "supports",
  "conflicts_with",
]);
export type LedgerLineageRelation = z.infer<typeof ledgerLineageRelationSchema>;

export const ledgerLineageEdgeSchema = z.object({
  from: z.string().trim().min(1).max(1_000),
  to: z.string().trim().min(1).max(1_000),
  relation: ledgerLineageRelationSchema,
}).strict().superRefine((value, ctx) => {
  if (value.from === value.to) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "Lineage edges cannot point a node to itself." });
  }
});
export type LedgerLineageEdge = z.infer<typeof ledgerLineageEdgeSchema>;

export const ledgerLineageGraphSchema = z.object({
  nodes: z.array(ledgerLineageNodeSchema).max(2_000).default([]),
  edges: z.array(ledgerLineageEdgeSchema).max(5_000).default([]),
}).strict();
export type LedgerLineageGraph = z.infer<typeof ledgerLineageGraphSchema>;

export const changeRecordSchema = z.object({
  changeId: z.string().uuid(),
  action: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(2_000),
  path: z.string().trim().min(1).max(1_000),
  beforeHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  afterHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  reversible: z.boolean(),
  before: z.unknown().nullable().default(null),
  after: z.unknown().nullable().default(null),
  inverse: z.record(z.unknown()).nullable().default(null),
}).strict().superRefine((value, ctx) => {
  if (value.reversible && value.inverse === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inverse"], message: "Reversible changes require an inverse payload." });
  }
});
export type ChangeRecord = z.infer<typeof changeRecordSchema>;

export const providerObservationSchema = z.object({
  provider: z.string().trim().min(1).max(300),
  sourceRef: z.string().trim().min(1).max(1_000),
  observedAt: z.string().datetime({ offset: true }),
  asOf: z.string().datetime({ offset: true }).nullable().default(null),
  hash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
}).strict();
export type ProviderObservation = z.infer<typeof providerObservationSchema>;

export const formulaReferenceSchema = z.object({
  name: z.string().trim().min(1).max(300),
  expression: z.string().trim().min(1).max(4_000).nullable().default(null),
  version: z.string().trim().min(1).max(200).nullable().default(null),
}).strict();
export type FormulaReference = z.infer<typeof formulaReferenceSchema>;

export const engineReferenceSchema = z.object({
  id: z.string().trim().min(1).max(300),
  version: z.string().trim().min(1).max(200).nullable().default(null),
  componentId: z.string().trim().min(1).max(300).nullable().default(null),
}).strict();
export type EngineReference = z.infer<typeof engineReferenceSchema>;

export const reproducibilityReceiptSchema = z.object({
  schemaVersion: z.literal(LIOS_LEDGER_SCHEMA_VERSION),
  receiptId: z.string().uuid(),
  requestId: z.string().uuid(),
  projectId: z.number().int().positive().nullable(),
  chatId: z.number().int().positive().nullable(),
  sessionId: z.string().trim().min(1).max(240).nullable(),
  operation: z.string().trim().min(1).max(300),
  status: z.enum(["completed", "failed", "cancelled"]),
  deterministic: z.boolean(),
  aiInvolvement: z.enum(["none", "assisted", "direct"]),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  asOf: z.string().datetime({ offset: true }).nullable().default(null),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  outputHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  inputSnapshot: z.record(z.unknown()).default({}),
  outputSnapshot: z.record(z.unknown()).default({}),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(1_000).default([]),
  providerObservations: z.array(providerObservationSchema).max(500).default([]),
  formulas: z.array(formulaReferenceSchema).max(200).default([]),
  engines: z.array(engineReferenceSchema).max(200).default([]),
  assumptions: z.array(z.object({
    ref: z.string().trim().min(1).max(500),
    label: z.string().trim().min(1).max(300),
    value: z.unknown(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()).max(500).default([]),
  warnings: z.array(z.string().trim().min(1).max(1_000)).max(200).default([]),
  lineage: ledgerLineageGraphSchema.default({ nodes: [], edges: [] }),
  integrityHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((value, ctx) => {
  if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "completedAt must not precede startedAt." });
  }
  if (value.deterministic && value.aiInvolvement === "direct") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["aiInvolvement"], message: "AI-direct output cannot be labelled deterministic." });
  }
});
export type ReproducibilityReceipt = z.infer<typeof reproducibilityReceiptSchema>;

export const ledgerEventEnvelopeSchema = z.object({
  schemaVersion: z.literal(LIOS_LEDGER_SCHEMA_VERSION),
  id: z.string().trim().min(1).max(200),
  streamId: z.string().trim().min(1).max(500),
  sequence: z.number().int().positive(),
  projectId: z.number().int().positive().nullable(),
  chatId: z.number().int().positive().nullable(),
  sessionId: z.string().trim().min(1).max(240).nullable(),
  ownerUserId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
  eventType: ledgerEventTypeSchema,
  actorType: ledgerActorTypeSchema,
  requestId: z.string().uuid().nullable().default(null),
  receiptId: z.string().uuid().nullable().default(null),
  correlationId: z.string().trim().min(1).max(300).nullable().default(null),
  causationId: z.string().trim().min(1).max(300).nullable().default(null),
  payload: z.record(z.unknown()).default({}),
  lineage: ledgerLineageGraphSchema.default({ nodes: [], edges: [] }),
  reversible: z.boolean().default(false),
  inversePayload: z.record(z.unknown()).nullable().default(null),
  previousHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  eventHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, ctx) => {
  if (value.reversible && value.inversePayload === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inversePayload"], message: "Reversible ledger events require an inverse payload." });
  }
});
export type LedgerEventEnvelope = z.infer<typeof ledgerEventEnvelopeSchema>;

export const ledgerIntegrityReportSchema = z.object({
  streamId: z.string().trim().min(1).max(500),
  valid: z.boolean(),
  checkedEvents: z.number().int().nonnegative(),
  headSequence: z.number().int().nonnegative(),
  headHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  firstInvalidSequence: z.number().int().positive().nullable().default(null),
  reason: z.string().trim().max(1_000).nullable().default(null),
}).strict();
export type LedgerIntegrityReport = z.infer<typeof ledgerIntegrityReportSchema>;

export const sessionDifferenceSchema = z.object({
  category: z.enum([
    "ancestry",
    "session_name",
    "layout",
    "analytical_state",
    "linked_context",
    "focused_object",
    "saved_view",
    "source_policy",
    "strategy",
    "backtest",
    "assumptions",
    "artifact_versions",
  ]),
  changed: z.boolean(),
  summary: z.string().trim().min(1).max(1_000),
  leftHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  rightHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
}).strict();

export type SessionDifference = z.infer<typeof sessionDifferenceSchema>;

export const sessionChangeExplanationSchema = z.object({
  leftSessionId: z.string().trim().min(1).max(240),
  rightSessionId: z.string().trim().min(1).max(240),
  commonAncestorId: z.string().trim().min(1).max(240).nullable(),
  differences: z.array(sessionDifferenceSchema).max(100),
  explanation: z.array(z.string().trim().min(1).max(1_000)).max(100),
  comparedAt: z.string().datetime({ offset: true }),
}).strict();
export type SessionChangeExplanation = z.infer<typeof sessionChangeExplanationSchema>;

export const projectPortabilityManifestV1Schema = z.object({
  version: z.literal(LIOS_PORTABILITY_MANIFEST_VERSION),
  generatedAt: z.string().datetime({ offset: true }),
  project: z.object({
    id: z.number().int().positive(),
    name: z.string().trim().min(1).max(240),
    instructionsHash: z.string().regex(/^[a-f0-9]{64}$/),
    updatedAt: z.string().datetime({ offset: true }),
  }).strict(),
  chats: z.array(z.object({
    id: z.number().int().positive(),
    status: z.enum(["active", "archived"]),
    titleHash: z.string().regex(/^[a-f0-9]{64}$/),
    updatedAt: z.string().datetime({ offset: true }),
  }).strict()).max(5_000),
  sessions: z.array(z.object({
    id: z.string().trim().min(1).max(240),
    parentSessionId: z.string().trim().min(1).max(240).nullable(),
    chatId: z.number().int().positive().nullable(),
    stateHash: z.string().regex(/^[a-f0-9]{64}$/),
    provenance: z.record(z.unknown()).default({}),
    updatedAt: z.string().datetime({ offset: true }),
  }).strict()).max(5_000),
  resourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(10_000).default([]),
  ledger: z.object({
    schemaVersion: z.literal(LIOS_LEDGER_SCHEMA_VERSION),
    eventCount: z.number().int().nonnegative(),
    streams: z.array(z.object({
      streamId: z.string().trim().min(1).max(500),
      headSequence: z.number().int().nonnegative(),
      headHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    }).strict()).max(10_000),
  }).strict(),
  excludesCredentials: z.literal(true),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type ProjectPortabilityManifestV1 = z.infer<typeof projectPortabilityManifestV1Schema>;
