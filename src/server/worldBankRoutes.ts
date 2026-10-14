/**
 * Internal terminal routes for the World Bank connector -- official, free,
 * no key required. Gated by the app.use("/api", requireInternal)
 * middleware in routes.ts like everything else in this registration group.
 */
import type { Express, Request, Response } from "express";
import { getWbIndicator, getWbCompare, getWbIndicatorCatalog, getWbProviderIndicatorCatalog, getWbProviderCountries, WB_COUNTRIES, WB_DEFAULT_YEARS_BACK, WB_MAX_YEARS_BACK, WB_MAX_PAGE_SIZE, type WbDomain, type WbIndicatorOptions } from "./worldBankData";

function parsePageQuery(req: Request): { page: number; limit: number; search?: string } {
  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > WB_MAX_PAGE_SIZE) throw new RangeError(`page must be >= 1 and limit must be between 1 and ${WB_MAX_PAGE_SIZE}`);
  return { page, limit, search: typeof req.query.search === "string" ? req.query.search : undefined };
}

function parseIndicatorOptions(req: Request): WbIndicatorOptions {
  const options: WbIndicatorOptions = {};
  const queryMap: Array<[string, keyof WbIndicatorOptions]> = [
    ["yearsBack", "yearsBack"], ["startYear", "startYear"], ["endYear", "endYear"],
    ["start", "startYear"], ["end", "endYear"], ["page", "page"], ["limit", "limit"],
  ];
  for (const [key, target] of queryMap) {
    if (req.query[key] !== undefined) (options[target] as number) = Number(req.query[key]);
  }
  if (options.yearsBack === undefined) options.yearsBack = WB_DEFAULT_YEARS_BACK;
  if (options.yearsBack !== undefined && (!Number.isInteger(options.yearsBack) || options.yearsBack < 1 || options.yearsBack > WB_MAX_YEARS_BACK)) throw new RangeError(`yearsBack must be an integer between 1 and ${WB_MAX_YEARS_BACK}`);
  return options;
}

function sendRouteError(res: Response, error: unknown): void {
  const status = error instanceof RangeError ? 400 : 502;
  res.status(status).json({ error: error instanceof Error ? error.message : "World Bank request failed" });
}

export function registerWorldBankRoutes(app: Express): void {
  app.get("/api/worldbank/countries", (_req, res) => {
    res.json(WB_COUNTRIES);
  });

  app.get("/api/worldbank/catalog/:domain", (req, res) => {
    const domain = req.params.domain as WbDomain;
    res.json(getWbIndicatorCatalog(domain));
  });

  // Provider catalog endpoints are paginated and intentionally separate from
  // the small curated catalog used by existing panels.
  app.get("/api/worldbank/provider/countries", async (req, res) => {
    try { res.json(await getWbProviderCountries(parsePageQuery(req))); }
    catch (error) { sendRouteError(res, error); }
  });

  app.get("/api/worldbank/provider/indicators", async (req, res) => {
    try { res.json(await getWbProviderIndicatorCatalog(parsePageQuery(req))); }
    catch (error) { sendRouteError(res, error); }
  });

  app.get("/api/worldbank/indicator/:code", async (req, res) => {
    try {
      const country = typeof req.query.country === "string" ? req.query.country : "US";
      res.json(await getWbIndicator(req.params.code, country, parseIndicatorOptions(req)));
    } catch (error) { sendRouteError(res, error); }
  });

  app.get("/api/worldbank/compare/:code", async (req, res) => {
    try {
      const countriesParam = typeof req.query.countries === "string" ? req.query.countries : WB_COUNTRIES.map((c) => c.iso2).join(",");
      const countries = countriesParam.split(",").map((c) => c.trim()).filter(Boolean);
      res.json(await getWbCompare(req.params.code, countries));
    } catch (error) { sendRouteError(res, error); }
  });
}
