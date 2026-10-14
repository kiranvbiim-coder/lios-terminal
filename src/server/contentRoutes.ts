/**
 * Publishing workflow: draft -> pending_review -> approved -> published,
 * with suppress available at any point (per-item, or platform-wide for
 * every AI-generated item at once -- the kill switch). Nothing here is
 * client-visible yet (Phase 3 builds the dashboard that reads this), but
 * the approval gate matters from day one: it's much cheaper to require
 * compliance sign-off before any content-generation feature exists than to
 * retrofit it after content is already flowing.
 */
import type { Express } from "express";
import { z } from "zod";
import { eq, and, or, desc } from "drizzle-orm";
import { getDb } from "./db";
import {
  publishedContent, contentOrganizationLinks, organizations, platformSettings, domains,
  PLATFORM_SETTING_AI_SUPPRESSED,
} from "@shared/schema";
import { requireRole } from "./auth";
import { recordAuditEvent, auditActor } from "./auditEvents";

const createContentSchema = z.object({
  title: z.string().trim().min(1),
  body: z.string().trim().min(1),
  contentType: z.enum(["note", "brief", "trade_idea", "report"]),
  visibility: z.enum(["all_clients", "specific_orgs"]).default("specific_orgs"),
  isAiGenerated: z.boolean().default(false),
  organizationIds: z.array(z.number().int().positive()).optional(),
  // Omitted -> finance, so the existing Publish Desk UI (which doesn't know
  // about domains yet) keeps working exactly as before.
  domainSlug: z.string().trim().min(1).default("finance"),
});

const editContentSchema = z.object({
  title: z.string().trim().min(1).optional(),
  body: z.string().trim().min(1).optional(),
  contentType: z.enum(["note", "brief", "trade_idea", "report"]).optional(),
  visibility: z.enum(["all_clients", "specific_orgs"]).optional(),
});

