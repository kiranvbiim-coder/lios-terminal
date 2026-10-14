import { z } from "zod";
import { providerEntitlementDecisionSchema, providerUseRightSchema } from "./universalDataFabric";

export const alternativeEvidenceDataClassSchema = z.enum([
  "estimates",
  "options_chain",
  "commodity_curve",
  "portfolio_holdings",
  "private_series",
]);
export type AlternativeEvidenceDataClass = z.infer<typeof alternativeEvidenceDataClassSchema>;

export const alternativeEvidenceClassSchema = z.enum(["alternative_data", "private_market", "user_owned"]);
export type AlternativeEvidenceClass = z.infer<typeof alternativeEvidenceClassSchema>;

export const alternativeEvidenceIdentitySchema = z.object({
  state: z.enum(["resolved", "ambiguous", "not_found", "not_applicable"]),
  queryKind: z.enum(["name", "ticker", "none"]),
  entityKey: z.string().trim().min(1).max(160),
  entityId: z.string().trim().min(1).max(240).nullable(),
  securityId: z.string().trim().min(1).max(240).nullable(),
  listingId: z.string().trim().min(1).max(240).nullable(),
  name: z.string().trim().min(1).max(500).nullable(),
}).strict();
export type AlternativeEvidenceIdentity = z.infer<typeof alternativeEvidenceIdentitySchema>;

export const alternativeEvidenceRightsSchema = z.object({
  entitlement: providerEntitlementDecisionSchema,
  aiTransmission: providerUseRightSchema,
  internalUse: providerUseRightSchema,
  redistribution: providerUseRightSchema,
  policyReviewed: z.boolean(),
  attribution: z.string().trim().max(500).nullable(),
}).strict();
export type AlternativeEvidenceRights = z.infer<typeof alternativeEvidenceRightsSchema>;

export const normalizedAlternativeEvidenceSchema = z.object({
  evidenceClass: alternativeEvidenceClassSchema,
  dataClass: alternativeEvidenceDataClassSchema,
  snapshotRef: z.string().startsWith("snapshot:"),
  parentSnapshotRef: z.string().startsWith("snapshot:").nullable(),
  providerId: z.string().trim().min(1).max(240),
  sourceId: z.string().trim().min(1).max(500),
  entityKey: z.string().trim().min(1).max(160),
  identity: alternativeEvidenceIdentitySchema,
  clocks: z.object({
    effectiveAt: z.string().datetime({ offset: true }).nullable(),
    publishedAt: z.string().datetime({ offset: true }).nullable(),
    retrievedAt: z.string().datetime({ offset: true }),
    availableAt: z.string().datetime({ offset: true }),
  }).strict(),
  provenance: z.object({
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    lineageHash: z.string().regex(/^[a-f0-9]{64}$/),
    entitlementPolicyId: z.string().trim().min(1).max(240).nullable(),
    qualityScore: z.number().finite().min(0).max(1).nullable(),
    recordCount: z.number().int().nonnegative(),
    missingOptionalFields: z.number().int().nonnegative(),
  }).strict(),
  rights: alternativeEvidenceRightsSchema,
  preview: z.object({
    text: z.string().max(12_000),
    totalRecords: z.number().int().nonnegative(),
    shownRecords: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }).strict(),
}).strict();
export type NormalizedAlternativeEvidence = z.infer<typeof normalizedAlternativeEvidenceSchema>;

export const alternativeEvidenceBlockReasonSchema = z.enum([
  "source_policy_denied",
  "entitlement_denied",
  "entitlement_unknown",
  "internal_use_restricted",
  "internal_use_unknown",
  "ai_transmission_restricted",
  "ai_transmission_unknown",
]);
export type AlternativeEvidenceBlockReason = z.infer<typeof alternativeEvidenceBlockReasonSchema>;
