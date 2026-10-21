import type { Express, Response } from "express";
import { z } from "zod";
import { createQuantExperimentSchema, editQuantExperimentSchema, quantRunRequestSchema } from "@shared/quantLab";
import { requireRole } from "./auth";
import { auditActor, recordAuditEvent } from "./auditEvents";
import {
  cancelQuantRun,
  cloneQuantExperiment,
  compareQuantRuns,
  createQuantExperiment,
  editQuantExperiment,
  enqueueQuantRun,
  executableQuantModels,
  getQuantExperiment,
  getQuantRun,
  initializeQuantLabRuntime,
  listQuantExperiments,
  listQuantDatasetCatalog,
  listQuantRuns,
  quantRunEnvelope,
  rerunQuantRun,
  runtimeStatus,
} from "./quantLabRuntime";
import { quantModelWorkspace } from "@shared/quantLab";
import { QUANT_MODEL_REGISTRY } from "./quantModelRegistry";
import { registerAdvancedQuantRoutes } from "./advancedQuantRoutes";
import { resolveQuantDatasetInputs } from "./quantLabDatasetInputs";
import type { QuantRun } from "@shared/schema";
async function admitRunResultRead(userId: number, run: QuantRun) {
  if (!run.datasetSnapshotIds.length) return;
  await resolveQuantDatasetInputs(userId, null, run.datasetSnapshotIds, run.datasetInputBindings, run.parameters, run.datasetSnapshotHashes, undefined, false, "read");
}

const READ_ROLES = ["internal_admin", "internal_analyst", "internal_compliance"] as const;
const AUTHOR_ROLES = ["internal_admin", "internal_analyst"] as const;
const idSchema = z.string().uuid();

function parseId(value: unknown): string | null {
  const parsed = idSchema.safeParse(value); return parsed.success ? parsed.data : null;
}

function failure(res: Response, error: unknown, fallbackStatus = 422) {
  const message = error instanceof Error ? error.message : "Quant Lab operation failed.";
  const status = message.includes("quota reached") ? 429 : message.includes("MB input limit") || message.includes("MB persistence limit") ? 413 : fallbackStatus;
  res.status(status).json({ error: message });
}

