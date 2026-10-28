import type { Express, Request, Response } from "express";
import { requireRole } from "./auth";
import {
  runScenarioPipeline,
  scenarioPipelineRequestSchema,
  ScenarioPipelineError,
  type ScenarioPipelineRequest,
  type ScenarioPipelineResult,
} from "./scenarioPipeline";
import { tenantContext, type TenantContext } from "./tenantContext";
import { IntegratedModelArtifactError } from "./integratedModelArtifact";
import { TerminalSourceAccessError } from "./terminalArtifactTool";

export const READ_ROLES = ["internal_admin", "internal_analyst", "internal_compliance"] as const;
export const SCENARIO_PIPELINE_READ_ROLES = READ_ROLES;

export interface ScenarioPipelineRouteService {
  runScenarioPipeline: (request: ScenarioPipelineRequest, ctx: TenantContext) => Promise<ScenarioPipelineResult>;
}

const defaultService: ScenarioPipelineRouteService = { runScenarioPipeline };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Scenario pipeline failed.";
}

export function createScenarioPipelineRouteHandlers(service: ScenarioPipelineRouteService = defaultService) {
  async function previewHandler(req: Request, res: Response): Promise<void> {
    const parsed = scenarioPipelineRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const result = await service.runScenarioPipeline(parsed.data as ScenarioPipelineRequest, tenantContext(req.user!));
      res.status(200).json({ trace: result.trace, receiptCalculation: result.receiptCalculation });
    } catch (error) {
      const status = error instanceof ScenarioPipelineError ? error.statusCode : error instanceof IntegratedModelArtifactError || error instanceof TerminalSourceAccessError ? error.status : 422;
      res.status(status).json({ error: errorMessage(error) });
    }
  }
  return { previewHandler };
}

export function registerScenarioPipelineRoutes(app: Express, service: ScenarioPipelineRouteService = defaultService): void {
  const handlers = createScenarioPipelineRouteHandlers(service);
  app.post("/api/scenario-pipeline/preview", requireRole(...READ_ROLES), handlers.previewHandler);
}

export const scenarioPipelineRouteHandlers = createScenarioPipelineRouteHandlers();