export function registerContentRoutes(app: Express): void {
  app.get("/api/content", requireRole("internal_admin", "internal_analyst", "internal_compliance"), async (req, res) => {
    const db = getDb();
    const isReviewer = req.user!.role === "internal_admin" || req.user!.role === "internal_compliance";
    const rows = isReviewer
      ? await db.select().from(publishedContent).orderBy(desc(publishedContent.createdAt))
      : await db.select().from(publishedContent)
          .where(or(eq(publishedContent.authorUserId, req.user!.id), eq(publishedContent.status, "published")))
          .orderBy(desc(publishedContent.createdAt));
    res.json(rows);
  });

  app.post("/api/content", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const parsed = createContentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { organizationIds, domainSlug, ...contentFields } = parsed.data;

    const db = getDb();
    const [domain] = await db.select().from(domains).where(eq(domains.slug, domainSlug)).limit(1);
    if (!domain) return res.status(400).json({ error: `Unknown domain: ${domainSlug}` });

    const [content] = await db.insert(publishedContent).values({
      ...contentFields,
      domainId: domain.id,
      authorUserId: req.user!.id,
      status: "draft",
    }).returning();

    if (contentFields.visibility === "specific_orgs" && organizationIds?.length) {
      await db.insert(contentOrganizationLinks).values(
        organizationIds.map((organizationId) => ({ contentId: content.id, organizationId })),
      );
    }

    await recordAuditEvent(req.user!.id, "content_created", { contentId: content.id, contentType: content.contentType, ...auditActor(req.user!) });
    res.json(content);
  });

  app.patch("/api/content/:id", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const id = Number(req.params.id);
    const parsed = editContentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    const [existing] = await db.select().from(publishedContent).where(eq(publishedContent.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: "Content not found." });
    if (existing.authorUserId !== req.user!.id && req.user!.role !== "internal_admin") {
      return res.status(403).json({ error: "Only the author or an admin can edit this." });
    }
    if (existing.status !== "draft") {
      return res.status(409).json({ error: "Only drafts can be edited. Submitted content is locked." });
    }

    const [content] = await db.update(publishedContent).set(parsed.data).where(eq(publishedContent.id, id)).returning();
    res.json(content);
  });

  app.post("/api/content/:id/submit", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const id = Number(req.params.id);
    const content = await transitionStatus(id, req.user!.id, "draft", "pending_review");
    if (!content) return res.status(409).json({ error: "Content must be in draft status to submit for review." });
    await recordAuditEvent(req.user!.id, "content_submitted", { contentId: id, ...auditActor(req.user!) });
    res.json(content);
  });

  app.post("/api/content/:id/approve", requireRole("internal_admin", "internal_compliance"), async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const [content] = await db.update(publishedContent)
      .set({ status: "approved", approvedByUserId: req.user!.id, approvedAt: new Date() })
      .where(and(eq(publishedContent.id, id), eq(publishedContent.status, "pending_review")))
      .returning();
    if (!content) return res.status(409).json({ error: "Content must be pending review to approve." });
    await recordAuditEvent(req.user!.id, "content_approved", { contentId: id, ...auditActor(req.user!) });
    res.json(content);
  });

  app.post("/api/content/:id/publish", requireRole("internal_admin", "internal_compliance"), async (req, res) => {
    const id = Number(req.params.id);
    const content = await transitionStatus(id, req.user!.id, "approved", "published", { publishedAt: new Date() });
    if (!content) return res.status(409).json({ error: "Content must be approved before it can be published." });
    await recordAuditEvent(req.user!.id, "content_published", { contentId: id, ...auditActor(req.user!) });
    res.json(content);
  });

  // Per-item suppress -- works from any status, including already-published.
  app.post("/api/content/:id/suppress", requireRole("internal_admin", "internal_compliance"), async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const [content] = await db.update(publishedContent)
      .set({ status: "suppressed", suppressedAt: new Date(), suppressedByUserId: req.user!.id })
      .where(eq(publishedContent.id, id))
      .returning();
    if (!content) return res.status(404).json({ error: "Content not found." });
    await recordAuditEvent(req.user!.id, "content_suppressed", { contentId: id, ...auditActor(req.user!) });
    res.json(content);
  });

  app.post("/api/content/:id/organizations", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const contentId = Number(req.params.id);
    const parsed = z.object({ organizationId: z.number().int().positive() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    const [org] = await db.select().from(organizations).where(eq(organizations.id, parsed.data.organizationId)).limit(1);
    if (!org) return res.status(404).json({ error: "Organization not found." });

    await db.insert(contentOrganizationLinks).values({ contentId, organizationId: parsed.data.organizationId }).onConflictDoNothing();
    res.json({ ok: true });
  });

  app.delete("/api/content/:id/organizations/:orgId", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const contentId = Number(req.params.id);
    const orgId = Number(req.params.orgId);
    const db = getDb();
    await db.delete(contentOrganizationLinks).where(
      and(eq(contentOrganizationLinks.contentId, contentId), eq(contentOrganizationLinks.organizationId, orgId)),
    );
    res.json({ ok: true });
  });

  // ─── Platform-wide AI kill switch ───────────────────────────────────────
  app.get("/api/admin/ai-kill-switch", requireRole("internal_admin", "internal_compliance"), async (_req, res) => {
    const db = getDb();
    const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, PLATFORM_SETTING_AI_SUPPRESSED)).limit(1);
    res.json({ suppressed: row?.value === true });
  });

  app.post("/api/admin/ai-kill-switch", requireRole("internal_admin"), async (req, res) => {
    const parsed = z.object({ suppressed: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    await db.insert(platformSettings)
      .values({ key: PLATFORM_SETTING_AI_SUPPRESSED, value: parsed.data.suppressed, updatedByUserId: req.user!.id })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: parsed.data.suppressed, updatedByUserId: req.user!.id, updatedAt: new Date() } });

    await recordAuditEvent(req.user!.id, parsed.data.suppressed ? "ai_kill_switch_activated" : "ai_kill_switch_deactivated", auditActor(req.user!));
    res.json({ suppressed: parsed.data.suppressed });
  });
}

async function transitionStatus(
  id: number,
  _actorId: number,
  fromStatus: "draft" | "pending_review" | "approved",
  toStatus: "pending_review" | "approved" | "published",
  extraFields: Record<string, unknown> = {},
) {
  const db = getDb();
  const [content] = await db.update(publishedContent)
    .set({ status: toStatus, ...extraFields })
    .where(and(eq(publishedContent.id, id), eq(publishedContent.status, fromStatus)))
    .returning();
  return content ?? null;
}
