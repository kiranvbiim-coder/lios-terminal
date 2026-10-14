/**
 * Internal terminal's FRED-backed domain routes -- Economics & Public
 * Policy, Operations & Supply Chain Logistics, Environment &
 * Sustainability, and Tourism & Hospitality, currently. Gated by the
 * app.use("/api", requireInternal) middleware in routes.ts like everything
 * else in this file's registration group -- no per-route auth needed here.
 * Backed by the same fredData.ts connector the client dashboard's views
 * use, so internal staff and clients see identical numbers.
 */
import type { Express, Request, Response } from "express";
import { getIndicatorQuotes, getIndicatorHistory, getIndicatorCatalog, getYieldCurve, FRED_DEFAULT_POINTS, FRED_MAX_POINTS, type FredHistoryOptions } from "./fredData";

function historyOptions(req: Request): FredHistoryOptions {
  const rawPoints = req.query.points;
  const points = rawPoints === undefined ? FRED_DEFAULT_POINTS : Number(rawPoints);
  if (!Number.isInteger(points) || points < 1 || points > FRED_MAX_POINTS) {
    throw new RangeError(`points must be an integer between 1 and ${FRED_MAX_POINTS}`);
  }
  const startDate = typeof req.query.start === "string" ? req.query.start : undefined;
  const endDate = typeof req.query.end === "string" ? req.query.end : undefined;
  if ((startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) || (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate))) {
    throw new RangeError("start and end must be ISO dates (YYYY-MM-DD)");
  }
  if (startDate && endDate && startDate > endDate) throw new RangeError("start must be on or before end");
  return { points, startDate, endDate };
}

async function sendHistory(req: Request, res: Response): Promise<void> {
  const seriesId = String(req.params.seriesId).toUpperCase();
  try {
    const [quote] = await getIndicatorQuotes([seriesId]);
    const history = await getIndicatorHistory(seriesId, historyOptions(req));
    res.json({ quote, history, provenance: { provider: "FRED", sourceReference: `https://fred.stlouisfed.org/series/${seriesId}`, status: history.length > 0 || quote?.isLive ? "live" : "unavailable" } });
  } catch (error) {
    if (error instanceof RangeError) { res.status(400).json({ error: error.message }); return; }
    res.status(502).json({ error: error instanceof Error ? error.message : "FRED request failed" });
  }
}
export function registerIndicatorRoutes(app: Express): void {
  app.get("/api/economics/indicators", async (_req, res) => {
    const quotes = await getIndicatorQuotes(getIndicatorCatalog("economics_policy").map((i) => i.seriesId));
    res.json(quotes);
  });
  app.get("/api/economics/indicator/:seriesId", async (req, res) => {
    await sendHistory(req, res);
  });

  app.get("/api/supplychain/indicators", async (_req, res) => {
    const quotes = await getIndicatorQuotes(getIndicatorCatalog("supply_chain").map((i) => i.seriesId));
    res.json(quotes);
  });
  app.get("/api/supplychain/indicator/:seriesId", async (req, res) => {
    await sendHistory(req, res);
  });

  app.get("/api/environment/indicators", async (_req, res) => {
    const quotes = await getIndicatorQuotes(getIndicatorCatalog("environment_sustainability").map((i) => i.seriesId));
    res.json(quotes);
  });
  app.get("/api/environment/indicator/:seriesId", async (req, res) => {
    await sendHistory(req, res);
  });

  app.get("/api/tourism/indicators", async (_req, res) => {
    const quotes = await getIndicatorQuotes(getIndicatorCatalog("tourism_hospitality").map((i) => i.seriesId));
    res.json(quotes);
  });
  app.get("/api/tourism/indicator/:seriesId", async (req, res) => {
    await sendHistory(req, res);
  });

  // ?date=YYYY-MM-DD for a historical snapshot curve; omitted for the live curve.
  app.get("/api/fred/yieldcurve", async (req, res) => {
    const asOfDate = typeof req.query.date === "string" ? req.query.date : undefined;
    const result = await getYieldCurve(asOfDate);
    res.json(result);
  });
}
