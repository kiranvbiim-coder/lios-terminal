import type { Express } from "express";
import { z } from "zod";
import { capabilitySurfaceSchema } from "@shared/capability";
import { capabilityDiscoveryResponseSchema } from "@shared/capabilityDiscovery";
import { discoverCapabilities } from "./capabilityDiscovery";

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
  app.get("/api/capabilities/discover", (req, res) => {
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

    const results = discoverCapabilities(parsed.data.q, {
      surface: parsed.data.surface,
      limit: parsed.data.limit,
      invocableOnly: parsed.data.invocableOnly === "true",
    });

    res.json(capabilityDiscoveryResponseSchema.parse({
      query: parsed.data.q,
      surface: parsed.data.surface,
      count: results.length,
      results,
    }));
  });
}
