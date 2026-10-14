/**
 * Internal terminal routes for the Wikipedia Pageviews connector --
 * official, free, no key required. Gated by the app.use("/api",
 * requireInternal) middleware in routes.ts like everything else in this
 * registration group.
 */
import type { Express } from "express";
import { getPageviews } from "./wikipediaData";

export function registerWikipediaRoutes(app: Express): void {
  app.get("/api/wikipedia/pageviews/:article", async (req, res) => {
    const result = await getPageviews(req.params.article);
    res.json(result);
  });
}
