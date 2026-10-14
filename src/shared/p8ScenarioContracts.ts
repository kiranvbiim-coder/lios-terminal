import { z } from "zod";

export const P8_SCHEMA_VERSION = "1" as const;

export const p8ScenarioKindSchema = z.enum(["base", "bull", "bear", "custom"]);
export type P8ScenarioKind = z.infer<typeof p8ScenarioKindSchema>;

export const p8ComparableScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type P8ComparableScalar = z.infer<typeof p8ComparableScalarSchema>;

export const p8ArtifactBranchRefSchema = z.object({
  artifactId: z.string().trim().min(1).max(240),
  version: z.number().int().positive().optional(),
  scenarioKind: p8ScenarioKindSchema.default("custom"),
  label: z.string().trim().min(1).max(240).optional(),
}).strict();
export type P8ArtifactBranchRef = z.infer<typeof p8ArtifactBranchRefSchema>;

export const p8ScenarioSnapshotSchema = z.object({
  schemaVersion: z.literal(P8_SCHEMA_VERSION),
  artifactId: z.string().trim().min(1).max(240),
  artifactVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(500),
  artifactKind: z.string().trim().min(1).max(100),
  scenarioKind: p8ScenarioKindSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  forkedFromArtifactId: z.string().trim().max(240).nullable(),
  forkedFromVersion: z.number().int().positive().nullable(),
  assumptions: z.record(p8ComparableScalarSchema),
  outputs: z.record(p8ComparableScalarSchema),
}).strict();
export type P8ScenarioSnapshot = z.infer<typeof p8ScenarioSnapshotSchema>;

export const p8ScenarioMatrixRowSchema = z.object({
  key: z.string().trim().min(1).max(1_000),
  section: z.enum(["assumption", "output"]),
  values: z.record(p8ComparableScalarSchema),
  changed: z.boolean(),
}).strict();
export type P8ScenarioMatrixRow = z.infer<typeof p8ScenarioMatrixRowSchema>;

export const p8ScenarioWaterfallItemSchema = z.object({
  branchArtifactId: z.string().trim().min(1).max(240),
  key: z.string().trim().min(1).max(1_000),
  baseValue: z.number(),
  branchValue: z.number(),
  delta: z.number(),
}).strict();
export type P8ScenarioWaterfallItem = z.infer<typeof p8ScenarioWaterfallItemSchema>;

export const p8ScenarioComparisonSchema = z.object({
  schemaVersion: z.literal(P8_SCHEMA_VERSION),
  projectId: z.number().int().positive(),
  rootArtifactId: z.string().trim().min(1).max(240),
  base: p8ScenarioSnapshotSchema,
  branches: z.array(p8ScenarioSnapshotSchema).max(20),
  matrix: z.array(p8ScenarioMatrixRowSchema).max(20_000),
  waterfall: z.array(p8ScenarioWaterfallItemSchema).max(20_000),
  changedAssumptionKeys: z.array(z.string().trim().min(1).max(1_000)).max(10_000),
  changedOutputKeys: z.array(z.string().trim().min(1).max(1_000)).max(10_000),
}).strict();
export type P8ScenarioComparison = z.infer<typeof p8ScenarioComparisonSchema>;

export const p8CompareRequestSchema = z.object({
  base: p8ArtifactBranchRefSchema,
  branches: z.array(p8ArtifactBranchRefSchema).min(1).max(20),
}).strict();
export type P8CompareRequest = z.infer<typeof p8CompareRequestSchema>;

export const p8BranchRequestSchema = z.object({
  scenarioKind: p8ScenarioKindSchema.exclude(["base"]),
  version: z.number().int().positive().optional(),
  title: z.string().trim().min(1).max(500).optional(),
}).strict();
export type P8BranchRequest = z.infer<typeof p8BranchRequestSchema>;

export const p8AssumptionMergeRequestSchema = z.object({
  sourceArtifactId: z.string().trim().min(1).max(240),
  sourceVersion: z.number().int().positive().optional(),
  targetArtifactId: z.string().trim().min(1).max(240),
  targetVersion: z.number().int().positive(),
  keys: z.array(z.string().trim().min(1).max(1_000)).min(1).max(500),
  summary: z.string().trim().min(1).max(4_000).optional(),
}).strict();
export type P8AssumptionMergeRequest = z.infer<typeof p8AssumptionMergeRequestSchema>;

