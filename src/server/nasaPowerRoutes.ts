/**
 * Internal terminal routes for the NASA POWER connector -- official, free,
 * no key required. Gated by the app.use("/api", requireInternal)
 * middleware in routes.ts like everything else in this registration group.
 */
import type { Express } from "express";
import { getClimateSnapshot, getClimateSnapshotsForTag, CLIMATE_LOCATIONS, type LocationTag } from "./nasaPowerData";

export function registerNasaPowerRoutes(app: Express): void {
  app.get("/api/climate/locations", (_req, res) => {
    res.json(CLIMATE_LOCATIONS);
  });

  app.get("/api/climate/snapshot/:code", async (req, res) => {
    const days = req.query.days ? Number(req.query.days) : 7;
    const result = await getClimateSnapshot(req.params.code, days);
    res.json(result);
  });

  app.get("/api/climate/all", async (req, res) => {
    const tag = typeof req.query.tag === "string" ? (req.query.tag as LocationTag) : undefined;
    const results = await getClimateSnapshotsForTag(tag);
    res.json(results);
  });
}
