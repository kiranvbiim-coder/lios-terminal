import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "./auth";
import { tenantContext } from "./tenantContext";
import {
  branchP8ScenarioArtifact,
  compareP8ScenarioArtifacts,
  createP8DecisionObject,
  getP8ScenarioSnapshot,
  proposeP8AssumptionMerge,
  proposeP8ModelDraft,
  publishP8Formula,
  validateP8Formula,
} from "./p8ScenarioService";

function ctx(req: Request) {
  return tenantContext(req.user!);
}

function fail(res: Response, error: unknown): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Invalid P8 request.", issues: error.issues });
    return;
  }
  const message = error instanceof Error ? error.message : "P8 request failed.";
  const status = /not found|not owned|different Project/i.test(message) ? 404 : /stale|head moved|concurrent/i.test(message) ? 409 : 400;
  res.status(status).json({ error: message });
}

export function registerP8Routes(app: Express): void {
  app.use("/api/p8", requireAuth);

  app.post("/api/p8/artifacts/:artifactId/branch", async (req, res) => {
    try { res.json(await branchP8ScenarioArtifact(ctx(req), req.params.artifactId, req.body)); }
    catch (error) { fail(res, error); }
  });

  app.get("/api/p8/artifacts/:artifactId/snapshot", async (req, res) => {
    try {
      const query = z.object({
        version: z.coerce.number().int().positive().optional(),
        scenarioKind: z.enum(["base", "bull", "bear", "custom"]).optional(),
      }).parse(req.query);
      res.json(await getP8ScenarioSnapshot(ctx(req), req.params.artifactId, query.version, query.scenarioKind));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/p8/projects/:projectId/scenario-compare", async (req, res) => {
    try { res.json(await compareP8ScenarioArtifacts(ctx(req), Number(req.params.projectId), req.body)); }
    catch (error) { fail(res, error); }
  });

  app.post("/api/p8/assumption-merge", async (req, res) => {
    try { res.json(await proposeP8AssumptionMerge(ctx(req), req.body)); }
    catch (error) { fail(res, error); }
  });

  app.post("/api/p8/artifacts/:artifactId/model-draft", async (req, res) => {
    try { res.json(await proposeP8ModelDraft(ctx(req), req.params.artifactId, req.body)); }
    catch (error) { fail(res, error); }
  });

  app.post("/api/p8/formulas/validate", async (req, res) => {
    try { res.json(validateP8Formula(req.body)); }
    catch (error) { fail(res, error); }
  });

  app.post("/api/p8/projects/:projectId/formulas/publish", async (req, res) => {
    try { res.json(await publishP8Formula(ctx(req), Number(req.params.projectId), req.body)); }
    catch (error) { fail(res, error); }
  });

  app.post("/api/p8/projects/:projectId/decisions", async (req, res) => {
    try { res.json(await createP8DecisionObject(ctx(req), Number(req.params.projectId), req.body)); }
    catch (error) { fail(res, error); }
  });
}
