import { z } from "zod";
import type { QuantModelRegistryEntry } from "./quantModelRegistry";

export const quantWorkspaceSchema = z.enum([
  "dataset", "statistics", "econometrics", "forecasting", "risk", "portfolio",
  "derivatives", "backtest", "ml", "results", "registry",
]);
export const quantExperimentStatusSchema = z.enum(["active", "archived"]);
export const quantRunStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled", "timed_out"]);

export const quantDatasetInputBindingSchema = z.object({
  snapshotId: z.string().uuid(),
  field: z.string().trim().min(1).max(160),
  parameter: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,99}$/).refine(value => !["constructor", "prototype", "seed"].includes(value), { message: "Bind a numerical model input, not a reserved runtime control." }),
  selection: z.enum(["values", "last"]),
  scale: z.number().finite().refine(value => value !== 0).default(1),
}).strict();
export type QuantDatasetInputBinding = z.infer<typeof quantDatasetInputBindingSchema>;
export const quantDatasetInputBindingsSchema = z.array(quantDatasetInputBindingSchema).max(50).superRefine((bindings, ctx) => {
  if (new Set(bindings.map(binding => binding.parameter)).size !== bindings.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Each engine parameter requires exactly one dataset binding." });
});

export const createQuantExperimentSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).default(""),
  workspace: quantWorkspaceSchema,
  modelId: z.string().trim().min(1).max(200),
  parameters: z.record(z.unknown()).default({}),
  datasetSnapshotIds: z.array(z.string().min(1).max(100)).max(50).default([]),
  datasetInputBindings: quantDatasetInputBindingsSchema.default([]),
  seed: z.number().int().min(0).max(2_147_483_647).nullable().default(null),
  timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000),
  investigationId: z.number().int().positive().nullable().default(null),
  organizationId: z.number().int().positive().nullable().default(null),
});

export const editQuantExperimentSchema = createQuantExperimentSchema.partial().extend({
  status: quantExperimentStatusSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const quantRunRequestSchema = z.object({
  parameters: z.record(z.unknown()).optional(),
  datasetSnapshotIds: z.array(z.string().min(1).max(100)).max(50).optional(),
  datasetInputBindings: quantDatasetInputBindingsSchema.optional(),
  seed: z.number().int().min(0).max(2_147_483_647).nullable().optional(),
  timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
  bypassCache: z.boolean().default(false),
});

export type QuantWorkspace = z.infer<typeof quantWorkspaceSchema>;
export type QuantRunStatus = z.infer<typeof quantRunStatusSchema>;
export type CreateQuantExperiment = z.infer<typeof createQuantExperimentSchema>;
export type QuantRunRequest = z.infer<typeof quantRunRequestSchema>;

export const QUANT_WORKSPACE_CATEGORIES: Record<QuantWorkspace, string[]> = {
  dataset: ["financial_data_fabric", "research_data", "research_intelligence"],
  statistics: ["statistics"],
  econometrics: ["econometrics", "economics_and_policy", "macro"],
  forecasting: ["forecasting"],
  risk: ["asset_pricing_and_risk", "credit_and_operational_risk", "credit_risk", "risk", "climate"],
  portfolio: ["portfolio_optimization", "general_optimization", "supply_chain"],
  derivatives: ["options_and_volatility", "derivatives", "fixed_income"],
  backtest: ["backtesting"],
  ml: ["machine_learning", "environment"],
  results: ["valuation", "financial_modelling", "decision_intelligence"],
  registry: [],
};

export function quantModelWorkspace(model: QuantModelRegistryEntry): QuantWorkspace {
  const match = (Object.entries(QUANT_WORKSPACE_CATEGORIES) as Array<[QuantWorkspace, string[]]>)
    .find(([, categories]) => categories.includes(model.category));
  return match?.[0] ?? "registry";
}

function flattenQuantOutput(value: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (Object.keys(out).length >= 500) return out;
  if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      flattenQuantOutput(nested, prefix ? `${prefix}.${key}` : key, out);
    }
  } else out[prefix || "value"] = value;
  return out;
}

export function compareQuantOutputs(left: unknown, right: unknown) {
  const a = flattenQuantOutput(left); const b = flattenQuantOutput(right);
  const paths = Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).sort();
  const changes = paths.flatMap((path) => {
    if (Object.is(a[path], b[path])) return [];
    const leftValue = a[path]; const rightValue = b[path];
    const delta = typeof leftValue === "number" && typeof rightValue === "number" ? rightValue - leftValue : null;
    const deltaPct = delta !== null && leftValue !== 0 ? delta / Math.abs(leftValue as number) : null;
    return [{ path, left: leftValue ?? null, right: rightValue ?? null, delta, deltaPct }];
  });
  return { equal: changes.length === 0, comparedPaths: paths.length, changedPaths: changes.length, changes: changes.slice(0, 250), truncated: changes.length > 250 };
}