export function registerQuantLabRoutes(app: Express): void {
  registerAdvancedQuantRoutes(app);
  void initializeQuantLabRuntime().catch((error) => console.error("Quant Lab recovery failed:", error));

  app.get("/api/quant-lab/runtime", requireRole(...READ_ROLES), (_req, res) => {
    res.json({ ...runtimeStatus(), workspaces: ["dataset", "statistics", "econometrics", "forecasting", "risk", "portfolio", "derivatives", "backtest", "ml", "results", "registry"] });
  });

  app.get("/api/quant-lab/models", requireRole(...READ_ROLES), (_req, res) => {
    const executableIds = new Set(executableQuantModels().map((model) => model.id));
    res.json(QUANT_MODEL_REGISTRY.map((model) => ({ ...model, workspace: quantModelWorkspace(model), executable: executableIds.has(model.id) })));
  });

  app.get("/api/quant-lab/datasets", requireRole(...READ_ROLES), async (req, res) => {
    const parsed = z.object({ organizationId: z.coerce.number().int().positive().nullable().default(null), limit: z.coerce.number().int().min(1).max(500).default(250) }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    res.json(await listQuantDatasetCatalog(parsed.data.organizationId, parsed.data.limit));
  });

  app.get("/api/quant-lab/experiments", requireRole(...READ_ROLES), async (req, res) => {
    res.json(await listQuantExperiments(req.user!.id, req.user!.role === "internal_compliance"));
  });

  app.post("/api/quant-lab/experiments", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = createQuantExperimentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const experiment = await createQuantExperiment(parsed.data, req.user!.id);
      await recordAuditEvent(req.user!.id, "quant_experiment_created", { experimentId: experiment.id, modelId: experiment.modelId, workspace: experiment.workspace, ...auditActor(req.user!) });
      res.status(201).json(experiment);
    } catch (error) { failure(res, error); }
  });

  app.get("/api/quant-lab/experiments/:id", requireRole(...READ_ROLES), async (req, res) => {
    const id = parseId(req.params.id); if (!id) return res.status(400).json({ error: "Invalid experiment id." });
    const experiment = await getQuantExperiment(id, req.user!.role === "internal_compliance" ? undefined : req.user!.id);
    if (!experiment) return res.status(404).json({ error: "Experiment not found." });
    const runs = await listQuantRuns(req.user!.id, id, req.user!.role === "internal_compliance");
    try { for (const run of runs) await admitRunResultRead(req.user!.id, run); }
    catch (error) { failure(res, error, 403); return; }
    res.json({ experiment, runs });
  });

  app.patch("/api/quant-lab/experiments/:id", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const id = parseId(req.params.id); const parsed = editQuantExperimentSchema.safeParse(req.body);
    if (!id) return res.status(400).json({ error: "Invalid experiment id." });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const experiment = await editQuantExperiment(id, req.user!.id, parsed.data);
      if (!experiment) return res.status(404).json({ error: "Experiment not found." });
      await recordAuditEvent(req.user!.id, "quant_experiment_updated", { experimentId: id, ...auditActor(req.user!) });
      res.json(experiment);
    } catch (error) { failure(res, error); }
  });

  app.post("/api/quant-lab/experiments/:id/clone", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const id = parseId(req.params.id); if (!id) return res.status(400).json({ error: "Invalid experiment id." });
    const clone = await cloneQuantExperiment(id, req.user!.id); if (!clone) return res.status(404).json({ error: "Experiment not found." });
    await recordAuditEvent(req.user!.id, "quant_experiment_cloned", { experimentId: clone.id, parentExperimentId: id, ...auditActor(req.user!) });
    res.status(201).json(clone);
  });

  app.post("/api/quant-lab/experiments/:id/runs", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const id = parseId(req.params.id); const parsed = quantRunRequestSchema.safeParse(req.body ?? {});
    if (!id) return res.status(400).json({ error: "Invalid experiment id." });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const run = await enqueueQuantRun(id, req.user!.id, parsed.data);
      await recordAuditEvent(req.user!.id, "quant_run_queued", { experimentId: id, runId: run.id, modelId: run.modelId, cached: Boolean(run.cachedFromRunId), ...auditActor(req.user!) });
      res.status(run.cachedFromRunId ? 200 : 202).json(run);
    } catch (error) { failure(res, error); }
  });

  app.get("/api/quant-lab/runs", requireRole(...READ_ROLES), async (req, res) => {
    const experimentId = req.query.experimentId ? parseId(req.query.experimentId) : undefined;
    if (req.query.experimentId && !experimentId) return res.status(400).json({ error: "Invalid experiment id." });
    try {
      const runs = await listQuantRuns(req.user!.id, experimentId ?? undefined, req.user!.role === "internal_compliance");
      for (const run of runs) await admitRunResultRead(req.user!.id, run);
      res.json(runs);
    } catch (error) { failure(res, error, 403); }
  });

  app.get("/api/quant-lab/runs/:id", requireRole(...READ_ROLES), async (req, res) => {
    const id = parseId(req.params.id); if (!id) return res.status(400).json({ error: "Invalid run id." });
    const run = await getQuantRun(id, req.user!.role === "internal_compliance" ? undefined : req.user!.id);
    if (!run) return res.status(404).json({ error: "Run not found." });
    try { await admitRunResultRead(req.user!.id, run); }
    catch (error) { failure(res, error, 403); return; }
    res.json({ run, envelope: quantRunEnvelope(run) });
  });

  app.post("/api/quant-lab/runs/:id/cancel", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const id = parseId(req.params.id); if (!id) return res.status(400).json({ error: "Invalid run id." });
    const run = await cancelQuantRun(id, req.user!.id); if (!run) return res.status(404).json({ error: "Run not found." });
    try { await admitRunResultRead(req.user!.id, run); }
    catch (error) { failure(res, error, 403); return; }
    await recordAuditEvent(req.user!.id, "quant_run_cancel_requested", { runId: id, ...auditActor(req.user!) });
    res.json(run);
  });

  app.post("/api/quant-lab/runs/:id/rerun", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const id = parseId(req.params.id); if (!id) return res.status(400).json({ error: "Invalid run id." });
    try { const run = await rerunQuantRun(id, req.user!.id, req.body?.bypassCache !== false); res.status(202).json(run); }
    catch (error) { failure(res, error); }
  });

  app.get("/api/quant-lab/compare", requireRole(...READ_ROLES), async (req, res) => {
    const left = parseId(req.query.left); const right = parseId(req.query.right);
    if (!left || !right) return res.status(400).json({ error: "Two valid run ids are required." });
    try {
      const runs = await Promise.all([getQuantRun(left, req.user!.id), getQuantRun(right, req.user!.id)]);
      for (const run of runs) { if (!run) throw new Error("Owned Quant run not found."); await admitRunResultRead(req.user!.id, run); }
      res.json(await compareQuantRuns(left, right, req.user!.id));
    }
    catch (error) { failure(res, error, 404); }
  });
}
