import { z } from "zod";

export const universeMemberStatusSchema = z.enum(["active", "delisted", "acquired", "bankrupt", "renamed", "unknown_exit"]);
export const universeMemberSchema = z.object({
  entityKey: z.string().min(1), symbol: z.string().min(1), name: z.string().min(1), exchange: z.string().min(1),
  assetClass: z.string().min(1).default("equity"), currency: z.string().nullable().default(null),
  weight: z.number().finite().nullable().default(null), rank: z.number().int().positive().nullable().default(null),
  validFrom: z.string().date().nullable().default(null), validTo: z.string().date().nullable().default(null),
  status: universeMemberStatusSchema.default("active"), exitReason: z.string().nullable().default(null),
  sourceMemberId: z.string().nullable().default(null), metadata: z.record(z.unknown()).default({}),
}).superRefine((member, ctx) => {
  if (member.validFrom && member.validTo && member.validFrom > member.validTo) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "validFrom must not be after validTo", path: ["validTo"] });
  if (member.status === "active" && member.validTo) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "An active member cannot have validTo", path: ["status"] });
});

export const universePayloadSchema = z.object({
  universeKey: z.string().min(1), name: z.string().min(1), description: z.string(), methodology: z.string(),
  provider: z.string().min(1), sourceName: z.string().min(1), sourceUrl: z.string().url().nullable(),
  effectiveDate: z.string().date(), members: z.array(universeMemberSchema).min(1).max(100_000),
});

export type UniverseMember = z.infer<typeof universeMemberSchema>;
export type UniversePayload = z.infer<typeof universePayloadSchema>;

export const entitlementPolicyInputSchema = z.object({
  provider: z.string().trim().min(1).max(80), dataClass: z.string().trim().min(1).max(80),
  licenseType: z.enum(["public_domain", "open_source", "commercial", "user_supplied", "unknown"]),
  accessScope: z.enum(["internal_only", "organization", "redistributable"]),
  redistribution: z.enum(["allowed", "attribution_required", "restricted", "unknown"]),
  permittedUses: z.array(z.enum(["display", "internal_research", "model_input", "derived_output", "export"])).min(1),
  attribution: z.string().trim().max(500).nullable().default(null), termsUrl: z.string().url().nullable().default(null),
  effectiveFrom: z.string().datetime(), effectiveTo: z.string().datetime().nullable().default(null),
  reviewedAt: z.string().datetime().nullable().default(null), notes: z.string().trim().max(2000).nullable().default(null),
});
export type EntitlementPolicyInput = z.infer<typeof entitlementPolicyInputSchema>;
