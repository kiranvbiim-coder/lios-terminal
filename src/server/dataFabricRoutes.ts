import type { Express } from "express";
import { z } from "zod";
import { alternativeSnapshotInputSchema, estimatesPayloadSchema } from "@shared/pointInTimeAlternativeData";
import { integratedModelRequestSchema, runIntegratedFinancialModel } from "@shared/integratedFinancialModel";
import { requireRole } from "./auth";
import { auditActor, recordAuditEvent } from "./auditEvents";
import {
  captureFinancialDatasetSnapshot,
  getDatasetSnapshot,
  getDatasetRevisionReport,
  getFinancialDatasetAsOf,
  listDatasetSnapshots,
  stableSnapshotHash,
} from "./pointInTimeDatasetStore";
import { getForecastActualVariance, listFinancialModelRuns, saveFinancialModelRun } from "./financialModelRunStore";
import { entitlementPolicyInputSchema, universePayloadSchema } from "@shared/pointInTimeUniverse";
import { createColumnarArtifact, listColumnarArtifacts, scanColumnarArtifact } from "./columnarArtifactStore";
import { createEntitlementPolicy, listEntitlementPolicies } from "./dataEntitlementStore";
import {
  captureFinancialStatementsConflictSnapshot,
  getFinancialStatementsConflictSnapshot,
  getFinancialStatementsConflictSnapshotAsOf,
  listFinancialStatementsConflictSnapshots,
} from "./financialStatementsBroker";
import { captureCanonicalListingsUniverse, captureUniverseSnapshot, getUniverseAsOf, getUniverseRevisionReport, getUniverseSnapshot, listUniverseSnapshots } from "./universeDatasetStore";
import {
  captureMarketDatasetSnapshot,
  getMarketDatasetAsOf,
  getMarketDatasetRevisionReport,
  getMarketDatasetSnapshot,
  listMarketDatasetSnapshots,
} from "./marketDatasetStore";
import {
  captureFredSeriesSnapshot,
  captureFredYieldCurveSnapshot,
  getEconomicDatasetAsOf,
  getEconomicDatasetRevisionReport,
  getEconomicDatasetSnapshot,
  listEconomicDatasetSnapshots,
} from "./economicDatasetStore";
import {
  calculateEstimateSurprises,
  captureAlternativeDataset,
  captureLseOptionsChain,
  captureFmpEstimates,
  capturePortfolioSnapshot,
  getAlternativeDataset,
  getAlternativeDatasetAsOf,
  getAlternativeDatasetRevisionReport,
  listAlternativeDatasets,
} from "./alternativeDatasetStore";
import { createModelInputLineage } from "./modelInputLineage";
import { createValuationLineage } from "./valuationLineage";
import { tenantContext } from "./tenantContext";
import { IntegratedModelArtifactError, integratedModelArtifactRequestSchema, loadIntegratedModelDatasetSource, assertIntegratedModelDatasetSourceCurrent, retainIntegratedModelArtifact, readIntegratedModelRun } from "./integratedModelArtifact";
import { getDb } from "./db";

const READ_ROLES = ["internal_admin", "internal_analyst", "internal_compliance"] as const;
const AUTHOR_ROLES = ["internal_admin", "internal_analyst"] as const;
const symbolSchema = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9.^_=-]+$/);
const alternativeClassSchema = z.enum(["estimates", "options_chain", "commodity_curve", "portfolio_holdings", "private_series"]);

