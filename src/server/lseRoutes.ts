/**
 * Internal terminal routes backed by lseData.ts (London Strategic Edge). Gated
 * by the app.use("/api", requireInternal) middleware in routes.ts like the
 * rest of this registration group.
 */
import type { Express } from "express";
import {
  isLseConfigured, getInsiderTrades, getOptionsFlow, getOptionsChain, getCot,
  getDividends, getEconomicCalendar, searchEconomicsCatalog, getSeries, getCatalog,
  getStockSplits, getCompanyProfile, getStockFundamentals, getBondYields, screenCatalog,
  getCandles, getLseDatasetManifest, normalizeLseQueryOptions, LseQueryValidationError,
} from "./lseData";
import { getFinancialReportsWithFallback } from "./financialDataProviders";
import { resolveFinancialStatements } from "./financialStatementsBroker";
const LSE_BROWSER_MAX_LIMIT = 500;

function queryValue(req: { query: Record<string, unknown> }, name: string): string | undefined {
  const value = req.query[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new LseQueryValidationError(`${name} must be supplied once.`);
  return value;
}

function queryNumber(req: { query: Record<string, unknown> }, name: string): number | undefined {
  const value = queryValue(req, name);
  if (value === undefined) return undefined;
  if (value.trim() === "") throw new LseQueryValidationError(`${name} must be a number.`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new LseQueryValidationError(`${name} must be a number.`);
  return number;
}
function lseQuery(req: { query: Record<string, unknown> }) {
  const mode = queryValue(req, "mode");
  if (mode !== undefined && mode !== "page") throw new LseQueryValidationError("mode must be page.");
  const options = normalizeLseQueryOptions({
    start: queryValue(req, "start"),
    end: queryValue(req, "end"),
    order: queryValue(req, "order") as "asc" | "desc" | undefined,
    limit: queryNumber(req, "limit"),
    page: queryNumber(req, "page"),
    cursor: queryValue(req, "cursor"),
    mode: mode as "page" | undefined,
  });
  if (options.limit !== undefined && options.limit > LSE_BROWSER_MAX_LIMIT) {
    throw new LseQueryValidationError(`limit must not exceed ${LSE_BROWSER_MAX_LIMIT} for browser responses; request additional pages.`);
  }
  return options;
}

function invalidLseQuery(res: { status: (code: number) => { json: (body: unknown) => unknown } }, error: unknown): boolean {
  if (!(error instanceof LseQueryValidationError)) return false;
  res.status(400).json({ error: error.message });
  return true;
}
export function registerLseRoutes(app: Express): void {
  app.get("/api/lse/status", async (_req, res) => {
    res.json({ configured: isLseConfigured() });
  });

  app.get("/api/lse/manifest", async (_req, res) => {
    res.json(getLseDatasetManifest());
  });

  // Cross-asset candles (stocks/FX/crypto/commodities/indices/ETFs/futures).
  // Additive, not wired into the Yahoo/Stooq/yfinance quote pipeline in
  // marketData.ts -- that cascade is already carefully tuned per-asset-class
  // (see its own comments) and LSE candle coverage/format is unverified
  // against it without a live key. This exposes LSE candles as an explicit,
  // independently selectable source instead.
  app.get("/api/lse/candles/:symbol", async (req, res) => {
    try {
      const symbol = String(req.params.symbol).toUpperCase();
      const timeframe = queryValue(req, "timeframe") ?? "1d";
      const candles = await getCandles(symbol, timeframe, { ...lseQuery(req), order: (queryValue(req, "order") as "asc" | "desc" | undefined) ?? "asc" });
      res.json(candles);
    } catch (error) {
      if (!invalidLseQuery(res, error)) throw error;
    }
  });

  app.get("/api/lse/insiders", async (req, res) => {
    try {
      const options = lseQuery(req);
      const symbol = queryValue(req, "symbol")?.toUpperCase();
      const type = queryValue(req, "type");
      const trades = await getInsiderTrades(symbol, type, options);
      res.json(trades);
    } catch (error) {
      if (!invalidLseQuery(res, error)) throw error;
    }
  });

  app.get("/api/lse/options-flow", async (req, res) => {
    try {
      const options = lseQuery(req);
      const underlying = queryValue(req, "underlying")?.toUpperCase();
      const typeValue = queryValue(req, "type");
      if (typeValue !== undefined && typeValue !== "call" && typeValue !== "put") throw new LseQueryValidationError("type must be call or put.");
      const minPremium = queryNumber(req, "minPremium");
      const maxDte = queryNumber(req, "maxDte");
      const prints = await getOptionsFlow({ ...options, underlying, type: typeValue as "call" | "put" | undefined, minPremium, maxDte });
      res.json(prints);
    } catch (error) {
      if (!invalidLseQuery(res, error)) throw error;
    }
  });

  app.get("/api/lse/options-chain/:underlying", async (req, res) => {
    try {
      const options = lseQuery(req);
      const typeValue = queryValue(req, "type");
      if (typeValue !== undefined && typeValue !== "call" && typeValue !== "put") throw new LseQueryValidationError("type must be call or put.");
      const expiry = queryValue(req, "expiry");
      const minDte = queryNumber(req, "minDte");
      const maxDte = queryNumber(req, "maxDte");
      const hasExplicitRange = minDte !== undefined || maxDte !== undefined || expiry !== undefined || typeValue !== undefined;
      const chain = await getOptionsChain(String(req.params.underlying).toUpperCase(), {
        ...options,
        type: typeValue as "call" | "put" | undefined,
        expiry,
        minDte,
        maxDte: maxDte ?? (hasExplicitRange ? undefined : 45),
        limit: options.limit ?? 200,
      });
      res.json(chain);
    } catch (error) {
      if (!invalidLseQuery(res, error)) throw error;
    }
  });

  app.get("/api/lse/cot/:symbol", async (req, res) => {
    try {
      const rows = await getCot(String(req.params.symbol).toUpperCase(), lseQuery(req));
      res.json(rows);
    } catch (error) {
      if (!invalidLseQuery(res, error)) throw error;
    }
  });

  app.get("/api/lse/dividends/:symbol", async (req, res) => {
    try {
      const rows = await getDividends(String(req.params.symbol).toUpperCase(), lseQuery(req));
      res.json(rows);
    } catch (error) {
      if (!invalidLseQuery(res, error)) throw error;
    }
  });

  app.get("/api/lse/splits/:symbol", async (req, res) => {
    try {
      const rows = await getStockSplits(String(req.params.symbol).toUpperCase(), lseQuery(req));
      res.json(rows);
    } catch (error) {
      if (!invalidLseQuery(res, error)) throw error;
    }
  });

  app.get("/api/lse/financials/:symbol", async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    const reportType = req.query.reportType ? String(req.query.reportType) : "income";
    const period = req.query.period ? String(req.query.period) : "FY";
    const result = await getFinancialReportsWithFallback(symbol, reportType, period, req.user?.id);
    // Preserve the array response consumed by existing panels while exposing
    // reliability provenance to terminal clients and diagnostics.
    res.set("X-Limuria-Provider", result.provider ?? "none");
    res.set("X-Limuria-Providers-Attempted", result.attemptedProviders.join(","));
    res.set("X-Limuria-Provider-Failures", String(result.failures.length));
    const { reports } = result;
    res.json(reports);
  });

  app.get("/api/lse/bondyields/:symbol", async (req, res) => {
    try {
      const options = lseQuery(req);
      const rows = await getBondYields(String(req.params.symbol).toUpperCase(), options);
      res.json(rows);
    } catch (error) {
      if (!invalidLseQuery(res, error)) throw error;
    }
  });
  // action (e.g. a Data Conflict Detector panel), not a page-load path.
  app.get("/api/lse/financials/:symbol/conflicts", async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    const reportType = req.query.reportType ? String(req.query.reportType) : "income";
    const period = req.query.period ? String(req.query.period) : "FY";
    const providers = typeof req.query.providers === "string" ? req.query.providers.split(",").filter(Boolean) : undefined;
    const resolution = await resolveFinancialStatements(symbol, reportType, period, providers);
    res.json(resolution);
  });

  app.get("/api/lse/company/:symbol", async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    const [profile, fundamentals] = await Promise.all([
      getCompanyProfile(symbol),
      getStockFundamentals(symbol),
    ]);
    res.json({ profile, fundamentals });
  });


  app.get("/api/lse/calendar", async (req, res) => {
    try {
      const region = queryValue(req, "region");
      const event = queryValue(req, "event");
      const rows = await getEconomicCalendar(region, event, false, { ...lseQuery(req), limit: lseQuery(req).limit ?? 50 });
      res.json(rows);
    } catch (error) {
      if (!invalidLseQuery(res, error)) throw error;
    }
  });

  app.get("/api/lse/economics/search", async (req, res) => {
    try {
      const options = lseQuery(req);
      const rows = await searchEconomicsCatalog(queryValue(req, "q") ?? "", queryValue(req, "country"), 200, "economics", options);
      res.json(rows);
    } catch (error) {
      if (!invalidLseQuery(res, error)) throw error;
    }
  });

  app.get("/api/lse/economics/series/:symbol", async (req, res) => {
    try {
      const options = lseQuery(req);
      const points = await getSeries(String(req.params.symbol), { ...options, dataset: "economics", limit: options.limit ?? 240 });
      res.json(points);
    } catch (error) {
      if (!invalidLseQuery(res, error)) throw error;
    }
  });

  app.get("/api/lse/bonds/search", async (req, res) => {
    try {
      const options = lseQuery(req);
      const rows = await searchEconomicsCatalog(queryValue(req, "q") ?? "", queryValue(req, "country"), 200, "bonds", options);
      res.json(rows);
    } catch (error) {
      if (!invalidLseQuery(res, error)) throw error;
    }
  });

  app.get("/api/lse/bonds/series/:symbol", async (req, res) => {
    try {
      const options = lseQuery(req);
      const points = await getSeries(String(req.params.symbol), { ...options, dataset: "bonds", limit: options.limit ?? 240 });
      res.json(points);
    } catch (error) {
      if (!invalidLseQuery(res, error)) throw error;
    }
  });

  app.get("/api/lse/bonds/screen", async (req, res) => {
    try {
      const options = lseQuery(req);
      const rows = await screenCatalog("bonds", {
        country: queryValue(req, "country"),
        category: queryValue(req, "category"),
        minValue: queryNumber(req, "minYield"),
        maxValue: queryNumber(req, "maxYield"),
        query: queryValue(req, "q"),
      }, 200, options);
      res.json(rows);
    } catch (error) {
      if (!invalidLseQuery(res, error)) throw error;
    }
  });

  app.get("/api/lse/economics/screen", async (req, res) => {
    try {
      const options = lseQuery(req);
      const rows = await screenCatalog("economics", {
        country: queryValue(req, "country"),
        category: queryValue(req, "category"),
        minValue: queryNumber(req, "minValue"),
        maxValue: queryNumber(req, "maxValue"),
        query: queryValue(req, "q"),
      }, 200, options);
      res.json(rows);
    } catch (error) {
      if (!invalidLseQuery(res, error)) throw error;
    }
  });

  app.get("/api/lse/economics/countries", async (_req, res) => {
    const rows = await getCatalog("economics");
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (r.country && r.country_name && !seen.has(r.country)) seen.set(r.country, r.country_name);
    }
    res.json(Array.from(seen.entries()).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name)));
  });

  app.get("/api/lse/bonds/countries", async (_req, res) => {
    const rows = await getCatalog("bonds");
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (r.country && r.country_name && !seen.has(r.country)) seen.set(r.country, r.country_name);
    }
    res.json(Array.from(seen.entries()).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name)));
  });
}
