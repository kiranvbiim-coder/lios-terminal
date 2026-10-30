/**
 * Internal admin tooling: create client organizations, manage users (both
 * internal and client accounts share the users table), and manage client
 * portfolios/positions. This is the screen an internal_admin uses before a
 * single client dashboard user can exist -- Phase 3 builds the dashboard
 * itself, but nothing there works without this existing first.
 */
import type { Express } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { resolvePositionIdentity, UNRESOLVED_LISTING_ERROR } from "./positionIdentity";
import {
  organizations, users, portfolios, positions, dashboardWatchlistItems, clientAlerts, domains, organizationDomains, insertUserSchema,
  adminDomains, consultingRequests, consultingApprovals, consultingComments, consultingTemplates, insertConsultingTemplateSchema,
  consultingQuotes, insertConsultingQuoteSchema,
  engagements, insertEngagementSchema, workstreams, insertWorkstreamSchema, deliverables, insertDeliverableSchema,
  meetings, insertMeetingSchema, clientAuditEvents,
  deliverableGateEvents, DELIVERABLE_GATE_SEQUENCE, clientDatasets, leads,
  insertPlatformPlanSchema, upsertOrganizationLicenseSchema, insertLicenseEntitlementSchema, updateLicenseEntitlementSchema,
  upsertAuthorizedDeviceSchema, updateAuthorizedDeviceSchema, insertSessionControlSchema,
} from "@shared/schema";
import { requireRole } from "./auth";
import { recordAuditEvent, auditActor } from "./auditEvents";
import { checkPasswordPolicy } from "@shared/passwordPolicy";
import {
  createPlatformPlan,
  createSessionControl,
  getOrganizationControlPlaneSnapshot,
  grantOrUpdateEntitlement,
  listPlatformPlans,
  registerOrUpdateDevice,
  updateDevice,
  updateEntitlement,
  upsertOrganizationLicense,
} from "./controlPlaneService";
import { deleteVaultCredential, listVaultCredentials, setVaultCredential } from "./credentialVault";

const insertOrgSchema = z.object({
  name: z.string().trim().min(1),
  slug: z.string().trim().min(1).regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only."),
});

const insertPortfolioSchema = z.object({
  name: z.string().trim().min(1),
});

const insertPositionSchema = z.object({
  symbol: z.string().trim().min(1).toUpperCase(),
  shares: z.number().positive(),
  avgCost: z.number().positive(),
});

const insertWatchlistItemSchema = z.object({
  symbol: z.string().trim().min(1).toUpperCase(),
  name: z.string().trim().min(1),
});

const insertClientAlertSchema = z.object({
  symbol: z.string().trim().min(1).toUpperCase(),
  condition: z.enum(["above", "below"]),
  price: z.number().positive(),
});

function generateTempPassword(): string {
  return crypto.randomBytes(9).toString("base64url");
}

