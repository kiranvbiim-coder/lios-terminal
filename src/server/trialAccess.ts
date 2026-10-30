/**
 * LiOS V4 trial and consulting-interest routes.
 *
 * V4 rules enforced here:
 * - trial duration is server-authoritative and defaults to seven days;
 * - trial software entitlement is Pro-style, not a curated panel subset;
 * - BYOAI never consumes LiOS credits;
 * - a trial user must explicitly select an AI provider before an AI action;
 * - consulting-service interest is separate from the software subscription.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { getDb } from "./db";
import {
  organizations,
  organizationLicenses,
  platformPlans,
  domains,
  engagements,
  CLIENT_ROLES,
} from "@shared/schema";
import {
  AI_RUNTIME_POLICY,
  DEFAULT_TRIAL_DAYS,
  READ_ONLY_ERROR_CODE,
  TRIAL_PENDING_BILLING_STATE,
  TRIAL_ENTITLEMENT_TIER,
  resolveTrialLifecycle,
} from "@shared/commercialRuntime";
import { buildDataStatus } from "@shared/dataStatus";
import {
  buildClientAiContextInstruction,
  clientAiContextSchema,
} from "@shared/clientAiContext";
import { logClientAuditEvent } from "./clientAuditLog";
import { recordAuditEvent } from "./auditEvents";
import { storage } from "./storage";
import { invokeAIProvider } from "./byoaiTransport";
import { normalizeProviderId } from "./byoaiRouter";
import { getEnvironmentSetupForUser } from "./environmentSetupService";
import { evaluateCachedOfflineAccess } from "./offlineLeaseCache";
import { ensureInstallationTrialRecord } from "./accessMode";

const DAY_MS = 24 * 60 * 60 * 1000;

export class TrialStartError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "TrialStartError";
  }
}

/**
 * The owner's explicit "Start 7-day trial". The clock is written once, by the server; the trial belongs to the
 * installation, so neither a second account nor a repeat call can restart it. An owner without a client
 * organization (the packaged desktop's internal_admin) starts the installation's own trial record.
 */
export async function startLocalTrial(organizationId: number | null, now = new Date()): Promise<{ trialEndsAt: Date }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    let targetOrganizationId = organizationId;
    if (targetOrganizationId === null) targetOrganizationId = (await ensureInstallationTrialRecord(tx as never)).organizationId;
    const [license] = await tx.select().from(organizationLicenses).where(eq(organizationLicenses.organizationId, targetOrganizationId)).limit(1);
    if (!license) throw new TrialStartError(404, "This account has no trial to start.");
    if (license.billingState !== TRIAL_PENDING_BILLING_STATE) throw new TrialStartError(409, "A trial has already been started on this installation.");
    const [used] = await tx.select({ id: organizationLicenses.id }).from(organizationLicenses)
      .where(and(eq(organizationLicenses.billingState, "trial"), isNotNull(organizationLicenses.trialEndsAt), ne(organizationLicenses.organizationId, targetOrganizationId)))
      .limit(1);
    if (used) throw new TrialStartError(409, "The free trial on this installation has already been used. Enter a license key to continue.");
    const trialEndsAt = new Date(now.getTime() + DEFAULT_TRIAL_DAYS * DAY_MS);
    await tx.update(organizationLicenses)
      .set({ billingState: "trial", trialEndsAt, updatedAt: now })
      .where(and(eq(organizationLicenses.id, license.id), eq(organizationLicenses.billingState, TRIAL_PENDING_BILLING_STATE)));
    return { trialEndsAt };
  });
}

const clientChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(8_000),
  context: clientAiContextSchema.optional(),
}).strict();

interface TrialLicenseSnapshot {
  id: number;
  startedAt: Date;
  endsAt: Date;
  status: "active" | "grace" | "billing_hold" | "suspended" | "security_locked" | "terminated";
}

