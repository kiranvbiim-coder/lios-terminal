import type { Express } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { requireRole } from "./auth";
import { recordAuditEvent, auditActor } from "./auditEvents";
import {
  contentOrganizationLinks,
  domains,
  organizations,
  publishedContent,
  researchBriefs,
  researchEvidence,
  researchEvidenceRelationships,
  researchInvestigations,
  researchSavedSearches,
} from "@shared/schema";
import {
  buildResearchBrief,
  canAccessResearchOrganization,
  compareEvidenceSnapshots,
  createEvidenceFingerprint,
  defaultSourceQuality,
} from "./researchService";
import { unifiedResearchSearch } from "./researchSearch";

const investigationStatusSchema = z.enum(["draft", "active", "review", "completed", "archived"]);
const evidenceTypeSchema = z.enum([
  "filing", "news", "official_data", "market_data", "model_output", "uploaded_document", "internal_note", "claim",
]);
const evidenceKindSchema = z.enum(["fact", "claim", "calculation", "interpretation", "counterargument", "unknown"]);
const optionalId = z.number().int().positive().nullable().optional();

const createInvestigationSchema = z.object({
  title: z.string().trim().min(1).max(160),
  question: z.string().trim().min(1).max(5000),
  thesis: z.string().trim().max(10000).nullable().optional(),
  status: investigationStatusSchema.default("draft"),
  primarySymbol: z.string().trim().max(30).nullable().optional(),
  subjectLabel: z.string().trim().max(200).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  scope: z.record(z.unknown()).default({}),
  companyId: optionalId,
  domainId: optionalId,
  organizationId: optionalId,
});

const editInvestigationSchema = createInvestigationSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required.",
);

const qualityComponent = z.number().min(0).max(1);
const sourceQualitySchema = z.object({
  authority: qualityComponent,
  directness: qualityComponent,
  recency: qualityComponent,
  corroboration: qualityComponent,
  extractionConfidence: qualityComponent,
});

const addEvidenceSchema = z.object({
  evidenceType: evidenceTypeSchema,
  evidenceKind: evidenceKindSchema.default("unknown"),
  title: z.string().trim().min(1).max(500),
  excerpt: z.string().trim().max(20000).nullable().optional(),
  annotation: z.string().trim().max(10000).nullable().optional(),
  sourceName: z.string().trim().min(1).max(200),
  provider: z.string().trim().min(1).max(100),
  sourceUrl: z.string().url().max(4000).nullable().optional(),
  sourceExternalId: z.string().trim().max(500).nullable().optional(),
  publishedAt: z.coerce.date().nullable().optional(),
  effectiveAt: z.coerce.date().nullable().optional(),
  retrievedAt: z.coerce.date().optional(),
  sourceQuality: sourceQualitySchema.optional(),
  relevanceScore: z.number().min(0).max(1).nullable().optional(),
  metadata: z.record(z.unknown()).default({}),
});

