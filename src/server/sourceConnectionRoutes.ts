import type { Express } from "express";
import { z } from "zod";
import { requireAuth } from "./auth";
import {
  deleteSourceConnection,
  discoverDatabaseSource,
  fetchApiSourceConnection,
  listSourceConnections,
  mapApiSourceConnection,
  profileDatabaseSource,
  queryDatabaseSource,
  testSourceConnection,
  upsertSourceConnection,
} from "./sourceConnectionService";
import { discoverApiConnection, discoverDatabaseConnection } from "./sourceDiscoveryService";
import { listSourceSnapshots } from "./sourceSnapshotStore";
import { normalizeUniversalFinanceRecords } from "@shared/universalIngestion";
import { upsertFinancialMetricOverride } from "./financialMetricStore";
import { tenantContext } from "./tenantContext";
import { getConnectorById, testConnectorCredential } from "./connectorService";
import { resolveCredential } from "./credentialVault";
import { sourceConnectionConfigSchema, sourceConnectionTestSchema } from "@shared/schema";
import { emitP9AutomationEvent } from "./p9AutomationService";
import { mapConfirmedDatabaseRecords } from "./databaseSemanticMapping";

const databaseQuerySchema = z.object({
  connectionId: z.number().int().positive(),
  query: z.string().trim().min(1).max(20_000),
  params: z.array(z.unknown()).max(100).default([]),
  datasetKey: z.string().trim().min(1).max(240).optional(),
});
const databaseNormalizeSchema = databaseQuerySchema.omit({ datasetKey: true }).extend({
  symbol: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9.^_=-]+$/),
  identityColumn: z.string().trim().min(1).max(63),
  source: z.string().trim().min(1).max(500).default("Database BYOD source"),
  defaultPeriod: z.string().trim().min(1).max(40).optional(),
  defaultCurrency: z.string().trim().min(1).max(12).optional(),
  persist: z.boolean().default(true),
});

export function validateDatabaseResultIdentity(
  rows: readonly Record<string, unknown>[],
  requestedSymbol: string,
  identityColumn: string,
): void {
  const normalizedSymbol = requestedSymbol.trim().toUpperCase();
  const normalizedColumn = identityColumn.trim().toLowerCase();
  rows.forEach(row => {
    const actualColumn = Object.keys(row).find(key => key.toLowerCase() === normalizedColumn);
    const value = actualColumn === undefined ? undefined : row[actualColumn];
    if (typeof value !== "string" && typeof value !== "number") {
      throw new Error(`Database normalization requires every result row to include identity column "${identityColumn}".`);
    }
    if (String(value).trim().toUpperCase() !== normalizedSymbol) {
      throw new Error("Database result contains rows for a different issuer than the requested symbol.");
    }
  });
}

const providerCredentialTestSchema = z.object({
  connectorId: z.string().trim().min(1).max(100),
  credential: z.string().min(1).max(10_000),
});
const databaseProfileSchema = z.object({
  connectionId: z.number().int().positive(),
  schema: z.string().trim().min(1).max(63),
  table: z.string().trim().min(1).max(63),
});
const apiConnectionSchema = z.object({
  connectionId: z.number().int().positive(),
});
const apiMappingSchema = apiConnectionSchema.extend({
  contractFamily: z.string().trim().min(1).max(100),
  symbol: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9.^_=-]+$/).optional(),
  defaultPeriod: z.string().trim().min(1).max(40).optional(),
  defaultCurrency: z.string().trim().min(1).max(12).optional(),
});

