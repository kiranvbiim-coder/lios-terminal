import type { Express } from "express";
import { z } from "zod";
import { requireClient, requireRole } from "./auth";
import { recordSecurityAuditEvent, auditActor } from "./auditEvents";
import {
  EnterpriseLegalHoldError,
  buildPublicDistributionManifest,
  ensureProductionRetentionPolicy,
  latestDiagnosticEvidence,
  latestDistributionEvidence,
  latestOperationsNotificationEvidence,
  listDeletionReceipts,
  listExportCustodyReceipts,
  markExportCustodyDeleted,
  productionOperationalCounts,
  purgeExpiredProductionMetadata,
  purgeOrganizationOperationalMetadata,
  recordDiagnosticEvent,
  registerExportCustodyReceipt,
  sendOperationsNotification,
  updateProductionRetentionPolicy,
  verifyPublicDistributionEndpoints,
} from "./productionControlPlane";

const diagnosticSchema = z.object({
  category: z.enum(["runtime", "crash", "performance"]),
  eventName: z.string().trim().min(1).max(120).regex(/^[a-z0-9._:-]+$/i),
  severity: z.enum(["info", "warning", "error", "fatal"]),
  appVersion: z.string().trim().max(80).optional(),
  platform: z.string().trim().max(40).optional(),
  arch: z.string().trim().max(40).optional(),
  fingerprint: z.string().trim().regex(/^[a-f0-9]{64}$/i).optional(),
  details: z.object({
    durationMs: z.number().finite().nonnegative().max(86_400_000).optional(),
    count: z.number().finite().nonnegative().max(1_000_000_000).optional(),
    code: z.string().trim().max(160).optional(),
    screen: z.string().trim().max(160).optional(),
    operation: z.string().trim().max(160).optional(),
    reason: z.string().trim().max(160).optional(),
    recoverable: z.boolean().optional(),
    memoryMb: z.number().finite().nonnegative().max(1_000_000).optional(),
    status: z.number().finite().optional(),
    method: z.string().trim().max(16).optional(),
    retryCount: z.number().int().nonnegative().max(1000).optional(),
    queueDepth: z.number().int().nonnegative().max(1_000_000).optional(),
    launchCount: z.number().int().nonnegative().max(1_000_000_000).optional(),
    failureCount: z.number().int().nonnegative().max(1_000_000_000).optional(),
    noResultCount: z.number().int().nonnegative().max(1_000_000_000).optional(),
    linkedContextChanges: z.number().int().nonnegative().max(1_000_000_000).optional(),
    completedMissions: z.number().int().nonnegative().max(1_000_000_000).optional(),
    timingCount: z.number().int().nonnegative().max(1_000_000_000).optional(),
    maxTimingMs: z.number().finite().nonnegative().max(86_400_000).optional(),
  }).strict().default({}),
}).strict();

const exportCustodySchema = z.object({
  format: z.enum(["pdf", "xlsx", "csv", "json", "zip", "other"]),
  artifactNameHash: z.string().trim().regex(/^[a-f0-9]{64}$/i),
  sha256: z.string().trim().regex(/^[a-f0-9]{64}$/i),
  byteSize: z.number().int().nonnegative().max(2_000_000_000),
  generatedAt: z.string().datetime(),
}).strict();

const retentionSchema = z.object({
  telemetryDays: z.number().int().min(1).max(365),
  deletionReceiptDays: z.number().int().min(30).max(3650),
  exportReceiptDays: z.number().int().min(1).max(3650),
}).strict();

