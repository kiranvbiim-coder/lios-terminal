import type { Express } from "express";
import { z } from "zod";
import { requireRole } from "./auth";
import { auditActor, recordAuditEvent } from "./auditEvents";
import { tenantContext } from "./tenantContext";
import { normalizeUniversalFinanceRecords } from "@shared/universalIngestion";
import { deleteFinancialCustomMetric, deleteFinancialMetricOverride, listFinancialCustomMetrics, listFinancialMetricOverrides, upsertFinancialCustomMetric, upsertFinancialMetricOverride } from "./financialMetricStore";
const READ_ROLES = ["internal_admin", "internal_analyst", "internal_compliance", "client_admin", "client_user"] as const;
const WRITE_ROLES = ["internal_admin", "internal_analyst", "client_admin"] as const;
const symbolSchema = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9.^_=-]+$/);
const dateOrTime = z.union([z.string().date(), z.string().datetime()]);
const overrideSchema = z.object({
  symbol: symbolSchema,
  metricId: z.string().trim().min(1).max(120),
  value: z.number().finite(),
  period: z.string().trim().min(1).max(40).default("CURRENT"),
  scenarioId: z.string().trim().min(1).max(80).optional(),
  asOf: dateOrTime,
  publishedAt: dateOrTime.optional(),
  source: z.string().trim().min(1).max(500),
  sourceUrl: z.string().url().optional(),
  currency: z.string().trim().min(1).max(12).optional(),
  note: z.string().trim().max(2000).optional(),
  confidence: z.number().finite().min(0).max(1).optional(),
  status: z.enum(["manual", "imported"]).default("manual"),
});
const customMetricSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  label: z.string().trim().min(1).max(160),
  unit: z.enum(["currency", "price", "currency-per-share", "percent", "ratio", "multiple", "days", "turnover", "count", "bps", "yield", "volatility"]),
  formula: z.string().trim().min(1).max(1000),
  description: z.string().trim().max(1000).optional(),
});

const normalizeSchema = z.object({
  symbol: symbolSchema,
  records: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
  source: z.string().trim().min(1).max(500),
  provider: z.string().trim().min(1).max(120),
  sourceUrl: z.string().url().optional(),
  defaultPeriod: z.string().trim().min(1).max(40).optional(),
  defaultCurrency: z.string().trim().min(1).max(12).optional(),
  retrievedAt: z.string().datetime().optional(),
  columnMapping: z.record(z.string(), z.string().nullable()).optional(),
  persist: z.boolean().default(false),
});
export function registerFinancialMetricRoutes(app: Express): void {
  app.post("/api/finance/normalize", requireRole(...WRITE_ROLES), async (req, res) => {
    const parsed = normalizeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const result = normalizeUniversalFinanceRecords(parsed.data);
    let persisted = 0;
    if (parsed.data.persist) {
      const ctx = tenantContext(req.user!);
      await Promise.all(result.observations.map(async observation => {
        if (typeof observation.value !== "number" || !observation.asOf || !observation.period || !observation.source) return;
        await upsertFinancialMetricOverride(ctx, {
          symbol: parsed.data.symbol,
          metricId: observation.metricId,
          value: observation.value,
          period: observation.period,
          asOf: observation.asOf,
          source: observation.source,
          sourceUrl: observation.sourceUrl,
          currency: observation.currency,
          note: observation.note,
          status: "imported",
        });
        persisted += 1;
      }));
    }
    await recordAuditEvent(req.user!.id, "financial_records_normalized", { symbol: parsed.data.symbol.toUpperCase(), provider: parsed.data.provider, observationCount: result.observations.length, rejectedCount: result.rejected.length, persisted, ...auditActor(req.user!) });
    res.json({ ...result, persisted });
  });
  app.get("/api/finance/metric-overrides", requireRole(...READ_ROLES), async (req, res) => {
    const symbol = symbolSchema.safeParse(req.query.symbol);
    if (!symbol.success) return res.status(400).json({ error: "A valid symbol is required." });
    try {
      res.json(await listFinancialMetricOverrides(tenantContext(req.user!), symbol.data));
    } catch (error) {
      res.status(403).json({ error: error instanceof Error ? error.message : "Finance override access denied." });
    }
  });

  app.post("/api/finance/metric-overrides", requireRole(...WRITE_ROLES), async (req, res) => {
    const parsed = overrideSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const ctx = tenantContext(req.user!);
      const observation = await upsertFinancialMetricOverride(ctx, parsed.data);
      await recordAuditEvent(req.user!.id, "financial_metric_override_upserted", { symbol: parsed.data.symbol.toUpperCase(), metricId: parsed.data.metricId, period: parsed.data.period, status: parsed.data.status, ...auditActor(req.user!) });
      res.status(201).json(observation);
    } catch (error) {
      res.status(403).json({ error: error instanceof Error ? error.message : "Finance override write denied." });
    }
  });

  app.delete("/api/finance/metric-overrides/:id", requireRole(...WRITE_ROLES), async (req, res) => {
    const id = z.string().trim().min(1).max(120).safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: "A valid override id is required." });
    try {
      const deleted = await deleteFinancialMetricOverride(tenantContext(req.user!), id.data);
      if (!deleted) return res.status(404).json({ error: "Finance override not found." });
      await recordAuditEvent(req.user!.id, "financial_metric_override_deleted", { overrideId: id.data, ...auditActor(req.user!) });
      res.json({ ok: true });
    } catch (error) {
      res.status(403).json({ error: error instanceof Error ? error.message : "Finance override delete denied." });
    }
  });
  app.get("/api/finance/custom-metrics", requireRole(...READ_ROLES), async (req, res) => {
    try {
      res.json(await listFinancialCustomMetrics(tenantContext(req.user!)));
    } catch (error) {
      res.status(403).json({ error: error instanceof Error ? error.message : "Custom metric access denied." });
    }
  });

  app.post("/api/finance/custom-metrics", requireRole(...WRITE_ROLES), async (req, res) => {
    const parsed = customMetricSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const metric = await upsertFinancialCustomMetric(tenantContext(req.user!), parsed.data);
      await recordAuditEvent(req.user!.id, "financial_custom_metric_upserted", { metricId: metric.id, label: metric.label, ...auditActor(req.user!) });
      res.status(201).json(metric);
    } catch (error) {
      res.status(422).json({ error: error instanceof Error ? error.message : "Custom metric rejected." });
    }
  });

  app.delete("/api/finance/custom-metrics/:id", requireRole(...WRITE_ROLES), async (req, res) => {
    const id = z.string().trim().min(1).max(120).safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: "A valid custom metric id is required." });
    try {
      const deleted = await deleteFinancialCustomMetric(tenantContext(req.user!), id.data);
      if (!deleted) return res.status(404).json({ error: "Custom metric not found." });
      await recordAuditEvent(req.user!.id, "financial_custom_metric_deleted", { metricId: id.data, ...auditActor(req.user!) });
      res.json({ ok: true });
    } catch (error) {
      res.status(403).json({ error: error instanceof Error ? error.message : "Custom metric delete denied." });
    }
  });

}
