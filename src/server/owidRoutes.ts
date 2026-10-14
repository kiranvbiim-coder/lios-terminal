/**
 * Internal terminal routes for the Our World in Data connector -- official,
 * free, no key required. Gated by the app.use("/api", requireInternal)
 * middleware in routes.ts like everything else in this registration group.
 */
import type { Express } from "express";
import { getOwidCountrySeries, OWID_COUNTRIES } from "./owidData";

export function registerOwidRoutes(app: Express): void {
  app.get("/api/owid/countries", (_req, res) => {
    res.json(OWID_COUNTRIES);
  });

  app.get("/api/owid/country/:iso3", async (req, res) => {
    const result = await getOwidCountrySeries(req.params.iso3);
    res.json(result);
  });
}