export const p8ModelDraftRequestSchema = z.object({
  baseVersion: z.number().int().positive(),
  summary: z.string().trim().min(1).max(4_000),
  patch: z.record(z.unknown()),
  origin: z.enum(["ai", "user"]).default("ai"),
}).strict();
export type P8ModelDraftRequest = z.infer<typeof p8ModelDraftRequestSchema>;

export const p8ChangeReviewItemSchema = z.object({
  path: z.string().trim().min(1).max(2_000),
  before: z.unknown(),
  after: z.unknown(),
  numericDelta: z.number().nullable(),
}).strict();

export const p8ChangeReviewSchema = z.object({
  changed: z.boolean(),
  changedPaths: z.array(p8ChangeReviewItemSchema).max(50_000),
}).strict();
export type P8ChangeReview = z.infer<typeof p8ChangeReviewSchema>;

export const p8FormulaSurfaceSchema = z.enum(["metric", "chart", "table", "screen", "alert", "factor"]);
export type P8FormulaSurface = z.infer<typeof p8FormulaSurfaceSchema>;

const p8FormulaSampleValuesSchema = z.record(z.number().finite()).superRefine((value, ctx) => {
  if (Object.keys(value).length > 5_000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Formula sample values are limited to 5,000 keys." });
  }
});

export const p8FormulaDraftSchema = z.object({
  expression: z.string().trim().min(1).max(20_000),
  targetSurface: p8FormulaSurfaceSchema,
  targetKey: z.string().trim().min(1).max(500),
  targetArtifactId: z.string().trim().max(240).nullable().default(null),
  sampleValues: p8FormulaSampleValuesSchema.default({}),
}).strict();
export type P8FormulaDraft = z.infer<typeof p8FormulaDraftSchema>;

export const p8FormulaValidationSchema = z.object({
  schemaVersion: z.literal(P8_SCHEMA_VERSION),
  status: z.enum(["valid", "invalid"]),
  expression: z.string(),
  targetSurface: p8FormulaSurfaceSchema,
  targetKey: z.string(),
  dependencies: z.array(z.string()).max(5_000),
  missingSampleValues: z.array(z.string()).max(5_000),
  sampleValue: z.number().nullable(),
  errors: z.array(z.string().max(2_000)).max(100),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type P8FormulaValidation = z.infer<typeof p8FormulaValidationSchema>;

export const p8FormulaPublishSchema = p8FormulaDraftSchema.extend({
  validationFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  approved: z.literal(true),
  title: z.string().trim().min(1).max(500).optional(),
}).strict();
export type P8FormulaPublish = z.infer<typeof p8FormulaPublishSchema>;

const p8DecisionScenarioSchema = z.object({
  id: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(1_000),
  kind: p8ScenarioKindSchema,
  artifactRef: z.string().trim().max(500).nullable().default(null),
  summary: z.string().max(10_000).default(""),
}).strict();

const p8DecisionAlternativeSchema = z.object({
  id: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(1_000),
  expectedOutcomes: z.array(z.string().max(10_000)).max(200).default([]),
  risks: z.array(z.string().max(10_000)).max(200).default([]),
  tradeoffs: z.array(z.string().max(10_000)).max(200).default([]),
}).strict();

export const p8DecisionObjectRequestSchema = z.object({
  title: z.string().trim().min(1).max(500),
  objective: z.string().trim().min(1).max(20_000),
  whatChanged: z.array(z.string().max(10_000)).max(500).default([]),
  why: z.array(z.string().max(10_000)).max(500).default([]),
  scenarios: z.array(p8DecisionScenarioSchema).max(100).default([]),
  constraints: z.array(z.string().max(10_000)).max(500).default([]),
  assumptions: z.record(z.unknown()).default({}),
  alternatives: z.array(p8DecisionAlternativeSchema).max(200).default([]),
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
export type P8DecisionObjectRequest = z.infer<typeof p8DecisionObjectRequestSchema>;