export function registerDataFabricRoutes(app: Express): void {
  app.get("/api/alternative-data/:dataClass", requireRole(...READ_ROLES), async (req, res) => {
    const dataClass = alternativeClassSchema.safeParse(req.params.dataClass);
    const organizationId = req.query.organizationId ? z.coerce.number().int().positive().safeParse(req.query.organizationId) : { success: true as const, data: null };
    if (!dataClass.success || !organizationId.success) return res.status(400).json({ error: "A valid data class and organization ID are required." });
    res.json(await listAlternativeDatasets(dataClass.data, req.query.entityKey ? String(req.query.entityKey) : undefined, organizationId.data, Math.min(Math.max(Number(req.query.limit) || 50, 1), 100)));
  });

  app.get("/api/alternative-data/:dataClass/:entityKey/as-of", requireRole(...READ_ROLES), async (req, res) => {
    const dataClass = alternativeClassSchema.safeParse(req.params.dataClass); const asOf = z.coerce.date().safeParse(req.query.asOf ?? new Date());
    const organizationId = req.query.organizationId ? z.coerce.number().int().positive().safeParse(req.query.organizationId) : { success: true as const, data: null };
    if (!dataClass.success || !asOf.success || !organizationId.success) return res.status(400).json({ error: "A valid data class, entity, as-of time, and organization ID are required." });
    const snapshot = await getAlternativeDatasetAsOf(dataClass.data, String(req.params.entityKey), asOf.data, organizationId.data);
    if (!snapshot) return res.status(404).json({ error: "No eligible snapshot was available at that time." }); res.json(snapshot);
  });

  app.get("/api/alternative-data/snapshots/:id", requireRole(...READ_ROLES), async (req, res) => {
    const organizationId = req.query.organizationId ? z.coerce.number().int().positive().safeParse(req.query.organizationId) : { success: true as const, data: null };
    if (!organizationId.success) return res.status(400).json({ error: "A valid organization ID is required." });
    const snapshot = await getAlternativeDataset(String(req.params.id), organizationId.data); if (!snapshot) return res.status(404).json({ error: "Snapshot not found." }); res.json(snapshot);
  });

  app.post("/api/alternative-data/import", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = alternativeSnapshotInputSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try { const result = await captureAlternativeDataset(parsed.data, req.user!.id); await recordAuditEvent(req.user!.id, result.created ? "alternative_dataset_created" : "alternative_dataset_reused", { snapshotId: result.snapshot.id, dataClass: result.snapshot.dataClass, entityKey: result.snapshot.entityKey, ...auditActor(req.user!) }); res.status(result.created ? 201 : 200).json(result); }
    catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Dataset import failed." }); }
  });

  app.post("/api/alternative-data/options/:symbol/capture", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const symbol = symbolSchema.safeParse(req.params.symbol); if (!symbol.success) return res.status(400).json({ error: "A valid symbol is required." });
    try { const result = await captureLseOptionsChain(symbol.data, req.user!.id); res.status(result.created ? 201 : 200).json(result); }
    catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : "Options capture failed." }); }
  });

  app.post("/api/alternative-data/estimates/:symbol/capture", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const symbol = symbolSchema.safeParse(req.params.symbol); if (!symbol.success) return res.status(400).json({ error: "A valid symbol is required." });
    try { const result = await captureFmpEstimates(symbol.data, req.user!.id); res.status(result.created ? 201 : 200).json(result); }
    catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : "Estimate capture failed." }); }
  });

  app.post("/api/alternative-data/portfolios/:portfolioId/capture", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const id = z.coerce.number().int().positive().safeParse(req.params.portfolioId); if (!id.success) return res.status(400).json({ error: "A valid portfolio ID is required." });
    try { const result = await capturePortfolioSnapshot(id.data, req.user!.id); res.status(result.created ? 201 : 200).json(result); }
    catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Portfolio capture failed." }); }
  });

  app.get("/api/alternative-data/estimates/:id/surprises", requireRole(...READ_ROLES), async (req, res) => {
    const snapshot = await getAlternativeDataset(String(req.params.id), null); if (!snapshot || snapshot.dataClass !== "estimates") return res.status(404).json({ error: "Estimate snapshot not found." });
    res.json(calculateEstimateSurprises(estimatesPayloadSchema.parse(snapshot.payload)));
  });
  app.get("/api/data-snapshots", requireRole(...READ_ROLES), async (req, res) => {
    const entityKey = req.query.entityKey ? String(req.query.entityKey) : undefined;
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 250);
    res.json(await listDatasetSnapshots(entityKey, limit));
  });

  app.get("/api/data-snapshots/:id/revisions", requireRole(...READ_ROLES), async (req, res) => {
    const id = String(req.params.id);
    const report = await getDatasetRevisionReport(id) ?? await getMarketDatasetRevisionReport(id) ?? await getEconomicDatasetRevisionReport(id) ?? await getUniverseRevisionReport(id) ?? await getAlternativeDatasetRevisionReport(id);
    if (!report) return res.status(404).json({ error: "Dataset snapshot not found." });
    res.json(report);
  });

  app.get("/api/data-snapshots/:id", requireRole(...READ_ROLES), async (req, res) => {
    const id = String(req.params.id);
    const snapshot = await getDatasetSnapshot(id) ?? await getMarketDatasetSnapshot(id) ?? await getEconomicDatasetSnapshot(id) ?? await getUniverseSnapshot(id);
    if (!snapshot) return res.status(404).json({ error: "Dataset snapshot not found." });
    res.json(snapshot);
  });

  app.get("/api/data-snapshots/markets/:symbol", requireRole(...READ_ROLES), async (req, res) => {
    const symbol = symbolSchema.safeParse(req.params.symbol);
    if (!symbol.success) return res.status(400).json({ error: "A valid symbol is required." });
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    res.json(await listMarketDatasetSnapshots(symbol.data, limit));
  });

  app.get("/api/data-snapshots/markets/:symbol/as-of", requireRole(...READ_ROLES), async (req, res) => {
    const symbol = symbolSchema.safeParse(req.params.symbol);
    const asOf = z.coerce.date().safeParse(req.query.asOf ?? new Date());
    if (!symbol.success || !asOf.success) return res.status(400).json({ error: "A valid symbol and asOf timestamp are required." });
    const snapshot = await getMarketDatasetAsOf(symbol.data, asOf.data);
    if (!snapshot) return res.status(404).json({ error: "No market snapshot was available at that time." });
    res.json(snapshot);
  });

  app.post("/api/data-snapshots/markets/:symbol", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const symbol = symbolSchema.safeParse(req.params.symbol);
    const range = z.enum(["1Y", "2Y", "5Y", "10Y", "MAX"]).safeParse(String(req.body?.range ?? "5Y").toUpperCase());
    if (!symbol.success || !range.success) return res.status(400).json({ error: "A valid symbol and supported range are required." });
    try {
      const result = await captureMarketDatasetSnapshot(symbol.data, req.user!.id, range.data);
      await recordAuditEvent(req.user!.id, result.created ? "market_dataset_snapshot_created" : "market_dataset_snapshot_reused", {
        snapshotId: result.snapshot.id, datasetKey: result.snapshot.datasetKey, contentHash: result.snapshot.contentHash, ...auditActor(req.user!),
      });
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : "Market snapshot capture failed." });
    }
  });

  app.get("/api/data-snapshots/economics/:seriesId", requireRole(...READ_ROLES), async (req, res) => {
    const seriesId = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/).safeParse(req.params.seriesId);
    if (!seriesId.success) return res.status(400).json({ error: "A valid series ID is required." });
    res.json(await listEconomicDatasetSnapshots(seriesId.data, "economic_series", Math.min(Math.max(Number(req.query.limit) || 25, 1), 100)));
  });

  app.get("/api/data-snapshots/economics/:seriesId/as-of", requireRole(...READ_ROLES), async (req, res) => {
    const seriesId = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/).safeParse(req.params.seriesId);
    const asOf = z.coerce.date().safeParse(req.query.asOf ?? new Date());
    if (!seriesId.success || !asOf.success) return res.status(400).json({ error: "A valid series ID and asOf timestamp are required." });
    const snapshot = await getEconomicDatasetAsOf(seriesId.data, "economic_series", asOf.data);
    if (!snapshot) return res.status(404).json({ error: "No economic-series snapshot was available at that time." });
    res.json(snapshot);
  });

  app.post("/api/data-snapshots/economics/:seriesId", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const seriesId = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/).safeParse(req.params.seriesId);
    const points = z.coerce.number().int().min(2).max(5000).safeParse(req.body?.points ?? 240);
    if (!seriesId.success || !points.success) return res.status(400).json({ error: "A valid series ID and point count are required." });
    try {
      const result = await captureFredSeriesSnapshot(seriesId.data, req.user!.id, points.data);
      await recordAuditEvent(req.user!.id, result.created ? "economic_dataset_snapshot_created" : "economic_dataset_snapshot_reused", { snapshotId: result.snapshot.id, seriesId: result.snapshot.entityKey, ...auditActor(req.user!) });
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : "Economic-series capture failed." }); }
  });

  app.get("/api/data-snapshots/curves/ust", requireRole(...READ_ROLES), async (req, res) => {
    res.json(await listEconomicDatasetSnapshots("UST_NOMINAL", "yield_curve", Math.min(Math.max(Number(req.query.limit) || 25, 1), 100)));
  });

  app.get("/api/data-snapshots/curves/ust/as-of", requireRole(...READ_ROLES), async (req, res) => {
    const asOf = z.coerce.date().safeParse(req.query.asOf ?? new Date());
    if (!asOf.success) return res.status(400).json({ error: "A valid asOf timestamp is required." });
    const snapshot = await getEconomicDatasetAsOf("UST_NOMINAL", "yield_curve", asOf.data);
    if (!snapshot) return res.status(404).json({ error: "No Treasury curve snapshot was available at that time." });
    res.json(snapshot);
  });

  app.post("/api/data-snapshots/curves/ust", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const curveDate = z.string().date().optional().safeParse(req.body?.curveDate);
    if (!curveDate.success) return res.status(400).json({ error: "curveDate must be an ISO date." });
    try {
      const result = await captureFredYieldCurveSnapshot(req.user!.id, curveDate.data);
      await recordAuditEvent(req.user!.id, result.created ? "yield_curve_snapshot_created" : "yield_curve_snapshot_reused", { snapshotId: result.snapshot.id, curveDate: result.snapshot.payload.curveDate, ...auditActor(req.user!) });
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : "Yield-curve capture failed." }); }
  });

  app.get("/api/data-universes", requireRole(...READ_ROLES), async (req, res) => {
    const key = req.query.key ? String(req.query.key) : undefined;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const snapshots = await listUniverseSnapshots(key, limit);
    if (String(req.query.summary ?? "false") !== "true") return res.json(snapshots);
    res.json(snapshots.map((snapshot) => ({ ...snapshot, payload: { ...snapshot.payload, members: undefined }, memberCount: snapshot.payload.members.length })));
  });

  app.post("/api/data-universes/capture/listings", requireRole(...AUTHOR_ROLES), async (req, res) => {
    try {
      const result = await captureCanonicalListingsUniverse(req.user!.id);
      await recordAuditEvent(req.user!.id, result.created ? "universe_snapshot_created" : "universe_snapshot_reused", { snapshotId: result.snapshot.id, universeKey: result.snapshot.entityKey, ...auditActor(req.user!) });
      res.status(result.created ? 201 : 200).json({ created: result.created, snapshot: { ...result.snapshot, payload: { ...result.snapshot.payload, members: undefined }, memberCount: result.snapshot.payload.members.length } });
    } catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Universe capture failed." }); }
  });

  app.post("/api/data-universes/import", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = universePayloadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const result = await captureUniverseSnapshot(parsed.data, req.user!.id);
      await recordAuditEvent(req.user!.id, result.created ? "universe_snapshot_imported" : "universe_snapshot_reused", { snapshotId: result.snapshot.id, universeKey: result.snapshot.entityKey, memberCount: result.snapshot.payload.members.length, ...auditActor(req.user!) });
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Universe import failed." }); }
  });

  app.get("/api/data-universes/:key/members", requireRole(...READ_ROLES), async (req, res) => {
    const key = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/).safeParse(req.params.key);
    const knowledgeAsOf = z.coerce.date().safeParse(req.query.knowledgeAsOf ?? new Date());
    const membershipAsOf = z.string().date().safeParse(req.query.membershipAsOf ?? new Date().toISOString().slice(0, 10));
    const offset = Math.max(Number(req.query.offset) || 0, 0); const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    if (!key.success || !knowledgeAsOf.success || !membershipAsOf.success) return res.status(400).json({ error: "A valid universe key and both as-of clocks are required." });
    const result = await getUniverseAsOf(key.data, knowledgeAsOf.data, membershipAsOf.data);
    if (!result) return res.status(404).json({ error: "No universe snapshot was available at the requested knowledge time." });
    const query = String(req.query.q ?? "").trim().toLowerCase();
    const matched = query ? result.members.filter((member) => `${member.symbol} ${member.name} ${member.exchange}`.toLowerCase().includes(query)) : result.members;
    res.json({ snapshotId: result.snapshot.id, knowledgeAsOf: result.snapshot.availableAt, membershipAsOf: result.membershipAsOf, total: matched.length, offset, limit, members: matched.slice(offset, offset + limit) });
  });

  app.get("/api/data-universes/:key/as-of", requireRole(...READ_ROLES), async (req, res) => {
    const key = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/).safeParse(req.params.key);
    const knowledgeAsOf = z.coerce.date().safeParse(req.query.knowledgeAsOf ?? new Date());
    const membershipAsOf = z.string().date().safeParse(req.query.membershipAsOf ?? new Date().toISOString().slice(0, 10));
    if (!key.success || !knowledgeAsOf.success || !membershipAsOf.success) return res.status(400).json({ error: "A valid universe key and both as-of clocks are required." });
    const result = await getUniverseAsOf(key.data, knowledgeAsOf.data, membershipAsOf.data);
    if (!result) return res.status(404).json({ error: "No universe snapshot was available at the requested knowledge time." });
    res.json(result);
  });

  app.get("/api/data-entitlements", requireRole(...READ_ROLES), async (_req, res) => res.json(await listEntitlementPolicies()));
  app.post("/api/data-entitlements", requireRole("internal_admin", "internal_compliance"), async (req, res) => {
    const parsed = entitlementPolicyInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const result = await createEntitlementPolicy(parsed.data, req.user!.id);
    await recordAuditEvent(req.user!.id, result.created ? "data_entitlement_policy_created" : "data_entitlement_policy_reused", { policyId: result.policy.id, provider: result.policy.provider, dataClass: result.policy.dataClass, ...auditActor(req.user!) });
    res.status(result.created ? 201 : 200).json(result);
  });

  app.get("/api/columnar-artifacts", requireRole(...READ_ROLES), async (req, res) => {
    res.json(await listColumnarArtifacts(req.query.datasetSnapshotId ? String(req.query.datasetSnapshotId) : undefined, Math.min(Math.max(Number(req.query.limit) || 50, 1), 100)));
  });
  app.post("/api/columnar-artifacts/:snapshotId", requireRole(...AUTHOR_ROLES), async (req, res) => {
    try {
      const result = await createColumnarArtifact(String(req.params.snapshotId), req.user!.id);
      await recordAuditEvent(req.user!.id, result.created ? "columnar_artifact_created" : "columnar_artifact_reused", { artifactId: result.artifact.id, datasetSnapshotId: result.artifact.datasetSnapshotId, rowCount: result.artifact.rowCount, ...auditActor(req.user!) });
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Columnar artifact creation failed." }); }
  });
  app.get("/api/columnar-artifacts/:id/scan", requireRole(...READ_ROLES), async (req, res) => {
    const metric = req.query.metric ? z.string().regex(/^[a-z_]+$/).safeParse(req.query.metric) : { success: true as const, data: undefined };
    const dateFrom = req.query.dateFrom ? z.string().date().safeParse(req.query.dateFrom) : { success: true as const, data: undefined };
    const dateTo = req.query.dateTo ? z.string().date().safeParse(req.query.dateTo) : { success: true as const, data: undefined };
    if (!metric.success || !dateFrom.success || !dateTo.success) return res.status(400).json({ error: "Metric and date filters are invalid." });
    try {
      const result = await scanColumnarArtifact(String(req.params.id), { metric: metric.data, dateFrom: dateFrom.data, dateTo: dateTo.data, limit: Number(req.query.limit) || 20 });
      if (!result) return res.status(404).json({ error: "Columnar artifact not found." }); res.json(result);
    } catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Columnar scan failed." }); }
  });

  app.get("/api/financial-models/integrated/runs", requireRole(...READ_ROLES), async (req, res) => {
    const symbol = symbolSchema.safeParse(req.query.symbol);
    if (!symbol.success) return res.status(400).json({ error: "A valid symbol is required." });
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const runs = await listFinancialModelRuns(symbol.data, limit);
    res.json(runs.map((run) => ({ ...run, createdAt: run.createdAt.toISOString() })));
  });

  app.get("/api/financial-models/integrated/variance", requireRole(...READ_ROLES), async (req, res) => {
    const symbol = symbolSchema.safeParse(req.query.symbol);
    if (!symbol.success) return res.status(400).json({ error: "A valid symbol is required." });
    res.json(await getForecastActualVariance(symbol.data));
  });

  app.get("/api/financial-models/integrated/runs/:runId", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.runId);
    if (!id.success) return res.status(400).json({ error: "A valid model run ID is required." });
    try { res.json(await readIntegratedModelRun(tenantContext(req.user!), id.data)); }
    catch (error) {
      if (error instanceof IntegratedModelArtifactError) return res.status(error.status).json({ error: error.message });
      res.status(422).json({ error: "Persisted model run could not be reopened." });
    }
  });

  app.post("/api/financial-models/integrated/runs/:runId/artifact", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const runId = z.string().uuid().safeParse(req.params.runId);
    const input = integratedModelArtifactRequestSchema.safeParse(req.body);
    if (!runId.success || !input.success) return res.status(400).json({ error: "A valid model run ID and an explicit Project or persistent owning Chat are required." });
    try {
      const retained = await retainIntegratedModelArtifact(tenantContext(req.user!), runId.data, input.data.projectId, undefined, input.data.owningChatId);
      res.json(retained);
    } catch (error) {
      if (error instanceof IntegratedModelArtifactError) return res.status(error.status).json({ error: error.message });
      if (error instanceof z.ZodError) return res.status(422).json({ error: "Persisted model data is not valid for workbook projection." });
      res.status(422).json({ error: "Model Artifact retention failed." });
    }
  });

  app.get("/api/data-snapshots/financials/:symbol/as-of", requireRole(...READ_ROLES), async (req, res) => {
    const symbol = symbolSchema.safeParse(req.params.symbol);
    const asOf = z.coerce.date().safeParse(req.query.asOf ?? new Date());
    if (!symbol.success || !asOf.success) return res.status(400).json({ error: "A valid symbol and asOf timestamp are required." });
    const snapshot = await getFinancialDatasetAsOf(symbol.data, asOf.data);
    if (!snapshot) return res.status(404).json({ error: "No financial snapshot was available at that time." });
    res.json(snapshot);
  });

  app.post("/api/data-snapshots/financials/:symbol", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const symbol = symbolSchema.safeParse(req.params.symbol);
    if (!symbol.success) return res.status(400).json({ error: "A valid symbol is required." });
    try {
      const result = await captureFinancialDatasetSnapshot(symbol.data, req.user!.id);
      await recordAuditEvent(req.user!.id, result.created ? "dataset_snapshot_created" : "dataset_snapshot_reused", {
        snapshotId: result.snapshot.id, datasetKey: result.snapshot.datasetKey, contentHash: result.snapshot.contentHash, ...auditActor(req.user!),
      });
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : "Financial snapshot capture failed." });
    }
  });

  app.get("/api/data-snapshots/financials/:symbol/conflicts", requireRole(...READ_ROLES), async (req, res) => {
    const symbol = symbolSchema.safeParse(req.params.symbol);
    if (!symbol.success) return res.status(400).json({ error: "A valid symbol is required." });
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    res.json(await listFinancialStatementsConflictSnapshots(symbol.data, limit));
  });

  app.get("/api/data-snapshots/financials/:symbol/conflicts/as-of", requireRole(...READ_ROLES), async (req, res) => {
    const symbol = symbolSchema.safeParse(req.params.symbol);
    const reportType = z.string().trim().min(1).max(20).safeParse(req.query.reportType ?? "income");
    const period = z.string().trim().min(1).max(10).safeParse(req.query.period ?? "FY");
    const asOf = z.coerce.date().safeParse(req.query.asOf ?? new Date());
    if (!symbol.success || !reportType.success || !period.success || !asOf.success) return res.status(400).json({ error: "A valid symbol, reportType, period, and asOf timestamp are required." });
    const snapshot = await getFinancialStatementsConflictSnapshotAsOf(symbol.data, reportType.data, period.data, asOf.data);
    if (!snapshot) return res.status(404).json({ error: "No conflict snapshot was available at that time." });
    res.json(snapshot);
  });

  app.get("/api/data-snapshots/financials/conflicts/:id", requireRole(...READ_ROLES), async (req, res) => {
    const snapshot = await getFinancialStatementsConflictSnapshot(String(req.params.id));
    if (!snapshot) return res.status(404).json({ error: "Conflict snapshot not found." });
    res.json(snapshot);
  });

  app.post("/api/data-snapshots/financials/:symbol/conflicts", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const symbol = symbolSchema.safeParse(req.params.symbol);
    const reportType = z.string().trim().min(1).max(20).safeParse(req.body?.reportType ?? "income");
    const period = z.string().trim().min(1).max(10).safeParse(req.body?.period ?? "FY");
    if (!symbol.success || !reportType.success || !period.success) return res.status(400).json({ error: "A valid symbol, reportType, and period are required." });
    try {
      const result = await captureFinancialStatementsConflictSnapshot(symbol.data, reportType.data, period.data, req.user!.id, Array.isArray(req.body?.providers) ? req.body.providers : undefined);
      await recordAuditEvent(req.user!.id, result.created ? "financial_statements_conflict_snapshot_created" : "financial_statements_conflict_snapshot_reused", {
        snapshotId: result.snapshot.id, datasetKey: result.snapshot.datasetKey, contentHash: result.snapshot.contentHash, conflictCount: result.snapshot.payload.conflicts.length, ...auditActor(req.user!),
      });
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : "Financial statements conflict capture failed." });
    }
  });

  app.post("/api/financial-models/integrated", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = integratedModelRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const ctx = tenantContext(req.user!);
      const { snapshot, result, inputHash, resultHash, run } = await getDb().transaction(async tx => {
        const source = await loadIntegratedModelDatasetSource(ctx, parsed.data.datasetSnapshotId, ["model_input", "display", "derived_output"], tx, true);
        const snapshot = source.snapshot;
        const result = runIntegratedFinancialModel({ datasetSnapshotId: snapshot.id, payload: snapshot.payload, assumptions: parsed.data.assumptions, schedules: parsed.data.schedules });
        const inputHash = stableSnapshotHash({ datasetContentHash: snapshot.contentHash, assumptions: result.assumptions, specializedSchedules: result.specializedSchedules });
        const resultHash = stableSnapshotHash({ modelVersion: result.modelVersion, datasetContentHash: snapshot.contentHash, assumptions: result.assumptions, specializedSchedules: result.specializedSchedules, forecast: result.forecast });
        const run = await saveFinancialModelRun({ result, resultHash, createdByUserId: ctx.userId }, tx);
        if (!run || run.createdByUserId !== ctx.userId) throw new IntegratedModelArtifactError(409, "An identical model result is not owned by the current actor.");
        await assertIntegratedModelDatasetSourceCurrent(ctx, snapshot.id, source.revision, ["model_input", "display", "derived_output"], tx);
        return { snapshot, result, inputHash, resultHash, run };
      });
    const organizationId = req.user!.organizationId;
    const modelInputLineage = organizationId ? createModelInputLineage({
      organizationId,
      modelId: "integrated_financial_model",
      modelVersionId: result.modelVersion,
      datasetVersionId: snapshot.id,
      transformationNodeIds: [run.id],
      sourceCellRefs: snapshot.payload.periods.flatMap((period) => [
        `${period.fiscalYear}:income.revenue`,
        `${period.fiscalYear}:balance.totalAssets`,
        `${period.fiscalYear}:cashflow.cashFromOperations`,
      ]),
      targetCellRefs: result.forecast.flatMap((period) => [
        `${period.fiscalYear}:income.revenue`,
        `${period.fiscalYear}:cashflow.cashFromOperations`,
        `${period.fiscalYear}:balance.totalAssets`,
      ]),
      inputHash,
      createdByUserId: req.user!.id,
    }) : null;
    const terminalForecast = result.forecast.at(-1);
    const valuationLineage = organizationId && modelInputLineage && terminalForecast ? createValuationLineage({
      organizationId,
      modelId: "integrated_financial_model",
      modelVersionId: result.modelVersion,
      method: "dcf",
      outputName: "terminal_projected_net_income",
      outputValue: terminalForecast.income.netIncome,
      currency: snapshot.currency || "USD",
      inputLineageIds: [modelInputLineage.id],
      assumptionNames: Object.keys(result.assumptions),
      calculationVersion: result.modelVersion,
      outputHash: resultHash,
      createdByUserId: req.user!.id,
    }) : null;
    await recordAuditEvent(req.user!.id, "integrated_financial_model_run", {
      snapshotId: snapshot.id, resultHash, symbol: result.symbol, checksPassed: result.checks.passed, modelInputLineageId: modelInputLineage?.id, valuationLineageId: valuationLineage?.id, ...auditActor(req.user!),
    });
    res.json({ result, receipt: { runId: run.id, resultHash, datasetSnapshotId: snapshot.id, datasetContentHash: snapshot.contentHash, inputHash, calculatedAt: run.createdAt.toISOString(), deterministic: true }, lineage: { modelInput: modelInputLineage, valuation: valuationLineage } });
    } catch (error) {
      if (error instanceof IntegratedModelArtifactError) return res.status(error.status).json({ error: error.message });
      throw error;
    }
  });
}
