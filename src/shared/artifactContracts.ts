import { z } from "zod";
import { trustManifestSchema } from "./trustContracts";
import { conversationSourceScopeSchema } from "./sourceScope";
import { financialEventSchema } from "./financialEventContracts";
import { numericalEvidenceSchema } from "./numericalEvidenceContracts";
import { terminalScreenStateSchema } from "./terminalArtifact";

export const LIOS_ARTIFACT_SCHEMA_VERSION = "1" as const;
export const LIOS_ARTIFACT_PACKAGE_VERSION = 1 as const;

export const artifactKindSchema = z.enum([
  "chart",
  "table",
  "screen",
  "valuation",
  "portfolio",
  "research",
  "report",
  "spreadsheet",
  "data",
  "backtest",
  "strategy",
  "decision",
  "timeline",
  "thesis",
]);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const artifactStatusSchema = z.enum(["active", "archived"]);
export type ArtifactStatus = z.infer<typeof artifactStatusSchema>;

export const artifactOriginSchema = z.enum(["direct", "conversation", "import", "fork", "engine"]);
export type ArtifactOrigin = z.infer<typeof artifactOriginSchema>;

export const artifactActionSchema = z.enum([
  "open",
  "edit",
  "keep",
  "reference",
  "fork",
  "compare",
  "export",
  "archive",
  "restore",
  "create_version",
  "propose_change",
  "accept_change",
  "reject_change",
  "undo",
  "rerun",
  "inspect_source",
  "import",
]);
export type ArtifactAction = z.infer<typeof artifactActionSchema>;

export const artifactReferenceTypeSchema = z.enum(["project", "session", "chat", "resource", "artifact"]);
export type ArtifactReferenceType = z.infer<typeof artifactReferenceTypeSchema>;

export const artifactRendererFamilySchema = z.enum([
  "builtin",
  "lightweight_charts",
  "recharts",
  "echarts",
  "univer",
  "duckdb",
  "perspective",
  "virtual_table",
  "tiptap",
]);
export type ArtifactRendererFamily = z.infer<typeof artifactRendererFamilySchema>;

export const artifactAdapterManifestSchema = z.object({
  id: z.string().trim().min(1).max(200),
  kinds: z.array(artifactKindSchema).min(1).max(20),
  renderer: artifactRendererFamilySchema,
  lifecycle: z.enum(["builtin", "optional"]),
  packageName: z.string().trim().min(1).max(300).nullable().default(null),
  capabilities: z.array(z.enum(["view", "edit", "diff", "export", "query", "large_data", "advanced_visualization"])).min(1).max(20),
  canonicalStateOwner: z.literal("LiOS"),
  fallbackAdapterId: z.string().trim().max(200).nullable().default(null),
}).strict();
export type ArtifactAdapterManifest = z.infer<typeof artifactAdapterManifestSchema>;

const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const recordRowSchema = z.record(z.union([scalarSchema, z.array(scalarSchema), z.record(scalarSchema)]));

export const chartArtifactContentSchema = z.object({
  kind: z.literal("chart"),
  rendererPreference: z.enum(["lightweight_charts", "recharts", "echarts"]).default("recharts"),
  chartType: z.string().trim().min(1).max(100),
  series: z.array(z.object({
    id: z.string().trim().min(1).max(200),
    label: z.string().trim().min(1).max(300),
    points: z.array(z.object({
      x: z.union([z.string(), z.number()]),
      y: z.number(),
    }).strict()).max(100_000),
  }).strict()).max(100),
  options: z.record(z.unknown()).default({}),
}).strict();

export const tableArtifactContentSchema = z.object({
  kind: z.literal("table"),
  columns: z.array(z.object({
    key: z.string().trim().min(1).max(200),
    label: z.string().trim().min(1).max(300),
    type: z.enum(["string", "number", "boolean", "date", "currency", "percent"]).default("string"),
  }).strict()).max(500),
  rows: z.array(recordRowSchema).max(50_000),
  numericalEvidence: z.array(numericalEvidenceSchema).max(50_000).optional(),
}).strict();

export const screenArtifactContentSchema = z.object({
  kind: z.literal("screen"),
  view: z.string().trim().min(1).max(200),
  symbol: z.string().trim().max(100).nullable().default(null),
  state: z.record(z.unknown()).default({}),
}).strict();

export const valuationArtifactContentSchema = z.object({
  kind: z.literal("valuation"),
  symbol: z.string().trim().max(100).nullable().default(null),
  modelId: z.string().trim().min(1).max(200),
  assumptions: z.record(z.unknown()).default({}),
  outputs: z.record(z.unknown()).default({}),
  summary: z.record(z.unknown()).default({}),
}).strict();

