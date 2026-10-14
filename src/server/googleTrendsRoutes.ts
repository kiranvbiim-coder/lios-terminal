/**
 * Internal terminal routes for the Google Trends connector. Gated by the
 * app.use("/api", requireInternal) middleware in routes.ts like everything
 * else in this registration group.
 */
import type { Express } from "express";
import { getSearchInterest, compareSearchInterest, type TrendsTimeframe } from "./googleTrendsData";

const VALID_TIMEFRAMES = new Set<TrendsTimeframe>(["now 7-d", "today 1-m", "today 3-m", "today 12-m", "today 5-y"]);

function resolveTimeframe(raw: unknown): TrendsTimeframe {
  return typeof raw === "string" && VALID_TIMEFRAMES.has(raw as TrendsTimeframe) ? (raw as TrendsTimeframe) : "today 12-m";
}

export function registerGoogleTrendsRoutes(app: Express): void {
  app.get("/api/trends/interest", async (req, res) => {
    const keyword = String(req.query.keyword || "").trim();
    if (!keyword) return res.status(400).json({ error: "keyword is required" });
    const geo = typeof req.query.geo === "string" ? req.query.geo : "";
    const timeframe = resolveTimeframe(req.query.timeframe);
    const result = await getSearchInterest(keyword, geo, timeframe);
    res.json(result);
  });

  app.get("/api/trends/compare", async (req, res) => {
    const raw = String(req.query.keywords || "").trim();
    const keywords = raw.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 5);
    if (keywords.length === 0) return res.status(400).json({ error: "keywords (comma-separated) is required" });
    const geo = typeof req.query.geo === "string" ? req.query.geo : "";
    const timeframe = resolveTimeframe(req.query.timeframe);
    const results = await compareSearchInterest(keywords, geo, timeframe);
    res.json(results);
  });
}