async function getOrCreateTrialPlanId(): Promise<number> {
  const db = getDb();
  const [existing] = await db.select().from(platformPlans).where(eq(platformPlans.code, "trial")).limit(1);
  if (existing) return existing.id;

  const [created] = await db.insert(platformPlans).values({
    code: "trial",
    name: "LiOS Pro Trial",
    tier: "trial",
    seatLimit: 1,
    deviceLimit: 2,
    offlineGraceDays: 0,
    featureLimits: {
      entitlementTier: TRIAL_ENTITLEMENT_TIER,
      trialDays: DEFAULT_TRIAL_DAYS,
      byoaiConsumesLiosCredits: false,
    },
    active: true,
  }).onConflictDoNothing().returning();

  if (created) return created.id;
  const [raced] = await db.select().from(platformPlans).where(eq(platformPlans.code, "trial")).limit(1);
  if (!raced) throw new Error("Unable to resolve canonical trial plan.");
  return raced.id;
}

/**
 * Creates the trial license exactly once. Existing trial organizations that
 * pre-date V4 receive an end time derived from the persisted license creation
 * time, never from the current request, so a status refresh cannot reset a
 * trial clock.
 */
export async function ensureServerBackedTrialLicense(organizationId: number): Promise<TrialLicenseSnapshot> {
  const db = getDb();
  const planId = await getOrCreateTrialPlanId();
  const [existing] = await db.select().from(organizationLicenses)
    .where(eq(organizationLicenses.organizationId, organizationId))
    .limit(1);

  if (!existing) {
    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + DEFAULT_TRIAL_DAYS * DAY_MS);
    const [created] = await db.insert(organizationLicenses).values({
      organizationId,
      planId,
      status: "active",
      billingState: "trial",
      seatsPurchased: 1,
      trialEndsAt: endsAt,
    }).onConflictDoNothing().returning();

    if (created) {
      return { id: created.id, startedAt: created.createdAt, endsAt, status: created.status };
    }

    const [raced] = await db.select().from(organizationLicenses)
      .where(eq(organizationLicenses.organizationId, organizationId))
      .limit(1);
    if (!raced) throw new Error("Unable to create trial license.");
    const racedEndsAt = raced.trialEndsAt ?? new Date(raced.createdAt.getTime() + DEFAULT_TRIAL_DAYS * DAY_MS);
    if (!raced.trialEndsAt) {
      await db.update(organizationLicenses)
        .set({ planId: raced.planId ?? planId, trialEndsAt: racedEndsAt, billingState: "trial", updatedAt: new Date() })
        .where(eq(organizationLicenses.id, raced.id));
    }
    return { id: raced.id, startedAt: raced.createdAt, endsAt: racedEndsAt, status: raced.status };
  }

  const endsAt = existing.trialEndsAt ?? new Date(existing.createdAt.getTime() + DEFAULT_TRIAL_DAYS * DAY_MS);
  if (!existing.trialEndsAt || existing.planId === null) {
    await db.update(organizationLicenses)
      .set({
        planId: existing.planId ?? planId,
        trialEndsAt: endsAt,
        billingState: existing.billingState || "trial",
        updatedAt: new Date(),
      })
      .where(eq(organizationLicenses.id, existing.id));
  }

  return { id: existing.id, startedAt: existing.createdAt, endsAt, status: existing.status };
}

async function resolveOrganizationTrialAccess(organizationId: number) {
  const db = getDb();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) return null;

  if (org.lifecycleStage !== "trial") {
    return {
      organization: org,
      trialState: null,
      trialLicense: null,
      serverNow: new Date(),
    } as const;
  }

  const serverNow = new Date();
  const [pending] = await db.select({ createdAt: organizationLicenses.createdAt }).from(organizationLicenses)
    .where(and(eq(organizationLicenses.organizationId, organizationId), eq(organizationLicenses.billingState, TRIAL_PENDING_BILLING_STATE)))
    .limit(1);
  if (pending) {
    // The owner has not chosen yet; the trial clock does not run until they start it, and a key converts it.
    const licensedBeforeStart = evaluateCachedOfflineAccess(undefined, serverNow).allowed;
    return {
      organization: org,
      trialState: licensedBeforeStart ? "converted" as const : "not_started" as const,
      trialLicense: null,
      serverNow,
    } as const;
  }
  const trialLicense = await ensureServerBackedTrialLicense(organizationId);
  // A valid vendor-signed licence imported on this install converts the trial; it does not wait for the clock.
  const licensed = evaluateCachedOfflineAccess(undefined, serverNow).allowed;
  const trialState = resolveTrialLifecycle({
    serverNow,
    startedAt: trialLicense.startedAt,
    endsAt: trialLicense.endsAt,
    convertedAt: licensed ? serverNow : null,
  });

  return { organization: org, trialState, trialLicense, serverNow } as const;
}