export const portfolioArtifactContentSchema = z.object({
  kind: z.literal("portfolio"),
  portfolioRef: z.string().trim().max(300).nullable().default(null),
  holdings: z.array(z.record(z.unknown())).max(100_000).default([]),
  summary: z.record(z.unknown()).default({}),
  risk: z.record(z.unknown()).default({}),
}).strict();

export const richDocumentBlockSchema = z.object({
  id: z.string().trim().min(1).max(200),
  type: z.enum(["heading", "paragraph", "bullet_list", "ordered_list", "table", "callout", "quote", "code", "chart_ref", "artifact_ref", "image"]),
  text: z.string().max(200_000).default(""),
  attrs: z.record(z.unknown()).default({}),
}).strict();
export type RichArtifactBlock = z.infer<typeof richDocumentBlockSchema>;

export const researchClaimProvenanceSchema = z.enum([
  "source_backed",
  "explicit_inference",
  "user_asserted",
  "unknown",
]);
export type ResearchClaimProvenance = z.infer<typeof researchClaimProvenanceSchema>;

export const researchClaimSchema = z.object({
  id: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(20_000),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
  provenance: researchClaimProvenanceSchema.default("unknown"),
}).strict().superRefine((claim, ctx) => {
  if (claim.provenance === "source_backed" && claim.sourceRefs.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceRefs"],
      message: "source_backed research claims require at least one sourceRef.",
    });
  }
});

export const researchArtifactContentSchema = z.object({
  kind: z.literal("research"),
  question: z.string().max(20_000).default(""),
  plan: z.object({
    status: z.enum(["draft", "active", "completed"]).default("draft"),
    steps: z.array(z.object({
      id: z.string().trim().min(1).max(200),
      objective: z.string().trim().min(1).max(10_000),
      status: z.enum(["todo", "in_progress", "done", "blocked"]).default("todo"),
      sourceKinds: z.array(z.enum(["filing", "document", "web", "provider", "project", "manual"])).max(20).default([]),
    }).strict()).max(500).default([]),
  }).strict().default({ status: "draft", steps: [] }),
  blocks: z.array(richDocumentBlockSchema).max(5_000),
  claims: z.array(researchClaimSchema).max(5_000).default([]),
  evidence: z.array(z.object({
    id: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(1_000),
    snippet: z.string().max(20_000).default(""),
    sourceRef: z.string().trim().min(1).max(1_000),
    url: z.string().url().max(4_000).nullable().default(null),
    sourceType: z.enum(["filing", "document", "web", "provider", "project", "manual"]).default("project"),
    observedAt: z.string().datetime({ offset: true }).nullable().default(null),
  }).strict()).max(10_000).default([]),
  sourcePolicy: z.object({
    mode: z.enum(["connected_sources", "only_refs"]).default("connected_sources"),
    allowedSourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(5_000).default([]),
    providerAllow: z.array(z.string().trim().min(1).max(200)).max(500).default([]),
    providerDeny: z.array(z.string().trim().min(1).max(200)).max(500).default([]),
  }).strict().default({ mode: "connected_sources", allowedSourceRefs: [], providerAllow: [], providerDeny: [] }),
  contradictions: z.array(z.object({
    id: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(20_000),
    claimRefs: z.array(z.string().trim().min(1).max(500)).max(500).default([]),
    evidenceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
    status: z.enum(["open", "resolved"]).default("open"),
  }).strict()).max(5_000).default([]),
  executionTrail: z.array(z.object({
    at: z.string().datetime({ offset: true }),
    action: z.string().trim().min(1).max(1_000),
    sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
    receiptId: z.string().trim().max(500).nullable().default(null),
  }).strict()).max(5_000).default([]),
  editorPreference: z.enum(["builtin", "tiptap"]).default("builtin"),
}).strict();