export function registerAdminRoutes(app: Express): void {
  // ─── Organizations ────────────────────────────────────────────────────
  app.get("/api/admin/organizations", requireRole("internal_admin", "internal_analyst", "internal_compliance"), async (_req, res) => {
    const db = getDb();
    const rows = await db.select().from(organizations);
    res.json(rows);
  });

  app.post("/api/admin/organizations", requireRole("internal_admin"), async (req, res) => {
    const parsed = insertOrgSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    const existing = await db.select().from(organizations).where(eq(organizations.slug, parsed.data.slug)).limit(1);
    if (existing.length) return res.status(409).json({ error: "An organization with that slug already exists." });

    const [org] = await db.insert(organizations).values(parsed.data).returning();
    await recordAuditEvent(req.user!.id, "organization_created", { organizationId: org.id, name: org.name, ...auditActor(req.user!) });
    res.json(org);
  });

  app.patch("/api/admin/organizations/:id", requireRole("internal_admin"), async (req, res) => {
    const id = Number(req.params.id);
    const patch = z.object({ name: z.string().trim().min(1).optional(), status: z.enum(["active", "inactive"]).optional() }).safeParse(req.body);
    if (!patch.success) return res.status(400).json({ error: patch.error.flatten() });

    const db = getDb();
    const [org] = await db.update(organizations).set(patch.data).where(eq(organizations.id, id)).returning();
    if (!org) return res.status(404).json({ error: "Organization not found." });
    await recordAuditEvent(req.user!.id, "organization_updated", { organizationId: id, changes: patch.data, ...auditActor(req.user!) });
    res.json(org);
  });

  // ─── Commercial control plane: plans, licenses, entitlements, devices ───
  app.get("/api/admin/plans", requireRole("internal_admin", "internal_analyst", "internal_compliance"), async (_req, res) => {
    res.json(await listPlatformPlans());
  });

  app.post("/api/admin/plans", requireRole("internal_admin"), async (req, res) => {
    const parsed = insertPlatformPlanSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const plan = await createPlatformPlan(parsed.data, req.user!);
      res.json(plan);
    } catch (err) {
      res.status(409).json({ error: err instanceof Error ? err.message : "Could not create platform plan." });
    }
  });

  app.get("/api/admin/organizations/:orgId/control-plane", requireRole("internal_admin", "internal_analyst", "internal_compliance"), async (req, res) => {
    const orgId = Number(req.params.orgId);
    const snapshot = await getOrganizationControlPlaneSnapshot(orgId);
    if (!snapshot) return res.status(404).json({ error: "Organization not found." });
    res.json(snapshot);
  });

  app.put("/api/admin/organizations/:orgId/license", requireRole("internal_admin"), async (req, res) => {
    const orgId = Number(req.params.orgId);
    const parsed = upsertOrganizationLicenseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const license = await upsertOrganizationLicense(orgId, parsed.data, req.user!);
      res.json(license);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : "Could not update organization license." });
    }
  });

  app.post("/api/admin/organizations/:orgId/entitlements", requireRole("internal_admin"), async (req, res) => {
    const orgId = Number(req.params.orgId);
    const parsed = insertLicenseEntitlementSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const entitlement = await grantOrUpdateEntitlement(orgId, parsed.data, req.user!);
      res.json(entitlement);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : "Could not grant entitlement." });
    }
  });

  app.patch("/api/admin/entitlements/:id", requireRole("internal_admin"), async (req, res) => {
    const id = Number(req.params.id);
    const parsed = updateLicenseEntitlementSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const entitlement = await updateEntitlement(id, parsed.data, req.user!);
      res.json(entitlement);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : "Entitlement not found." });
    }
  });

  app.post("/api/admin/organizations/:orgId/devices", requireRole("internal_admin"), async (req, res) => {
    const orgId = Number(req.params.orgId);
    const parsed = upsertAuthorizedDeviceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const device = await registerOrUpdateDevice(orgId, parsed.data, req.user!);
      res.json(device);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : "Could not register device." });
    }
  });

  app.patch("/api/admin/devices/:id", requireRole("internal_admin"), async (req, res) => {
    const id = Number(req.params.id);
    const parsed = updateAuthorizedDeviceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const device = await updateDevice(id, parsed.data, req.user!);
      res.json(device);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : "Device not found." });
    }
  });

  app.post("/api/admin/session-controls", requireRole("internal_admin"), async (req, res) => {
    const parsed = insertSessionControlSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const result = await createSessionControl(parsed.data, req.user!);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Could not create session control." });
    }
  });

  // ─── Credential vault management ──────────────────────────────────────────
  app.get("/api/admin/vault/credentials", requireRole("internal_admin"), async (_req, res) => {
    res.json(listVaultCredentials());
  });

  app.put("/api/admin/vault/credentials/:name", requireRole("internal_admin"), async (req, res) => {
    const name = String(req.params.name);
    const parsed = z.object({
      value: z.string().trim().min(1),
      label: z.string().trim().min(1).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    setVaultCredential(name, parsed.data.value, parsed.data.label);
    await recordAuditEvent(req.user!.id, "vault_credential_set", { name, ...auditActor(req.user!) });
    res.json({ ok: true, name });
  });

  app.delete("/api/admin/vault/credentials/:name", requireRole("internal_admin"), async (req, res) => {
    const name = String(req.params.name);
    const deleted = deleteVaultCredential(name);
    if (!deleted) return res.status(404).json({ error: "Credential not found in vault." });
    await recordAuditEvent(req.user!.id, "vault_credential_deleted", { name, ...auditActor(req.user!) });
    res.json({ ok: true, name });
  });

  // ─── Trial-to-Contract Phase C.5: internal pipeline visibility ─────────
  // Staff need to see trial activity as soon as it exists, not once the
  // whole funnel is built -- this is a plain read: which trial orgs exist,
  // how much of their credit allotment they've used, what they've selected,
  // and when they last did anything. The org-suspend "kill switch" this
  // page needs isn't a new endpoint -- PATCH /api/admin/organizations/:id
  // above already supports {status: "inactive"} and requireTrialOrClient
  // (trialAccess.ts) already enforces it; it just never had a UI action
  // calling it until now.
  const STALLED_AFTER_DAYS = 7;
  const HOT_ACTIVITY_WITHIN_DAYS = 2;

  app.get("/api/admin/pipeline", requireRole("internal_admin", "internal_analyst"), async (_req, res) => {
    const db = getDb();
    const trialOrgs = await db.select().from(organizations).where(eq(organizations.lifecycleStage, "trial"));

    const rows = await Promise.all(trialOrgs.map(async (org) => {
      const [lastActivity] = await db.select({ createdAt: clientAuditEvents.createdAt })
        .from(clientAuditEvents)
        .where(eq(clientAuditEvents.organizationId, org.id))
        .orderBy(desc(clientAuditEvents.createdAt))
        .limit(1);
      const orgEngagements = await db.select({
        id: engagements.id, engagementModel: engagements.engagementModel, status: engagements.status, createdAt: engagements.createdAt,
      }).from(engagements).where(eq(engagements.organizationId, org.id));

      const now = Date.now();
      const daysSinceStart = org.trialCreditsGrantedAt ? (now - org.trialCreditsGrantedAt.getTime()) / 86_400_000 : 0;
      const daysSinceActivity = lastActivity ? (now - lastActivity.createdAt.getTime()) / 86_400_000 : Infinity;
      const hasSelectedTiers = orgEngagements.length > 0;

      // Simple, explainable rule rather than a scored model -- a human
      // reading the pipeline needs to trust why something is flagged
      // "stalled", not take a black-box score on faith.
      let pipelineStatus: "hot" | "active" | "stalled";
      if (hasSelectedTiers || daysSinceActivity <= HOT_ACTIVITY_WITHIN_DAYS) pipelineStatus = "hot";
      else if (daysSinceStart >= STALLED_AFTER_DAYS && daysSinceActivity >= STALLED_AFTER_DAYS) pipelineStatus = "stalled";
      else pipelineStatus = "active";

      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        status: org.status,
        trialCreditsGrantedAt: org.trialCreditsGrantedAt,
        lastActivityAt: lastActivity?.createdAt ?? null,
        selectedTiers: orgEngagements.map((e) => ({ id: e.id, model: e.engagementModel, status: e.status })),
        pipelineStatus,
      };
    }));

    res.json(rows);
  });

  // ─── Domains (verticals) & per-org subscriptions ───────────────────────
  app.get("/api/admin/domains", requireRole("internal_admin", "internal_analyst", "internal_compliance"), async (_req, res) => {
    const db = getDb();
    const rows = await db.select().from(domains);
    res.json(rows);
  });

  // Activates/deactivates a seeded-but-not-yet-built vertical (e.g.
  // supply_chain) once it has a real dashboard + real data + a real
  // domain-specific engine behind it -- previously there was no route at
  // all to flip `domains.active`, only the one-time seed script's default
  // value, so a domain could never move from "placeholder" to "live"
  // without a direct DB edit. `DomainPicker.tsx` already reads and
  // respects this flag (disables the tile when false), so this is a real
  // missing piece, not new surface.
  app.patch("/api/admin/domains/:id", requireRole("internal_admin"), async (req, res) => {
    const id = Number(req.params.id);
    const parsed = z.object({ active: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    const [domain] = await db.select().from(domains).where(eq(domains.id, id)).limit(1);
    if (!domain) return res.status(404).json({ error: "Domain not found." });

    await db.update(domains).set({ active: parsed.data.active }).where(eq(domains.id, id));
    await recordAuditEvent(req.user!.id, parsed.data.active ? "domain_activated" : "domain_deactivated", { domainSlug: domain.slug, ...auditActor(req.user!) });
    res.json({ ok: true, slug: domain.slug, active: parsed.data.active });
  });

  app.get("/api/admin/organizations/:orgId/domains", requireRole("internal_admin", "internal_analyst", "internal_compliance"), async (req, res) => {
    const orgId = Number(req.params.orgId);
    const db = getDb();
    const rows = await db.select({ id: domains.id, slug: domains.slug, name: domains.name, active: domains.active })
      .from(organizationDomains)
      .innerJoin(domains, eq(organizationDomains.domainId, domains.id))
      .where(eq(organizationDomains.organizationId, orgId));
    res.json(rows);
  });

  app.post("/api/admin/organizations/:orgId/domains", requireRole("internal_admin"), async (req, res) => {
    const orgId = Number(req.params.orgId);
    const parsed = z.object({ domainId: z.number().int().positive() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return res.status(404).json({ error: "Organization not found." });
    const [domain] = await db.select().from(domains).where(eq(domains.id, parsed.data.domainId)).limit(1);
    if (!domain) return res.status(404).json({ error: "Domain not found." });

    await db.insert(organizationDomains).values({ organizationId: orgId, domainId: domain.id }).onConflictDoNothing();
    await recordAuditEvent(req.user!.id, "organization_domain_granted", { organizationId: orgId, domainSlug: domain.slug, ...auditActor(req.user!) });
    res.json({ ok: true });
  });

  app.delete("/api/admin/organizations/:orgId/domains/:domainId", requireRole("internal_admin"), async (req, res) => {
    const orgId = Number(req.params.orgId);
    const domainId = Number(req.params.domainId);
    const db = getDb();
    await db.delete(organizationDomains).where(and(eq(organizationDomains.organizationId, orgId), eq(organizationDomains.domainId, domainId)));
    await recordAuditEvent(req.user!.id, "organization_domain_revoked", { organizationId: orgId, domainId, ...auditActor(req.user!) });
    res.json({ ok: true });
  });

  // ─── Users (internal + client accounts share this table) ──────────────
  app.get("/api/admin/users", requireRole("internal_admin"), async (_req, res) => {
    const db = getDb();
    const rows = await db.select({
      id: users.id, email: users.email, role: users.role, organizationId: users.organizationId,
      name: users.name, active: users.active, createdAt: users.createdAt, lastLoginAt: users.lastLoginAt,
    }).from(users);
    res.json(rows);
  });

  app.post("/api/admin/users", requireRole("internal_admin"), async (req, res) => {
    const bodySchema = insertUserSchema.omit({ password: true }).extend({ password: z.string().min(8).optional() });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const isClientRole = parsed.data.role === "client_admin" || parsed.data.role === "client_user";
    if (isClientRole && !parsed.data.organizationId) {
      return res.status(400).json({ error: "Client accounts must be assigned to an organization." });
    }
    if (!isClientRole && parsed.data.organizationId) {
      return res.status(400).json({ error: "Internal accounts cannot be assigned to an organization." });
    }

    const db = getDb();
    const existing = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
    if (existing.length) return res.status(409).json({ error: "A user with that email already exists." });

    if (parsed.data.password) {
      const policy = checkPasswordPolicy(parsed.data.password, { email: parsed.data.email, name: parsed.data.name });
      if (!policy.valid) return res.status(400).json({ error: policy.errors.join(" ") });
    }

    const tempPassword = parsed.data.password ?? generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const [user] = await db.insert(users).values({
      email: parsed.data.email,
      passwordHash,
      role: parsed.data.role,
      organizationId: parsed.data.organizationId ?? null,
      name: parsed.data.name,
      // Nobody but the account holder should keep a password someone else
      // picked -- force a change on first login either way.
      mustChangePassword: true,
    }).returning();

    await recordAuditEvent(req.user!.id, "user_created", { createdUserId: user.id, role: user.role, organizationId: user.organizationId, ...auditActor(req.user!) });

    res.json({
      id: user.id, email: user.email, role: user.role, organizationId: user.organizationId, name: user.name,
      // Only returned once, at creation -- same convention as the seed script.
      temporaryPassword: parsed.data.password ? undefined : tempPassword,
    });
  });

  app.patch("/api/admin/users/:id", requireRole("internal_admin"), async (req, res) => {
    const id = Number(req.params.id);
    const patch = z.object({
      active: z.boolean().optional(),
      role: z.enum(["internal_admin", "internal_analyst", "internal_compliance", "client_admin", "client_user"]).optional(),
      organizationId: z.number().int().positive().nullable().optional(),
    }).safeParse(req.body);
    if (!patch.success) return res.status(400).json({ error: patch.error.flatten() });

    const db = getDb();
    const [user] = await db.update(users).set(patch.data).where(eq(users.id, id)).returning();
    if (!user) return res.status(404).json({ error: "User not found." });
    await recordAuditEvent(req.user!.id, "user_updated", { targetUserId: id, changes: patch.data, ...auditActor(req.user!) });
    res.json({ id: user.id, email: user.email, role: user.role, organizationId: user.organizationId, active: user.active });
  });

  // Passwords are bcrypt hashes -- there's no way to recover a forgotten
  // one, only overwrite it. Mirrors the create-user convention: the new
  // password is generated server-side and returned exactly once in this
  // response; it is never stored or logged in plaintext anywhere.
  app.post("/api/admin/users/:id/reset-password", requireRole("internal_admin"), async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    const [user] = await db.update(users).set({
      passwordHash,
      mustChangePassword: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
    }).where(eq(users.id, id)).returning();
    if (!user) return res.status(404).json({ error: "User not found." });
    await recordAuditEvent(req.user!.id, "user_password_reset", { targetUserId: id, ...auditActor(req.user!) });
    res.json({ id: user.id, email: user.email, temporaryPassword: tempPassword });
  });

  // ─── Portfolios & positions ─────────────────────────────────────────────
  app.get("/api/admin/organizations/:orgId/portfolios", requireRole("internal_admin", "internal_analyst", "internal_compliance"), async (req, res) => {
    const orgId = Number(req.params.orgId);
    const db = getDb();
    const rows = await db.select().from(portfolios).where(eq(portfolios.organizationId, orgId));
    res.json(rows);
  });

  app.post("/api/admin/organizations/:orgId/portfolios", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const orgId = Number(req.params.orgId);
    const parsed = insertPortfolioSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return res.status(404).json({ error: "Organization not found." });

    const [portfolio] = await db.insert(portfolios).values({ organizationId: orgId, name: parsed.data.name }).returning();
    await recordAuditEvent(req.user!.id, "portfolio_created", { portfolioId: portfolio.id, organizationId: orgId, ...auditActor(req.user!) });
    res.json(portfolio);
  });

  app.get("/api/admin/portfolios/:id/positions", requireRole("internal_admin", "internal_analyst", "internal_compliance"), async (req, res) => {
    const portfolioId = Number(req.params.id);
    const db = getDb();
    const rows = await db.select().from(positions).where(eq(positions.portfolioId, portfolioId));
    res.json(rows);
  });

  app.post("/api/admin/portfolios/:id/positions", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const portfolioId = Number(req.params.id);
    const parsed = insertPositionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    const [portfolio] = await db.select().from(portfolios).where(eq(portfolios.id, portfolioId)).limit(1);
    if (!portfolio) return res.status(404).json({ error: "Portfolio not found." });

    const identity = await resolvePositionIdentity(db, parsed.data.symbol);
    if (!identity.resolved) {
      return res.status(400).json({ error: UNRESOLVED_LISTING_ERROR });
    }
    const [position] = await db.insert(positions).values({
      portfolioId,
      symbol: identity.symbol,
      listingId: identity.listingId,
      securityId: identity.securityId,
      shares: parsed.data.shares,
      avgCost: parsed.data.avgCost,
    }).returning();
    await recordAuditEvent(req.user!.id, "position_added", { positionId: position.id, portfolioId, symbol: position.symbol, ...auditActor(req.user!) });
    res.json(position);
  });

  app.delete("/api/admin/positions/:id", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    await db.delete(positions).where(eq(positions.id, id));
    await recordAuditEvent(req.user!.id, "position_removed", { positionId: id, ...auditActor(req.user!) });
    res.json({ ok: true });
  });

  // ─── Dashboard watchlist (curated per-org, feeds the client dashboard) ──
  app.get("/api/admin/organizations/:orgId/watchlist", requireRole("internal_admin", "internal_analyst", "internal_compliance"), async (req, res) => {
    const orgId = Number(req.params.orgId);
    const db = getDb();
    const rows = await db.select().from(dashboardWatchlistItems).where(eq(dashboardWatchlistItems.organizationId, orgId));
    res.json(rows);
  });

  app.post("/api/admin/organizations/:orgId/watchlist", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const orgId = Number(req.params.orgId);
    const parsed = insertWatchlistItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return res.status(404).json({ error: "Organization not found." });

    const [item] = await db.insert(dashboardWatchlistItems).values({
      organizationId: orgId, symbol: parsed.data.symbol, name: parsed.data.name, addedByUserId: req.user!.id,
    }).returning();
    await recordAuditEvent(req.user!.id, "dashboard_watchlist_item_added", { itemId: item.id, organizationId: orgId, symbol: item.symbol, ...auditActor(req.user!) });
    res.json(item);
  });

  app.delete("/api/admin/watchlist/:id", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    await db.delete(dashboardWatchlistItems).where(eq(dashboardWatchlistItems.id, id));
    await recordAuditEvent(req.user!.id, "dashboard_watchlist_item_removed", { itemId: id, ...auditActor(req.user!) });
    res.json({ ok: true });
  });

  // ─── Client alerts (curated per-org, feeds the client dashboard) ───────
  app.get("/api/admin/organizations/:orgId/alerts", requireRole("internal_admin", "internal_analyst", "internal_compliance"), async (req, res) => {
    const orgId = Number(req.params.orgId);
    const db = getDb();
    const rows = await db.select().from(clientAlerts).where(eq(clientAlerts.organizationId, orgId));
    res.json(rows);
  });

  app.post("/api/admin/organizations/:orgId/alerts", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const orgId = Number(req.params.orgId);
    const parsed = insertClientAlertSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return res.status(404).json({ error: "Organization not found." });

    const [alert] = await db.insert(clientAlerts).values({
      organizationId: orgId, symbol: parsed.data.symbol, condition: parsed.data.condition, price: parsed.data.price, createdByUserId: req.user!.id,
    }).returning();
    await recordAuditEvent(req.user!.id, "client_alert_created", { alertId: alert.id, organizationId: orgId, symbol: alert.symbol, ...auditActor(req.user!) });
    res.json(alert);
  });

  app.delete("/api/admin/alerts/:id", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    await db.delete(clientAlerts).where(eq(clientAlerts.id, id));
    await recordAuditEvent(req.user!.id, "client_alert_removed", { alertId: id, ...auditActor(req.user!) });
    res.json({ ok: true });
  });

  // ─── Admin Domains Mapping (Junction) ───────────────────────────────────
  app.get("/api/admin/users/:userId/domains", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const userId = Number(req.params.userId);
    const db = getDb();
    const rows = await db.select({ id: domains.id, slug: domains.slug, name: domains.name })
      .from(adminDomains)
      .innerJoin(domains, eq(adminDomains.domainId, domains.id))
      .where(eq(adminDomains.userId, userId));
    res.json(rows);
  });

  app.post("/api/admin/users/:userId/domains", requireRole("internal_admin"), async (req, res) => {
    const userId = Number(req.params.userId);
    const parsed = z.object({ domainId: z.number().int().positive() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    const [row] = await db.insert(adminDomains).values({ userId, domainId: parsed.data.domainId }).returning();
    res.json(row);
  });

  app.delete("/api/admin/users/:userId/domains/:domainId", requireRole("internal_admin"), async (req, res) => {
    const userId = Number(req.params.userId);
    const domainId = Number(req.params.domainId);
    const db = getDb();
    await db.delete(adminDomains).where(and(eq(adminDomains.userId, userId), eq(adminDomains.domainId, domainId)));
    res.json({ ok: true });
  });

  // ─── Unified Admin Inbox & Consulting Request Operations ────────────────
  app.get("/api/admin/consulting/requests", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const domainSlug = req.query.domain as string | undefined;
    const db = getDb();

    // Check admin's assigned domains if not super admin
    let userDomainIds: number[] | null = null;
    if (req.user!.role !== "internal_admin") { // internal_admin acts as Super Admin
      const assigned = await db.select({ domainId: adminDomains.domainId }).from(adminDomains).where(eq(adminDomains.userId, req.user!.id));
      userDomainIds = assigned.map(a => a.domainId);
      if (!userDomainIds.length) return res.json([]);
    }

    let query = db.select({
      id: consultingRequests.id,
      title: consultingRequests.title,
      description: consultingRequests.description,
      packType: consultingRequests.packType,
      slaHours: consultingRequests.slaHours,
      slaDeadline: consultingRequests.slaDeadline,
      status: consultingRequests.status,
      createdAt: consultingRequests.createdAt,
      organizationName: organizations.name,
      domainId: consultingRequests.domainId,
      domainName: domains.name,
      domainSlug: domains.slug,
      assignedAdminId: consultingRequests.assignedAdminId,
      assignedAdminName: users.name,
    })
    .from(consultingRequests)
    .innerJoin(organizations, eq(consultingRequests.organizationId, organizations.id))
    .innerJoin(domains, eq(consultingRequests.domainId, domains.id))
    .leftJoin(users, eq(consultingRequests.assignedAdminId, users.id));

    // Filter by assigned domains if applicable
    let rows = userDomainIds !== null
      ? (await query).filter(r => userDomainIds!.includes(r.domainId))
      : await query;
    if (domainSlug) rows = rows.filter(r => r.domainSlug === domainSlug);

    // One extra query for all quotes across the visible requests rather than
    // N+1 per request -- grouped in JS below. Cheap at this data volume and
    // keeps the list endpoint a single round trip like every sibling route.
    const requestIds = rows.map(r => r.id);
    const quoteRows = requestIds.length
      ? await db.select().from(consultingQuotes).where(inArray(consultingQuotes.requestId, requestIds)).orderBy(desc(consultingQuotes.createdAt))
      : [];
    const quotesByRequestId = new Map<number, typeof quoteRows>();
    for (const q of quoteRows) {
      const list = quotesByRequestId.get(q.requestId) ?? [];
      list.push(q);
      quotesByRequestId.set(q.requestId, list);
    }

    res.json(rows.map(r => ({ ...r, quotes: quotesByRequestId.get(r.id) ?? [] })));
  });

  app.post("/api/admin/consulting/requests/:id/quotes", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const id = Number(req.params.id);
    const parsed = insertConsultingQuoteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    // One transaction so a failure partway through (e.g. the request-status
    // update) can't leave a quote row committed with nothing reflecting it --
    // supersede, insert, and status update all move together or not at all.
    const quote = await db.transaction(async (tx) => {
      // A negotiation round supersedes whatever was previously on the table
      // -- full history stays in the row itself (see consultingQuotes' own
      // comment in shared/schema.ts), this just marks the old one no longer live.
      await tx.update(consultingQuotes)
        .set({ status: "superseded" })
        .where(and(eq(consultingQuotes.requestId, id), eq(consultingQuotes.status, "proposed")));

      const [inserted] = await tx.insert(consultingQuotes).values({
        requestId: id,
        proposedByAdminId: req.user!.id,
        ...parsed.data,
      }).returning();

      await tx.update(consultingRequests)
        .set({ status: "quoted", updatedAt: new Date() })
        .where(eq(consultingRequests.id, id));

      return inserted;
    });

    res.json(quote);
  });

  app.patch("/api/admin/consulting/requests/:id/assign", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const id = Number(req.params.id);
    const { assignedAdminId } = req.body;
    const db = getDb();

    const [updated] = await db.update(consultingRequests)
      .set({ assignedAdminId, status: assignedAdminId ? "assigned" : "pending", updatedAt: new Date() })
      .where(eq(consultingRequests.id, id))
      .returning();

    res.json(updated);
  });

  // Consultant Triage (Phase 6): the explicit "Terminal response / CaaS /
  // Project" routing decision the roadmap's own engagement-model diagram
  // names, made real. "resolved" and "escalated" were already in
  // requestStatusEnum (clientRoutes.ts's engagement-health computation
  // already reads "escalated" as a risk signal) but nothing ever set
  // either -- every request silently defaulted to the full CaaS quote
  // cycle with no staff decision point at all. "resolved" is the Terminal-
  // response case: staff determined this didn't need a paid engagement.
  // "escalated" flags it as needing to grow into a full Project -- linking
  // an actual engagement is a separate, bigger action left to the existing
  // Projects tooling, not duplicated here.
  const triageDecisionSchema = z.object({ decision: z.enum(["resolved", "escalated"]) });

  app.patch("/api/admin/consulting/requests/:id/triage", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const id = Number(req.params.id);
    const parsed = triageDecisionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      return;
    }

    const db = getDb();
    const [updated] = await db.update(consultingRequests)
      .set({ status: parsed.data.decision, updatedAt: new Date() })
      .where(eq(consultingRequests.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Request not found." });
      return;
    }

    await recordAuditEvent(req.user!.id, "consulting_request_triaged", {
      requestId: id, decision: parsed.data.decision, ...auditActor(req.user!),
    });

    res.json(updated);
  });

  app.post("/api/admin/consulting/requests/:id/approvals", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const id = Number(req.params.id);
    const { solutionBody, attachedFiles } = req.body;

    if (!solutionBody || typeof solutionBody !== "string") {
      return res.status(400).json({ error: "Solution body is required." });
    }

    const db = getDb();
    const [approval] = await db.insert(consultingApprovals).values({
      requestId: id,
      submittedByAdminId: req.user!.id,
      solutionBody,
      attachedFiles: attachedFiles || [],
    }).returning();

    await db.update(consultingRequests)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(consultingRequests.id, id));

    res.json(approval);
  });

  // ─── Consulting Solution Templates ──────────────────────────────────────
  app.get("/api/admin/consulting/templates", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const domainSlug = req.query.domain as string | undefined;
    const db = getDb();

    const rows = await db.select({
      id: consultingTemplates.id,
      title: consultingTemplates.title,
      category: consultingTemplates.category,
      templateBody: consultingTemplates.templateBody,
      usageCount: consultingTemplates.usageCount,
      domainId: consultingTemplates.domainId,
      domainName: domains.name,
      domainSlug: domains.slug,
    })
    .from(consultingTemplates)
    .innerJoin(domains, eq(consultingTemplates.domainId, domains.id));

    if (domainSlug) {
      return res.json(rows.filter(r => r.domainSlug === domainSlug));
    }
    res.json(rows);
  });

  app.post("/api/admin/consulting/templates", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const parsed = insertConsultingTemplateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    const [template] = await db.insert(consultingTemplates).values({
      ...parsed.data,
      createdByUserId: req.user!.id,
    }).returning();

    res.json(template);
  });

  // ─── Audit trail viewer ──────────────────────────────────────────────────
  app.get("/api/admin/audit-events", requireRole("internal_admin", "internal_compliance"), async (_req, res) => {
    const { listAuditEvents } = await import("./auditEvents");
    res.json(await listAuditEvents());
  });

  // ─── Engagements ("projects") & Workstreams (Wave 2) ────────────────────
  // Thin CRUD only -- enough for the client portal's collaboration loop to
  // have real data to read/comment on. The fuller admin management surface
  // (kanban board, bulk actions, per-domain admin scoping like the consulting
  // inbox above) is Wave 3's Admin Command Centre, not this pass.
  app.get("/api/admin/engagements", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const orgId = req.query.orgId ? Number(req.query.orgId) : undefined;
    const db = getDb();
    const rows = await db.select({
      id: engagements.id,
      title: engagements.title,
      engagementModel: engagements.engagementModel,
      status: engagements.status,
      organizationId: engagements.organizationId,
      organizationName: organizations.name,
      domainId: engagements.domainId,
      domainName: domains.name,
      createdAt: engagements.createdAt,
    })
    .from(engagements)
    .innerJoin(organizations, eq(engagements.organizationId, organizations.id))
    .innerJoin(domains, eq(engagements.domainId, domains.id));

    res.json(orgId ? rows.filter((r) => r.organizationId === orgId) : rows);
  });

  app.post("/api/admin/engagements", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const parsed = insertEngagementSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    const [engagement] = await db.insert(engagements).values(parsed.data).returning();
    res.json(engagement);
  });

  app.get("/api/admin/workstreams", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const engagementId = req.query.engagementId ? Number(req.query.engagementId) : undefined;
    if (!engagementId) return res.status(400).json({ error: "engagementId is required." });

    const db = getDb();
    const rows = await db.select().from(workstreams).where(eq(workstreams.engagementId, engagementId)).orderBy(workstreams.sequence);
    res.json(rows);
  });

  app.post("/api/admin/workstreams", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const parsed = insertWorkstreamSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    const [workstream] = await db.insert(workstreams).values(parsed.data).returning();
    res.json(workstream);
  });

  app.post("/api/admin/deliverables", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const parsed = insertDeliverableSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    const [deliverable] = await db.insert(deliverables).values({
      ...parsed.data,
      submittedByAdminId: req.user!.id,
    }).returning();
    res.json(deliverable);
  });

  // ─── Quality Gate (Major Bet, Roadmap Rev.3) ───────────────────────────────
  // "Make the deliverable/approval flow explicit" -- see shared/schema.ts's
  // deliverableStatusEnum docstring for why the whole enum was replaced
  // rather than layered on. Flat list across every engagement (no drill-down
  // UI exists for engagements/workstreams yet -- see the "thin CRUD" note
  // above), joined up to workstream/engagement/org for display context.
  app.get("/api/admin/deliverables", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const workstreamId = req.query.workstreamId ? Number(req.query.workstreamId) : undefined;
    const db = getDb();
    const rows = await db.select({
      id: deliverables.id,
      title: deliverables.title,
      description: deliverables.description,
      status: deliverables.status,
      workstreamId: deliverables.workstreamId,
      workstreamTitle: workstreams.title,
      engagementId: workstreams.engagementId,
      engagementTitle: engagements.title,
      organizationName: organizations.name,
      createdAt: deliverables.createdAt,
      updatedAt: deliverables.updatedAt,
      deliveredAt: deliverables.deliveredAt,
      isDecisionRoom: deliverables.isDecisionRoom,
      decisionQuestion: deliverables.decisionQuestion,
      dataUsed: deliverables.dataUsed,
      modelUsed: deliverables.modelUsed,
      keyAssumptions: deliverables.keyAssumptions,
      keyRisks: deliverables.keyRisks,
      scenarios: deliverables.scenarios,
      recommendation: deliverables.recommendation,
      decisionOwner: deliverables.decisionOwner,
    })
      .from(deliverables)
      .innerJoin(workstreams, eq(deliverables.workstreamId, workstreams.id))
      .innerJoin(engagements, eq(workstreams.engagementId, engagements.id))
      .innerJoin(organizations, eq(engagements.organizationId, organizations.id))
      .orderBy(desc(deliverables.updatedAt));

    res.json(workstreamId ? rows.filter((r) => r.workstreamId === workstreamId) : rows);
  });

  app.get("/api/admin/deliverables/:id/gate-log", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const rows = await db.select({
      id: deliverableGateEvents.id,
      action: deliverableGateEvents.action,
      fromStatus: deliverableGateEvents.fromStatus,
      toStatus: deliverableGateEvents.toStatus,
      notes: deliverableGateEvents.notes,
      createdAt: deliverableGateEvents.createdAt,
      performedByName: users.name,
    })
      .from(deliverableGateEvents)
      .innerJoin(users, eq(deliverableGateEvents.performedByUserId, users.id))
      .where(eq(deliverableGateEvents.deliverableId, id))
      .orderBy(desc(deliverableGateEvents.createdAt));
    res.json(rows);
  });

  const advanceGateSchema = z.object({ notes: z.string().trim().optional() });

  app.patch("/api/admin/deliverables/:id/advance", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const id = Number(req.params.id);
    const parsed = advanceGateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    const [existing] = await db.select().from(deliverables).where(eq(deliverables.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: "Not found." });

    const idx = DELIVERABLE_GATE_SEQUENCE.indexOf(existing.status);
    if (idx === -1 || idx === DELIVERABLE_GATE_SEQUENCE.length - 1) {
      return res.status(400).json({ error: "This deliverable has already completed the gate." });
    }

    // Senior review sign-off is the one stage in the gate that needs to mean
    // something beyond a label -- an internal_analyst can push a deliverable
    // through every earlier stage, but only internal_admin can clear it for
    // delivery, same privilege boundary as org/user management elsewhere in
    // this file.
    if (existing.status === "senior_review" && req.user!.role !== "internal_admin") {
      return res.status(403).json({ error: "Senior review sign-off requires an admin account." });
    }

    const nextStatus = DELIVERABLE_GATE_SEQUENCE[idx + 1];
    const updates: { status: typeof nextStatus; updatedAt: Date; deliveredAt?: Date } = { status: nextStatus, updatedAt: new Date() };
    if (nextStatus === "delivered") updates.deliveredAt = new Date();

    const [updated] = await db.update(deliverables).set(updates).where(eq(deliverables.id, id)).returning();
    await db.insert(deliverableGateEvents).values({
      deliverableId: id, action: "advance", fromStatus: existing.status, toStatus: nextStatus,
      performedByUserId: req.user!.id, notes: parsed.data.notes,
    });
    res.json(updated);
  });

  const rejectGateSchema = z.object({ reason: z.string().trim().min(1) });

  app.patch("/api/admin/deliverables/:id/reject", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const id = Number(req.params.id);
    const parsed = rejectGateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    const [existing] = await db.select().from(deliverables).where(eq(deliverables.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: "Not found." });
    if (existing.status === "draft") return res.status(400).json({ error: "Already at draft -- nothing to send back." });
    if (existing.status === "delivered") return res.status(400).json({ error: "Already delivered to the client -- can't be sent back." });

    const [updated] = await db.update(deliverables).set({ status: "draft", updatedAt: new Date() }).where(eq(deliverables.id, id)).returning();
    await db.insert(deliverableGateEvents).values({
      deliverableId: id, action: "reject", fromStatus: existing.status, toStatus: "draft",
      performedByUserId: req.user!.id, notes: parsed.data.reason,
    });
    res.json(updated);
  });

  // ─── BYOD -- Bring Your Own Data, consultant-facing read side (Major Bet) ──
  // "Reaches the client only through the consultant" -- the consultant is
  // the one who can pull up a specific org's uploaded datasets while
  // working that org's engagement. Read-only: uploads and deletes are
  // always client-initiated (see clientRoutes.ts), staff never uploads on
  // a client's behalf here.
  app.get("/api/admin/datasets", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const organizationId = req.query.organizationId ? Number(req.query.organizationId) : undefined;
    if (!organizationId) return res.status(400).json({ error: "organizationId is required." });

    const db = getDb();
    const rows = await db.select({
      id: clientDatasets.id, fileName: clientDatasets.fileName, fileExt: clientDatasets.fileExt,
      sheetCount: clientDatasets.sheetCount, totalRows: clientDatasets.totalRows,
      createdAt: clientDatasets.createdAt, uploadedByName: users.name,
    })
      .from(clientDatasets)
      .innerJoin(users, eq(clientDatasets.uploadedByUserId, users.id))
      .where(eq(clientDatasets.organizationId, organizationId))
      .orderBy(desc(clientDatasets.createdAt));
    res.json(rows);
  });

  app.get("/api/admin/datasets/:id", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const [row] = await db.select().from(clientDatasets).where(eq(clientDatasets.id, id)).limit(1);
    if (!row) return res.status(404).json({ error: "Not found." });
    res.json(row);
  });

  app.post("/api/admin/meetings", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const parsed = insertMeetingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    const [meeting] = await db.insert(meetings).values({
      ...parsed.data,
      createdByUserId: req.user!.id,
    }).returning();
    res.json(meeting);
  });

  // A meeting could be created (above) but never read back anywhere -- no
  // GET existed at all, so every logged meeting was permanently invisible
  // through the API. Same list/filter shape as the deliverables GET above
  // (optional scoping query param, joins in engagement/org context for
  // display) for consistency.
  app.get("/api/admin/meetings", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const engagementId = req.query.engagementId ? Number(req.query.engagementId) : undefined;
    const db = getDb();
    const rows = await db.select({
      id: meetings.id,
      engagementId: meetings.engagementId,
      engagementTitle: engagements.title,
      organizationName: organizations.name,
      workstreamId: meetings.workstreamId,
      workstreamTitle: workstreams.title,
      title: meetings.title,
      scheduledAt: meetings.scheduledAt,
      durationMinutes: meetings.durationMinutes,
      notes: meetings.notes,
      status: meetings.status,
      createdAt: meetings.createdAt,
    })
      .from(meetings)
      .innerJoin(engagements, eq(meetings.engagementId, engagements.id))
      .innerJoin(organizations, eq(engagements.organizationId, organizations.id))
      .leftJoin(workstreams, eq(meetings.workstreamId, workstreams.id))
      .orderBy(desc(meetings.scheduledAt));

    res.json(engagementId ? rows.filter((r) => r.engagementId === engagementId) : rows);
  });

  // ─── Retained leads (read-only) ──────────────────────────────────────────
  // The public capture form was retired; this only lets internal staff review
  // rows it captured earlier.
  app.get("/api/admin/leads", requireRole("internal_admin", "internal_analyst"), async (_req, res) => {
    const db = getDb();
    const rows = await db.select().from(leads).orderBy(desc(leads.createdAt));
    res.json(rows);
  });
}
