import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  captureFactorRiskSnapshot,
  FactorRiskValidationError,
  getFactorRiskSnapshot,
} from "./factorRiskModel";
import { calculateFactorAttribution, FactorAttributionValidationError } from "@shared/factorAttribution";
import type { FactorScenario, FactorAttributionInput, FactorDefinition, SecurityFactorExposure } from "@shared/factorAttribution";
import { requireRole } from "./auth";
import { getRequestIdentity } from "./requestContext";
import {
  createFactorRiskSnapshotStore,
  FACTOR_RISK_SNAPSHOT_MAX_LIST_LIMIT,
  FACTOR_RISK_SNAPSHOT_MAX_PAGE,
  type FactorRiskSnapshotListOptions,
  type FactorRiskSnapshotMetadataPage,
} from "./factorRiskSnapshotStore";
const READ_ROLES = ["internal_admin", "internal_analyst", "internal_compliance"] as const;
const AUTHOR_ROLES = ["internal_admin", "internal_analyst"] as const;


const symbolSchema = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9.^_=-]+$/);
export const factorRiskSnapshotRequestSchema = z.object({
  symbols: z.array(symbolSchema).min(1).max(100),
  benchmarkSymbol: symbolSchema.default("^GSPC"),
  asOf: z.union([z.string().date(), z.string().datetime({ offset: true })])
    .transform((value) => value.slice(0, 10))
    .optional(),
  // keeping the allowlist here prevents an accidental unbounded provider call.
  range: z.enum(["1Y", "2Y", "3Y", "5Y"]).default("5Y"),
}).strict().superRefine((value, ctx) => {
  const symbols = value.symbols.map((symbol) => symbol.toUpperCase());
  if (new Set(symbols).size !== symbols.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["symbols"], message: "symbols must be unique (case-insensitive)." });
  }
  if (symbols.includes(value.benchmarkSymbol.toUpperCase())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["symbols"], message: "benchmarkSymbol must not also be in symbols." });
  }
});
export const factorRiskSnapshotListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(FACTOR_RISK_SNAPSHOT_MAX_PAGE).default(1),
  limit: z.coerce.number().int().min(1).max(FACTOR_RISK_SNAPSHOT_MAX_LIST_LIMIT).default(25),
  symbol: symbolSchema.optional(),
  organizationId: z.coerce.number().int().positive().optional(),
  asOf: z.string().date().optional(),
}).strict();


const finiteNumber = z.number().finite();
const weightsSchema = z.record(z.string().min(1), finiteNumber);
const factorScenarioSchema = z.object({
  id: z.string().min(1).max(200).optional(),
  label: z.string().min(1).max(200).optional(),
  factorShocks: z.union([weightsSchema, z.array(finiteNumber)]),
  specificShocks: weightsSchema.optional(),
  provenance: z.object({
    source: z.string().min(1), asOf: z.string().min(1), units: z.string().min(1),
    status: z.string().optional(), period: z.string().optional(), currency: z.string().optional(),
    sourceRef: z.string().optional(), snapshotId: z.string().optional(),
  }).optional(),
}).strict();

export const factorRiskDecomposeRequestSchema = z.object({
  snapshotId: z.string().trim().min(1).max(256),
  portfolioWeights: weightsSchema,
  benchmarkWeights: weightsSchema.optional(),
  scenario: factorScenarioSchema.optional(),
}).strict();

export type FactorRiskSnapshotRequest = z.infer<typeof factorRiskSnapshotRequestSchema>;
export type FactorRiskDecomposeRequest = z.infer<typeof factorRiskDecomposeRequestSchema>;

type EstimationShape = {
  factorReturnSeries?: readonly { periodEnd: string; returns: Readonly<Record<string, number>> }[];
  factorCovariance?: readonly (readonly number[])[];
  specificVariances?: Readonly<Record<string, number>>;
};

type SnapshotShape = {
  snapshotId?: string;
  contentHash?: string;
  request?: {
    symbols: readonly string[];
    benchmarkSymbol: string;
    range: string;
    asOf: string;
    scope?: string;
  };
  capturedAt?: string;
  factors?: readonly FactorDefinition[];
  securities?: readonly SecurityFactorExposure[];
  estimation?: EstimationShape;
  estimator?: EstimationShape;
  factorReturnSeries?: EstimationShape["factorReturnSeries"];
  factorCovariance?: EstimationShape["factorCovariance"];
  specificVariances?: EstimationShape["specificVariances"];
  provenance?: unknown;
  sources?: unknown;
  excluded?: Array<{ securityId: string; reason: string }>;
};
export function validateDecomposeWeights(
  weights: Readonly<Record<string, number>>,
  securityIds: readonly string[],
  fieldName: string,
): string | null {
  const expected = new Set(securityIds);
  const actual = Object.keys(weights);
  const unknown = actual.filter((id) => !expected.has(id));
  if (unknown.length) return `${fieldName} contains unknown security weight(s): ${unknown.join(", ")}.`;
  const missing = securityIds.filter((id) => !Object.prototype.hasOwnProperty.call(weights, id));
  if (missing.length) return `${fieldName} is missing security weight(s): ${missing.join(", ")}.`;
  return null;
}