export const thesisArtifactContentSchema = z.object({
  kind: z.literal("thesis"),
  entityRef: z.string().trim().max(500).nullable().default(null),
  status: z.enum(["draft", "active", "invalidated", "closed"]).default("draft"),
  summary: z.string().max(50_000).default(""),
  expectedOutcomes: z.array(z.object({
    id: z.string().trim().min(1).max(200),
    text: z.string().trim().min(1).max(20_000),
    status: z.enum(["open", "occurred", "missed", "superseded"]).default("open"),
    dueAt: z.string().datetime({ offset: true }).nullable().default(null),
    evidenceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
  }).strict()).max(2_000).default([]),
  claims: z.array(z.object({
    id: z.string().trim().min(1).max(200),
    text: z.string().trim().min(1).max(20_000),
    status: z.enum(["open", "supported", "contradicted", "invalidated"]).default("open"),
    confidence: z.number().min(0).max(1).nullable().default(null),
    evidenceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
    counterEvidenceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
    updatedAt: z.string().datetime({ offset: true }).nullable().default(null),
  }).strict()).max(5_000).default([]),
  catalysts: z.array(z.object({
    id: z.string().trim().min(1).max(200),
    text: z.string().trim().min(1).max(20_000),
    status: z.enum(["open", "occurred", "missed", "cancelled"]).default("open"),
    dueAt: z.string().datetime({ offset: true }).nullable().default(null),
    evidenceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
  }).strict()).max(2_000).default([]),
  risks: z.array(z.object({
    id: z.string().trim().min(1).max(200),
    text: z.string().trim().min(1).max(20_000),
    status: z.enum(["open", "materialized", "mitigated", "dismissed"]).default("open"),
    evidenceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
  }).strict()).max(2_000).default([]),
  invalidationConditions: z.array(z.object({
    id: z.string().trim().min(1).max(200),
    text: z.string().trim().min(1).max(20_000),
    triggered: z.boolean().default(false),
    evidenceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
  }).strict()).max(2_000).default([]),
  openQuestions: z.array(z.object({
    id: z.string().trim().min(1).max(200),
    text: z.string().trim().min(1).max(20_000),
    status: z.enum(["open", "answered", "deferred"]).default("open"),
    evidenceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
  }).strict()).max(2_000).default([]),
  refresh: z.object({
    lastRefreshedAt: z.string().datetime({ offset: true }).nullable().default(null),
    snapshotId: z.string().trim().max(300).nullable().default(null),
    contradictions: z.array(z.string().max(20_000)).max(2_000).default([]),
    changes: z.array(z.string().max(20_000)).max(2_000).default([]),
  }).strict().default({ lastRefreshedAt: null, snapshotId: null, contradictions: [], changes: [] }),
  postmortems: z.array(z.object({
    at: z.string().datetime({ offset: true }),
    outcome: z.enum(["validated", "partially_validated", "invalidated", "closed"]),
    summary: z.string().max(50_000),
    whatWorked: z.array(z.string().max(20_000)).max(1_000).default([]),
    whatFailed: z.array(z.string().max(20_000)).max(1_000).default([]),
    evidenceRefs: z.array(z.string().trim().min(1).max(1_000)).max(2_000).default([]),
  }).strict()).max(500).default([]),
}).strict();

export const reportArtifactContentSchema = z.object({
  kind: z.literal("report"),
  templateId: z.string().trim().max(200).nullable().default(null),
  blocks: z.array(richDocumentBlockSchema).max(5_000),
  sections: z.array(z.object({
    id: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(500),
    blockIds: z.array(z.string().trim().min(1).max(200)).max(5_000),
  }).strict()).max(500).default([]),
  editorPreference: z.enum(["builtin", "tiptap"]).default("builtin"),
}).strict();
export type RichArtifactDocument = z.infer<typeof researchArtifactContentSchema> | z.infer<typeof reportArtifactContentSchema>;