// Authentication + organization-state guard shared by trial and paid clients.
// Trial expiry is checked again on paid-capability routes because login access
// and entitlement to execute paid software are intentionally separate states.
export async function requireTrialOrClient(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.isAuthenticated() || !CLIENT_ROLES.includes(req.user!.role as (typeof CLIENT_ROLES)[number])) {
    res.status(403).json({ error: "Not signed in to the client workspace." });
    return;
  }

  const orgId = req.user!.organizationId;
  if (orgId === null) {
    res.status(403).json({ error: "No organization associated." });
    return;
  }

  const access = await resolveOrganizationTrialAccess(orgId);
  if (!access || access.organization.status !== "active" || access.organization.lifecycleStage === "churned") {
    res.status(403).json({ error: "This organization no longer has LiOS access." });
    return;
  }

  next();
}

export async function requireExecutableTrialOrClient(req: Request, res: Response, next: NextFunction): Promise<void> {
  const orgId = req.user!.organizationId!;
  const access = await resolveOrganizationTrialAccess(orgId);
  if (!access) {
    res.status(404).json({ error: "Organization not found." });
    return;
  }

  if (access.organization.lifecycleStage === "trial" && access.trialState !== "active" && access.trialState !== "converted") {
    res.status(402).json({
      error: "LiOS is read-only: your trial or license has ended. You can still open and export your work. Enter a license key to continue.",
      code: READ_ONLY_ERROR_CODE,
      trialState: access.trialState,
      trialEndsAt: access.trialLicense?.endsAt ?? null,
      serverNow: access.serverNow,
    });
    return;
  }

  next();
}

const consultingSelectionSchema = z.object({
  services: z.array(z.enum(["strategy", "one", "vantage"])).min(1, "Select at least one consulting service."),
});

const legacyTierSelectionSchema = z.object({
  tiers: z.array(z.enum(["strategy", "one", "vantage"])).min(1, "Select at least one consulting service."),
});

type ConsultingService = z.infer<typeof consultingSelectionSchema>["services"][number];

const CONSULTING_SERVICE_LABEL: Record<ConsultingService, string> = {
  strategy: "Limuria Strategy",
  one: "Limuria One",
  vantage: "Limuria Vantage",
};

async function createConsultingInterest(req: Request, res: Response, services: ConsultingService[]): Promise<void> {
  const orgId = req.user!.organizationId!;
  const userId = req.user!.id;
  const db = getDb();

  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) {
    res.status(404).json({ error: "Organization not found." });
    return;
  }

  // Engagements still require a domain in the existing consulting schema.
  // This is consulting metadata only; it does not grant or restrict LiOS
  // software entitlement.
  const [financeDomain] = await db.select().from(domains).where(eq(domains.slug, "finance")).limit(1);
  if (!financeDomain) {
    res.status(500).json({ error: "Consulting domain configuration is unavailable. Contact support." });
    return;
  }

  const created = await Promise.all(services.map((service) =>
    db.insert(engagements).values({
      organizationId: orgId,
      engagementModel: service,
      domainId: financeDomain.id,
      title: `${CONSULTING_SERVICE_LABEL[service]} — Client Interest`,
      status: "proposed",
    }).returning().then(([engagement]) => engagement),
  ));

  await logClientAuditEvent({
    organizationId: orgId,
    userId,
    eventType: "consulting_service_selected",
    details: { services },
  });
  await recordAuditEvent(userId, "consulting_service_selected", {
    organizationId: orgId,
    services,
    engagementIds: created.map((engagement) => engagement.id),
  });

  res.json({ engagements: created });
}

