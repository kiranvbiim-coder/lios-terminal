import { z } from "zod";
import { p7SourceTypeSchema } from "./p7ResearchContracts";
import {
  providerEntitlementDecisionSchema,
  providerUseRightSchema,
} from "./universalDataFabric";

export const RESEARCH_SOURCE_COMPOSITION_VERSION = "1" as const;

export const researchSourceClassSchema = z.enum([
  "public_external",
  "broker_research",
  "expert_content",
  "internal_research",
  "user_file",
]);
export type ResearchSourceClass = z.infer<typeof researchSourceClassSchema>;

export const researchSourceIdentitySchema = z.object({
  sourceId: z.string().trim().min(1).max(1_000),
  providerId: z.string().trim().min(1).max(240).nullable().default(null),
  organization: z.string().trim().min(1).max(500).nullable().default(null),
  author: z.string().trim().min(1).max(500).nullable().default(null),
  analystId: z.string().trim().min(1).max(240).nullable().default(null),
  expertId: z.string().trim().min(1).max(240).nullable().default(null),
  url: z.string().url().max(2_000).nullable().default(null),
}).strict();
export type ResearchSourceIdentity = z.infer<typeof researchSourceIdentitySchema>;

export const researchSourceRightsSchema = z.object({
  entitlement: providerEntitlementDecisionSchema,
  aiTransmission: providerUseRightSchema,
  internalUse: providerUseRightSchema,
  redistribution: providerUseRightSchema,
}).strict();
export type ResearchSourceRights = z.infer<typeof researchSourceRightsSchema>;

export const researchSourceMetadataSchema = z.object({
  class: researchSourceClassSchema,
  identity: researchSourceIdentitySchema,
  rights: researchSourceRightsSchema,
}).strict();
export type ResearchSourceMetadata = z.infer<typeof researchSourceMetadataSchema>;

export const researchCompositionUseSchema = z.enum([
  "internal_research",
  "ai_assistance",
  "redistribution",
]);
export type ResearchCompositionUse = z.infer<typeof researchCompositionUseSchema>;

export const researchCompositionBlockReasonSchema = z.enum([
  "source_identity_unknown",
  "entitlement_denied",
  "entitlement_unknown",
  "internal_use_restricted",
  "internal_use_unknown",
  "ai_transmission_restricted",
  "ai_transmission_unknown",
  "redistribution_restricted",
  "redistribution_unknown",
]);
export type ResearchCompositionBlockReason = z.infer<typeof researchCompositionBlockReasonSchema>;

export const composedResearchSourceSchema = z.object({
  documentId: z.string().trim().min(1).max(300),
  sourceRef: z.string().trim().min(1).max(1_000),
  sourceType: p7SourceTypeSchema,
  title: z.string().trim().min(1).max(1_000),
  sourceClass: researchSourceClassSchema,
  identity: researchSourceIdentitySchema,
  rights: researchSourceRightsSchema,
  occurredAt: z.string().datetime({ offset: true }).nullable(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500),
  entityRefs: z.array(z.string().trim().min(1).max(500)).max(500),
  excerpt: z.string().max(2_000),
}).strict();
export type ComposedResearchSource = z.infer<typeof composedResearchSourceSchema>;

export const blockedResearchSourceSchema = z.object({
  documentId: z.string().trim().min(1).max(300),
  sourceRef: z.string().trim().min(1).max(1_000),
  sourceClass: researchSourceClassSchema.nullable(),
  identity: researchSourceIdentitySchema.nullable(),
  reason: researchCompositionBlockReasonSchema,
}).strict();
export type BlockedResearchSource = z.infer<typeof blockedResearchSourceSchema>;

export const researchSourceCompositionSchema = z.object({
  schemaVersion: z.literal(RESEARCH_SOURCE_COMPOSITION_VERSION),
  targetUse: researchCompositionUseSchema,
  included: z.array(composedResearchSourceSchema).max(500),
  blocked: z.array(blockedResearchSourceSchema).max(500),
  counts: z.object({
    included: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    byClass: z.record(z.number().int().nonnegative()),
    byBlockReason: z.record(z.number().int().nonnegative()),
  }).strict(),
}).strict();
export type ResearchSourceComposition = z.infer<typeof researchSourceCompositionSchema>;
