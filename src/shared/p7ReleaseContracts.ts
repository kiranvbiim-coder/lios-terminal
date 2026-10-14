import { z } from "zod";

export const P7_RELEASE_SCHEMA_VERSION = "1" as const;

export const p7ReleaseCategorySchema = z.enum([
  "security_privacy",
  "identity_sso",
  "device_session",
  "offline_policy",
  "performance",
  "accessibility",
  "packaging_recovery",
  "enterprise_deployment",
  "release_rights",
]);
export type P7ReleaseCategory = z.infer<typeof p7ReleaseCategorySchema>;

export const p7ReleaseOwnerSchema = z.enum(["engineering", "release_owner", "enterprise_admin"]);
export type P7ReleaseOwner = z.infer<typeof p7ReleaseOwnerSchema>;

export const p7ReleaseStateSchema = z.enum(["ready", "verified", "external_required", "blocked"]);
export type P7ReleaseState = z.infer<typeof p7ReleaseStateSchema>;

export const p7ReleaseReadinessRowSchema = z.object({
  id: z.string().trim().min(1).max(300),
  label: z.string().trim().min(1).max(500),
  category: p7ReleaseCategorySchema,
  owner: p7ReleaseOwnerSchema,
  state: p7ReleaseStateSchema,
  requiredForEngineering: z.boolean(),
  requiredForRelease: z.boolean(),
  evidenceAt: z.string().datetime({ offset: true }).nullable(),
  evidence: z.array(z.string().trim().min(1).max(2_000)).max(100),
  blockers: z.array(z.string().trim().min(1).max(2_000)).max(100),
  nextAction: z.string().trim().min(1).max(2_000),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(100),
}).strict();
export type P7ReleaseReadinessRow = z.infer<typeof p7ReleaseReadinessRowSchema>;

export const p7ReleaseReadinessSnapshotSchema = z.object({
  schemaVersion: z.literal(P7_RELEASE_SCHEMA_VERSION),
  generatedAt: z.string().datetime({ offset: true }),
  status: z.enum(["engineering_blocked", "engineering_ready", "release_certified"]),
  engineeringComplete: z.boolean(),
  releaseCertified: z.boolean(),
  counts: z.object({
    engineeringReady: z.number().int().nonnegative(),
    engineeringBlocked: z.number().int().nonnegative(),
    releaseVerified: z.number().int().nonnegative(),
    externalRequired: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }).strict(),
  rows: z.array(p7ReleaseReadinessRowSchema).max(250),
  engineeringBlockers: z.array(z.string().trim().min(1).max(2_000)).max(250),
  externalBlockers: z.array(z.string().trim().min(1).max(2_000)).max(250),
  notes: z.array(z.string().trim().min(1).max(2_000)).max(50),
}).strict();
export type P7ReleaseReadinessSnapshot = z.infer<typeof p7ReleaseReadinessSnapshotSchema>;
