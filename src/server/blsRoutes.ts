/**
 * Internal terminal routes for the BLS connector -- official, free, no key
 * required. Gated by the app.use("/api", requireInternal) middleware in
 * routes.ts like everything else in this registration group.
 */
import type { Express, Request, Response } from "express";
import { getBlsSeries, BLS_CATALOG, BLS_MAX_YEARS_BACK, type BlsSeriesOptions } from "./blsData";

function parseOptions(req: Request): BlsSeriesOptions {
  const options: BlsSeriesOptions = {};
  for (const key of ["yearsBack", "startYear", "endYear"] as const) {
    if (req.query[key] !== undefined) (options[key] as number) = Number(req.query[key]);
  }
  if (options.yearsBack !== undefined && (!Number.isInteger(options.yearsBack) || options.yearsBack < 1 || options.yearsBack > BLS_MAX_YEARS_BACK)) throw new RangeError(`yearsBack must be an integer between 1 and ${BLS_MAX_YEARS_BACK}`);
  return options;
}
function routeError(res: Response, error: unknown): void {
  const status = error instanceof RangeError ? 400 : 502;
  res.status(status).json({ error: error instanceof Error ? error.message : "BLS request failed" });
}

export function registerBlsRoutes(app: Express): void {
  app.get("/api/bls/catalog", (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    if ((req.query.page !== undefined && (!Number.isInteger(page) || page < 1)) || (!Number.isInteger(limit) || limit < 1 || limit > 1_000)) { routeError(res, new RangeError("page must be >= 1 and limit must be between 1 and 1000")); return; }
    const filtered = search ? BLS_CATALOG.filter((item) => `${item.seriesId} ${item.name}`.toLowerCase().includes(search)) : BLS_CATALOG;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit);
    if (req.query.page === undefined && req.query.limit === undefined && !search) { res.json(BLS_CATALOG); return; }
    res.json({ items, page, limit, total: filtered.length, hasMore: start + items.length < filtered.length, nextPage: start + items.length < filtered.length ? page + 1 : null, source: "curated BLS IDs; arbitrary IDs accepted by /series/:seriesId" });
  });

  app.get("/api/bls/series/:seriesId", async (req, res) => {
    try { res.json(await getBlsSeries(req.params.seriesId, parseOptions(req))); }
    catch (error) { routeError(res, error); }
  });
}
