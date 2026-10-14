import type { Express } from "express";
import { providerConflictQuerySchema, getProviderConflictView } from "./providerConflictService";
import { requireAuth } from "./auth";
import { createDataStackPinSchema } from "@shared/dataStackPins";
import { listDataStackPins, addDataStackPin, removeDataStackPin } from "./environmentSetupService";

/**
 * Main registers this module from server/routes.ts alongside the data-fabric
 * routes. Keeping registration separate makes the read-only conflict surface
 * independently testable and prevents it from triggering provider calls.
 *
 * Conflicts + pins are both retail-reachable (requireAuth, not an internal
 * role gate): ProviderConflictPanel.tsx is mounted inside
 * DataConnectionCenter.tsx, which every signed-in user (not just
 * internal_admin/internal_analyst/internal_compliance) reaches. Restricting
 * the API to internal roles while the panel is shown to every user meant
 * the Advanced/Data-truth surface the P0.3 re-audit finding wants pin
 * controls in was unreachable for the audience it exists for. The view
 * itself is safe to broaden: it only answers a caller-supplied
 * symbol+metric+period (no bulk/other-user data), and real provider names
 * are appropriate here specifically because this page is where a user
 * already manages their own named connectors (Connection Center), unlike
 * quote/panel surfaces where DataStatus deliberately never names a vendor.
 */
export function registerProviderConflictRoutes(app: Express): void {
  app.get("/api/data-truth/conflicts", requireAuth, async (req, res) => {
    const parsed = providerConflictQuerySchema.safeParse({
      symbol: req.query.symbol,
      metric: req.query.metric,
      period: req.query.period,
    });
    if (!parsed.success) {
      return res.status(400).json({ error: "A valid symbol, metric, and period are required.", details: parsed.error.flatten() });
    }
    try {
      const view = await getProviderConflictView(parsed.data);
      return res.json(view);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : "Provider conflict lookup failed." });
    }
  });

  // ─── Conflict pins (P0.3) ──────────────────────────────────────────────
  app.get("/api/data-truth/pins", requireAuth, async (req, res) => {
    const pins = await listDataStackPins(req.user!.id);
    return res.json({ pins });
  });

  app.post("/api/data-truth/pins", requireAuth, async (req, res) => {
    const parsed = createDataStackPinSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid pin.", details: parsed.error.flatten() });
    }
    const pin = await addDataStackPin(req.user!.id, req.user!.organizationId ?? null, parsed.data, { id: req.user!.id, email: req.user!.email });
    return res.status(201).json({ pin });
  });

  app.delete("/api/data-truth/pins/:id", requireAuth, async (req, res) => {
    const removed = await removeDataStackPin(req.user!.id, String(req.params.id), { id: req.user!.id, email: req.user!.email });
    if (!removed) return res.status(404).json({ error: "Pin not found." });
    return res.status(204).send();
  });
}