type CaptureResult = { snapshot: SnapshotShape; cache: "hit" | "miss" } | SnapshotShape;
export function normalizeCaptureResult(result: CaptureResult): { snapshot: SnapshotShape; cache: "hit" | "miss" } {
  if ("snapshot" in result && result.snapshot) return result as { snapshot: SnapshotShape; cache: "hit" | "miss" };
  return { snapshot: result as SnapshotShape, cache: "miss" };
}


export function buildFactorAttributionInput(snapshot: SnapshotShape, request: FactorRiskDecomposeRequest): FactorAttributionInput {
  const factors = snapshot.factors ?? [];
  const securities = snapshot.securities ?? [];
  const estimate = snapshot.estimation ?? snapshot.estimator ?? snapshot;
  const series = estimate.factorReturnSeries ?? [];
  if (!series.length) throw new Error("Snapshot contains no estimated factor-return period.");
  if (!estimate.factorCovariance) throw new Error("Snapshot contains no factor covariance.");
  // Arithmetic average of estimated periods is selected deliberately so the
  // decomposition is not driven by one noisy latest month; covariance and
  // specific variance remain estimated over the full retained history.
  const factorReturns = Object.fromEntries(factors.map((factor) => [
    factor.id,
    series.reduce((sum, period) => sum + (period.returns[factor.id] ?? 0), 0) / series.length,
  ]));
  return {
    factors,
    factorReturns,
    factorCovariance: estimate.factorCovariance,
    securities,
    portfolioWeights: request.portfolioWeights,
    benchmarkWeights: request.benchmarkWeights,
    specificVariances: estimate.specificVariances,
    scenario: request.scenario as FactorScenario | undefined,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export interface FactorRiskRouteService {
  captureFactorRiskSnapshot: typeof captureFactorRiskSnapshot;
  getFactorRiskSnapshot: typeof getFactorRiskSnapshot;
  listFactorRiskSnapshots?: (options: FactorRiskSnapshotListOptions) => Promise<FactorRiskSnapshotMetadataPage>;
}

const defaultSnapshotStore = createFactorRiskSnapshotStore();

function requestScope(): string {
  const organizationId = getRequestIdentity()?.organizationId;
  return organizationId === undefined || organizationId === null ? "local" : `organization:${organizationId}`;
}

const defaultRouteService: FactorRiskRouteService = {
  captureFactorRiskSnapshot,
  getFactorRiskSnapshot,
  listFactorRiskSnapshots: (options) => defaultSnapshotStore.list(options),
};

export function createFactorRiskRouteHandlers(service: FactorRiskRouteService = defaultRouteService) {
  async function captureHandler(req: Request, res: Response): Promise<void> {
    const parsed = factorRiskSnapshotRequestSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
    try {
      const result = normalizeCaptureResult(await service.captureFactorRiskSnapshot(parsed.data));
      res.status(result.cache === "hit" ? 200 : 201).json({ ...result.snapshot, cache: result.cache });
    } catch (error) {
      const status = error instanceof FactorRiskValidationError ? error.statusCode : 502;
      res.status(status).json({ error: errorMessage(error, "Factor risk snapshot capture failed.") });
    }
  }

  async function listHandler(req: Request, res: Response): Promise<void> {
    const rawQuery = {
      page: req.query.page,
      limit: req.query.limit,
      symbol: req.query.symbol,
      organizationId: req.query.organizationId,
      asOf: req.query.asOf,
    };
    const parsed = factorRiskSnapshotListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
    const scope = requestScope();
    const requestedScope = parsed.data.organizationId === undefined ? undefined : `organization:${parsed.data.organizationId}`;
    if (requestedScope !== undefined && requestedScope !== scope) {
      res.status(403).json({ error: "Factor risk snapshot organization scope is not accessible." });
      return;
    }
    try {
      const list = await (service.listFactorRiskSnapshots ?? defaultRouteService.listFactorRiskSnapshots!)({
        page: parsed.data.page,
        limit: parsed.data.limit,
        symbol: parsed.data.symbol,
        asOf: parsed.data.asOf,
        organizationScope: scope,
      });
      res.json({
        items: list.items,
        paging: {
          page: list.page,
          limit: list.limit,
          total: list.total,
          returned: list.items.length,
          hasMore: list.hasMore,
          nextPage: list.nextPage,
        },
      });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error, "Factor risk snapshot listing failed.") });
    }
  }

  async function refreshHandler(req: Request, res: Response): Promise<void> {
    try {
      const snapshot = await service.getFactorRiskSnapshot(String(req.params.snapshotId)) as SnapshotShape | null;
      if (!snapshot || !snapshot.request || snapshot.request.scope !== requestScope()) {
        res.status(404).json({ error: "Factor risk snapshot not found or expired." });
        return;
      }
      const originalRequest = factorRiskSnapshotRequestSchema.safeParse({
        symbols: snapshot.request.symbols,
        benchmarkSymbol: snapshot.request.benchmarkSymbol,
        range: snapshot.request.range,
        asOf: snapshot.request.asOf,
      });
      if (!originalRequest.success) {
        res.status(422).json({ error: "Factor risk snapshot has no valid captured request to refresh." });
        return;
      }
      const result = normalizeCaptureResult(await service.captureFactorRiskSnapshot(originalRequest.data));
      res.status(result.cache === "hit" ? 200 : 201).json({ ...result.snapshot, cache: result.cache });
    } catch (error) {
      const status = error instanceof FactorRiskValidationError ? error.statusCode : 502;
      res.status(status).json({ error: errorMessage(error, "Factor risk snapshot refresh failed.") });
    }
  }

  async function getHandler(req: Request, res: Response): Promise<void> {
    try {
      const snapshot = await service.getFactorRiskSnapshot(String(req.params.snapshotId));
      if (!snapshot) { res.status(404).json({ error: "Factor risk snapshot not found or expired." }); return; }
      res.json(snapshot);
    } catch (error) {
      res.status(500).json({ error: errorMessage(error, "Factor risk snapshot lookup failed.") });
    }
  }

  async function decomposeHandler(req: Request, res: Response): Promise<void> {
    const parsed = factorRiskDecomposeRequestSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
    try {
      const snapshot = await service.getFactorRiskSnapshot(parsed.data.snapshotId) as SnapshotShape | null;
      if (!snapshot) { res.status(404).json({ error: "Factor risk snapshot not found or expired." }); return; }
      const securityIds = (snapshot.securities ?? []).map((security) => security.securityId);
      const portfolioError = validateDecomposeWeights(parsed.data.portfolioWeights, securityIds, "portfolioWeights");
      if (portfolioError) { res.status(400).json({ error: portfolioError }); return; }
      if (parsed.data.benchmarkWeights) {
        const benchmarkError = validateDecomposeWeights(parsed.data.benchmarkWeights, securityIds, "benchmarkWeights");
        if (benchmarkError) { res.status(400).json({ error: benchmarkError }); return; }
      }
      const result = calculateFactorAttribution(buildFactorAttributionInput(snapshot, parsed.data));
      res.json({
        snapshotId: snapshot.snapshotId ?? parsed.data.snapshotId,
        contentHash: snapshot.contentHash,
        provenance: snapshot.provenance ?? snapshot.sources ?? { source: "factor-risk-model", status: "derived", asOf: new Date().toISOString(), units: "return" },
        factorReturnSelection: "arithmetic-average-of-estimated-period-returns",
        result,
      });
    } catch (error) {
      const status = error instanceof FactorAttributionValidationError ? 400 : 422;
      res.status(status).json({ error: errorMessage(error, "Factor risk decomposition failed.") });
    }
  }

  return { captureHandler, getHandler, decomposeHandler, listHandler, refreshHandler };
}

