import { z } from "zod";

export const quantModelStatusSchema = z.enum(["validated", "implemented", "experimental", "synthetic", "planned"]);
export const quantValidationLevelSchema = z.enum([
  "known_answer", "regression_tested", "implementation_reviewed", "benchmark_required", "research_only", "not_started",
]);
export const quantDeterminismSchema = z.enum(["deterministic", "seeded_stochastic", "provider_dependent"]);
export const quantDataModeSchema = z.enum(["point_in_time", "live_provider", "user_supplied", "mixed", "synthetic_only"]);

export const quantModelRegistryEntrySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  category: z.string().min(1),
  program: z.enum(["quant_acceleration", "financial_modelling", "shared_foundation"]),
  engine: z.enum(["python_sidecar", "typescript", "spreadsheet", "ai_interpretation", "data_service"]),
  status: quantModelStatusSchema,
  validationLevel: quantValidationLevelSchema,
  determinism: quantDeterminismSchema,
  dataMode: quantDataModeSchema,
  version: z.string().min(1),
  apiEndpoint: z.string().optional(),
  engineEndpoint: z.string().optional(),
  surfaces: z.array(z.string()),
  components: z.array(z.string()),
  sourceFiles: z.array(z.string()).min(1),
  references: z.array(z.object({ label: z.string(), url: z.string().url() })),
  limitations: z.array(z.string()),
  nextValidation: z.string().min(1),
});

/**
 * A source binding deliberately carries Data Truth's connector/provider/field
 * identifiers plus the immutable snapshot that supplied the model input.
 * It is the run-level counterpart to DataPassportEntry, not a second
 * provider taxonomy.
 */
export const quantInputDataClassificationSchema = z.enum([
  "live", "delayed", "historical", "cached", "manual", "synthetic", "model_derived", "fallback",
]);

/** Explicit adapter over existing canonical snapshot numeric columns, recorded in the native receipt. */
export const canonicalSnapshotColumnSchema = z.object({
  field: z.string().trim().min(1).max(160),
  selection: z.enum(["values", "last"]),
  scale: z.number().finite().refine(value => value !== 0),
  rowsWhereFinite: z.string().trim().min(1).max(160).optional(),
}).strict();
export function canonicalSnapshotColumnTransform(input: z.infer<typeof canonicalSnapshotColumnSchema>): string {
  return `canonical-column:${JSON.stringify(canonicalSnapshotColumnSchema.parse(input))}`;
}

export const quantInputSourceBindingSchema = z.object({
  contractFamily: z.string().trim().min(1).max(160),
  field: z.string().trim().min(1).max(200),
  connectorId: z.string().trim().min(1).max(160),
  provider: z.string().trim().min(1).max(160),
  priority: z.enum(["primary", "secondary", "fallback", "manual_override"]),
  sourceReference: z.string().trim().min(1).max(2_000),
  asOf: z.string().datetime(),
  retrievedAt: z.string().datetime(),
  freshness: z.string().trim().min(1).max(160),
  snapshot: z.object({
    id: z.string().trim().min(1).max(200),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  transformations: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
}).strict();

const advancedQuantInputProvenanceBaseSchema = z.object({
  dataClassification: quantInputDataClassificationSchema,
  sourceBindings: z.array(quantInputSourceBindingSchema).max(500).optional(),
  transformations: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
  manualInputs: z.record(z.unknown()).optional(),
  syntheticContext: z.enum(["sample", "experiment"]).optional(),
  derivedFrom: z.object({
    modelId: z.string().trim().min(1).max(200),
    modelVersion: z.string().trim().min(1).max(100),
    outputSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional(),
}).strict();

function validateAdvancedQuantInputProvenance(
  value: z.infer<typeof advancedQuantInputProvenanceBaseSchema>,
  ctx: z.RefinementCtx,
) {
  const sourceBound = ["live", "delayed", "historical", "cached", "fallback"].includes(value.dataClassification);
  if (sourceBound && !value.sourceBindings?.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceBindings"], message: "Source-bound classifications require at least one source binding." });
  }
  if (value.dataClassification === "manual" && !value.manualInputs) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["manualInputs"], message: "Manual provenance must record the exact user-supplied inputs." });
  }
  if (value.dataClassification === "synthetic" && !value.syntheticContext) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["syntheticContext"], message: "Synthetic provenance must identify a sample or experiment." });
  }
  if (value.dataClassification === "model_derived" && !value.derivedFrom) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["derivedFrom"], message: "Model-derived provenance must identify its upstream model output." });
  }
}