// Optional on historical cells: never backfill metadata into an immutable version.
const spreadsheetLineageFields = {
  custody: z.enum(["server_projection", "imported_history", "user_authored"]),
  capturedRaw: z.string().max(100_000),
  capturedFormat: z.string().max(200).nullable(),
  capturedValueHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  sourceRefs: z.array(z.string().min(1).max(1_000)).max(100),
  datasetSnapshotId: z.string().uuid().optional(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  modelRunId: z.string().uuid().optional(),
  resultHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  resultPath: z.string().min(1).max(1_000).optional(),
  sourcePath: z.string().min(1).max(1_000).optional(),
  statement: z.string().min(1).max(100).optional(),
  canonicalKey: z.string().min(1).max(200).optional(),
  period: z.string().min(1).max(80).optional(),
  fiscalYear: z.string().min(1).max(80).optional(),
  periodEnd: z.string().date().optional(),
  availableAt: z.string().datetime({ offset: true }).optional(),
  currency: z.string().min(1).max(20).optional(),
  entitlementPolicyRef: z.string().min(1).max(1_000).optional(),
  sourceUnit: z.string().min(1).max(200).optional(),
  numericRepresentation: z.literal("js_number_roundtrip").optional(),
};
export const spreadsheetCellLineageSchema = z.discriminatedUnion("kind", [
  z.object({
    ...spreadsheetLineageFields,
    kind: z.literal("reported_actual"),
    datasetSnapshotId: z.string().uuid(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    statement: z.string().min(1).max(100),
    canonicalKey: z.string().min(1).max(200),
    sourcePath: z.string().min(1).max(1_000),
  }).strict(),
  z.object({
    ...spreadsheetLineageFields,
    kind: z.literal("engine_output"),
    modelRunId: z.string().uuid(),
    resultHash: z.string().regex(/^[a-f0-9]{64}$/),
    resultPath: z.string().min(1).max(1_000),
  }).strict(),
  z.object({
    ...spreadsheetLineageFields,
    kind: z.literal("user_assumption"),
    assumptionOrigin: z.enum(["user_authored", "persisted_run_input"]),
  }).strict(),
]);
export type SpreadsheetCellLineage = z.infer<typeof spreadsheetCellLineageSchema>;

export const spreadsheetCellSchema = z.object({
  raw: z.string().max(100_000),
  format: z.string().max(200).nullable().default(null),
  lineage: spreadsheetCellLineageSchema.optional(),
}).strict();
export type SpreadsheetCell = z.infer<typeof spreadsheetCellSchema>;

export const spreadsheetSheetSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  cells: z.record(spreadsheetCellSchema).default({}),
  names: z.record(z.string().trim().min(1).max(200)).default({}),
  rowCount: z.number().int().min(1).max(100_000).default(100),
  columnCount: z.number().int().min(1).max(10_000).default(26),
}).strict();

const spreadsheetArtifactObjectSchema = z.object({
  kind: z.literal("spreadsheet"),
  sheets: z.array(spreadsheetSheetSchema).min(1).max(200),
  activeSheetId: z.string().trim().min(1).max(200),
  rendererPreference: z.enum(["builtin", "univer"]).default("builtin"),
  calculationMode: z.enum(["automatic", "manual"]).default("automatic"),
}).strict();

function validateSpreadsheetActiveSheet(
  value: z.infer<typeof spreadsheetArtifactObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  if (!value.sheets.some((sheet) => sheet.id === value.activeSheetId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["activeSheetId"], message: "activeSheetId must reference an existing sheet." });
  }
}

export const spreadsheetArtifactContentSchema = spreadsheetArtifactObjectSchema.superRefine(validateSpreadsheetActiveSheet);

export const dataArtifactContentSchema = z.object({
  kind: z.literal("data"),
  columns: z.array(z.object({
    name: z.string().trim().min(1).max(300),
    type: z.string().trim().min(1).max(200),
  }).strict()).max(2_000),
  previewRows: z.array(recordRowSchema).max(10_000).default([]),
  rowCount: z.number().int().nonnegative(),
  columnarArtifactId: z.string().trim().max(300).nullable().default(null),
  rendererPreference: z.enum(["virtual_table", "perspective"]).default("virtual_table"),
}).strict();

export const backtestArtifactContentSchema = z.object({
  kind: z.literal("backtest"),
  strategyRef: z.string().trim().max(500).nullable().default(null),
  status: z.enum(["edited_not_run", "running", "completed", "failed", "stale"]),
  metrics: z.record(z.unknown()).default({}),
  equityCurve: z.array(z.object({ at: z.string(), value: z.number() }).strict()).max(200_000).default([]),
  drawdown: z.array(z.object({ at: z.string(), value: z.number() }).strict()).max(200_000).default([]),
  trades: z.array(z.record(z.unknown())).max(200_000).default([]),
  benchmark: z.record(z.unknown()).default({}),
  assumptions: z.record(z.unknown()).default({}),
  reproducibilityHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  pointInTimeVerified: z.boolean().nullable().default(null),
  warnings: z.array(z.string().max(1_000)).max(200).default([]),
}).strict();

export const strategyArtifactContentSchema = z.object({
  kind: z.literal("strategy"),
  language: z.enum(["rules", "json", "brue", "python", "pinescript", "other"]).default("rules"),
  source: z.string().max(500_000),
  parameters: z.record(z.unknown()).default({}),
  validation: z.object({
    status: z.enum(["unvalidated", "valid", "invalid"]),
    errors: z.array(z.string().max(2_000)).max(500).default([]),
  }).strict().default({ status: "unvalidated", errors: [] }),
}).strict();

