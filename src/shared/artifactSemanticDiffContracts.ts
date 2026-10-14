import { z } from "zod";

export const artifactSemanticDirectionSchema = z.enum(["up", "down", "flat", "added", "removed"]);
export type ArtifactSemanticDirection = z.infer<typeof artifactSemanticDirectionSchema>;

export const artifactSemanticNumericDeltaSchema = z.object({
  path: z.string().trim().min(1).max(500),
  before: z.number().finite().nullable(),
  after: z.number().finite().nullable(),
  absoluteChange: z.number().finite().nullable(),
  percentChange: z.number().finite().nullable(),
  direction: artifactSemanticDirectionSchema,
  comparable: z.boolean(),
}).strict();
export type ArtifactSemanticNumericDelta = z.infer<typeof artifactSemanticNumericDeltaSchema>;

export const artifactSemanticCollectionDeltaSchema = z.object({
  path: z.string().trim().min(1).max(500),
  addedIds: z.array(z.string().trim().min(1).max(500)).max(10_000),
  removedIds: z.array(z.string().trim().min(1).max(500)).max(10_000),
  changedIds: z.array(z.string().trim().min(1).max(500)).max(10_000),
}).strict();
export type ArtifactSemanticCollectionDelta = z.infer<typeof artifactSemanticCollectionDeltaSchema>;

export const artifactSemanticComparabilityFlagSchema = z.object({
  kind: z.enum(["kind", "model", "missing_value", "collection_identity", "method", "currency", "period"]),
  path: z.string().trim().min(1).max(500).nullable(),
  message: z.string().trim().min(1).max(2_000),
  blocksAttribution: z.boolean(),
}).strict();
export type ArtifactSemanticComparabilityFlag = z.infer<typeof artifactSemanticComparabilityFlagSchema>;

export const artifactSemanticAttributionItemSchema = z.object({
  key: z.string().trim().min(1).max(500),
  contribution: z.number().finite(),
}).strict();

export const artifactSemanticAttributionSchema = z.object({
  available: z.boolean(),
  reason: z.string().trim().min(1).max(1_000).nullable(),
  items: z.array(artifactSemanticAttributionItemSchema).max(1_000),
  totalChange: z.number().finite().nullable(),
  residual: z.number().finite().nullable(),
}).strict();
export type ArtifactSemanticAttribution = z.infer<typeof artifactSemanticAttributionSchema>;

export const artifactSemanticComparisonSchema = z.object({
  materialChange: z.boolean(),
  numericDeltas: z.array(artifactSemanticNumericDeltaSchema).max(10_000),
  collectionDeltas: z.array(artifactSemanticCollectionDeltaSchema).max(10_000),
  comparability: z.array(artifactSemanticComparabilityFlagSchema).max(10_000),
  attribution: artifactSemanticAttributionSchema,
}).strict();
export type ArtifactSemanticComparison = z.infer<typeof artifactSemanticComparisonSchema>;
