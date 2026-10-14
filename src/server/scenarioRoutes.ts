/**
 * Scenario Manager routes. Same role split as assumptionRoutes.ts and
 * workspaceRoutes.ts (see workspaceRoutes.ts's comment for the house
 * convention).
 */
import type { Express } from "express";
import { requireRole } from "./auth";
import { recordAuditEvent, auditActor } from "./auditEvents";
import { listScenarios, saveScenario, deleteScenario } from "./uideEngine/scenarioStore";

const SCENARIO_AUTHOR_ROLES = ["internal_admin", "internal_analyst"] as const;
const SCENARIO_READ_ROLES = ["internal_admin", "internal_analyst", "internal_compliance"] as const;

export function registerScenarioRoutes(app: Express): void {
  app.get("/api/workspaces/:workspaceId/scenarios", requireRole(...SCENARIO_READ_ROLES), (req, res) => {
    res.json(listScenarios(String(req.params.workspaceId)));
  });

  app.post("/api/workspaces/:workspaceId/scenarios", requireRole(...SCENARIO_AUTHOR_ROLES), async (req, res) => {
    const { name, values } = req.body as { name?: string; values?: Record<string, number> };
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name is required." });
      return;
    }
    if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).length === 0) {
      res.status(400).json({ error: "values must be a non-empty object of assumption name -> number." });
      return;
    }
    for (const v of Object.values(values)) {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        res.status(400).json({ error: "every value in the scenario must be a finite number." });
        return;
      }
    }
    const workspaceId = String(req.params.workspaceId);
    const list = saveScenario(workspaceId, name, values, req.user!.id);
    await recordAuditEvent(req.user!.id, "scenario_saved", { workspaceId, name: name.trim(), assumptionCount: Object.keys(values).length, ...auditActor(req.user!) });
    res.json(list);
  });

  app.delete("/api/workspaces/:workspaceId/scenarios/:name", requireRole(...SCENARIO_AUTHOR_ROLES), async (req, res) => {
    const workspaceId = String(req.params.workspaceId);
    const name = String(req.params.name);
    const list = deleteScenario(workspaceId, name);
    await recordAuditEvent(req.user!.id, "scenario_deleted", { workspaceId, name, ...auditActor(req.user!) });
    res.json(list);
  });
}
