/**
 * Opportunity Radar / Risk Radar -- "turn existing signals into ranked
 * opportunities/risks" (roadmap item, previously Partial/P0 with no actual
 * implementation anywhere in the repo). Gated by the app.use("/api",
 * requireInternal) middleware in routes.ts like every other internal-only
 * route in this registration group (same tier as /api/watchlist,
 * /api/alerts).
 *
 * Every signal fetched here reuses an EXISTING, already-integrated
 * connector -- nothing new is fetched or invented:
 *  - getQuotes()        (./marketData.ts)   -- live price/52w range, same
 *                                              feed Screener/Watchlist use.
 *  - getFundamentals()  (./marketData.ts)   -- yfinance-backed trailing P/E,
 *                                              revenue growth, ROE, beta,
 *                                              same as Quote/Valuation panels.
 *  - getNews()          (./marketData.ts)   -- real per-symbol RSS news,
 *                                              tallied here into a net
 *                                              sentiment score using the
 *                                              same `sentiment` field
 *                                              getMarketSentiment() already
 *                                              computes per article.
 *  - getInsiderTransactions() (./secEdgarData.ts) -- real SEC EDGAR Form 4
 *                                              filings, filtered here to
 *                                              open-market (P/S) transactions
 *                                              only and netted to a signed
 *                                              dollar buy/sell value.
 *
 * The actual scoring math lives in @shared/radarScoring.ts (pure, unit
 * tested, documented weights) -- this file only fetches and shapes real
 * inputs for it.
 */
import type { Express, Request } from "express";
import { z } from "zod";
import { getQuotes, getFundamentals, getNews, type Quote, type NewsItem } from "./marketData";
import { getInsiderTransactions, type EdgarInsiderTransaction } from "./secEdgarData";
import { storage } from "./storage";
import { scoreOpportunity, scoreRisk, type RadarSignalInputs, type RadarFactorContribution } from "@shared/radarScoring";

const MAX_SYMBOLS = 40;
const INSIDER_LOOKBACK = 20;

const querySchema = z.object({
  symbols: z.string().trim().max(400).optional(),
});

function parseSymbolsParam(raw: string | undefined): string[] {
  if (!raw) return [];
  const symbols = raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  return Array.from(new Set(symbols)).slice(0, MAX_SYMBOLS);
}

/** Explicit `symbols` query param wins; otherwise fall back to the caller's own watchlist (server/storage.ts -- the same real per-user state /api/watchlist serves). */
async function resolveSymbols(req: Request): Promise<string[]> {
  const parsed = querySchema.safeParse(req.query);
  const fromQuery = parsed.success ? parseSymbolsParam(parsed.data.symbols) : [];
  if (fromQuery.length) return fromQuery;

  const watchlist = await storage.getWatchlist(req.user!.id);
  const symbols = watchlist.map((item) => item.symbol.toUpperCase());
  return Array.from(new Set(symbols)).slice(0, MAX_SYMBOLS);
}

function tallyNewsSentiment(items: NewsItem[]): { score: number | null; count: number } {
  if (!items.length) return { score: null, count: 0 };
  const positive = items.filter((item) => item.sentiment === "positive").length;
  const negative = items.filter((item) => item.sentiment === "negative").length;
  return { score: (positive - negative) / items.length, count: items.length };
}

/** Net signed $ value of real open-market (Form 4 code P/S) insider transactions; routine equity-comp mechanics (RSU vesting, option exercise, tax withholding) are excluded, same distinction secEdgarData.ts already draws via isOpenMarket. */
function netOpenMarketInsiderValue(transactions: EdgarInsiderTransaction[]): number | null {
  const relevant = transactions.filter((t) => t.isOpenMarket && !t.isDerivative && t.value !== null && t.acquiredDisposed);
  if (!relevant.length) return null;
  return relevant.reduce((sum, t) => sum + (t.acquiredDisposed === "A" ? t.value! : -t.value!), 0);
}

async function buildSignalInputs(symbol: string, quote: Quote | undefined): Promise<RadarSignalInputs> {
  const [fundamentals, news, insiderTx] = await Promise.all([
    getFundamentals(symbol).catch(() => null),
    getNews(symbol).catch(() => [] as NewsItem[]),
    getInsiderTransactions(symbol, INSIDER_LOOKBACK).catch(() => [] as EdgarInsiderTransaction[]),
  ]);
  const sentiment = tallyNewsSentiment(news);
  return {
    symbol,
    trailingPE: fundamentals?.trailingPE ?? quote?.pe ?? null,
    price: quote?.price ?? null,
    high52: quote?.high52 ?? null,
    low52: quote?.low52 ?? null,
    changePercent: quote?.changePercent ?? null,
    newsSentimentScore: sentiment.score,
    newsArticleCount: sentiment.count,
    insiderNetValue: netOpenMarketInsiderValue(insiderTx),
    revenueGrowth: fundamentals?.revenueGrowth ?? null,
    returnOnEquity: fundamentals?.returnOnEquity ?? null,
    beta: fundamentals?.beta ?? null,
  };
}

interface RadarResponseItem {
  symbol: string;
  name: string | null;
  price: number | null;
  changePercent: number | null;
  score: number;
  factors: RadarFactorContribution[];
}

async function buildRadarResults(
  req: Request,
  score: (inputs: RadarSignalInputs) => { score: number; factors: RadarFactorContribution[] },
): Promise<{ symbols: string[]; results: RadarResponseItem[] }> {
  const symbols = await resolveSymbols(req);
  if (!symbols.length) return { symbols, results: [] };

  const quotes = await getQuotes(symbols);
  const quoteMap = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));

  const results = await Promise.all(symbols.map(async (symbol) => {
    const quote = quoteMap.get(symbol);
    const inputs = await buildSignalInputs(symbol, quote);
    const scored = score(inputs);
    return {
      symbol,
      name: quote?.name ?? null,
      price: quote?.price ?? null,
      changePercent: quote?.changePercent ?? null,
      score: scored.score,
      factors: scored.factors,
    };
  }));

  results.sort((a, b) => b.score - a.score);
  return { symbols, results };
}

export function registerRadarRoutes(app: Express): void {
  app.get("/api/radar/opportunities", async (req, res) => {
    try {
      const payload = await buildRadarResults(req, scoreOpportunity);
      res.json(payload);
    } catch (error) {
      console.error("Opportunity radar failed:", error);
      res.status(502).json({ error: "Opportunity radar unavailable right now." });
    }
  });

  app.get("/api/radar/risks", async (req, res) => {
    try {
      const payload = await buildRadarResults(req, scoreRisk);
      res.json(payload);
    } catch (error) {
      console.error("Risk radar failed:", error);
      res.status(502).json({ error: "Risk radar unavailable right now." });
    }
  });
}