export function registerSourceConnectionRoutes(app: Express): void {
  app.post("/api/setup/provider-credentials/test", requireAuth, async (req, res, next) => {
    const parsed = providerCredentialTestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      res.json(await testConnectorCredential(parsed.data.connectorId, parsed.data.credential));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/setup/source-connections", requireAuth, async (req, res, next) => {
    try {
      res.json(await listSourceConnections(req.user!.id));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/setup/source-connections", requireAuth, async (req, res) => {
    const parsed = sourceConnectionConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      if (parsed.data.sourceType === "keyed_api") {
        const connector = getConnectorById(parsed.data.connectorId);
        const credential = connector?.vaultKey ? resolveCredential("", connector.vaultKey) : null;
        if (!credential) {
          res.status(422).json({ error: "A verified provider credential is required before saving this connection." });
          return;
        }
        const validation = await testConnectorCredential(parsed.data.connectorId, credential);
        if (validation.state !== "healthy") {
          res.status(422).json({ error: `${validation.detail} Connection was not saved.` });
          return;
        }
      }
      const connection = await upsertSourceConnection(req.user!.id, req.user!.organizationId ?? null, parsed.data, req.user!);
      res.json({ connection });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save source connection.";
      res.status(422).json({ error: message });
    }
  });

  app.post("/api/setup/source-connections/test", requireAuth, async (req, res, next) => {
    const parsed = sourceConnectionTestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const result = await testSourceConnection(req.user!.id, parsed.data.connectionId, req.user!);
      if (!result) {
        res.status(404).json({ error: "Source connection not found." });
        return;
      }
      res.json(result);
      void emitP9AutomationEvent({
        eventType: "provider_health",
        occurredAt: new Date().toISOString(),
        projectId: null,
        ownerUserId: req.user!.id,
        organizationId: req.user!.organizationId ?? null,
        sourceRef: "source-connection:" + result.connectionId,
        payload: { connectionId: result.connectionId, status: result.status, detail: result.detail },
      }).catch((eventError) => console.warn("[p9Automation] provider-health event failed:", eventError));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/setup/source-connections/api/discover", requireAuth, async (req, res) => {
    const parsed = apiConnectionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      res.json(await discoverApiConnection(req.user!.id, parsed.data.connectionId, req.user!));
    } catch (error) {
      res.status(422).json({ error: error instanceof Error ? error.message : "API discovery failed." });
    }
  });

  app.post("/api/setup/source-connections/api/fetch", requireAuth, async (req, res, next) => {
    const parsed = apiConnectionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      res.json(await fetchApiSourceConnection(req.user!.id, parsed.data.connectionId, req.user!));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/setup/source-connections/api/map", requireAuth, async (req, res, next) => {
    const parsed = apiMappingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      res.json(await mapApiSourceConnection(req.user!.id, parsed.data.connectionId, parsed.data.contractFamily, req.user!, { symbol: parsed.data.symbol, defaultPeriod: parsed.data.defaultPeriod, defaultCurrency: parsed.data.defaultCurrency }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/setup/source-connections/:id/snapshots", requireAuth, async (req, res, next) => {
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: "A valid source connection id is required." });
      return;
    }
    try {
      res.json(await listSourceSnapshots(id.data, req.user!.id, Number(req.query.limit) || 100));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/setup/source-connections/:id", requireAuth, async (req, res, next) => {
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: "A valid source connection id is required." });
      return;
    }
    try {
      const deleted = await deleteSourceConnection(req.user!.id, id.data, req.user!);
      if (!deleted) {
        res.status(404).json({ error: "Source connection not found." });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/setup/source-connections/database/catalog", requireAuth, async (req, res) => {
    const parsed = sourceConnectionTestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      res.json(await discoverDatabaseConnection(req.user!.id, parsed.data.connectionId, req.user!));
    } catch (error) {
      res.status(422).json({ error: error instanceof Error ? error.message : "Database discovery failed." });
    }
  });

  app.post("/api/setup/source-connections/database/discover", requireAuth, async (req, res, next) => {
    const parsed = sourceConnectionTestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      res.json({ columns: await discoverDatabaseSource(req.user!.id, parsed.data.connectionId, req.user!) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/setup/source-connections/database/query", requireAuth, async (req, res, next) => {
    const parsed = databaseQuerySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      let query = parsed.data.query;
      if (parsed.data.datasetKey) {
        const parts = parsed.data.datasetKey.split(".");
        if (parts.length !== 2 || parts.some(part => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(part))) { res.status(422).json({ error: "Mapped database datasets require an exact schema.table identity." }); return; }
        // Mapped reads are derived from the selected dataset, never arbitrary
        // SQL relabelled by an independent caller-supplied mapping key.
        const expected = `SELECT * FROM ${parts[0]}.${parts[1]}`;
        if (query.trim().replace(/;$/, "").toLowerCase() !== expected.toLowerCase() || parsed.data.params.length) { res.status(422).json({ error: "Mapped queries must select the complete exact confirmed dataset without SQL overrides." }); return; }
        const catalog = await discoverDatabaseConnection(req.user!.id, parsed.data.connectionId, req.user!);
        if (!catalog.tables.some(table => table.schema === parts[0] && table.name === parts[1])) { res.status(422).json({ error: "Mapped dataset is not present in the authorized connection catalogue." }); return; }
        query = expected;
      }
      const result = await queryDatabaseSource(req.user!.id, parsed.data.connectionId, query, parsed.data.params, req.user!);
      const semantic = parsed.data.datasetKey
        ? await mapConfirmedDatabaseRecords(
          { ownerUserId: req.user!.id, organizationId: req.user!.organizationId ?? null },
          parsed.data.connectionId, parsed.data.datasetKey, result.rows,
        )
        : undefined;
      res.json({ ...result, ...(semantic ?? {}) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/setup/source-connections/database/normalize", requireAuth, async (req, res, next) => {
    const parsed = databaseNormalizeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const queryResult = await queryDatabaseSource(req.user!.id, parsed.data.connectionId, parsed.data.query, parsed.data.params, req.user!);
      validateDatabaseResultIdentity(queryResult.rows, parsed.data.symbol, parsed.data.identityColumn);
      const normalized = normalizeUniversalFinanceRecords({ symbol: parsed.data.symbol, records: queryResult.rows, source: parsed.data.source, provider: "database", defaultPeriod: parsed.data.defaultPeriod, defaultCurrency: parsed.data.defaultCurrency });
      const persistedObservations = parsed.data.persist
        ? normalized.observations.filter(observation => typeof observation.value === "number" && Boolean(observation.asOf) && Boolean(observation.period))
        : [];
      if (persistedObservations.length > 0) {
        const ctx = tenantContext(req.user!);
        await Promise.all(persistedObservations.map(observation => upsertFinancialMetricOverride(ctx, { symbol: parsed.data.symbol, metricId: observation.metricId, value: observation.value as number, period: observation.period as string, asOf: observation.asOf as string, source: observation.source ?? parsed.data.source, sourceUrl: undefined, currency: observation.currency, note: observation.note, status: "imported" })));
      }
      res.json({ records: queryResult.rows, ...normalized, persisted: persistedObservations.length });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/setup/source-connections/database/profile", requireAuth, async (req, res, next) => {
    const parsed = databaseProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      res.json(await profileDatabaseSource(req.user!.id, parsed.data.connectionId, parsed.data.schema, parsed.data.table, req.user!));
    } catch (error) {
      next(error);
    }
  });
}
