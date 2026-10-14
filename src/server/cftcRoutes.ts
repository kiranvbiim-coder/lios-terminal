/**
 * Internal terminal routes for the CFTC connector -- official, free, no key
 * required. Gated by the app.use("/api", requireInternal) middleware in
 * routes.ts like everything else in this registration group.
 */
import type { Express } from "express";
import { getCftcCot, searchCftcMarkets, CFTC_PRESET_MARKETS } from "./cftcData";

export function registerCftcRoutes(app: Express): void {
  app.get("/api/cftc/markets", (_req, res) => {
    res.json(CFTC_PRESET_MARKETS);
  });

  app.get("/api/cftc/cot/:code", async (req, res) => {
    const code = String(req.params.code);
    const limit = req.query.limit ? Number(req.query.limit) : 26;
    const rows = await getCftcCot(code, limit);
    res.json(rows);
  });

  app.get("/api/cftc/search", async (req, res) => {
    const q = String(req.query.q ?? "");
    const results = await searchCftcMarkets(q);
    res.json(results);
  });
}
