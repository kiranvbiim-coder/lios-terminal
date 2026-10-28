import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  captureFactorRiskSnapshot,
  FactorRiskValidationError,
  getFactorRiskSnapshot,
} from "./factorRiskModel";
import { calculateFactorAttribution, FactorAttributionValidationError } from "@shared/factorAttribution";
import { requireRole } from "./auth";
import { getRequestIdentity } from "./requestContext";
import {
  createFactorRiskSnapshotStore,
  FACTOR_RISK_SNAPSHOT_MAX_LIST_LIMIT,
  FACTOR_RISK_SNAPSHOT_MAX_PAGE,
  type FactorRiskSnapshotListOptions,
  type FactorRiskSnapshotMetadataPage,
} from "./factorRiskSnapshotStore";
import { buildFactorAttributionInput, validateDecomposeWeights, factorRiskDecomposeRequestSchema } from "./factorRiskModel";
import { tenantContext } from "./tenantContext";
import { validateTerminalExecutionTarget } from "./terminalArtifactTool";
import { createTerminalArtifactEngineVersion } from "./artifactStore";
import { executeOriginalFactorDecomposition } from "./advancedQuantExecution";
import type { FactorRiskSnapshot } from "./factorRiskModel";
import { FactorRiskAccessError } from "./factorRiskInputCapture";
type SnapshotShape = Parameters<typeof buildFactorAttributionInput>[0];
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



export type FactorRiskSnapshotRequest = z.infer<typeof factorRiskSnapshotRequestSchema>;

type CaptureResult = { snapshot: SnapshotShape; cache: "hit" | "miss" } | SnapshotShape;
export function normalizeCaptureResult(result: CaptureResult): { snapshot: SnapshotShape; cache: "hit" | "miss" } {
  if ("snapshot" in result && result.snapshot) return result as { snapshot: SnapshotShape; cache: "hit" | "miss" };
  return { snapshot: result as SnapshotShape, cache: "miss" };
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
      const status = error instanceof FactorRiskAccessError ? error.status : error instanceof FactorRiskValidationError ? error.statusCode : 502;
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
      const status = error instanceof FactorRiskAccessError ? error.status : error instanceof FactorRiskValidationError ? error.statusCode : 502;
      res.status(status).json({ error: errorMessage(error, "Factor risk snapshot refresh failed.") });
    }
  }

  async function getHandler(req: Request, res: Response): Promise<void> {
    try {
      const snapshot = await service.getFactorRiskSnapshot(String(req.params.snapshotId));
      if (!snapshot) { res.status(404).json({ error: "Factor risk snapshot not found or expired." }); return; }
      res.json(snapshot);
    } catch (error) {
      res.status(error instanceof FactorRiskAccessError ? error.status : 500).json({ error: errorMessage(error, "Factor risk snapshot lookup failed.") });
    }
  }

  async function decomposeHandler(req: Request, res: Response): Promise<void> {
    const parsed = factorRiskDecomposeRequestSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
    try {
      const snapshot = await service.getFactorRiskSnapshot(parsed.data.snapshotId) as SnapshotShape | null;
      if (!snapshot) { res.status(404).json({ error: "Factor risk snapshot not found or expired." }); return; }
      if (parsed.data.expectedSnapshotHash && snapshot.contentHash !== parsed.data.expectedSnapshotHash) { res.status(409).json({ error: "Selected factor snapshot hash changed; no replacement was selected." }); return; }
      if (parsed.data.terminalArtifact) {
        try {
          if (!req.user) throw new Error("Current authenticated factor model author is required.");
          const ctx = tenantContext(req.user);
          await validateTerminalExecutionTarget(ctx, parsed.data.terminalArtifact, new AbortController().signal);
          const execution = await executeOriginalFactorDecomposition(snapshot as FactorRiskSnapshot, parsed.data, ctx);
          const saved = await createTerminalArtifactEngineVersion(ctx, parsed.data.terminalArtifact, execution);
          res.json({ ...execution.response, terminalArtifact: { artifactId: saved.artifactId, baseVersion: parsed.data.terminalArtifact.baseVersion, version: saved.version, contentHash: saved.contentHash } });
        } catch (error) {
          res.status(409).json({ error: `Provider decomposition was not retained: ${errorMessage(error, "source or target admission failed")}` });
        }
        return;
      }
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
        portfolioWeights: parsed.data.portfolioWeights,
        result,
      });
    } catch (error) {
      const status = error instanceof FactorRiskAccessError ? error.status : error instanceof FactorAttributionValidationError ? 400 : 422;
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
