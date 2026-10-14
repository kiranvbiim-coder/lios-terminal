import type { Express } from "express";
import { z } from "zod";
import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import {
  consensusAlertRules,
  consensusBenchmarks,
  consensusSnapshots,
  researchEvidence,
  researchInvestigations,
} from "@shared/schema";
import { requireRole } from "./auth";
import { getDb } from "./db";
import { auditActor, recordAuditEvent } from "./auditEvents";
import {
  CONSENSUS_METRICS,
  buildConsensusSignals,
  buildRevisionSeries,
  calculateConsensusStatistics,
  compareConsensusBenchmarks,
  consensusSnapshotHash,
  revisionAcceleration,
} from "./consensusService";
import { getEstimateRecommendationEvidence } from "./estimateRecommendationEvidence";
export { snapshotVintageRows } from "./estimateRecommendationEvidence";
import { captureProviderConsensus } from "./consensusProviderCapture";


const READ_ROLES = ["internal_admin", "internal_analyst", "internal_compliance"] as const;
const AUTHOR_ROLES = ["internal_admin", "internal_analyst"] as const;
const metricSchema = z.enum(CONSENSUS_METRICS);
const nullableId = z.number().int().positive().nullable().optional();
const optionalUrl = z.string().url().max(4000).nullable().optional();
const finiteNumber = z.number().finite();
const fiscalPeriodPattern = /^(?:FY\d{4}(?:Q[1-4]|H[1-2])?|\d{4}(?:Q[1-4]|H[1-2])?|Q[1-4]FY\d{4}|CURRENT)$/i;
const intelligenceQuerySchema = z.object({
  symbol: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9.^_=-]+$/).transform((value) => value.toUpperCase()),
  metric: metricSchema,
  fiscalPeriod: z.string().trim().min(1).max(40).regex(fiscalPeriodPattern).transform((value) => value.toUpperCase()),
  asOf: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const scopeSchema = z.object({
  symbol: z.string().trim().min(1).max(30).transform((value) => value.toUpperCase()),
  organizationId: nullableId,
  investigationId: nullableId,
  metric: metricSchema,
  fiscalPeriod: z.string().trim().min(1).max(40),
  periodEnd: z.coerce.date().nullable().optional(),
  currency: z.string().trim().min(3).max(8).transform((value) => value.toUpperCase()).nullable().optional(),
  unit: z.string().trim().min(1).max(40),
});

const aggregateSchema = z.object({
  mean: finiteNumber.nullable().optional(),
  median: finiteNumber.nullable().optional(),
  high: finiteNumber.nullable().optional(),
  low: finiteNumber.nullable().optional(),
  contributorCount: z.number().int().nonnegative().nullable().optional(),
  standardDeviation: z.number().finite().nonnegative().nullable().optional(),
});

const providerConsensusCaptureSchema = z.object({
  provider: z.string().trim().min(1).max(100),
  sourceName: z.string().trim().min(1).max(200),
  sourceUrl: optionalUrl,
  sourceType: z.enum(["licensed_provider", "user_supplied", "manual"]).default("licensed_provider"),
  methodology: z.string().trim().min(1).max(2000),
  retrievedAt: z.coerce.date().optional(),
  observations: z.array(z.object({
    metric: metricSchema,
    fiscalPeriod: z.string().trim().min(1).max(40).regex(fiscalPeriodPattern).transform((value) => value.toUpperCase()),
    unit: z.string().trim().min(1).max(40),
    currency: z.string().trim().min(3).max(8).transform((value) => value.toUpperCase()).nullable().default(null),
    mean: finiteNumber.nullable().default(null),
    median: finiteNumber.nullable().default(null),
    high: finiteNumber.nullable().default(null),
    low: finiteNumber.nullable().default(null),
    contributorCount: z.number().int().nonnegative().nullable().default(null),
    metadata: z.record(z.unknown()).default({}),
  }).strict()).min(1).max(5000),
}).strict();

