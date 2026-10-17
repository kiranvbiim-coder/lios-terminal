import type { Express } from "express";
import { z } from "zod";
import { capabilitySurfaceSchema } from "@shared/capability";
import { capabilityDiscoveryResponseSchema } from "@shared/capabilityDiscovery";
import { discoverCapabilities } from "./capabilityDiscovery";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { getDb } from "./db";
import { requireAuth } from "./auth";
import { getEnvironmentSetupStatus } from "./environmentSetupService";
import { readManagedRuntimeState, managedRuntimePythonPath } from "./pythonRuntimeManager";
import { inspectRunningPythonService } from "./pythonService";

const discoveryQuerySchema = z.object({
  q: z.string().trim().max(200).default(""),
  surface: capabilitySurfaceSchema.default("command_palette"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  invocableOnly: z.enum(["true", "false"]).default("false"),
}).strict();

/**
 * Auth is intentionally inherited from routes.ts's existing internal gate.
 * This endpoint exposes capability metadata only; execution remains behind the
 * normal role/entitlement boundaries of each capability caller.
 */
export function registerCapabilityRoutes(app: Express): void {
  app.get("/api/capabilities/discover", requireAuth, async (req, res, next) => {
    const parsed = discoveryQuerySchema.safeParse({
      q: req.query.q ?? "",
      surface: req.query.surface ?? "command_palette",
      limit: req.query.limit ?? 20,
      invocableOnly: req.query.invocableOnly ?? "false",
    });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid capability discovery query.", issues: parsed.error.issues });
      return;
    }

    try {
      const [actor] = await getDb().select().from(users).where(eq(users.id, req.user!.id)).limit(1);
      if (!actor || actor.role !== req.user!.role || actor.organizationId !== req.user!.organizationId) {
        res.status(403).json({ error: "Current account identity is unavailable; sign in again." }); return;
      }
      const [environment, pythonService] = await Promise.all([getEnvironmentSetupStatus(actor.id), inspectRunningPythonService()]);
      const results = discoverCapabilities(parsed.data.q, {
        surface: parsed.data.surface, limit: parsed.data.limit, invocableOnly: parsed.data.invocableOnly === "true",
        currentUser: {
          role: actor.role, accountActive: actor.active && !actor.mustChangePassword && (!actor.lockedUntil || actor.lockedUntil.getTime() <= Date.now()),
          selectedConnectorIds: environment.setup?.selectedConnectorIds ?? [], connectors: environment.connectors,
          runtimeState: readManagedRuntimeState(), pythonAvailable: managedRuntimePythonPath() !== null, pythonService,
        },
      });
      res.json(capabilityDiscoveryResponseSchema.parse({
        query: parsed.data.q, surface: parsed.data.surface, count: results.length, results,
      }));
    } catch (error) { next(error); }
  });
}