const decisionAuthoredRefsSchema = {
  sourceRefs: z.array(z.string().min(1).max(1_000)).max(100).default([]),
  artifactRefs: z.array(z.string().min(1).max(500)).max(100).default([]),
};
const decisionAuthoredDateSchema = z.string().datetime({ offset: true }).nullable().default(null);

// These are authored observations/plans, never execution or reviewer authority.
export const decisionArtifactActionSchema = z.object({
  id: z.string().min(1).max(200),
  description: z.string().min(1).max(10_000),
  status: z.enum(["planned", "in_progress", "completed", "blocked", "cancelled"]).default("planned"),
  assignee: z.string().max(500).nullable().default(null),
  dueAt: decisionAuthoredDateSchema,
  completedAt: decisionAuthoredDateSchema,
  ...decisionAuthoredRefsSchema,
}).strict();
export const decisionArtifactOutcomeSchema = z.object({
  summary: z.string().max(20_000),
  status: z.enum(["pending", "observed", "inconclusive"]).default("pending"),
  observedAt: decisionAuthoredDateSchema,
  ...decisionAuthoredRefsSchema,
}).strict();
export const decisionArtifactFollowUpSchema = z.object({
  id: z.string().min(1).max(200),
  description: z.string().min(1).max(10_000),
  status: z.enum(["open", "in_progress", "completed", "cancelled"]).default("open"),
  dueAt: decisionAuthoredDateSchema,
  completedAt: decisionAuthoredDateSchema,
  ...decisionAuthoredRefsSchema,
}).strict();

export const decisionArtifactContentSchema = z.object({
  kind: z.literal("decision"),
  objective: z.string().trim().min(1).max(20_000),
  recommendation: z.string().max(20_000).optional(),
  dissent: z.array(z.string().max(10_000)).max(500).optional(),
  actions: z.array(decisionArtifactActionSchema).max(500).optional(),
  outcome: decisionArtifactOutcomeSchema.nullable().optional(),
  followUp: z.array(decisionArtifactFollowUpSchema).max(500).optional(),
  // An authored reference is not an approval; only server P4 linkage receipts bind review authority.
  caseRef: z.string().regex(/^decision:[1-9]\d*$/).nullable().optional(),
  whatChanged: z.array(z.string().max(10_000)).max(500).default([]),
  why: z.array(z.string().max(10_000)).max(500).default([]),
  scenarios: z.array(z.object({
    id: z.string().trim().min(1).max(200),
    label: z.string().trim().min(1).max(1_000),
    kind: z.enum(["base", "bull", "bear", "custom"]),
    artifactRef: z.string().trim().max(500).nullable().default(null),
    summary: z.string().max(10_000).default(""),
  }).strict()).max(100).default([]),
  constraints: z.array(z.string().max(10_000)).max(500).default([]),
  assumptions: z.record(z.unknown()).default({}),
  alternatives: z.array(z.object({
    id: z.string().trim().min(1).max(200),
    label: z.string().trim().min(1).max(1_000),
    expectedOutcomes: z.array(z.string().max(10_000)).max(200).default([]),
    risks: z.array(z.string().max(10_000)).max(200).default([]),
    tradeoffs: z.array(z.string().max(10_000)).max(200).default([]),
  }).strict()).max(200).default([]),
  selectedAlternativeId: z.string().trim().max(200).nullable().default(null),
  uncertainties: z.array(z.string().max(10_000)).max(500).default([]),
  nextActions: z.array(z.string().max(10_000)).max(500).default([]),
  implementation: z.array(z.string().max(10_000)).max(500).default([]),
  monitoring: z.array(z.string().max(10_000)).max(500).default([]),
  linkedRefs: z.object({
    models: z.array(z.string().trim().min(1).max(1_000)).max(1_000).default([]),
    sources: z.array(z.string().trim().min(1).max(1_000)).max(1_000).default([]),
    scenarios: z.array(z.string().trim().min(1).max(1_000)).max(1_000).default([]),
    backtests: z.array(z.string().trim().min(1).max(1_000)).max(1_000).default([]),
    monitors: z.array(z.string().trim().min(1).max(1_000)).max(1_000).default([]),
  }).strict().default({ models: [], sources: [], scenarios: [], backtests: [], monitors: [] }),
}).strict();
export type DecisionArtifactContent = z.infer<typeof decisionArtifactContentSchema>;