const createSnapshotSchema = scopeSchema.and(z.object({
  observations: z.array(finiteNumber).min(1).max(5000).optional(),
  aggregate: aggregateSchema.optional(),
  upwardRevisionCount: z.number().int().nonnegative().nullable().optional(),
  downwardRevisionCount: z.number().int().nonnegative().nullable().optional(),
  unchangedRevisionCount: z.number().int().nonnegative().nullable().optional(),
  estimateAsOf: z.coerce.date(),
  sourceType: z.enum(["licensed_provider", "user_supplied", "manual"]),
  provider: z.string().trim().min(1).max(100),
  sourceName: z.string().trim().min(1).max(200),
  sourceUrl: optionalUrl,
  methodology: z.string().trim().max(2000).nullable().optional(),
  metadata: z.record(z.unknown()).default({}),
})).superRefine((value, ctx) => {
  if (!value.observations?.length && value.aggregate?.mean == null && value.aggregate?.median == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide observations or an aggregate mean/median." });
  }
  if (value.aggregate?.low != null && value.aggregate?.high != null && value.aggregate.low > value.aggregate.high) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Aggregate low cannot exceed high." });
  }
});

const assumptionSchema = z.object({
  label: z.string().trim().min(1).max(200),
  value: z.union([z.string().max(500), finiteNumber]).nullable().optional(),
  evidenceId: z.number().int().positive().optional(),
});