const editEvidenceSchema = z.object({
  evidenceKind: evidenceKindSchema.optional(),
  annotation: z.string().trim().max(10000).nullable().optional(),
  sourceQuality: sourceQualitySchema.optional(),
  relevanceScore: z.number().min(0).max(1).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required.");

const researchFiltersSchema = z.object({
  entity: z.string().trim().max(30).optional(),
  sourceClasses: z.array(z.enum(["filing", "news", "official_data", "published_content", "private_data"])).max(5).optional(),
  documentTypes: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  domainId: z.number().int().positive().optional(),
  freshnessDays: z.number().int().positive().max(3650).optional(),
}).default({});

const searchSchema = z.object({
  query: z.string().trim().max(300).default(""),
  investigationId: z.number().int().positive().optional(),
  filters: researchFiltersSchema,
  limit: z.number().int().min(1).max(50).default(20),
}).refine((value) => value.query.length > 0 || Boolean(value.filters.entity), "A query or entity is required.");

const savedSearchSchema = z.object({
  investigationId: z.number().int().positive().nullable().optional(),
  name: z.string().trim().min(1).max(120),
  query: z.string().trim().max(300).default(""),
  filters: researchFiltersSchema,
}).refine((value) => value.query.length > 0 || Boolean(value.filters.entity), "A query or entity is required.");

const relationshipSchema = z.object({
  fromEvidenceId: z.number().int().positive(),
  toEvidenceId: z.number().int().positive(),
  relationshipType: z.enum(["supports", "contradicts", "supersedes", "derived_from", "affects", "cites"]),
  note: z.string().trim().max(2000).nullable().optional(),
}).refine((value) => value.fromEvidenceId !== value.toEvidenceId, "Evidence cannot relate to itself.");

const publishBriefSchema = z.object({
  domainSlug: z.string().trim().min(1).default("finance"),
  visibility: z.enum(["all_clients", "specific_orgs"]).default("specific_orgs"),
});

const READ_ROLES = ["internal_admin", "internal_analyst", "internal_compliance"] as const;
const AUTHOR_ROLES = ["internal_admin", "internal_analyst"] as const;

function parseId(value: unknown): number | null {
  if (Array.isArray(value)) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function loadInvestigation(id: number) {
  const db = getDb();
  const [investigation] = await db.select().from(researchInvestigations)
    .where(eq(researchInvestigations.id, id)).limit(1);
  return investigation ?? null;
}

export function registerResearchRoutes(app: Express): void {
  app.post("/api/research/search", requireRole(...READ_ROLES), async (req, res) => {
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const investigation = parsed.data.investigationId ? await loadAccessibleInvestigation(parsed.data.investigationId, req.user!) : null;
    if (parsed.data.investigationId && !investigation) return res.status(404).json({ error: "Investigation not found." });
    const response = await unifiedResearchSearch({
      query: parsed.data.query,
      filters: parsed.data.filters,
      organizationId: investigation?.organizationId,
      limit: parsed.data.limit,
    });
    res.json(response);
  });

  app.get("/api/research/saved-searches", requireRole(...READ_ROLES), async (req, res) => {
    const db = getDb();
    const rows = await db.select().from(researchSavedSearches)
      .where(eq(researchSavedSearches.ownerUserId, req.user!.id))
      .orderBy(desc(researchSavedSearches.updatedAt));
    res.json(rows);
  });

  app.post("/api/research/saved-searches", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = savedSearchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    if (parsed.data.investigationId && !await loadAccessibleInvestigation(parsed.data.investigationId, req.user!, true)) {
      return res.status(404).json({ error: "Investigation not found." });
    }
    const db = getDb();
    const [saved] = await db.insert(researchSavedSearches).values({ ...parsed.data, ownerUserId: req.user!.id }).returning();
    await recordAuditEvent(req.user!.id, "research_search_saved", { savedSearchId: saved.id, investigationId: saved.investigationId, ...auditActor(req.user!) });
    res.status(201).json(saved);
  });

  app.delete("/api/research/saved-searches/:id", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid saved search id." });
    const db = getDb();
    const [deleted] = await db.delete(researchSavedSearches).where(and(
      eq(researchSavedSearches.id, id),
      eq(researchSavedSearches.ownerUserId, req.user!.id),
    )).returning();
    if (!deleted) return res.status(404).json({ error: "Saved search not found." });
    res.json({ ok: true });
  });

  app.get("/api/research/investigations", requireRole(...READ_ROLES), async (req, res) => {
    const parsedStatus = req.query.status ? investigationStatusSchema.safeParse(req.query.status) : null;
    if (parsedStatus && !parsedStatus.success) return res.status(400).json({ error: "Invalid investigation status." });
    const db = getDb();
    const candidates = parsedStatus?.success
      ? await db.select().from(researchInvestigations)
          .where(eq(researchInvestigations.status, parsedStatus.data))
          .orderBy(desc(researchInvestigations.updatedAt))
      : await db.select().from(researchInvestigations).orderBy(desc(researchInvestigations.updatedAt));
    const rows = candidates.filter((item) => canReadInvestigation(req.user!, item));
    res.json(rows);
  });

  app.get("/api/research/investigations/:id", requireRole(...READ_ROLES), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid investigation id." });
    const investigation = await loadAccessibleInvestigation(id, req.user!);
    if (!investigation) return res.status(404).json({ error: "Investigation not found." });

    const db = getDb();
    const [evidence, relationships, briefs, savedSearches] = await Promise.all([
      db.select().from(researchEvidence).where(eq(researchEvidence.investigationId, id)).orderBy(desc(researchEvidence.createdAt)),
      db.select().from(researchEvidenceRelationships).where(eq(researchEvidenceRelationships.investigationId, id)).orderBy(desc(researchEvidenceRelationships.createdAt)),
      db.select({ id: researchBriefs.id, title: researchBriefs.title, snapshotHash: researchBriefs.snapshotHash, createdAt: researchBriefs.createdAt })
        .from(researchBriefs).where(eq(researchBriefs.investigationId, id)).orderBy(desc(researchBriefs.createdAt)),
      db.select().from(researchSavedSearches).where(and(
        eq(researchSavedSearches.investigationId, id),
        eq(researchSavedSearches.ownerUserId, req.user!.id),
      )).orderBy(desc(researchSavedSearches.updatedAt)),
    ]);
    res.json({ ...investigation, evidence, relationships, briefs, savedSearches });
  });

  app.post("/api/research/investigations", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = createInvestigationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const completedAt = parsed.data.status === "completed" ? new Date() : null;
    const db = getDb();
    if (parsed.data.organizationId != null && !await organizationExists(parsed.data.organizationId)) {
      return res.status(400).json({ error: "Organization not found." });
    }
    const [investigation] = await db.insert(researchInvestigations).values({
      ...parsed.data,
      primarySymbol: parsed.data.primarySymbol?.toUpperCase() || null,
      ownerUserId: req.user!.id,
      completedAt,
    }).returning();
    await recordAuditEvent(req.user!.id, "research_investigation_created", {
      investigationId: investigation.id,
      status: investigation.status,
      organizationId: investigation.organizationId,
      ...auditActor(req.user!),
    });
    res.status(201).json(investigation);
  });

  app.patch("/api/research/investigations/:id", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid investigation id." });
    const parsed = editInvestigationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const existing = await loadAccessibleInvestigation(id, req.user!, true);
    if (!existing) return res.status(404).json({ error: "Investigation not found." });

    const data = parsed.data;
    const nextStatus = data.status ?? existing.status;
    const completedAt = nextStatus === "completed" ? existing.completedAt ?? new Date() : null;
    if (data.organizationId !== undefined && data.organizationId !== existing.organizationId && req.user!.role !== "internal_admin") {
      return res.status(403).json({ error: "Only an internal administrator can move an investigation between organizations." });
    }
    if (data.organizationId != null && !await organizationExists(data.organizationId)) {
      return res.status(400).json({ error: "Organization not found." });
    }
    const db = getDb();
    const [investigation] = await db.update(researchInvestigations).set({
      ...data,
      primarySymbol: data.primarySymbol === undefined ? undefined : data.primarySymbol?.toUpperCase() || null,
      completedAt,
      updatedAt: new Date(),
    }).where(eq(researchInvestigations.id, id)).returning();
    await recordAuditEvent(req.user!.id, "research_investigation_updated", {
      investigationId: id,
      fromStatus: existing.status,
      toStatus: investigation.status,
      ...auditActor(req.user!),
    });
    res.json(investigation);
  });

  app.post("/api/research/investigations/:id/evidence", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const investigationId = parseId(req.params.id);
    if (!investigationId) return res.status(400).json({ error: "Invalid investigation id." });
    const parsed = addEvidenceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    if (!await loadAccessibleInvestigation(investigationId, req.user!, true)) return res.status(404).json({ error: "Investigation not found." });

    const input = parsed.data;
    const fingerprint = createEvidenceFingerprint({
      provider: input.provider,
      sourceExternalId: input.sourceExternalId,
      sourceUrl: input.sourceUrl,
      title: input.title,
      publishedAt: input.publishedAt,
    });
    const db = getDb();
    const [duplicate] = await db.select({ id: researchEvidence.id }).from(researchEvidence)
      .where(and(
        eq(researchEvidence.investigationId, investigationId),
        eq(researchEvidence.contentFingerprint, fingerprint),
      )).limit(1);
    if (duplicate) return res.status(409).json({ error: "This evidence is already attached to the investigation.", evidenceId: duplicate.id });

    let evidence;
    try {
      [evidence] = await db.insert(researchEvidence).values({
        ...input,
        investigationId,
        contentFingerprint: fingerprint,
        sourceQuality: input.sourceQuality ?? defaultSourceQuality(input.evidenceType, input.provider, Boolean(input.sourceUrl)),
        addedByUserId: req.user!.id,
      }).returning();
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return res.status(409).json({ error: "This evidence is already attached to the investigation." });
      }
      throw error;
    }
    await db.update(researchInvestigations).set({ updatedAt: new Date() })
      .where(eq(researchInvestigations.id, investigationId));
    await recordAuditEvent(req.user!.id, "research_evidence_added", {
      investigationId,
      evidenceId: evidence.id,
      evidenceType: evidence.evidenceType,
      provider: evidence.provider,
      ...auditActor(req.user!),
    });
    res.status(201).json(evidence);
  });

  app.patch("/api/research/evidence/:id", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid evidence id." });
    const parsed = editEvidenceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const db = getDb();
    const [existing] = await db.select().from(researchEvidence).where(eq(researchEvidence.id, id)).limit(1);
    if (!existing || !await loadAccessibleInvestigation(existing.investigationId, req.user!, true)) {
      return res.status(404).json({ error: "Evidence not found." });
    }
    const [evidence] = await db.update(researchEvidence).set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(researchEvidence.id, id)).returning();
    if (!evidence) return res.status(404).json({ error: "Evidence not found." });
    await db.update(researchInvestigations).set({ updatedAt: new Date() })
      .where(eq(researchInvestigations.id, evidence.investigationId));
    await recordAuditEvent(req.user!.id, "research_evidence_updated", {
      investigationId: evidence.investigationId,
      evidenceId: id,
      ...auditActor(req.user!),
    });
    res.json(evidence);
  });

  app.delete("/api/research/evidence/:id", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const id = parseId(req.params.id);
    const db = getDb();
    if (!id) return res.status(400).json({ error: "Invalid evidence id." });
    const [existing] = await db.select().from(researchEvidence).where(eq(researchEvidence.id, id)).limit(1);
    if (!existing || !await loadAccessibleInvestigation(existing.investigationId, req.user!, true)) {
      return res.status(404).json({ error: "Evidence not found." });
    }
    const [evidence] = await db.delete(researchEvidence).where(eq(researchEvidence.id, id)).returning();
    if (!evidence) return res.status(404).json({ error: "Evidence not found." });
    await recordAuditEvent(req.user!.id, "research_evidence_removed", {
      investigationId: evidence.investigationId,
      evidenceId: id,
      ...auditActor(req.user!),
    });
    res.json({ ok: true });
  });

  app.post("/api/research/investigations/:id/relationships", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const investigationId = parseId(req.params.id);
    if (!investigationId) return res.status(400).json({ error: "Invalid investigation id." });
    const parsed = relationshipSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    if (!await loadAccessibleInvestigation(investigationId, req.user!, true)) {
      return res.status(404).json({ error: "Investigation not found." });
    }
    const db = getDb();
    const evidence = await db.select({ id: researchEvidence.id }).from(researchEvidence).where(and(
      eq(researchEvidence.investigationId, investigationId),
    ));
    const validIds = new Set(evidence.map((item) => item.id));
    if (!validIds.has(parsed.data.fromEvidenceId) || !validIds.has(parsed.data.toEvidenceId)) {
      return res.status(400).json({ error: "Both evidence items must belong to this investigation." });
    }
    try {
      const [relationship] = await db.insert(researchEvidenceRelationships).values({
        ...parsed.data,
        investigationId,
        createdByUserId: req.user!.id,
      }).returning();
      await recordAuditEvent(req.user!.id, "research_relationship_created", { investigationId, relationshipId: relationship.id, relationshipType: relationship.relationshipType, ...auditActor(req.user!) });
      res.status(201).json(relationship);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return res.status(409).json({ error: "This relationship already exists." });
      throw error;
    }
  });

  app.delete("/api/research/relationships/:id", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid relationship id." });
    const db = getDb();
    const [existing] = await db.select().from(researchEvidenceRelationships).where(eq(researchEvidenceRelationships.id, id)).limit(1);
    if (!existing || !await loadAccessibleInvestigation(existing.investigationId, req.user!, true)) {
      return res.status(404).json({ error: "Relationship not found." });
    }
    const [deleted] = await db.delete(researchEvidenceRelationships).where(eq(researchEvidenceRelationships.id, id)).returning();
    if (!deleted) return res.status(404).json({ error: "Relationship not found." });
    await recordAuditEvent(req.user!.id, "research_relationship_removed", { investigationId: deleted.investigationId, relationshipId: id, ...auditActor(req.user!) });
    res.json({ ok: true });
  });

  app.get("/api/research/investigations/:id/timeline", requireRole(...READ_ROLES), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid investigation id." });
    const investigation = await loadAccessibleInvestigation(id, req.user!);
    if (!investigation) return res.status(404).json({ error: "Investigation not found." });
    const db = getDb();
    const [evidence, briefs] = await Promise.all([
      db.select().from(researchEvidence).where(eq(researchEvidence.investigationId, id)),
      db.select().from(researchBriefs).where(eq(researchBriefs.investigationId, id)),
    ]);
    const events = [
      { id: `investigation-${id}`, eventType: "investigation_created", timestamp: investigation.createdAt, title: investigation.title, provenance: "Limuria audit trail" },
      ...evidence.flatMap((item) => [
        { id: `evidence-${item.id}-added`, eventType: "evidence_added", timestamp: item.createdAt, title: item.title, evidenceId: item.id, provenance: item.provider },
        ...(item.effectiveAt ? [{ id: `evidence-${item.id}-effective`, eventType: "evidence_effective", timestamp: item.effectiveAt, title: item.title, evidenceId: item.id, provenance: item.sourceName }] : []),
      ]),
      ...briefs.map((brief) => ({ id: `brief-${brief.id}`, eventType: "brief_generated", timestamp: brief.createdAt, title: brief.title, briefId: brief.id, provenance: "Frozen evidence snapshot" })),
    ].sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
    res.json(events);
  });

  app.get("/api/research/investigations/:id/briefs", requireRole(...READ_ROLES), async (req, res) => {
    const investigationId = parseId(req.params.id);
    if (!investigationId) return res.status(400).json({ error: "Invalid investigation id." });
    if (!await loadAccessibleInvestigation(investigationId, req.user!)) return res.status(404).json({ error: "Investigation not found." });
    const db = getDb();
    const rows = await db.select().from(researchBriefs).where(eq(researchBriefs.investigationId, investigationId)).orderBy(desc(researchBriefs.createdAt));
    res.json(rows);
  });

  app.post("/api/research/investigations/:id/briefs", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const investigationId = parseId(req.params.id);
    if (!investigationId) return res.status(400).json({ error: "Invalid investigation id." });
    const investigation = await loadAccessibleInvestigation(investigationId, req.user!, true);
    if (!investigation) return res.status(404).json({ error: "Investigation not found." });
    const db = getDb();
    const evidence = await db.select().from(researchEvidence).where(eq(researchEvidence.investigationId, investigationId));
    if (!evidence.length) return res.status(409).json({ error: "Attach evidence before generating a brief." });
    const output = buildResearchBrief(investigation, evidence);
    const [brief] = await db.insert(researchBriefs).values({
      investigationId,
      title: `${investigation.title} - evidence brief`,
      markdown: output.markdown,
      evidenceSnapshot: output.snapshot,
      snapshotHash: output.snapshotHash,
      citations: output.citations,
      generatedByUserId: req.user!.id,
    }).returning();
    await recordAuditEvent(req.user!.id, "research_brief_generated", { investigationId, briefId: brief.id, snapshotHash: brief.snapshotHash, evidenceCount: output.snapshot.length, ...auditActor(req.user!) });
    res.status(201).json(brief);
  });

  app.get("/api/research/investigations/:id/what-changed", requireRole(...READ_ROLES), async (req, res) => {
    const investigationId = parseId(req.params.id);
    if (!investigationId) return res.status(400).json({ error: "Invalid investigation id." });
    if (!await loadAccessibleInvestigation(investigationId, req.user!)) return res.status(404).json({ error: "Investigation not found." });
    const db = getDb();
    const [evidence, previous] = await Promise.all([
      db.select().from(researchEvidence).where(eq(researchEvidence.investigationId, investigationId)),
      db.select().from(researchBriefs).where(eq(researchBriefs.investigationId, investigationId)).orderBy(desc(researchBriefs.createdAt)).limit(1),
    ]);
    res.json({ comparedToBriefId: previous[0]?.id ?? null, ...compareEvidenceSnapshots(previous[0]?.evidenceSnapshot ?? null, evidence) });
  });

  app.post("/api/research/briefs/:id/publishing-draft", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid brief id." });
    const parsed = publishBriefSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const db = getDb();
    const [brief] = await db.select().from(researchBriefs).where(eq(researchBriefs.id, id)).limit(1);
    if (!brief) return res.status(404).json({ error: "Brief not found." });
    const investigation = await loadAccessibleInvestigation(brief.investigationId, req.user!, true);
    if (!investigation) return res.status(404).json({ error: "Brief not found." });
    const [domain] = await db.select().from(domains).where(eq(domains.slug, parsed.data.domainSlug)).limit(1);
    if (!domain) return res.status(400).json({ error: `Unknown domain: ${parsed.data.domainSlug}` });
    if (parsed.data.visibility === "specific_orgs" && !investigation.organizationId) {
      return res.status(409).json({ error: "Assign an organization before creating an organization-scoped publishing draft." });
    }
    const [content] = await db.insert(publishedContent).values({
      authorUserId: req.user!.id,
      domainId: domain.id,
      title: brief.title,
      body: brief.markdown,
      contentType: "brief",
      visibility: parsed.data.visibility,
      status: "draft",
      isAiGenerated: false,
    }).returning();
    if (parsed.data.visibility === "specific_orgs" && investigation.organizationId) {
      await db.insert(contentOrganizationLinks).values({ contentId: content.id, organizationId: investigation.organizationId });
    }
    await recordAuditEvent(req.user!.id, "research_brief_exported_to_publishing", { investigationId: investigation.id, briefId: brief.id, contentId: content.id, ...auditActor(req.user!) });
    res.status(201).json(content);
  });
}
async function organizationExists(id: number): Promise<boolean> {
  const [organization] = await getDb().select({ id: organizations.id }).from(organizations)
    .where(eq(organizations.id, id)).limit(1);
  return Boolean(organization);
}
function canReadInvestigation(user: Express.User, investigation: typeof researchInvestigations.$inferSelect): boolean {
  if (!canAccessResearchOrganization(user.role, user.organizationId, investigation.organizationId)) return false;
  return user.role === "internal_admin"
    || user.role === "internal_compliance"
    || investigation.ownerUserId === user.id;
}

function canWriteInvestigation(user: Express.User, investigation: typeof researchInvestigations.$inferSelect): boolean {
  return canAccessResearchOrganization(user.role, user.organizationId, investigation.organizationId)
    && (user.role === "internal_admin" || investigation.ownerUserId === user.id);
}

async function loadAccessibleInvestigation(id: number, user: Express.User, write = false) {
  const investigation = await loadInvestigation(id);
  if (!investigation || !(write ? canWriteInvestigation(user, investigation) : canReadInvestigation(user, investigation))) return null;
  return investigation;
}
