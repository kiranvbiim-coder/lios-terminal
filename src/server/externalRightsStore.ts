import crypto from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { externalRightsAssessments } from "@shared/schema";
import { externalRightsSchema, type ExternalRights } from "@shared/universalDataFabric";
import { isCredentialSafeReference } from "@shared/dataFabric";
import type { TenantContext } from "./tenantContext";
import { getDb } from "./db";

export const externalRightsSubjectKindSchema = z.enum([
  "software",
  "api",
  "data",
  "model",
  "asset",
  "trademark",
  "combined",
]);
export type ExternalRightsSubjectKind = z.infer<typeof externalRightsSubjectKindSchema>;

export const externalRightsAssessmentInputSchema = z.object({
  subjectId: z.string().trim().min(1).max(500),
  subjectKind: externalRightsSubjectKindSchema,
  rights: externalRightsSchema,
  notes: z.string().trim().max(4_000).nullable().default(null),
  reviewedAt: z.string().datetime({ offset: true }).default(() => new Date().toISOString()),
}).strict();

export type ExternalRightsAssessmentInput = z.infer<typeof externalRightsAssessmentInputSchema>;

function orgClause(ctx: TenantContext) {
  return ctx.organizationId === null
    ? isNull(externalRightsAssessments.organizationId)
    : eq(externalRightsAssessments.organizationId, ctx.organizationId);
}

export function validateExternalRightsAssessmentInput(raw: unknown): ExternalRightsAssessmentInput {
  const parsed = externalRightsAssessmentInputSchema.parse(raw);
  if (!isCredentialSafeReference(parsed.subjectId)) throw new Error("Rights subject identifier must not contain credentials.");
  if (parsed.notes && !isCredentialSafeReference(parsed.notes)) throw new Error("Rights notes must not contain credentials.");
  if (parsed.rights.apiTerms.termsUrl && !isCredentialSafeReference(parsed.rights.apiTerms.termsUrl)) {
    throw new Error("API terms URL must not contain credentials.");
  }
  return parsed;
}

export async function recordExternalRightsAssessment(
  ctx: TenantContext,
  raw: ExternalRightsAssessmentInput,
) {
  const input = validateExternalRightsAssessmentInput(raw);
  const db = getDb();
  const [prior] = await db.select({ version: externalRightsAssessments.version })
    .from(externalRightsAssessments)
    .where(and(
      eq(externalRightsAssessments.ownerUserId, ctx.userId),
      orgClause(ctx),
      eq(externalRightsAssessments.subjectKind, input.subjectKind),
      eq(externalRightsAssessments.subjectId, input.subjectId),
    ))
    .orderBy(desc(externalRightsAssessments.version))
    .limit(1);
  const version = (prior?.version ?? 0) + 1;
  const [created] = await db.insert(externalRightsAssessments).values({
    id: crypto.randomUUID(),
    ownerUserId: ctx.userId,
    organizationId: ctx.organizationId,
    subjectId: input.subjectId,
    subjectKind: input.subjectKind,
    version,
    rights: input.rights as ExternalRights,
    notes: input.notes,
    reviewedAt: new Date(input.reviewedAt),
    reviewedByUserId: ctx.userId,
  }).returning();
  return created;
}

export async function listExternalRightsAssessments(
  ctx: TenantContext,
  filters: { subjectId?: string; subjectKind?: ExternalRightsSubjectKind; limit?: number } = {},
) {
  const conditions = [
    eq(externalRightsAssessments.ownerUserId, ctx.userId),
    orgClause(ctx),
    filters.subjectId ? eq(externalRightsAssessments.subjectId, filters.subjectId) : undefined,
    filters.subjectKind ? eq(externalRightsAssessments.subjectKind, filters.subjectKind) : undefined,
  ].filter((value): value is NonNullable<typeof value> => value !== undefined);
  return getDb().select().from(externalRightsAssessments)
    .where(and(...conditions))
    .orderBy(desc(externalRightsAssessments.reviewedAt), desc(externalRightsAssessments.version))
    .limit(Math.min(Math.max(filters.limit ?? 100, 1), 500));
}

export async function getLatestExternalRightsAssessment(
  ctx: TenantContext,
  subjectKind: ExternalRightsSubjectKind,
  subjectId: string,
) {
  const [row] = await getDb().select().from(externalRightsAssessments)
    .where(and(
      eq(externalRightsAssessments.ownerUserId, ctx.userId),
      orgClause(ctx),
      eq(externalRightsAssessments.subjectKind, subjectKind),
      eq(externalRightsAssessments.subjectId, subjectId),
    ))
    .orderBy(desc(externalRightsAssessments.version))
    .limit(1);
  return row ?? null;
}