const createBenchmarkSchema = scopeSchema.and(z.object({
  benchmarkKind: z.enum(["company_guidance", "reported_actual", "limuria_model"]),
  value: finiteNumber.nullable().optional(),
  low: finiteNumber.nullable().optional(),
  high: finiteNumber.nullable().optional(),
  effectiveAt: z.coerce.date(),
  provider: z.string().trim().min(1).max(100),
  sourceName: z.string().trim().min(1).max(200),
  sourceUrl: optionalUrl,
  modelName: z.string().trim().max(200).nullable().optional(),
  modelVersion: z.string().trim().max(100).nullable().optional(),
  evidenceIds: z.array(z.number().int().positive()).max(100).default([]),
  assumptionRefs: z.array(assumptionSchema).max(100).default([]),
  metadata: z.record(z.unknown()).default({}),
})).superRefine((value, ctx) => {
  if (value.value == null && value.low == null && value.high == null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide a benchmark value or range." });
  if (value.value == null && (value.low == null || value.high == null)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Benchmark ranges require both low and high values." });
  if (value.low != null && value.high != null && value.low > value.high) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Benchmark low cannot exceed high." });
  if (value.benchmarkKind === "reported_actual" && value.value == null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Reported actuals require a point value." });
  if (value.benchmarkKind === "limuria_model" && (!value.modelName || !value.modelVersion)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Limuria outputs require model name and version." });
  if (value.benchmarkKind === "limuria_model" && !value.evidenceIds.length && !value.assumptionRefs.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Link at least one model assumption or evidence item." });
});

const querySchema = z.object({
  symbol: z.string().trim().min(1).max(30).transform((value) => value.toUpperCase()),
  organizationId: z.coerce.number().int().positive().optional(),
  metric: metricSchema.optional(),
  fiscalPeriod: z.string().trim().min(1).max(40).optional(),
  asOf: z.coerce.date().optional(),
});

const alertSchema = z.object({
  symbol: z.string().trim().min(1).max(30).transform((value) => value.toUpperCase()),
  organizationId: nullableId,
  metric: metricSchema.nullable().optional(),
  revisionThresholdPct: z.number().finite().positive().max(1000).default(5),
  dispersionThresholdPct: z.number().finite().positive().max(1000).default(20),
  divergenceThresholdPct: z.number().finite().positive().max(1000).default(10),
  enabled: z.boolean().default(true),
});

function scopeCondition(column: typeof consensusSnapshots.organizationId | typeof consensusBenchmarks.organizationId, organizationId?: number | null) {
  return organizationId ? eq(column, organizationId) : isNull(column);
}

async function validateLinkedScope(organizationId?: number | null, investigationId?: number | null, evidenceIds: number[] = []) {
  const db = getDb();
  if (!investigationId) return evidenceIds.length ? "Evidence links require an investigation." : null;
  const [investigation] = await db.select({ organizationId: researchInvestigations.organizationId }).from(researchInvestigations).where(eq(researchInvestigations.id, investigationId)).limit(1);
  if (!investigation) return "Investigation not found.";
  if ((investigation.organizationId ?? null) !== (organizationId ?? null)) return "Investigation and consensus organization scopes must match.";
  if (evidenceIds.length) {
    const rows = await db.select({ id: researchEvidence.id }).from(researchEvidence).where(eq(researchEvidence.investigationId, investigationId));
    const allowed = new Set(rows.map((row) => row.id));
    if (evidenceIds.some((id) => !allowed.has(id))) return "Every evidence link must belong to the selected investigation.";
  }
  return null;
}

function seriesKey(item: { metric: string; fiscalPeriod: string }) {
  return `${item.metric}:${item.fiscalPeriod}`;
}

export function registerConsensusRoutes(app: Express): void {
  app.get("/api/consensus/providers", requireRole(...READ_ROLES), async (_req, res) => {
    res.json({
      providers: [
        { id: "licensed_provider", label: "Licensed provider import", status: "available", automatic: false, message: "Submit an attributed aggregate or observations from a connected licensed provider." },
        { id: "user_supplied", label: "User-supplied observations", status: "available", automatic: false, message: "Statistics are calculated and frozen by Limuria." },
        { id: "manual", label: "Attributed manual aggregate", status: "available", automatic: false, message: "Source and as-of metadata are mandatory." },
      ],
      unsupportedDataUsed: false,
    });
  });

  app.post("/api/consensus/capture/:symbol", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const symbol = z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9.^_=-]+$/).safeParse(req.params.symbol);
    if (!symbol.success) return res.status(400).json({ error: "A valid symbol is required." });
    const capture = providerConsensusCaptureSchema.safeParse(req.body);
    if (!capture.success) return res.status(400).json({ error: capture.error.flatten() });
    try {
      const result = await captureProviderConsensus({
        symbol: symbol.data,
        ...capture.data,
      }, req.user!.id);
      await recordAuditEvent(req.user!.id, "provider_consensus_captured", {
        symbol: result.symbol,
        provider: result.provider,
        createdCount: result.createdCount,
        reusedCount: result.reusedCount,
        ...auditActor(req.user!),
      });
      res.status(result.createdCount ? 201 : 200).json(result);
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : "Provider consensus capture failed." });
    }
  });

  app.get("/api/consensus/intelligence", requireRole(...READ_ROLES), async (req, res) => {
    const parsed = intelligenceQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      res.json(await getEstimateRecommendationEvidence({
        organizationId: req.user!.organizationId ?? null,
        symbol: parsed.data.symbol,
        metric: parsed.data.metric,
        fiscalPeriod: parsed.data.fiscalPeriod,
        asOf: parsed.data.asOf,
        page: parsed.data.page,
        limit: parsed.data.limit,
      }));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Consensus intelligence unavailable." });
    }
  });

  app.get("/api/consensus/snapshots", requireRole(...READ_ROLES), async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const db = getDb();
    const filters = [eq(consensusSnapshots.symbol, parsed.data.symbol), scopeCondition(consensusSnapshots.organizationId, parsed.data.organizationId)];
    if (parsed.data.metric) filters.push(eq(consensusSnapshots.metric, parsed.data.metric));
    if (parsed.data.fiscalPeriod) filters.push(eq(consensusSnapshots.fiscalPeriod, parsed.data.fiscalPeriod));
    if (parsed.data.asOf) filters.push(lte(consensusSnapshots.availableAt, parsed.data.asOf));
    const rows = await db.select().from(consensusSnapshots).where(and(...filters)).orderBy(desc(consensusSnapshots.estimateAsOf));
    res.json(rows);
  });

  app.post("/api/consensus/snapshots", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = createSnapshotSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const scopeError = await validateLinkedScope(parsed.data.organizationId, parsed.data.investigationId);
    if (scopeError) return res.status(400).json({ error: scopeError });
    const calculated = parsed.data.observations ? calculateConsensusStatistics(parsed.data.observations) : null;
    const aggregate = calculated ?? parsed.data.aggregate!;
    const values = {
      ...parsed.data,
      observations: undefined,
      aggregate: undefined,
      organizationId: parsed.data.organizationId ?? null,
      investigationId: parsed.data.investigationId ?? null,
      periodEnd: parsed.data.periodEnd ?? null,
      currency: parsed.data.currency ?? null,
      mean: aggregate.mean ?? null,
      median: aggregate.median ?? null,
      high: aggregate.high ?? null,
      low: aggregate.low ?? null,
      contributorCount: aggregate.contributorCount ?? null,
      standardDeviation: aggregate.standardDeviation ?? null,
      upwardRevisionCount: parsed.data.upwardRevisionCount ?? null,
      downwardRevisionCount: parsed.data.downwardRevisionCount ?? null,
      unchangedRevisionCount: parsed.data.unchangedRevisionCount ?? null,
      sourceUrl: parsed.data.sourceUrl ?? null,
      methodology: parsed.data.methodology ?? (calculated ? "Limuria-calculated from user-supplied observations." : null),
    };
    const snapshotHash = consensusSnapshotHash(values);
    const db = getDb();
    try {
      const [snapshot] = await db.insert(consensusSnapshots).values({ ...values, snapshotHash, createdByUserId: req.user!.id }).returning();
      await recordAuditEvent(req.user!.id, "consensus_snapshot_created", { snapshotId: snapshot.id, symbol: snapshot.symbol, metric: snapshot.metric, fiscalPeriod: snapshot.fiscalPeriod, sourceType: snapshot.sourceType, ...auditActor(req.user!) });
      res.status(201).json(snapshot);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return res.status(409).json({ error: "This exact consensus snapshot is already recorded." });
      throw error;
    }
  });

  app.get("/api/consensus/benchmarks", requireRole(...READ_ROLES), async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const db = getDb();
    const filters = [eq(consensusBenchmarks.symbol, parsed.data.symbol), scopeCondition(consensusBenchmarks.organizationId, parsed.data.organizationId)];
    if (parsed.data.metric) filters.push(eq(consensusBenchmarks.metric, parsed.data.metric));
    if (parsed.data.fiscalPeriod) filters.push(eq(consensusBenchmarks.fiscalPeriod, parsed.data.fiscalPeriod));
    const rows = await db.select().from(consensusBenchmarks).where(and(...filters)).orderBy(desc(consensusBenchmarks.effectiveAt));
    res.json(rows);
  });

  app.post("/api/consensus/benchmarks", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = createBenchmarkSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const evidenceIds = Array.from(new Set([...parsed.data.evidenceIds, ...parsed.data.assumptionRefs.flatMap((item) => item.evidenceId ? [item.evidenceId] : [])]));
    const scopeError = await validateLinkedScope(parsed.data.organizationId, parsed.data.investigationId, evidenceIds);
    if (scopeError) return res.status(400).json({ error: scopeError });
    const db = getDb();
    const [benchmark] = await db.insert(consensusBenchmarks).values({
      ...parsed.data,
      organizationId: parsed.data.organizationId ?? null,
      investigationId: parsed.data.investigationId ?? null,
      periodEnd: parsed.data.periodEnd ?? null,
      currency: parsed.data.currency ?? null,
      value: parsed.data.value ?? null,
      low: parsed.data.low ?? null,
      high: parsed.data.high ?? null,
      sourceUrl: parsed.data.sourceUrl ?? null,
      modelName: parsed.data.modelName ?? null,
      modelVersion: parsed.data.modelVersion ?? null,
      evidenceIds,
      createdByUserId: req.user!.id,
    }).returning();
    await recordAuditEvent(req.user!.id, "consensus_benchmark_created", { benchmarkId: benchmark.id, symbol: benchmark.symbol, metric: benchmark.metric, fiscalPeriod: benchmark.fiscalPeriod, benchmarkKind: benchmark.benchmarkKind, evidenceIds, ...auditActor(req.user!) });
    res.status(201).json(benchmark);
  });

  app.get("/api/consensus/analysis", requireRole(...READ_ROLES), async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const db = getDb();
    const snapshotFilters = [eq(consensusSnapshots.symbol, parsed.data.symbol), scopeCondition(consensusSnapshots.organizationId, parsed.data.organizationId)];
    const benchmarkFilters = [eq(consensusBenchmarks.symbol, parsed.data.symbol), scopeCondition(consensusBenchmarks.organizationId, parsed.data.organizationId)];
    if (parsed.data.metric) { snapshotFilters.push(eq(consensusSnapshots.metric, parsed.data.metric)); benchmarkFilters.push(eq(consensusBenchmarks.metric, parsed.data.metric)); }
    if (parsed.data.fiscalPeriod) { snapshotFilters.push(eq(consensusSnapshots.fiscalPeriod, parsed.data.fiscalPeriod)); benchmarkFilters.push(eq(consensusBenchmarks.fiscalPeriod, parsed.data.fiscalPeriod)); }
    if (parsed.data.asOf) { snapshotFilters.push(lte(consensusSnapshots.availableAt, parsed.data.asOf)); benchmarkFilters.push(lte(consensusBenchmarks.effectiveAt, parsed.data.asOf)); }
    const [snapshots, benchmarks, rules] = await Promise.all([
      db.select().from(consensusSnapshots).where(and(...snapshotFilters)).orderBy(asc(consensusSnapshots.estimateAsOf)),
      db.select().from(consensusBenchmarks).where(and(...benchmarkFilters)).orderBy(asc(consensusBenchmarks.effectiveAt)),
      db.select().from(consensusAlertRules).where(and(
        eq(consensusAlertRules.ownerUserId, req.user!.id),
        eq(consensusAlertRules.symbol, parsed.data.symbol),
        parsed.data.organizationId ? eq(consensusAlertRules.organizationId, parsed.data.organizationId) : isNull(consensusAlertRules.organizationId),
        eq(consensusAlertRules.enabled, true),
      )),
    ]);
    const grouped = new Map<string, typeof snapshots>();
    for (const snapshot of snapshots) grouped.set(seriesKey(snapshot), [...(grouped.get(seriesKey(snapshot)) ?? []), snapshot]);
    const series = Array.from(grouped.entries()).map(([key, items]) => {
      const revisions = buildRevisionSeries(items);
      const matchingBenchmarks = benchmarks.filter((item) => seriesKey(item) === key);
      const rule = rules.find((item) => item.metric === items[0].metric) ?? rules.find((item) => item.metric == null);
      const thresholds = rule ? { revisionPct: rule.revisionThresholdPct, dispersionPct: rule.dispersionThresholdPct, divergencePct: rule.divergenceThresholdPct } : undefined;
      return {
        key,
        metric: items[0].metric,
        fiscalPeriod: items[0].fiscalPeriod,
        latest: items.at(-1),
        revisions,
        revisionAccelerationPct: revisionAcceleration(revisions),
        comparisons: compareConsensusBenchmarks(items, matchingBenchmarks),
        signals: buildConsensusSignals(items, matchingBenchmarks, thresholds),
      };
    });
    res.json({
      symbol: parsed.data.symbol,
      organizationId: parsed.data.organizationId ?? null,
      coverage: snapshots.length ? { state: "available", snapshotCount: snapshots.length, seriesCount: series.length } : { state: "unavailable", snapshotCount: 0, seriesCount: 0, reason: "No licensed or user-supplied consensus has been recorded for this scope." },
      series,
      benchmarks,
      alertRules: rules,
    });
  });

  app.get("/api/consensus/alerts", requireRole(...READ_ROLES), async (req, res) => {
    const db = getDb();
    res.json(await db.select().from(consensusAlertRules).where(eq(consensusAlertRules.ownerUserId, req.user!.id)).orderBy(desc(consensusAlertRules.updatedAt)));
  });

  app.post("/api/consensus/alerts", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = alertSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const db = getDb();
    const [existing] = await db.select({ id: consensusAlertRules.id }).from(consensusAlertRules).where(and(
      eq(consensusAlertRules.ownerUserId, req.user!.id),
      eq(consensusAlertRules.symbol, parsed.data.symbol),
      parsed.data.organizationId ? eq(consensusAlertRules.organizationId, parsed.data.organizationId) : isNull(consensusAlertRules.organizationId),
      parsed.data.metric ? eq(consensusAlertRules.metric, parsed.data.metric) : isNull(consensusAlertRules.metric),
    )).limit(1);
    if (existing) return res.status(409).json({ error: "An alert rule already exists for this symbol and metric." });
    try {
      const [rule] = await db.insert(consensusAlertRules).values({ ...parsed.data, organizationId: parsed.data.organizationId ?? null, metric: parsed.data.metric ?? null, ownerUserId: req.user!.id }).returning();
      await recordAuditEvent(req.user!.id, "consensus_alert_created", { alertRuleId: rule.id, symbol: rule.symbol, metric: rule.metric, ...auditActor(req.user!) });
      res.status(201).json(rule);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return res.status(409).json({ error: "An alert rule already exists for this symbol and metric." });
      throw error;
    }
  });

  app.delete("/api/consensus/alerts/:id", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid alert rule id." });
    const db = getDb();
    const [deleted] = await db.delete(consensusAlertRules).where(and(eq(consensusAlertRules.id, id), eq(consensusAlertRules.ownerUserId, req.user!.id))).returning();
    if (!deleted) return res.status(404).json({ error: "Alert rule not found." });
    await recordAuditEvent(req.user!.id, "consensus_alert_removed", { alertRuleId: id, symbol: deleted.symbol, metric: deleted.metric, ...auditActor(req.user!) });
    res.json({ ok: true });
  });
}
