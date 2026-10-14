import type { Express } from "express";
import { z } from "zod";
import { requireRole } from "./auth";
import { auditActor, recordAuditEvent } from "./auditEvents";
import { tenantContext } from "./tenantContext";
import { deleteNormalizationAdjustment, listNormalizationPolicies, upsertNormalizationPolicy } from "./financialNormalizationStore";

const READ_ROLES = ["internal_admin", "internal_analyst", "internal_compliance", "client_admin", "client_user"] as const;
const WRITE_ROLES = ["internal_admin", "internal_analyst", "client_admin"] as const;
const symbolSchema = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9.^_=-]+$/);

const adjustmentKindSchema = z.enum(["add-back", "subtract", "reclassify", "exclude", "replace"]);

const adjustmentSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  label: z.string().trim().min(1).max(160),
  metricId: z.string().trim().min(1).max(120),
  kind: adjustmentKindSchema,
  amount: z.number().finite(),
  period: z.string().trim().min(1).max(40),
  rationale: z.string().trim().max(2000).optional(),
  source: z.string().trim().max(500).optional(),
});

const policySchema = z.object({
  symbol: symbolSchema,
  label: z.string().trim().min(1).max(160).default("Normalization Policy"),
  adjustments: z.array(adjustmentSchema).max(200).default([]),
});

export function registerFinancialNormalizationRoutes(app: Express): void {
  app.get("/api/finance/normalization-policies", requireRole(...READ_ROLES), async (req, res) => {
    const symbol = symbolSchema.safeParse(req.query.symbol);
    if (!symbol.success) return res.status(400).json({ error: "A valid symbol is required." });
    try {
      res.json(await listNormalizationPolicies(tenantContext(req.user!), symbol.data));
    } catch (error) {
      res.status(403).json({ error: error instanceof Error ? error.message : "Normalization policy access denied." });
    }
  });

  app.post("/api/finance/normalization-policies", requireRole(...WRITE_ROLES), async (req, res) => {
    const parsed = policySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const ctx = tenantContext(req.user!);
      const policy = await upsertNormalizationPolicy(ctx, parsed.data);
      await recordAuditEvent(req.user!.id, "financial_normalization_policy_upserted", { symbol: parsed.data.symbol.toUpperCase(), policyId: policy.id, adjustmentCount: policy.adjustments.length, ...auditActor(req.user!) });
      res.status(201).json(policy);
    } catch (error) {
      res.status(403).json({ error: error instanceof Error ? error.message : "Normalization policy write denied." });
    }
  });

  app.delete("/api/finance/normalization-policies/:policyId/adjustments/:id", requireRole(...WRITE_ROLES), async (req, res) => {
    const id = z.string().trim().min(1).max(120).safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: "A valid adjustment id is required." });
    try {
      const deleted = await deleteNormalizationAdjustment(tenantContext(req.user!), id.data);
      if (!deleted) return res.status(404).json({ error: "Normalization adjustment not found." });
      await recordAuditEvent(req.user!.id, "financial_normalization_adjustment_deleted", { adjustmentId: id.data, policyId: req.params.policyId, ...auditActor(req.user!) });
      res.json({ ok: true });
    } catch (error) {
      res.status(403).json({ error: error instanceof Error ? error.message : "Normalization adjustment delete denied." });
    }
  });
}
