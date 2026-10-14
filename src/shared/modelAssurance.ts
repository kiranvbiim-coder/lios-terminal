import { z } from "zod";
import { quantValidationLevelSchema } from "./quantModelRegistry";

export const modelRiskTierSchema = z.enum(["tier_1_material", "tier_2_analytical", "tier_3_exploratory"]);
export const assuranceBandSchema = z.enum([
  "institutional",
  "decision_grade",
  "review_required",
  "research_only",
  "blocked",
]);
export const validationEvidenceKindSchema = z.enum([
  "known_answer",
  "cross_engine",
  "invariant",
  "boundary",
  "provider_reconciliation",
  "out_of_sample",
  "monte_carlo_stability",
  "regression",
]);
export const outputCriticalitySchema = z.enum([
  "exploratory",
  "internal_analysis",
  "client_advisory",
  "material_decision",
]);

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/, "Expected lowercase SHA-256 digest");
const scoreSchema = z.number().finite().min(0).max(100);

export const persistedValidationEvidenceSchema = z.object({
  kind: validationEvidenceKindSchema,
  passed: z.boolean(),
  independent: z.boolean().default(false),
  details: z.string().max(4000).optional(),
  artifactHash: digestSchema.optional(),
  validatedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable().default(null),
  validator: z.string().min(1).max(200),
  referenceIds: z.array(z.string().min(1)).default([]),
});

export const assuranceIntegritySchema = z.object({
  algorithm: z.literal("ed25519"),
  keyId: z.string().regex(/^[a-f0-9]{16,64}$/, "Expected hexadecimal assurance key identifier"),
  signature: z.string().min(40).max(500),
});

export const unsignedModelAssuranceArtifactSchema = z.object({
  schemaVersion: z.literal("1.0"),
  modelId: z.string().min(1),
  modelVersion: z.string().min(1),
  engineVersion: z.string().min(1),
  riskTier: modelRiskTierSchema,
  validationLevel: quantValidationLevelSchema,
  band: assuranceBandSchema,
  score: scoreSchema,
  components: z.object({
    validation: scoreSchema,
    dataQuality: scoreSchema,
    evidence: scoreSchema,
    reproducibility: scoreSchema,
  }),
  inputSnapshotHash: digestSchema.nullable(),
  validationReportHash: digestSchema.nullable(),
  providerIds: z.array(z.string().min(1)).default([]),
  evidence: z.array(persistedValidationEvidenceSchema),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  uncertainty: z.object({
    quantified: z.boolean(),
    method: z.string().min(1).nullable(),
    summary: z.string().max(4000).nullable(),
  }),
  challenger: z.object({
    required: z.boolean(),
    passed: z.boolean(),
    modelId: z.string().min(1).nullable(),
    artifactHash: digestSchema.nullable(),
  }),
  deterministic: z.boolean(),
  seed: z.number().int().nullable(),
  createdAt: z.string().datetime(),
});

export const modelAssuranceArtifactSchema = unsignedModelAssuranceArtifactSchema.extend({
  integrity: assuranceIntegritySchema,
});

export const decisionAssuranceAttachmentSchema = z.object({
  criticality: outputCriticalitySchema,
  permitted: z.boolean(),
  assurance: modelAssuranceArtifactSchema,
  gateVersion: z.string().min(1),
  evaluatedAt: z.string().datetime(),
  reasonCodes: z.array(z.string().min(1)),
});

export type ModelRiskTier = z.infer<typeof modelRiskTierSchema>;
export type AssuranceBand = z.infer<typeof assuranceBandSchema>;
export type PersistedValidationEvidence = z.infer<typeof persistedValidationEvidenceSchema>;
export type AssuranceIntegrity = z.infer<typeof assuranceIntegritySchema>;
export type UnsignedModelAssuranceArtifact = z.infer<typeof unsignedModelAssuranceArtifactSchema>;
export type ModelAssuranceArtifact = z.infer<typeof modelAssuranceArtifactSchema>;
export type OutputCriticality = z.infer<typeof outputCriticalitySchema>;
export type DecisionAssuranceAttachment = z.infer<typeof decisionAssuranceAttachmentSchema>;