export function registerFactorRiskRoutes(app: Express, service: FactorRiskRouteService = defaultRouteService): void {
  const handlers = createFactorRiskRouteHandlers(service);
  app.post("/api/factor-risk/snapshots", requireRole(...AUTHOR_ROLES), handlers.captureHandler);
  app.get("/api/factor-risk/snapshots/:snapshotId", requireRole(...READ_ROLES), handlers.getHandler);
  app.post("/api/factor-risk/decompose", requireRole(...READ_ROLES), handlers.decomposeHandler);
}

/**
 * Registers the durable snapshot catalog and explicit refresh endpoints.
 * Kept separate so deployments can opt into the catalog without changing
 * existing factor-risk route registration.
 */
export function registerFactorRiskSnapshotListingRoutes(
  app: Express,
  service: FactorRiskRouteService = defaultRouteService,
): void {
  const handlers = createFactorRiskRouteHandlers(service);
  app.get("/api/factor-risk/snapshots", requireRole(...READ_ROLES), handlers.listHandler);
  app.post("/api/factor-risk/snapshots/:snapshotId/refresh", requireRole(...AUTHOR_ROLES), handlers.refreshHandler);
}

// Exported for focused route tests and callers embedding the route module.
export const factorRiskRouteHandlers = createFactorRiskRouteHandlers();