export const advancedQuantInputProvenanceSchema = advancedQuantInputProvenanceBaseSchema.superRefine(validateAdvancedQuantInputProvenance);

export const resolvedAdvancedQuantInputProvenanceSchema = advancedQuantInputProvenanceBaseSchema.extend({
  declaration: z.enum(["explicit", "legacy_default"]),
}).strict().superRefine(validateAdvancedQuantInputProvenance);

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => sameJsonValue(item, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(rightRecord, key) && sameJsonValue(leftRecord[key], rightRecord[key]));
}

export function resolveAdvancedQuantInputProvenance(
  parameters: Record<string, unknown>,
  inputProvenance?: unknown,
) {
  if (inputProvenance === undefined) {
    return {
      success: true as const,
      data: resolvedAdvancedQuantInputProvenanceSchema.parse({
        dataClassification: "manual",
        sourceBindings: [],
        transformations: [],
        manualInputs: parameters,
        declaration: "legacy_default",
      }),
    };
  }
  const parsed = advancedQuantInputProvenanceSchema.safeParse(inputProvenance);
  if (!parsed.success) return parsed;
  if (parsed.data.dataClassification === "manual" && !sameJsonValue(parsed.data.manualInputs, parameters)) {
    return {
      success: false as const,
      error: new z.ZodError([{
        code: z.ZodIssueCode.custom,
        path: ["manualInputs"],
        message: "manualInputs must exactly match the submitted model parameters.",
      }]),
    };
  }
  return {
    success: true as const,
    data: resolvedAdvancedQuantInputProvenanceSchema.parse({
      ...parsed.data,
      sourceBindings: parsed.data.sourceBindings ?? [],
      declaration: "explicit",
    }),
  };
}


export const quantRunEnvelopeSchema = z.object({
  modelId: z.string().min(1),
  modelVersion: z.string().min(1),
  runId: z.string().min(1),
  inputSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  outputSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  datasetSnapshotIds: z.array(z.string()),
  effectiveAt: z.string().datetime().nullable(),
  calculatedAt: z.string().datetime(),
  seed: z.number().int().nullable(),
  parameters: z.record(z.unknown()),
  diagnostics: z.record(z.unknown()),
  warnings: z.array(z.string()),
  result: z.unknown(),
});
export const advancedQuantRunReceiptSchema = quantRunEnvelopeSchema.extend({
  modelPath: z.string().min(1),
  validationLevel: quantValidationLevelSchema,
  dataClassification: quantInputDataClassificationSchema,
  inputProvenance: resolvedAdvancedQuantInputProvenanceSchema,
  sourceBindings: z.array(quantInputSourceBindingSchema),
  transformations: z.array(z.string()),
  auditEventType: z.literal("advanced_quant_run"),
});

export type QuantModelStatus = z.infer<typeof quantModelStatusSchema>;
export type QuantValidationLevel = z.infer<typeof quantValidationLevelSchema>;
export type QuantModelRegistryEntry = z.infer<typeof quantModelRegistryEntrySchema>;
export type QuantRunEnvelope = z.infer<typeof quantRunEnvelopeSchema>;
export type QuantInputDataClassification = z.infer<typeof quantInputDataClassificationSchema>;
export type QuantInputSourceBinding = z.infer<typeof quantInputSourceBindingSchema>;
export type AdvancedQuantInputProvenance = z.infer<typeof advancedQuantInputProvenanceSchema>;
export type ResolvedAdvancedQuantInputProvenance = z.infer<typeof resolvedAdvancedQuantInputProvenanceSchema>;
export type AdvancedQuantRunReceipt = z.infer<typeof advancedQuantRunReceiptSchema>;