export function registerProductionControlRoutes(app: Express): void {
  // Public website/account surfaces. These return only sanitized product and
  // distribution metadata; no customer, provider or credential state.
  app.get("/api/public/desktop-distribution", (_req, res) => {
    res.json(buildPublicDistributionManifest());
  });

  // Customer diagnostics are remote-control-plane data. The downloaded app
  // forwards its authenticated hosted session; the local workspace remains
  // authoritative for BYOD and never sends raw content through this route.
  app.get("/api/client/diagnostics/config", requireClient, async (req, res) => {
    const retention = await ensureProductionRetentionPolicy();
    res.json({
      enabled: process.env.LIOS_TELEMETRY_ENABLED?.trim().toLowerCase() === "true",
      retentionDays: retention.telemetryDays,
      acceptsRawContent: false,
    });
  });

  app.post("/api/client/diagnostics", requireClient, async (req, res) => {
    const parsed = diagnosticSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid diagnostic envelope.", issues: parsed.error.issues });
      return;
    }
    const result = await recordDiagnosticEvent({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      ...parsed.data,
    });
    res.status(result.accepted ? 202 : 200).json(result);
  });

  app.get("/api/client/export-custody", requireClient, async (req, res) => {
    if (req.user!.organizationId === null) {
      res.status(403).json({ error: "Organization membership is required." });
      return;
    }
    res.json(await listExportCustodyReceipts(req.user!.organizationId, req.user!.id));
  });

  app.post("/api/client/export-custody", requireClient, async (req, res) => {
    const parsed = exportCustodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid export custody receipt.", issues: parsed.error.issues });
      return;
    }
    if (req.user!.organizationId === null) {
      res.status(403).json({ error: "Organization membership is required." });
      return;
    }
    const receipt = await registerExportCustodyReceipt({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      format: parsed.data.format,
      artifactNameHash: parsed.data.artifactNameHash,
      sha256: parsed.data.sha256,
      byteSize: parsed.data.byteSize,
      generatedAt: new Date(parsed.data.generatedAt),
    });
    res.status(201).json(receipt);
  });

  app.delete("/api/client/export-custody/:id", requireClient, async (req, res) => {
    const receiptId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!receiptId) {
      res.status(400).json({ error: "Export custody receipt id is required." });
      return;
    }
    if (req.user!.organizationId === null) {
      res.status(403).json({ error: "Organization membership is required." });
      return;
    }
    try {
      const receipt = await markExportCustodyDeleted(receiptId, req.user!.organizationId, req.user!.id);
      if (!receipt) {
        res.status(404).json({ error: "Active export custody receipt not found." });
        return;
      }
      res.json(receipt);
    } catch (error) {
      if (error instanceof EnterpriseLegalHoldError) {
        res.status(423).json({ error: error.message, code: "enterprise_legal_hold" });
        return;
      }
      throw error;
    }
  });

  // Internal production operations.
  app.get("/api/admin/production-control/status", requireRole("internal_admin", "internal_analyst", "internal_compliance"), async (_req, res) => {
    const [
      retention,
      latestDiagnostic,
      latestCrash,
      latestNotification,
      latestDistribution,
      counts,
    ] = await Promise.all([
      ensureProductionRetentionPolicy(),
      latestDiagnosticEvidence(),
      latestDiagnosticEvidence("crash"),
      latestOperationsNotificationEvidence(),
      latestDistributionEvidence(),
      productionOperationalCounts(),
    ]);
    res.json({
      distribution: buildPublicDistributionManifest(),
      retention,
      telemetryEnabled: process.env.LIOS_TELEMETRY_ENABLED?.trim().toLowerCase() === "true",
      operationsEmailConfigured: !!process.env.LIOS_OPERATIONS_ALERT_EMAIL?.trim(),
      latestEvidence: {
        diagnosticAt: latestDiagnostic?.createdAt ?? null,
        crashAt: latestCrash?.createdAt ?? null,
        operationsNotificationAt: latestNotification?.createdAt ?? null,
        distributionAt: latestDistribution?.createdAt ?? null,
      },
      counts,
    });
  });

  app.put("/api/admin/production-control/retention", requireRole("internal_admin"), async (req, res) => {
    const parsed = retentionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid retention policy.", issues: parsed.error.issues });
      return;
    }
    const policy = await updateProductionRetentionPolicy(parsed.data, req.user!.id);
    await recordSecurityAuditEvent(req.user!.id, "production_retention_policy_updated", { ...policy, ...auditActor(req.user!) });
    res.json(policy);
  });

  app.post("/api/admin/production-control/purge", requireRole("internal_admin"), async (req, res) => {
    const parsed = z.object({ confirm: z.literal(true) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Explicit purge confirmation is required." });
      return;
    }
    const result = await purgeExpiredProductionMetadata();
    await recordSecurityAuditEvent(req.user!.id, "production_retention_purge_run", { counts: result.counts, receiptId: result.receipt.id, ...auditActor(req.user!) });
    res.json(result);
  });

  app.post("/api/admin/production-control/organizations/:organizationId/purge-operational-metadata", requireRole("internal_admin"), async (req, res) => {
    const organizationId = Number(req.params.organizationId);
    const parsed = z.object({ reason: z.string().trim().min(3).max(500), confirm: z.literal(true) }).safeParse(req.body);
    if (!Number.isInteger(organizationId) || organizationId <= 0 || !parsed.success) {
      res.status(400).json({ error: "Valid organization, reason and explicit confirmation are required." });
      return;
    }
    const result = await purgeOrganizationOperationalMetadata(organizationId, req.user!.id, parsed.data.reason);
    await recordSecurityAuditEvent(req.user!.id, "production_organization_metadata_purged", {
      organizationId,
      counts: result.counts,
      receiptId: result.receipt.id,
      ...auditActor(req.user!),
    });
    res.json(result);
  });

  app.get("/api/admin/production-control/deletion-receipts", requireRole("internal_admin", "internal_compliance"), async (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
    res.json(await listDeletionReceipts(limit));
  });

  app.get("/api/admin/production-control/export-custody", requireRole("internal_admin", "internal_compliance"), async (req, res) => {
    const organizationId = Number(req.query.organizationId);
    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      res.status(400).json({ error: "organizationId is required." });
      return;
    }
    res.json(await listExportCustodyReceipts(organizationId));
  });

  app.post("/api/admin/production-control/distribution/verify", requireRole("internal_admin"), async (req, res) => {
    const result = await verifyPublicDistributionEndpoints();
    await recordSecurityAuditEvent(req.user!.id, "production_distribution_verified", {
      verified: result.verified,
      checks: result.checks.map((check) => ({ name: check.name, ok: check.ok, status: check.status })),
      ...auditActor(req.user!),
    });
    res.status(result.verified ? 200 : 409).json(result);
  });

  app.post("/api/admin/production-control/notification/test", requireRole("internal_admin"), async (req, res) => {
    const result = await sendOperationsNotification(
      "LiOS production notification acceptance",
      "This message verifies the configured LiOS production operations notification path.",
    );
    await recordSecurityAuditEvent(req.user!.id, "production_notification_tested", { delivered: result.delivered, ...auditActor(req.user!) });
    res.status(result.delivered ? 200 : 409).json(result);
  });
}