export function registerTrialRoutes(app: Express): void {
  app.get("/api/client/trial/status", requireTrialOrClient, async (req, res) => {
    const orgId = req.user!.organizationId!;
    const access = await resolveOrganizationTrialAccess(orgId);
    if (!access) {
      res.status(404).json({ error: "Organization not found." });
      return;
    }

    if (access.organization.lifecycleStage === "trial") {
      await logClientAuditEvent({
        organizationId: orgId,
        userId: req.user!.id,
        eventType: "trial_status_checked",
        details: { trialState: access.trialState },
      });
    }

    res.json({
      lifecycleStage: access.organization.lifecycleStage,
      trialState: access.trialState,
      trialStartedAt: access.trialLicense?.startedAt ?? null,
      trialEndsAt: access.trialLicense?.endsAt ?? null,
      serverNow: access.serverNow,
      entitlementTier: access.organization.lifecycleStage === "trial" ? TRIAL_ENTITLEMENT_TIER : null,
      trialDays: DEFAULT_TRIAL_DAYS,
      ai: {
        providerOwnership: AI_RUNTIME_POLICY.ownership,
        requiresUserProvider: AI_RUNTIME_POLICY.requiresUserProviderForAiActions,
        consumesLiosCredits: AI_RUNTIME_POLICY.trialByoaiConsumesLiosCredits,
      },
    });
  });

  app.post(
    "/api/client/trial/chat",
    requireTrialOrClient,
    requireExecutableTrialOrClient,
    async (req, res) => {
      const userId = req.user!.id;
      const parsedRequest = clientChatRequestSchema.safeParse(req.body);
      if (!parsedRequest.success) {
        res.status(400).json({ error: "Invalid Ask LiOS request.", issues: parsedRequest.error.issues });
        return;
      }
      const { message, context } = parsedRequest.data;

      const aiSetup = await getEnvironmentSetupForUser(userId);
      const selectedProvider = aiSetup?.aiProviderId ? normalizeProviderId(aiSetup.aiProviderId) : null;
      if (!selectedProvider) {
        res.status(409).json({
          error: "Choose and connect your AI provider before using LiOS AI.",
          code: "AI_PROVIDER_REQUIRED",
        });
        return;
      }

      await storage.addChatMessage(userId, { role: "user", content: message });
      const history = (await storage.getChatMessages(userId))
        .slice(-20)
        .map((item) => ({ role: item.role as "user" | "assistant", content: item.content }));

      const contextInstruction = buildClientAiContextInstruction(context);
      const systemPrompt = [
        "You are the LiOS Intelligence Terminal analyst. Be precise, concise, and data-oriented.",
        "Deterministic LiOS calculations and connected client data are authoritative when supplied.",
        "Clearly distinguish connected data, deterministic results, and general model reasoning.",
        "Never invent prices, filings, figures, or source access you do not have.",
        contextInstruction,
      ].filter(Boolean).join(" ");

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      try {
        const result = await invokeAIProvider({
          provider: selectedProvider,
          model: aiSetup?.aiModelId ?? undefined,
          system: systemPrompt,
          messages: history,
          maxTokens: 1024,
        });

        await storage.addChatMessage(userId, { role: "assistant", content: result.text });
        res.write(`data: ${JSON.stringify({ text: result.text })}\n\n`);
        const status = buildDataStatus({
          provider: result.attribution.provider,
          freshness: "ai_generated",
          asOf: new Date().toISOString(),
        });
        res.write(`data: ${JSON.stringify({ done: true, status, meteredCredits: 0 })}\n\n`);
      } catch (error) {
        console.error("LiOS BYOAI request failed:", error);
        res.write(`data: ${JSON.stringify({
          error: "The selected AI provider is unavailable. Check its connection and try again.",
          meteredCredits: 0,
        })}\n\n`);
      }
      res.end();
    },
  );

  // Canonical V4 consulting-interest endpoint. Selecting a consulting service
  // never changes the LiOS software subscription or entitlement tier.
  app.post("/api/client/consulting/select-services", requireTrialOrClient, async (req, res) => {
    const parsed = consultingSelectionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      return;
    }
    await createConsultingInterest(req, res, parsed.data.services);
  });

  // Compatibility alias for older clients. It is intentionally only an alias
  // to the consulting workflow and must never be interpreted as a software
  // plan selection endpoint.
  app.post("/api/client/trial/select-tiers", requireTrialOrClient, async (req, res) => {
    res.setHeader("Deprecation", "true");
    const parsed = legacyTierSelectionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      return;
    }
    await createConsultingInterest(req, res, parsed.data.tiers);
  });
}
