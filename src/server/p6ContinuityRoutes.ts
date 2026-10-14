import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "./auth";
import { getP6ProjectContinuity } from "./p6ProjectContinuity";
import { tenantContext } from "./tenantContext";

function ctx(req: Request) {
  return tenantContext(req.user!);
}

function projectId(req: Request): number {
  return z.coerce.number().int().positive().parse(req.params.projectId);
}

function fail(res: Response, error: unknown): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Invalid P6 continuity request.", issues: error.issues });
    return;
  }
  const message = error instanceof Error ? error.message : "Project Continuity request failed.";
  if (/not found|not owned|boundary|different Project/i.test(message)) {
    res.status(404).json({ error: message });
    return;
  }
  res.status(400).json({ error: message });
}

export function registerP6ContinuityRoutes(app: Express): void {
  app.use("/api/projects/:projectId/continuity", requireAuth);

  app.get("/api/projects/:projectId/continuity", async (req, res) => {
    try {
      res.json(await getP6ProjectContinuity(ctx(req), projectId(req)));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/continuity/refresh", async (req, res) => {
    try {
      res.json(await getP6ProjectContinuity(ctx(req), projectId(req), { refreshIntelligence: true }));
    } catch (error) { fail(res, error); }
  });
}