export const decisionArtifactApprovalBaseSchema = z.object({
  baseVersion: z.number().int().positive(),
  baseHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const decisionArtifactApprovalLinkInputSchema = decisionArtifactApprovalBaseSchema.extend({
  decisionId: z.number().int().positive(),
  receiptVersionId: z.number().int().positive(),
  receiptHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type DecisionArtifactApprovalLinkInput = z.infer<typeof decisionArtifactApprovalLinkInputSchema>;
export type DecisionArtifactApprovalBaseInput = z.infer<typeof decisionArtifactApprovalBaseSchema>;

export const decisionArtifactApprovalLinkSchema = z.object({
  decisionId: z.number().int().positive(),
  receiptVersionId: z.number().int().positive(),
  receiptVersion: z.number().int().positive(),
  receiptHash: z.string().regex(/^[a-f0-9]{64}$/),
  serverApprovalId: z.number().int().positive(),
  outcome: z.enum(["approved", "waived"]),
  reviewerUserId: z.number().int().positive(),
  approvedAt: z.string().datetime({ offset: true }),
  linkedAt: z.string().datetime({ offset: true }),
  artifactVersion: z.number().int().positive(),
  artifactContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  projectId: z.number().int().positive(),
}).strict();
export type DecisionArtifactApprovalLink = z.infer<typeof decisionArtifactApprovalLinkSchema>;
export const decisionArtifactApprovalInspectionSchema = z.object({
  artifactId: z.string().min(1),
  approvalScope: z.literal("linked_receipt_only"),
  version: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(["unlinked", "approved", "waived", "stale", "unavailable"]),
  reason: z.string().nullable(),
  link: decisionArtifactApprovalLinkSchema.nullable(),
  currentApproval: decisionArtifactApprovalLinkSchema.nullable(),
}).strict();
export type DecisionArtifactApprovalInspection = z.infer<typeof decisionArtifactApprovalInspectionSchema>;
export const decisionArtifactApprovalOptionsSchema = z.object({
  cases: z.array(z.object({
    id: z.number().int().positive(),
    title: z.string(),
    status: z.string(),
    receipts: z.array(z.object({
      id: z.number().int().positive(),
      version: z.number().int().positive(),
      snapshotHash: z.string(),
      recommendation: z.string(),
      eligible: z.boolean(),
      reason: z.string().nullable(),
    }).strict()),
  }).strict()),
}).strict();
export type DecisionArtifactApprovalOptions = z.infer<typeof decisionArtifactApprovalOptionsSchema>;

export const timelineArtifactContentSchema = z.object({
  kind: z.literal("timeline"),
  events: z.array(z.object({
    id: z.string().trim().min(1).max(200),
    at: z.string().datetime({ offset: true }),
    type: z.enum(["filing", "earnings", "alert", "research", "model_change", "decision", "artifact", "note"]),
    title: z.string().trim().min(1).max(1_000),
    summary: z.string().max(20_000).default(""),
    sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
    artifactRefs: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
    decisionRef: z.string().trim().max(500).nullable().default(null),
    financialEvent: financialEventSchema.optional(),
  }).strict()).max(100_000),
}).strict();

const artifactContentObjectSchema = z.discriminatedUnion("kind", [
  chartArtifactContentSchema,
  tableArtifactContentSchema,
  screenArtifactContentSchema,
  valuationArtifactContentSchema,
  portfolioArtifactContentSchema,
  researchArtifactContentSchema,
  thesisArtifactContentSchema,
  reportArtifactContentSchema,
  spreadsheetArtifactObjectSchema,
  dataArtifactContentSchema,
  backtestArtifactContentSchema,
  strategyArtifactContentSchema,
  decisionArtifactContentSchema,
  timelineArtifactContentSchema,
]);

export const artifactContentSchema = artifactContentObjectSchema.superRefine((value, ctx) => {
  if (value.kind === "spreadsheet") validateSpreadsheetActiveSheet(value, ctx);
  if (value.kind === "screen" && value.state.terminal !== undefined) {
    const terminal = terminalScreenStateSchema.safeParse(value.state.terminal);
    if (!terminal.success) ctx.addIssue({ code: "custom", path: ["state", "terminal"], message: "Interactive terminal state is invalid." });
    else if (terminal.data.subject.symbol !== value.symbol) ctx.addIssue({ code: "custom", path: ["symbol"], message: "Terminal subject must match the screen symbol." });
  }
  if (value.kind === "table" && value.numericalEvidence) {
    const columns = new Set(value.columns.map(column => column.key));
    const boundTargets = new Set<string>();
    for (const [index, evidence] of value.numericalEvidence.entries()) {
      const key = `${evidence.target.row}:${evidence.target.column}`;
      if (!columns.has(evidence.target.column)
        || value.rows[evidence.target.row]?.[evidence.target.column] !== evidence.normalizedValue) {
        ctx.addIssue({ code: "custom", path: ["numericalEvidence", index, "target"], message: "Numerical evidence must match the exact current output cell value." });
      }
      if (boundTargets.has(key)) ctx.addIssue({ code: "custom", path: ["numericalEvidence", index, "target"], message: "A numeric output cell may have only one evidence binding." });
      boundTargets.add(key);
    }
  }
});
export type ArtifactContent = z.infer<typeof artifactContentSchema>;

export const artifactIdentitySchema = z.object({
  schemaVersion: z.literal(LIOS_ARTIFACT_SCHEMA_VERSION),
  id: z.string().trim().min(1).max(240),
  projectId: z.number().int().positive().nullable(),
  owningChatId: z.number().int().positive().nullable().optional(),
  kind: artifactKindSchema,
  title: z.string().trim().min(1).max(500),
  status: artifactStatusSchema,
  origin: artifactOriginSchema,
  headVersion: z.number().int().positive(),
  forkedFromArtifactId: z.string().trim().max(240).nullable().default(null),
  forkedFromVersion: z.number().int().positive().nullable().default(null),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  archivedAt: z.string().datetime({ offset: true }).nullable().default(null),
}).strict().refine(identity => identity.projectId !== null || identity.owningChatId != null, "An Artifact requires an owning Project or persistent Chat.");
export type ArtifactIdentity = z.infer<typeof artifactIdentitySchema>;

export const artifactRefreshSpecSchema = z.object({
  kind: z.enum(["conversation", "engine", "manual"]),
  sourceScope: conversationSourceScopeSchema.default("auto"),
  executionMode: z.enum(["deterministic_first", "ai_assisted", "ai_direct"]).default("deterministic_first"),
  capabilityIds: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  message: z.string().max(50_000).nullable().default(null),
  selection: z.object({
    kind: z.string().trim().max(120).nullable().default(null),
    id: z.string().trim().max(300).nullable().default(null),
    label: z.string().trim().max(300).nullable().default(null),
    view: z.string().trim().max(120).nullable().default(null),
    symbol: z.string().trim().max(120).nullable().default(null),
  }).strict().nullable().default(null),
  engineRef: z.string().trim().max(300).nullable().default(null),
}).strict();
export type ArtifactRefreshSpec = z.infer<typeof artifactRefreshSpecSchema>;

export const artifactVersionSchema = z.object({
  schemaVersion: z.literal(LIOS_ARTIFACT_SCHEMA_VERSION),
  id: z.string().trim().min(1).max(240),
  artifactId: z.string().trim().min(1).max(240),
  version: z.number().int().positive(),
  parentVersionId: z.string().trim().max(240).nullable().default(null),
  adapterId: z.string().trim().min(1).max(200),
  content: artifactContentSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(2_000).default([]),
  executionReceiptIds: z.array(z.string().uuid()).max(1_000).default([]),
  assumptionRefs: z.array(z.string().trim().min(1).max(500)).max(2_000).default([]),
  trustManifest: trustManifestSchema.nullable().default(null),
  dependencyRefs: z.array(z.string().trim().min(1).max(1_000)).max(5_000).default([]),
  refreshSpec: artifactRefreshSpecSchema.nullable().default(null),
  note: z.string().max(4_000).nullable().default(null),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type ArtifactVersion = z.infer<typeof artifactVersionSchema>;

export const spreadsheetCellDiffSchema = z.object({
  sheetId: z.string().trim().min(1).max(200),
  ref: z.string().regex(/^[A-Z]{1,4}[1-9][0-9]{0,6}$/),
  before: spreadsheetCellSchema.nullable(),
  after: spreadsheetCellSchema.nullable(),
}).strict();
export type SpreadsheetCellDiff = z.infer<typeof spreadsheetCellDiffSchema>;

export const artifactProposalSchema = z.object({
  id: z.string().trim().min(1).max(240),
  artifactId: z.string().trim().min(1).max(240),
  baseVersion: z.number().int().positive(),
  type: z.enum(["spreadsheet_ai_diff", "document_edit", "artifact_patch"]),
  status: z.enum(["pending", "accepted", "rejected", "cancelled"]),
  summary: z.string().trim().min(1).max(4_000),
  diffs: z.array(spreadsheetCellDiffSchema).max(50_000).default([]),
  patch: z.record(z.unknown()).default({}),
  proposedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime({ offset: true }),
  decidedAt: z.string().datetime({ offset: true }).nullable().default(null),
}).strict();
export type ArtifactProposal = z.infer<typeof artifactProposalSchema>;

export const artifactInteractionReceiptSchema = z.object({
  id: z.string().uuid(),
  artifactId: z.string().trim().min(1).max(240),
  action: artifactActionSchema,
  actorType: z.enum(["user", "conversation", "system"]),
  fromVersion: z.number().int().positive().nullable().default(null),
  toVersion: z.number().int().positive().nullable().default(null),
  requestId: z.string().uuid().nullable().default(null),
  detail: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type ArtifactInteractionReceipt = z.infer<typeof artifactInteractionReceiptSchema>;

export const artifactComparisonSchema = z.object({
  artifactId: z.string().trim().min(1).max(240),
  leftVersion: z.number().int().positive(),
  rightVersion: z.number().int().positive(),
  leftHash: z.string().regex(/^[a-f0-9]{64}$/),
  rightHash: z.string().regex(/^[a-f0-9]{64}$/),
  changed: z.boolean(),
  topLevelChangedKeys: z.array(z.string().max(300)).max(5_000),
  spreadsheetDiffs: z.array(spreadsheetCellDiffSchema).max(50_000).default([]),
}).strict();
export type ArtifactComparison = z.infer<typeof artifactComparisonSchema>;

export const artifactExportFormatSchema = z.enum(["json", "csv", "xlsx", "pdf", "pptx", "docx", "md"]);
export type ArtifactExportFormat = z.infer<typeof artifactExportFormatSchema>;

export const ARTIFACT_EXPORT_FORMATS: Readonly<Record<ArtifactKind, readonly ArtifactExportFormat[]>> = {
  chart: ["json", "pdf", "pptx"],
  table: ["json", "csv", "xlsx", "pdf", "pptx"],
  screen: ["json", "pdf"],
  valuation: ["json", "xlsx", "pdf", "pptx"],
  portfolio: ["json", "csv", "xlsx", "pdf", "pptx"],
  research: ["json", "md", "pdf", "pptx", "docx"],
  report: ["json", "md", "pdf", "pptx", "docx"],
  spreadsheet: ["json", "xlsx", "pdf", "pptx"],
  data: ["json", "csv", "xlsx"],
  backtest: ["json", "csv", "xlsx", "pdf", "pptx"],
  strategy: ["json", "md"],
  decision: ["json", "md", "pdf", "pptx", "docx"],
  timeline: ["json", "csv", "pdf", "pptx"],
  thesis: ["json", "md", "pdf", "pptx", "docx"],
};

export function artifactExportFormatsForKind(kind: ArtifactKind): readonly ArtifactExportFormat[] {
  return ARTIFACT_EXPORT_FORMATS[kind];
}

export const artifactExportPlanSchema = z.object({
  artifactId: z.string().trim().min(1).max(240),
  version: z.number().int().positive(),
  kind: artifactKindSchema,
  formats: z.array(artifactExportFormatSchema).min(1).max(10),
  filenameStem: z.string().trim().min(1).max(240),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(2_000),
}).strict();
export type ArtifactExportPlan = z.infer<typeof artifactExportPlanSchema>;

export const artifactPackageSchema = z.object({
  version: z.literal(LIOS_ARTIFACT_PACKAGE_VERSION),
  generatedAt: z.string().datetime({ offset: true }),
  sourceProject: z.object({
    id: z.number().int().positive(),
    name: z.string().trim().min(1).max(240),
    manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  sessions: z.array(z.object({
    id: z.string().trim().min(1).max(240),
    parentSessionId: z.string().trim().max(240).nullable(),
    name: z.string().trim().min(1).max(240),
    status: z.enum(["active", "archived"]),
    workspaceState: z.record(z.unknown()),
    stateHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()).max(5_000),
  artifacts: z.array(z.object({
    identity: artifactIdentitySchema,
    versions: z.array(artifactVersionSchema).min(1).max(10_000),
  }).strict()).max(10_000),
  references: z.array(z.object({
    artifactId: z.string().trim().min(1).max(240),
    version: z.number().int().positive().nullable(),
    targetType: artifactReferenceTypeSchema,
    targetRef: z.string().trim().min(1).max(1_000),
    label: z.string().trim().max(500).nullable(),
  }).strict()).max(50_000),
  entitlementRequirements: z.array(z.string().trim().min(1).max(1_000)).max(10_000).default([]),
  excludesCredentials: z.literal(true),
  packageHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type ArtifactPackage = z.infer<typeof artifactPackageSchema>;
