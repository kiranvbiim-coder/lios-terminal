import type { Express } from "express";
import type { Server } from "http";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { storage } from "./storage";
import { insertWatchlistItemSchema, insertAlertSchema } from "@shared/schema";
import { evaluateAlerts } from "./alertsEngine";
import {
  getEconomicsSnapshot,
  getIndexSparklines,
  getMarketMovers,
  getMarketSentiment,
  getNews,
  getNewsArticle,
  getOHLCV,
  getOHLCVSeries,
  getFundamentals,
  getMarketBreadth,
  getPeers,
  getQuotes,
  getScreenerResults,
  getEarningsCalendar,
  getForexQuotes,
} from "./marketData";
import { getGeminiNewsAnalysis } from "./geminiNewsService";
import { getCapeSnapshot } from "./shillerCapeService";
import { getRateCycleImpact } from "./crossDomainService";
import { getEconomicCalendar, getEconomicEventDetail } from "./economicsData";
import { getCoverageMap } from "./dataCoverageRegistry";
import { getProviderStatuses } from "./providerStatus";
import { resolveEntity } from "./entityResolver";
import { calculatePortfolioAnalytics } from "./portfolioAnalytics";
import { appendMemory, getMemoryContext } from "./aiMemory";
import { auditLog } from "./auditLog";
import { validateKey, generateKey } from "./apiKey";
import { registerAuthRoutes, registerClientAuthRoutes, requireAuth, requireInternal, requireRole } from "./auth";
import { p10ObservabilityMiddleware } from "./p10Observability";
import { invokeAIRoutedCompletion } from "./byoaiTransport";
import { getEnvironmentSetupForUser } from "./environmentSetupService";
import { classifyAskLiosIntent, formatAskLiosDelegation, ASK_LIOS_SYSTEM_PREAMBLE } from "@shared/askLiosRouter";
import { rejectIfMasterAiOff } from "./masterAiGate";
import { isAuthenticatedSelfServiceRoute } from "./apiAccessPolicy";
import { resolvePersistedInstrument } from "./globalInstrumentMasterStore";
import { providerIngestedUniversePath } from "./providerIngestedCatalog";
import { registerAdminRoutes } from "./adminRoutes";
import { registerContentRoutes } from "./contentRoutes";
import { registerClientRoutes } from "./clientRoutes";
import { registerPersonaPreferenceRoutes } from "./personaPreferenceRoutes";
import { registerTrialRoutes } from "./trialAccess";
import { registerPublicRoutes } from "./publicRoutes";
import { registerEnvironmentSetupRoutes } from "./environmentSetupRoutes";
import { resolvePackagedNativeRuntimeBundleAuthority } from "./nativeRuntimeBundle";
import { configureRuntimeDoctorProvisioning } from "./runtimeDoctorTool";
import { registerSourceConnectionRoutes } from "./sourceConnectionRoutes";
import { registerSourceRegistryRoutes } from "./sourceRegistryRoutes";
import { registerProjectRoutes } from "./projectRoutes";
import { registerProjectConversationRoutes } from "./projectConversationRoutes";
import { registerLedgerRoutes } from "./ledgerRoutes";
import { registerArtifactRoutes } from "./artifactRoutes";
import { registerIndicatorRoutes } from "./indicatorRoutes";
import { registerMediaRoutes } from "./mediaRoutes";
import { registerLseRoutes } from "./lseRoutes";
import { registerCftcRoutes } from "./cftcRoutes";
import { registerSecEdgarRoutes } from "./secEdgarRoutes";
import { registerCompanyIntelligenceRoutes } from "./companyIntelligenceRoutes";
import { registerP13ExtensionRoutes } from "./p13ExtensionRoutes";
import { registerWorldBankRoutes } from "./worldBankRoutes";
import { registerNasaPowerRoutes } from "./nasaPowerRoutes";
import { registerGoogleTrendsRoutes } from "./googleTrendsRoutes";
import { registerFamaFrenchRoutes } from "./famaFrenchRoutes";
import { registerBlsRoutes } from "./blsRoutes";
import { registerOwidRoutes } from "./owidRoutes";
import { registerWikipediaRoutes } from "./wikipediaRoutes";
import { registerUideRoutes } from "./uideRoutes";
import { registerVoiceRoutes } from "./voiceRoutes";
import { registerWorkspaceRoutes } from "./workspaceRoutes";
import { registerModelRoutes } from "./modelRoutes";
import { registerQuantRoutes } from "./quantRoutes";
import { registerQuantLabRoutes } from "./quantLabRoutes";
import { registerAssumptionRoutes } from "./assumptionRoutes";
import { registerScenarioRoutes } from "./scenarioRoutes";
import { registerModelVersionRoutes } from "./modelVersionRoutes";
import { registerWorkspaceSnapshotRoutes } from "./workspaceSnapshotRoutes";
import { registerComponentLibraryRoutes } from "./componentLibraryRoutes";
import { registerResearchRoutes } from "./researchRoutes";
import { registerConsensusRoutes } from "./consensusRoutes";
import { registerBrainRoutes } from "./brainRoutes";
import { registerDecisionRoutes } from "./decisionRoutes";
import { registerDataFabricRoutes } from "./dataFabricRoutes";
import { registerUniversalDataFabricRoutes } from "./universalDataFabricRoutes";
import { registerFinancialMetricRoutes } from "./financialMetricRoutes";
import { registerFinancialNormalizationRoutes } from "./financialNormalizationRoutes";
import { registerConnectorRoutes } from "./connectorRoutes";
import { registerRuntimeFoundationRoutes } from "./runtimeFoundationRoutes";
import { registerLicenseRoutes } from "./licenseRoutes";
import { registerBackupRoutes } from "./backupRoutes";
import { registerDeviceRoutes } from "./deviceRoutes";
import { registerMCPRoutes } from "./mcpRoutes";
import { registerReadinessRoutes } from "./readinessRoutes";
import { registerWaveCRoutes } from "./waveCRoutes";
import { registerWaveDRoutes } from "./waveDRoutes";
import { registerRadarRoutes } from "./radarRoutes";
import { registerFactorRiskRoutes, registerFactorRiskSnapshotListingRoutes } from "./factorRiskRoutes";
import { registerScenarioPipelineRoutes } from "./scenarioPipelineRoutes";
import { registerWaveERoutes } from "./waveERoutes";
import { registerEnterpriseRoutes } from "./enterpriseRoutes";
import { registerEnterpriseSsoRoutes } from "./enterpriseSso";
import { registerOperationalReadinessRoutes } from "./operationalReadinessRoutes";
import { registerProviderConflictRoutes } from "./providerConflictRoutes";
import { registerCalculationJobRoutes } from "./calculationJobRoutes";
import { registerGlobalInstrumentMasterRoutes } from "./globalInstrumentMasterRoutes";
import { registerProductionControlRoutes } from "./productionControlRoutes";
import { registerP6FinanceRoutes } from "./p6FinanceRoutes";
import { registerP6ContinuityRoutes } from "./p6ContinuityRoutes";
import { registerP7ResearchRoutes } from "./p7ResearchRoutes";
import { registerP8Routes } from "./p8Routes";
import { registerP9AutomationRoutes } from "./p9AutomationRoutes";
import { dataRoot, stateDir } from "./dataRoot";


function parseSymbols(value: unknown) {
  return String(value || "")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
}

// Real Wilder's-smoothing RSI(14) and EMA-crossover MACD(12,26,9), computed
// from actual daily closes -- used by the /api/chat local fallback engine
// (routes.ts) so its "chart" response reports genuine momentum readings
// instead of a hardcoded placeholder value.
function calculateRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function calculateMACDCrossover(closes: number[]): { histogram: number; crossover: "bullish" | "bearish" | "none" } | null {
  if (closes.length < 35) return null;
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = closes.map((_, i) => ema12[i] - ema26[i]);
  const signalLine = ema(macdLine, 9);
  const histogram = macdLine[macdLine.length - 1] - signalLine[signalLine.length - 1];
  const prevHistogram = macdLine[macdLine.length - 2] - signalLine[signalLine.length - 2];
  let crossover: "bullish" | "bearish" | "none" = "none";
  if (prevHistogram <= 0 && histogram > 0) crossover = "bullish";
  else if (prevHistogram >= 0 && histogram < 0) crossover = "bearish";
  return { histogram, crossover };
}

const portfolioAnalyticsRequestSchema = z.object({
  positions: z.array(z.object({
    symbol: z.string().trim().min(1),
    shares: z.number().positive(),
    avgCost: z.number().positive(),
  })).min(1),
});

// ─── Route Registration ─────────────────────────────────────────────────────
export async function registerRoutes(httpServer: Server, app: Express): Promise<void> {
  app.use(p10ObservabilityMiddleware);
  registerAuthRoutes(app);

  // Client dashboard (Phase 3) routes are registered here, before the
  // requireInternal gate below, so client_* credentials can reach their own
  // /api/client/* endpoints. Each route is individually protected by
  // requireClient inside registerClientAuthRoutes/registerClientRoutes --
  // this isn't an open surface, it's just outside the internal-only gate.
  registerClientAuthRoutes(app);
  registerEnterpriseSsoRoutes(app);
  registerClientRoutes(app);
  registerPersonaPreferenceRoutes(app);
  registerTrialRoutes(app);
  registerLicenseRoutes(app);
  registerBackupRoutes(app);
  registerDeviceRoutes(app);
  registerMCPRoutes(app);
  const nativeResources = (process as { resourcesPath?: string }).resourcesPath || process.env.ELECTRON_RESOURCES_PATH;
  let nativeProvisioning: ReturnType<typeof resolvePackagedNativeRuntimeBundleAuthority> = null;
  let nativeProvisioningInvalid = false;
  if (nativeResources) {
    try {
      nativeProvisioning = resolvePackagedNativeRuntimeBundleAuthority(nativeResources, path.join(dataRoot(), "python-runtimes"));
    } catch {
      nativeProvisioningInvalid = true;
      console.warn("Native runtime bundle verification failed; provisioning is disabled.");
    }
  }
  configureRuntimeDoctorProvisioning(Boolean(nativeProvisioning));
  registerEnvironmentSetupRoutes(app, {
    ...(nativeProvisioning ? { strictProvisioningAuthority: nativeProvisioning } : {}),
    ...(nativeProvisioningInvalid ? { provisioningBlocker: "native_runtime_bundle_invalid" as const } : {}),
  });
  registerSourceConnectionRoutes(app);
  registerSourceRegistryRoutes(app);
  registerProjectRoutes(app);
  registerProjectConversationRoutes(app);
  registerLedgerRoutes(app);
  registerArtifactRoutes(app);
  // P6 deterministic finance/backtest surface is shared by authenticated client/internal users.
  registerP6FinanceRoutes(app);
  // Active seven-phase P6: Project Graph + Decision Memory + Continuous Intelligence.
  registerP6ContinuityRoutes(app);
  // P7 Project Intelligence is tenant-scoped and shared by internal/client Project users.
  registerP7ResearchRoutes(app);
  // P8 scenario/formula routes are authenticated and must be centrally registered.
  registerP8Routes(app);
  // P9 Project automation is tenant-scoped and shared by authenticated Project users.
  registerP9AutomationRoutes(app);
  registerP13ExtensionRoutes(app);

  // Deliberately small anonymous surface: marketing/product preview support
  // and explicit lead capture only. The public entry experience is
  // non-executable; research, data, AI, engines, Projects, Artifacts and
  // connectors require an authenticated LiOS principal.
  registerPublicRoutes(app);
  registerProductionControlRoutes(app);

  // Everything else requires a signed-in internal account, EXCEPT the path
  // prefixes below: external reference-data proxies (quotes/OHLCV, the
  // ticker directory, economic/supply-chain/environment/tourism indicators,
  // LSE-sourced data, CFTC, SEC EDGAR, World Bank, NASA POWER climate,
  // Google Trends, Fama-French factors, BLS, Our World in Data, Wikipedia
  // pageviews). Verified by grep that none of these route files touch
  // req.user -- they carry no per-user state and cost nothing per request,
  // unlike /api/watchlist, /api/alerts, /api/models, /api/workspaces, etc.,
  // which stay internal-only because they're scoped to an individual
  // internal user's own data, not shared reference data. The
  // client-audience Terminal experience (client/src/lib/audience.ts)
  // needs these open to reuse the same ~25 panel
  // components (Indicator Explorer, Insider Trades, Options Flow, COT,
  // Company Fundamentals, the domain dashboards, etc.) rather than
  // duplicating them. requireAuth still means a real session is required --
  // this isn't an open surface, just not internal-role-gated.
  const PUBLIC_DATA_PATH_PREFIXES = [
    "/finance/", "/economics/", "/supplychain/", "/environment/", "/tourism/",
    "/fred/", "/media/", "/lse/", "/cftc/", "/edgar/", "/worldbank/",
    "/climate/", "/trends/", "/famafrench/", "/bls/", "/owid/", "/wikipedia/",
    // Only these specific /quant/ sub-paths -- not the whole prefix, which
    // would also open consensus-note/challenge-assumption (real per-request
    // AI calls that must stay internal-only). Both are stateless Python-
    // sidecar compute (QuantLib / scipy.optimize) with no AI cost and no
    // metering need, same shape as the reference-data proxies above, and
    // QuantWorkbenchPanel.tsx (where both are wired in) already renders in
    // both builds.
    "/quant/fixed-income/", "/quant/portfolio/", "/quant/credit/", "/quant/stats/", "/quant/econometrics/", "/quant/options/", "/quant/forecasting/", "/quant/economics/", "/quant/ml/", "/quant/supplychain/", "/quant/environment/",
    // Damodaran industry beta/WACC reference data -- a plain read of a
    // public dataset (no AI, no metering need), same shape as the
    // reference-data proxies above. Valuation/DCF work is a core Terminal
    // feature in both audiences.
    "/quant/damodaran/",
  ];
  // Exceptions within an otherwise-open prefix: this one calls Gemini per
  // request with no credit metering (unlike the metered client AI surface
  // in trialAccess.ts), so it must stay internal-only despite /finance/
  // being open.
  const METERED_EXCEPTIONS = new Set(["/finance/news/ai-smart-search"]);
  app.use("/api", (req, res, next) => {
    const isPublicData = PUBLIC_DATA_PATH_PREFIXES.some((p) => req.path.startsWith(p)) && !METERED_EXCEPTIONS.has(req.path);
    const isAuthenticatedSelfService = isAuthenticatedSelfServiceRoute(req.method, req.path);
    return isPublicData || isAuthenticatedSelfService ? requireAuth(req, res, next) : requireInternal(req, res, next);
  });

  registerAdminRoutes(app);
  registerContentRoutes(app);
  registerIndicatorRoutes(app);
  registerMediaRoutes(app);
  registerLseRoutes(app);
  registerCftcRoutes(app);
  registerSecEdgarRoutes(app);
  registerCompanyIntelligenceRoutes(app);
  registerWorldBankRoutes(app);
  registerNasaPowerRoutes(app);
  registerGoogleTrendsRoutes(app);
  registerFamaFrenchRoutes(app);
  registerBlsRoutes(app);
  registerOwidRoutes(app);
  registerWikipediaRoutes(app);
  registerUideRoutes(app);
  registerVoiceRoutes(app);
  registerWorkspaceRoutes(app);
  registerModelRoutes(app);
  registerQuantRoutes(app);
  registerQuantLabRoutes(app);
  registerAssumptionRoutes(app);
  registerScenarioRoutes(app);
  registerModelVersionRoutes(app);
  registerWorkspaceSnapshotRoutes(app);
  registerComponentLibraryRoutes(app);
  registerResearchRoutes(app);
  registerConsensusRoutes(app);
  registerBrainRoutes(app);
  registerDecisionRoutes(app);
  registerDataFabricRoutes(app);
  registerUniversalDataFabricRoutes(app);
  registerFinancialMetricRoutes(app);
  registerFinancialNormalizationRoutes(app);
  registerConnectorRoutes(app);
  registerRuntimeFoundationRoutes(app);
  registerReadinessRoutes(app);
  registerWaveCRoutes(app);
  registerWaveDRoutes(app);
  registerRadarRoutes(app);
  registerFactorRiskRoutes(app);
  registerFactorRiskSnapshotListingRoutes(app);
  registerProviderConflictRoutes(app);
  registerCalculationJobRoutes(app);
  registerGlobalInstrumentMasterRoutes(app);
  registerScenarioPipelineRoutes(app);
  registerWaveERoutes(app);
  registerEnterpriseRoutes(app);
  registerOperationalReadinessRoutes(app);

  // API key logging middleware for finance routes
  app.use("/api/finance", (req, res, next) => {
    const key = (req.query.key as string) || (req.headers["x-api-key"] as string);
    if (key) {
      const isValid = validateKey(key);
      auditLog("api_key_access", { path: req.path, key: key.slice(0, 4) + "...", valid: isValid });
    } else {
      auditLog("api_access_no_key", { path: req.path });
    }
    next();
  });

  // A quote that came back price 0 / status.isFallback (genuinely no live or
  // cached data for that symbol yet) shouldn't be cached as long as a real
  // quote. The underlying data (Yahoo, or this app's own persisted history
  // store) often resolves within seconds of a transient failure -- caching
  // the failure response at the same 90s+180s stale-while-revalidate window
  // as a good quote left a symbol's first bad-luck fetch stuck showing "NO
  // LIVE DATA AVAILABLE" for minutes after the data had actually recovered.
  const HARD_FALLBACK_CACHE_SECS = 5;
  function hasHardFallback(data: unknown): boolean {
    if (!Array.isArray(data)) return false;
    return data.some((item) => {
      if (!item || typeof item !== "object") return false;
      const q = item as { price?: unknown; status?: { isFallback?: unknown } };
      return q.price === 0 && q.status?.isFallback === true;
    });
  }

  // Wrap handlers and set Cache-Control headers to let browser cache responses
  const handleFinance = <T>(loader: (req: any) => Promise<T>, cacheSecs = 60) => {
    return async (req: any, res: any) => {
      try {
        const data = await loader(req);
        const secs = hasHardFallback(data) ? HARD_FALLBACK_CACHE_SECS : cacheSecs;
        res.set("Cache-Control", `public, max-age=${secs}, stale-while-revalidate=${secs * 2}`);
        res.json(data);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unknown finance data error";
        res.status(502).json({ error: detail });
      }
    };
  };

  // ─── Finance proxy routes ─────────────────────────────────────────────────
  app.get("/api/finance/sparklines", handleFinance(async () => getIndexSparklines(), 300));

  // User-provisioned permitted monthly CAPE observations, never a bundled
  // provider dataset. Missing input fails visibly; no network/AI substitution.
  app.get("/api/finance/cape", handleFinance(async () => getCapeSnapshot(), 3600));

  // Cross-Domain Intelligence Fusion (Phase 4): live FEDFUNDS + live sector
  // ETF history, joined server-side; the client's own real sector exposure
  // is joined on top of this client-side (see CrossDomainFusionPanel.tsx).
  app.get("/api/finance/rate-cycle-impact", handleFinance(async (req) => {
    const sector = String(req.query.sector || "Technology");
    return getRateCycleImpact(sector);
  }, 3600));

  app.get("/api/finance/tick", handleFinance(async (req) => {
    const symbols = parseSymbols(req.query.symbols);
    if (!symbols.length) return [];
    const quotes = await getQuotes(symbols);
    return quotes.map(({ symbol, price, change, changePercent, quoteSource, isLive, status }) => ({
      symbol,
      price,
      change,
      changePercent,
      quoteSource,
      isLive,
      status,
    }));
  }, 30));

  app.get("/api/finance/quotes", handleFinance(async (req) => {
    const symbols = parseSymbols(req.query.symbols);
    if (!symbols.length) return [];
    return getQuotes(symbols);
  }, 90));

  app.get("/api/finance/ohlcv", handleFinance(async (req) => {
    const symbol = String(req.query.symbol || "AAPL").toUpperCase();
    const range = String(req.query.range || "1Y");
    const interval = String(req.query.interval || "1d") as "5m" | "15m" | "1h" | "1d";
    return getOHLCVSeries(symbol, range, interval);
  }, 1800));

  // Live fundamentals (market cap, P/E, EPS, revenue, ...) -- separate from
  // /api/finance/quotes because a yfinance .info fetch is meaningfully slower
  // than a price quote; kept single-symbol and cached a full day so
  // calculation-heavy panels (Quote, Valuation, Peer Comp, Asset Pricing) get
  // real numbers instead of being limited to the ~200-symbol static catalog.
  app.get("/api/finance/fundamentals", handleFinance(async (req) => {
    const symbol = String(req.query.symbol || "").toUpperCase();
    if (!symbol) return { error: "symbol is required" };
    const data = await getFundamentals(symbol);
    return data ?? { error: `No fundamentals data available for ${symbol}` };
  }, 3600));

  app.get("/api/finance/breadth", handleFinance(async () => getMarketBreadth(), 300));

  app.get("/api/finance/gainers", handleFinance(async (req) => getMarketMovers("gainers", req.query.region as any), 60));
  app.get("/api/finance/losers", handleFinance(async (req) => getMarketMovers("losers", req.query.region as any), 60));
  app.get("/api/finance/active", handleFinance(async (req) => getMarketMovers("active", req.query.region as any), 60));
  app.get("/api/finance/sentiment", handleFinance(async () => getMarketSentiment(), 60));

  app.get("/api/finance/news", handleFinance(async (req) => {
    const symbol = typeof req.query.symbol === "string" ? req.query.symbol.toUpperCase() : undefined;
    const query = typeof req.query.query === "string" ? req.query.query : undefined;
    return getNews(symbol, query);
  }, 300));

  app.get("/api/finance/news/ai-smart-search", handleFinance(async (req) => {
    const q = String(req.query.q || req.query.symbol || "NUVAMA").trim();
    return getGeminiNewsAnalysis(q);
  }, 300));

  app.get("/api/finance/news/read", handleFinance(async (req) => {
    const url = String(req.query.url || "");
    const title = String(req.query.title || "Untitled article");
    const source = String(req.query.source || "Unknown source");
    const publishedAt = String(req.query.publishedAt || new Date(0).toISOString());
    const summary = typeof req.query.summary === "string" ? req.query.summary : undefined;
    const feedProvider = typeof req.query.feedProvider === "string" ? req.query.feedProvider : undefined;

    return getNewsArticle({
      url,
      title,
      source,
      feedProvider,
      publishedAt,
      summary,
    });
  }, 900));

  app.get("/api/finance/economics", handleFinance(async () => getEconomicsSnapshot(), 300));
  app.get("/api/finance/economics/calendar", handleFinance(async () => getEconomicCalendar(), 900));

  app.get("/api/finance/earnings", handleFinance(async () => getEarningsCalendar(), 900));
  app.get("/api/finance/forex", handleFinance(async () => getForexQuotes(), 30));

  app.get("/api/finance/economics/events/:releaseId", async (req, res) => {
    const releaseId = Number(req.params.releaseId);
    if (!Number.isInteger(releaseId) || releaseId <= 0) {
      return res.status(400).json({ error: "Invalid releaseId" });
    }
    try {
      res.json(await getEconomicEventDetail(releaseId));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown economics event error";
      res.status(502).json({ error: detail });
    }
  });

  app.get("/api/finance/peers", handleFinance(async (req) => {
    const symbol = String(req.query.symbol || "AAPL").toUpperCase();
    return getPeers(symbol);
  }));

  app.get("/api/finance/screener", handleFinance(async (req) => {
    return getScreenerResults({
      sector: typeof req.query.sector === "string" ? req.query.sector : undefined,
      minPe: typeof req.query.minPe === "string" ? req.query.minPe : undefined,
      maxPe: typeof req.query.maxPe === "string" ? req.query.maxPe : undefined,
      dynamicField: typeof req.query.dynamicField === "string" ? req.query.dynamicField : undefined,
      dynamicOperator: typeof req.query.dynamicOperator === "string" && ["eq", "neq", "gt", "gte", "lt", "lte"].includes(req.query.dynamicOperator) ? req.query.dynamicOperator as "eq" | "neq" | "gt" | "gte" | "lt" | "lte" : undefined,
      dynamicValue: typeof req.query.dynamicValue === "string" ? req.query.dynamicValue : undefined,
    });
  }));

  app.post("/api/finance/portfolio-analytics", async (req, res) => {
    const parsed = portfolioAnalyticsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    try {
      const positions = parsed.data.positions.map((position) => ({
        symbol: position.symbol.toUpperCase(),
        shares: position.shares,
        avgCost: position.avgCost,
      }));
      const symbols: string[] = Array.from(new Set(positions.map((position) => position.symbol)));
      auditLog("portfolio_analytics_request", { positionCount: positions.length, symbols });
      const historyEntries = await Promise.all(symbols.map(async (symbol) => ([
        symbol,
        (await getOHLCV(symbol, "1Y", "1d")).map((point) => ({ date: point.date, close: point.close })),
      ] as const)));
      const benchmark = (await getOHLCV("SPY", "1Y", "1d")).map((point) => ({ date: point.date, close: point.close }));

      res.json(calculatePortfolioAnalytics({
        positions,
        histories: Object.fromEntries(historyEntries),
        benchmark,
      }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown portfolio analytics error";
      res.status(502).json({ error: detail });
    }
  });

  // ─── Watchlist ─────────────────────────────────────────────────────────────
  // ─── Watchlist ─────────────────────────────────────────────────────────────
  app.get("/api/watchlist", async (req, res) => {
    const items = await storage.getWatchlist(req.user!.id);
    res.json(items);
  });

  app.post("/api/watchlist", async (req, res) => {
    const parsed = insertWatchlistItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const item = await storage.addWatchlistItem(req.user!.id, parsed.data);
    res.json(item);
  });

  app.delete("/api/watchlist/:id", async (req, res) => {
    await storage.removeWatchlistItem(req.user!.id, Number(req.params.id));
    res.json({ ok: true });
  });

  // ─── Alerts ────────────────────────────────────────────────────────────────
  app.get("/api/alerts", async (req, res) => {
    const items = await storage.getAlerts(req.user!.id);
    items.sort((a, b) => {
      if (a.triggered !== b.triggered) return Number(a.triggered) - Number(b.triggered);
      const left = a.triggeredAt ?? a.createdAt;
      const right = b.triggeredAt ?? b.createdAt;
      return +new Date(right) - +new Date(left);
    });
    res.json(items);
  });

  app.post("/api/alerts", async (req, res) => {
    const parsed = insertAlertSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const alert = await storage.addAlert(req.user!.id, parsed.data);
    auditLog("alert_created", { id: alert.id, symbol: alert.symbol, condition: alert.condition, price: alert.price });
    res.json(alert);
  });

  app.post("/api/alerts/nlp", async (req, res) => {
    const { text } = req.body as { text: string };
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Text prompt is required" });
    }

    const symbolMatch = text.match(/\b([A-Z0-9.\-=]{2,12})\b/);
    const priceMatch = text.match(/(?:\$|₹|¥|HK\$)?\s*(\d+(?:\.\d+)?)/);

    if (!symbolMatch) {
      return res.status(400).json({ error: "Could not identify symbol in prompt" });
    }
    if (!priceMatch) {
      return res.status(400).json({ error: "Could not identify target price in prompt" });
    }

    const symbol = symbolMatch[1];
    const price = parseFloat(priceMatch[1]);
    const lower = text.toLowerCase();
    let condition: "above" | "below" = "above";
    if (lower.includes("below") || lower.includes("drops") || lower.includes("less") || lower.includes("down") || lower.includes("falls")) {
      condition = "below";
    }

    try {
      const alert = await storage.addAlert(req.user!.id, { symbol, condition, price });
      auditLog("alert_created_nlp", { id: alert.id, symbol, condition, price });
      res.json(alert);
    } catch (error) {
      res.status(500).json({ error: "Failed to create alert from prompt" });
    }
  });

  app.delete("/api/alerts/:id", async (req, res) => {
    const id = Number(req.params.id);
    await storage.deleteAlert(req.user!.id, id);
    auditLog("alert_deleted", { id });
    res.json({ ok: true });
  });

  // ─── Chat (AI Agent) ───────────────────────────────────────────────────────
  app.get("/api/chat", async (req, res) => {
    const msgs = await storage.getChatMessages(req.user!.id);
    res.json(msgs);
  });

  app.post("/api/chat", async (req, res) => {
    const { message, magnetization, orderIntensity } = req.body as { message: string; magnetization?: number; orderIntensity?: number };
    if (!message?.trim()) {
      return res.status(400).json({ error: "Message required" });
    }

    // Master AI is a product-wide preference. Chat and Brain share this gate;
    // deterministic Workbench engines stay available when the switch is off.
    if (await rejectIfMasterAiOff(req, res)) return;

    await storage.addChatMessage(req.user!.id, { role: "user", content: message });
    await appendMemory({ ts: new Date().toISOString(), role: "user", content: message });
    auditLog("chat_user_message", { messageLength: message.length });

    const intent = classifyAskLiosIntent(message);
    if (intent.kind === "compute") {
      const fullContent = formatAskLiosDelegation(intent);
      await storage.addChatMessage(req.user!.id, { role: "assistant", content: fullContent });
      await appendMemory({ ts: new Date().toISOString(), role: "assistant", content: fullContent });
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(`data: ${JSON.stringify({ text: fullContent })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }
    if (intent.kind === "resolve") {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      try {
        const result = await resolvePersistedInstrument({ ticker: intent.ticker });
        const match = result.match;
        const fullContent = match
          ? `Ask LiOS resolved ${intent.ticker} through the Global Instrument Master.\nEntity: ${match.entityId ?? "unknown"}\nListing: ${match.listingId ?? "unknown"}\nCanonical: ${match.canonical ? "yes" : "no"}\n<<NAVIGATE: ${intent.ticker}, quote>>`
          : `Ask LiOS could not resolve ${intent.ticker} in the Global Instrument Master. No identity was invented.`;
        await storage.addChatMessage(req.user!.id, { role: "assistant", content: fullContent });
        res.write(`data: ${JSON.stringify({ text: fullContent })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        return res.end();
      } catch (error) {
        const fullContent = `Instrument resolver is unavailable: ${error instanceof Error ? error.message : "unknown error"}. No identity was invented.`;
        await storage.addChatMessage(req.user!.id, { role: "assistant", content: fullContent });
        res.write(`data: ${JSON.stringify({ text: fullContent })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        return res.end();
      }
    }

    const history = await storage.getChatMessages(req.user!.id);
    const claudeMessages = history
      .slice(-20)
      .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let fullContent = "";

    try {
      const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      let systemPrompt = `${ASK_LIOS_SYSTEM_PREAMBLE}

You are embedded in the LiOS Intelligence Terminal. You support market/data analysis. You have deep expertise in:
- Equity markets, fixed income, commodities, FX, crypto
- Technical analysis: RSI, MACD, Bollinger Bands, moving averages, support/resistance levels
- Fundamental analysis: P/E, EV/EBITDA, DCF valuation, earnings quality, margin analysis
- Macro economics: Fed policy, yield curves, inflation dynamics, GDP, labor markets
- Market microstructure, order flow, liquidity, options flows

When a colleague is working on a client deliverable specifically, you have three more jobs -- each about interrogating and drafting, never calculating:
- Citation checks: when a fact or figure is stated, ask what source and date back it; flag anything asserted without one.
- Evidence-gap flagging: read a draft or argument and name what claim in it isn't yet backed by data available on the Terminal.
- Drafting help: turn rough notes into client-ready prose in Limuria's voice -- direct, data-grounded, no hedging filler.

Limuria's deterministic quant engines are the source of truth for every number -- you never invent a figure, a source, or a calculation result yourself. Your job is to interrogate and draft around numbers that already exist on the Terminal, not to produce new ones. Respond precisely and directly, data-oriented, terminal-style formatting with tables and bullets where useful. Format numbers properly: $1.2B, 4.5%, 120bps. Be concise and actionable. Current date: ${today}.

You can control the client's terminal workspace by appending navigation commands at the end of your response:
- To change the active stock/symbol: <<NAVIGATE: SYMBOL>> (e.g. <<NAVIGATE: RELIANCE.NS>>)
- To switch panels: <<NAVIGATE: VIEW_MODE>> (e.g. <<NAVIGATE: valuation>>)
- To update both: <<NAVIGATE: SYMBOL, VIEW_MODE>> (e.g. <<NAVIGATE: AAPL, options>>)
Available VIEW_MODE choices: market, quote, chart, news, agent, screener, watchlist, alerts, economics, portfolio, ising, optimizer, valuation, fixedincome, fractal, risknetwork, filingintel, sentiment, macrostress.`;

      systemPrompt += await getMemoryContext();

      if (typeof magnetization === "number") {
        systemPrompt += `\n\n[TRADER SOCIAL CONTAGION HERD STATE (ISING CONSENSUS): ${magnetization.toFixed(2)}]`;
      }
      if (typeof orderIntensity === "number") {
        systemPrompt += `\n[HIGH-FREQUENCY TRADING ORDER ARRIVAL INTENSITY: ${orderIntensity.toFixed(1)}x baseline]`;
      }

      const aiSetup = await getEnvironmentSetupForUser(req.user!.id);
      const result = await invokeAIRoutedCompletion({
        system: systemPrompt,
        messages: claudeMessages,
        maxTokens: 1024,
        preferredProvider: aiSetup?.aiProviderId,
        preferredModel: aiSetup?.aiModelId,
      });
      const provider = result.attribution.provider;
      fullContent = result.text;
      res.write(`data: ${JSON.stringify({ text: fullContent })}\n\n`);

      await storage.addChatMessage(req.user!.id, { role: "assistant", content: fullContent });
      await appendMemory({ ts: new Date().toISOString(), role: "assistant", content: fullContent });
      auditLog("chat_assistant_message", { contentLength: fullContent.length, provider });
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    } catch (err) {
      console.warn("All AI providers failed, executing local superpower fallback engine:", err);
      const cleanMsg = message.toUpperCase();
      let matchedSymbol = "AAPL";

      const DEGRADED_NOTICE = "> ⚠️ **AI analysis engine offline** — all configured AI providers are unreachable right now, so this is a degraded local fallback. Figures above are live market data; anything requiring AI-assisted modeling is unavailable until a provider is back online.";

      const symbols = [
        "AAPL", "MSFT", "NVDA", "TSLA", "GOOGL", "AMZN", "META", "BRK-B",
        "JPM", "BAC", "GS", "MS", "V", "MA", "PYPL", "XOM", "CVX", "COP", "SLB",
        "UNH", "JNJ", "PFE", "KO", "PEP", "WMT", "HD", "DIS", "NFLX", "CRM",
        "ADBE", "AMD", "INTC", "QCOM", "TXN", "AVGO", "MU", "AMAT", "ASML",
        "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
        "SBIN.NS", "TATAMOTORS.NS", "BHARTIARTL.NS", "LT.NS", "ITC.NS",
        "7203.T", "9984.T", "6758.T", "3690.HK", "0700.HK", "9988.HK",
        "BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD"
      ];

      // Exact-token match on word boundaries -- a plain .includes() substring
      // check previously matched e.g. the ticker "V" against any message
      // containing the letter sequence "V" (like the word "DELIVERABLE"),
      // firing a completely unrelated Visa response.
      const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      for (const sym of symbols) {
        const baseSym = sym.split(".")[0].split("-")[0];
        const symPattern = new RegExp(`\\b${escapeRegex(sym)}\\b`);
        const basePattern = new RegExp(`\\b${escapeRegex(baseSym)}\\b`);
        if (symPattern.test(cleanMsg) || basePattern.test(cleanMsg)) {
          matchedSymbol = sym;
          break;
        }
      }

      let viewMode: string | null = null;
      if (cleanMsg.match(/\b(CHART|GRAPH|PLOT|GP)\b/)) viewMode = "chart";
      else if (cleanMsg.match(/\b(DCF|LBO|DUPONT|VALUE|VALUATION|INSOLVENCY|ALTMAN|Z-SCORE)\b/)) viewMode = "valuation";
      else if (cleanMsg.match(/\b(MONTE|CARLO|SIMULATION|SIMULATE|MCST)\b/)) viewMode = "montecarlo";
      else if (cleanMsg.match(/\b(OPTION|OPTIONS|BLACK|SCHOLES|STRIKE|CALL|PUT|OPCV)\b/)) viewMode = "options";
      else if (cleanMsg.match(/\b(FILING|FILINGS|PATTERN|PATTERNS|10-K|10-Q)\b/)) viewMode = "filingintel";
      else if (cleanMsg.match(/\b(FRACTAL|CHAOS|GARCH|FORECAST)\b/)) viewMode = "fractal";
      else if (cleanMsg.match(/\b(QUANTUM|TUNNEL|BARRIER)\b/)) viewMode = "quantum";
      else if (cleanMsg.match(/\b(FX|FOREX|CURRENCY|CURRENCIES)\b/)) viewMode = "forex";
      else if (cleanMsg.match(/\b(NEWS|HEADLINE|HEADLINES)\b/)) viewMode = "news";
      else if (cleanMsg.match(/\b(SCREENER|EQS)\b/)) viewMode = "screener";
      else if (cleanMsg.match(/\b(WATCHLIST|WLT)\b/)) viewMode = "watchlist";
      else if (cleanMsg.match(/\b(ALERT|ALERTS|MON)\b/)) viewMode = "alerts";
      else if (cleanMsg.match(/\b(ECONOMIC|ECONOMICS|ECST|MACRO|FED|RATES|INFLATION)\b/)) viewMode = "economics";
      else if (cleanMsg.match(/\b(PORTFOLIO|PRTU|HOLDINGS)\b/)) viewMode = "portfolio";
      else if (cleanMsg.match(/\b(CORRELATION|MATRIX|CORR)\b/)) viewMode = "correlation";
      else if (cleanMsg.match(/\b(ISING|HERD|MAGNET)\b/)) viewMode = "ising";
      else if (cleanMsg.match(/\b(OPTIMIZER|OPTIMIZE|OPTZ)\b/)) viewMode = "optimizer";
      else if (cleanMsg.match(/\b(FIXED|INCOME|SOVEREIGN|YIELD|YILD)\b/)) viewMode = "fixedincome";
      else if (cleanMsg.match(/\b(RISK|SPILLOVER|NETWORK)\b/)) viewMode = "risknetwork";
      else if (cleanMsg.match(/\b(HAWKES|POINT|EXCITE)\b/)) viewMode = "hawkes";
      else if (cleanMsg.match(/\b(ENTROPY|SHANNON|LEAD)\b/)) viewMode = "entropy";
      else if (cleanMsg.match(/\b(FLOW|SYNTHESIS)\b/)) viewMode = "flow";
      else if (cleanMsg.match(/\b(SENTIMENT|SENT|FEAR|GREED|FNG|FEAR.GREED)\b/)) viewMode = "sentiment";
      else if (cleanMsg.match(/\b(STRESS|STRS|SCENARIO|SHOCK|CRISIS|CRASH|RECESSION)\b/)) viewMode = "macrostress";

      let msg = "";
      try {
        const quotes = await getQuotes([matchedSymbol]);
        const quote = quotes.find((q) => q.symbol === matchedSymbol);
        
        if (quote) {
          const sign = quote.change >= 0 ? "+" : "";
          const currency = quote.symbol.includes(".NS") ? "₹" : quote.symbol.includes(".T") ? "¥" : quote.symbol.includes(".HK") ? "HK$" : "$";
          const mc = quote.marketCap ? `${(quote.marketCap / 1e9).toFixed(1)}B` : "N/A";
          
          if (viewMode === "chart") {
            let rsiText = "N/A (insufficient price history)";
            let macdText = "N/A (insufficient price history)";
            let supportResistanceText = "N/A (insufficient price history)";
            try {
              const bars = await getOHLCV(matchedSymbol, "6M", "1d");
              const closes = bars.map((b) => b.close);
              const rsi = calculateRSI(closes);
              if (rsi !== null) {
                const rsiLabel = rsi >= 70 ? "Overbought" : rsi <= 30 ? "Oversold" : "Neutral";
                rsiText = `${rsi.toFixed(1)} (${rsiLabel} momentum)`;
              }
              const macd = calculateMACDCrossover(closes);
              if (macd) {
                const histText = `${macd.histogram >= 0 ? "+" : ""}${macd.histogram.toFixed(2)}`;
                macdText = macd.crossover === "bullish"
                  ? `Bullish crossover (histogram ${histText})`
                  : macd.crossover === "bearish"
                  ? `Bearish crossover (histogram ${histText})`
                  : `No active crossover (histogram ${histText})`;
              }
              if (bars.length >= 5) {
                const recent = bars.slice(-20);
                const recentLow = Math.min(...recent.map((b) => b.low));
                const recentHigh = Math.max(...recent.map((b) => b.high));
                supportResistanceText = `Support near ${currency}${recentLow.toFixed(2)} (${recent.length}-day low), Resistance near ${currency}${recentHigh.toFixed(2)} (${recent.length}-day high)`;
              }
            } catch (e) {
              console.error("Local engine OHLCV fetch failure:", e);
            }
            msg = `### 📈 TECHNICAL ANALYSIS DESK: ${quote.symbol} (${quote.name})
- **Current Spot**: ${currency}${quote.price} (${sign}${quote.changePercent}%)
- **52-Week Range**: ${currency}${quote.low52} - ${currency}${quote.high52}
- **Volume / Avg**: ${(quote.volume / 1e6).toFixed(1)}M / ${(quote.avgVolume / 1e6).toFixed(1)}M
- **Signal Indicators** (computed from live daily price history):
  * **RSI (14)**: ${rsiText}
  * **MACD (12,26,9)**: ${macdText}
  * **Support / Resistance**: ${supportResistanceText}

<<NAVIGATE: ${quote.symbol}, chart>>`;
          } else if (viewMode === "valuation") {
            const revenueText = quote.revenue ? `${currency}${(quote.revenue / 1e9).toFixed(2)}B` : "N/A";
            msg = `### 📊 VALUATION ANALYSIS DESK: ${quote.symbol} (${quote.name})
- **Exchange / Sector**: ${quote.exchange} / ${quote.sector ?? "N/A"}
- **Market Capitalization**: ${currency}${mc}
- **Trailing P/E**: ${quote.pe ?? "N/A"}x | **Earnings Per Share (EPS)**: ${currency}${quote.eps ?? "N/A"}
- **Revenue (TTM)**: ${revenueText}

${DEGRADED_NOTICE} DCF/DuPont model outputs require AI-assisted modeling and are not shown here.

<<NAVIGATE: ${quote.symbol}, valuation>>`;
          } else if (viewMode === "options") {
            msg = `### 🧪 OPTIONS DESK: ${quote.symbol} (${quote.name})
- **Spot Price**: ${currency}${quote.price} (${sign}${quote.changePercent}%)

${DEGRADED_NOTICE} Option chain pricing, implied volatility, and Greeks require live options market data plus AI-assisted modeling, neither of which is available in this fallback mode.

<<NAVIGATE: ${quote.symbol}, options>>`;
          } else if (viewMode === "risknetwork") {
            msg = `### 🕸️ RISK SPILLOVER NETWORK: ${quote.symbol} (${quote.name})
- **Current Spot**: ${currency}${quote.price} (${sign}${quote.changePercent}%)

${DEGRADED_NOTICE} Cross-asset correlation and VaR spillover analysis require AI-assisted modeling and are not shown here.

<<NAVIGATE: ${quote.symbol}, risknetwork>>`;
          } else if (viewMode === "montecarlo") {
            let volText = "N/A (insufficient price history)";
            try {
              const bars = await getOHLCV(matchedSymbol, "1Y", "1d");
              const closes = bars.map((b) => b.close);
              if (closes.length >= 30) {
                const logReturns: number[] = [];
                for (let i = 1; i < closes.length; i++) logReturns.push(Math.log(closes[i] / closes[i - 1]));
                const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
                const variance = logReturns.reduce((a, r) => a + (r - mean) ** 2, 0) / (logReturns.length - 1);
                const annualVol = Math.sqrt(variance * 252);
                volText = `${(annualVol * 100).toFixed(1)}% (realized, trailing ${Math.round(closes.length / 21)}mo)`;
              }
            } catch (e) {
              console.error("Local engine OHLCV fetch failure:", e);
            }
            msg = `### 🎲 MONTE CARLO PROBABILITY DESK: ${quote.symbol} (${quote.name})
- **Current Price**: ${currency}${quote.price}
- **Realized Volatility (Ann.)**: ${volText}

${DEGRADED_NOTICE} Simulated price-path projections require AI-assisted modeling and are not shown here.

<<NAVIGATE: ${quote.symbol}, montecarlo>>`;
          } else if (viewMode) {
            msg = `### 💻 REDIRECTING TO PANEL: ${viewMode.toUpperCase()} FOR ${quote.symbol}
Loading active datasets for ${quote.name}...

<<NAVIGATE: ${quote.symbol}, ${viewMode}>>`;
          } else {
            msg = `### 📋 DESK DESCRIPTION: ${quote.symbol} (${quote.name})
- **Exchange / Sector**: ${quote.exchange} / ${quote.sector ?? "N/A"}
- **Price**: ${currency}${quote.price} (${sign}${quote.changePercent}%)
- **Market Cap**: ${currency}${mc}
- **52-Week Range**: ${currency}${quote.low52} - ${currency}${quote.high52}

Use commands like "chart ${quote.symbol}", "dcf ${quote.symbol}", or "options ${quote.symbol}" to run deep-dives.

<<NAVIGATE: ${quote.symbol}, quote>>`;
          }
        }
      } catch (e) {
        console.error("Local engine quote fetch failure:", e);
      }

      if (!msg) {
        if (viewMode === "economics") {
          msg = `### 🏛️ MACROECONOMIC WATCH: POLICY DESK

${DEGRADED_NOTICE} Live macro figures (Fed funds rate, CPI, payrolls, GDP, yield-curve spread) require an AI provider and are not shown here — open the Economics panel directly for the latest connected data.

<<NAVIGATE: economics>>`;
        } else if (viewMode === "heatmap") {
          let moversText = "Movers unavailable (data fetch failed).";
          try {
            const [gainers, losers] = await Promise.all([
              getMarketMovers("gainers", "US"),
              getMarketMovers("losers", "US"),
            ]);
            const topGainer = gainers[0];
            const topLoser = losers[0];
            if (topGainer && topLoser) {
              moversText = `**Top Advancer**: ${topGainer.symbol} (${topGainer.changePercent >= 0 ? "+" : ""}${topGainer.changePercent.toFixed(1)}%)\n- **Top Decliner**: ${topLoser.symbol} (${topLoser.changePercent.toFixed(1)}%)`;
            }
          } catch (e) {
            console.error("Local engine market movers fetch failure:", e);
          }
          msg = `### 🗺️ GLOBAL HEAT MAP PANEL
- ${moversText}

<<NAVIGATE: heatmap>>`;
        } else if (viewMode) {
          msg = `### 💻 LOADING PANEL: ${viewMode.toUpperCase()}
Navigating terminal desk to requested pane.

<<NAVIGATE: ${viewMode}>>`;
        } else {
          if (cleanMsg.includes("YIELD CURVE")) {
            msg = `### 🏛️ MACRO OUTLOOK: YIELD CURVE INVERSION
A yield curve inversion occurs when short-term interest rates exceed long-term rates. Historically, a sustained inversion of the 10Y-2Y spread is a highly reliable recession indicator, preceding economic downturns by 12-18 months.

${DEGRADED_NOTICE} The current spread reading requires an AI provider and is not shown here — open the Economics panel directly for the latest connected data.

<<NAVIGATE: economics>>`;
          } else if (cleanMsg.includes("VIX")) {
            msg = `### 📉 CBOE VOLATILITY INDEX (VIX) ANALYSIS
The VIX measures implied volatility of S&P 500 options over the next 30 days. 
* VIX > 25 indicates high uncertainty, suggesting rising hedging demand and downside risk.
* VIX < 15 signals complacency or broad stability.

<<NAVIGATE: market>>`;
          } else {
            msg = `### 💻 LIMURIA TERMINAL ASSISTANT
Welcome to the Limuria Intelligence Terminal command engine. I can help you analyze assets, check valuations, and simulate portfolios.

**Try asking me**:
* "Chart NVDA" or "Analyze reliance"
* "DCF Apple" or "Simulate TSLA"
* "Explain yield curve" or "Show macroeconomic status"

<<NAVIGATE: market>>`;
          }
        }
      }

      await storage.addChatMessage(req.user!.id, { role: "assistant", content: msg });
      await appendMemory({ ts: new Date().toISOString(), role: "assistant", content: msg });
      auditLog("chat_assistant_fallback_message", { contentLength: msg.length });
      res.write(`data: ${JSON.stringify({ text: msg, done: true })}\n\n`);
    }

    res.end();
  });

  app.delete("/api/chat", async (req, res) => {
    await storage.clearChatMessages(req.user!.id);
    res.json({ ok: true });
  });

  // ─── Authentication ─────────────────────────────────────────────────────
  // Real session-based login lives in auth.ts (registerAuthRoutes), wired up
  // in index.ts alongside the session/passport middleware. The old hardcoded
  // email allowlist and public 5-minute trial system are gone -- every
  // account is now a real row in the users table with a real password.

  // ─── Stock Universe Autocomplete Search ────────────────────────────────────
  let tickersList: Array<{ symbol: string; name: string; exchange: string; sector: string; assetClass?: string; region?: string; isPrimaryListing?: boolean }> = [];
  try {
    const resourcesBase = (process as { resourcesPath?: string }).resourcesPath || process.env.ELECTRON_RESOURCES_PATH;
    const dataPath = resourcesBase
      ? path.resolve(resourcesBase, "server", "data", "tickers.json")
      : path.resolve(process.cwd(), "server", "data", "tickers.json");
    if (fs.existsSync(dataPath)) {
      tickersList = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    }
    const mutualFunds = [
      { symbol: "VFIAX", name: "Vanguard 500 Index Fund Admiral", exchange: "NASDAQ", sector: "Blended Large Cap", assetClass: "mutual_fund", region: "US" },
      { symbol: "FCNTX", name: "Fidelity Contrafund", exchange: "NYSE", sector: "Growth Large Cap", assetClass: "mutual_fund", region: "US" },
      { symbol: "PONAX", name: "PIMCO Income Fund Class A", exchange: "NYSE", sector: "Fixed Income Bond", assetClass: "mutual_fund", region: "US" },
      { symbol: "0P0000XWAI.BO", name: "SBI Bluechip Fund Direct Growth", exchange: "BSE", sector: "Equity Large Cap", assetClass: "mutual_fund", region: "IN" },
      { symbol: "0P0000XW4Y.BO", name: "HDFC Top 100 Mutual Fund Growth", exchange: "BSE", sector: "Equity Large Cap", assetClass: "mutual_fund", region: "IN" },
      { symbol: "0P0000XVZE.BO", name: "Nippon India Growth Fund Direct Growth", exchange: "BSE", sector: "Equity Mid Cap", assetClass: "mutual_fund", region: "IN" },
      { symbol: "0P0000Y1S2.T", name: "Nomura Morningstar Index Fund", exchange: "TSE", sector: "Index Blend", assetClass: "mutual_fund", region: "JP" },
      { symbol: "0P00018G8I.T", name: "Nikko AM World Equity Fund", exchange: "TSE", sector: "Global Equity", assetClass: "mutual_fund", region: "JP" },
      { symbol: "0P0000Y2B0.HK", name: "Hang Seng Index Fund Class A", exchange: "HKEX", sector: "Index Blend", assetClass: "mutual_fund", region: "HK" },
      { symbol: "0P0001LUX8.HK", name: "HSBC Hang Seng Tech Index Fund", exchange: "HKEX", sector: "Technology Sector", assetClass: "mutual_fund", region: "HK" },
      { symbol: "0P0000KSP2.L", name: "Vanguard FTSE U.K. All Share Index", exchange: "LSE", sector: "UK Equity Blend", assetClass: "mutual_fund", region: "UK" },
      { symbol: "0P00000B2H.L", name: "BlackRock World Gold Fund Class A", exchange: "LSE", sector: "Precious Metals", assetClass: "mutual_fund", region: "UK" },
      { symbol: "0P000071C6.TO", name: "RBC Select Balanced Fund Class A", exchange: "TSX", sector: "Multi-Asset Balanced", assetClass: "mutual_fund", region: "CA" },
      { symbol: "0P0000720O.TO", name: "TD Comfort Balanced Portfolio Class A", exchange: "TSX", sector: "Multi-Asset Balanced", assetClass: "mutual_fund", region: "CA" },
      { symbol: "0P0000W82O.AX", name: "Vanguard Balanced Index Fund", exchange: "ASX", sector: "Multi-Asset Balanced", assetClass: "mutual_fund", region: "AU" },
      { symbol: "0P00000B1A.DE", name: "DWS Deutschland Fund", exchange: "XETRA", sector: "German Equity", assetClass: "mutual_fund", region: "DE" },
      { symbol: "0P00000AWG.PA", name: "Amundi Funds - European Equity", exchange: "Euronext", sector: "European Equity", assetClass: "mutual_fund", region: "FR" },
      { symbol: "0P0000Y7P7.TW", name: "Yuanta Taiwan Top 50 ETF Mutual Fund", exchange: "TWSE", sector: "Index Blend", assetClass: "mutual_fund", region: "TW" },
      { symbol: "0P0000YD7L.KS", name: "Samsung KODEX 200 Mutual Fund", exchange: "KRX", sector: "Index Blend", assetClass: "mutual_fund", region: "KR" },
      { symbol: "0P0000UGX8.SA", name: "Itaú ETF Ibovespa Mutual Fund", exchange: "B3", sector: "Index Blend", assetClass: "mutual_fund", region: "BR" },
      { symbol: "0P0000UYP5.KL", name: "Public Ittikal Fund (Malaysia)", exchange: "Bursa", sector: "Islamic Equity", assetClass: "mutual_fund", region: "MY" }
    ];
    tickersList.push(...mutualFunds);

    // Converge the Screener on the canonical provider-aware universe. The
    // Directory Screener previously read only tickers.json, entirely
    // bypassing provider-ingested rows (server/data/provider_ingested_universe.json,
    // real SEC EDGAR/NASDAQ Trader/CoinGecko data -- see
    // instrumentUniverseIngestion.ts) even though the search-box path
    // (instrumentSearchIndexStore.ts) already included them. Read raw
    // here (not through providerIngestedCatalog.ts's InstrumentMasterCandidate
    // adapter) because assetClass/sector -- fields this screener's filter
    // UI depends on -- have no equivalent on InstrumentMasterCandidate;
    // asset class is inferred honestly from each row's real originating
    // source (CoinGecko rows are genuinely crypto; SEC/NASDAQ rows are
    // genuinely equities -- neither ingestion path pulls bonds/derivatives
    // today), not fabricated.
    const ingestedPath = providerIngestedUniversePath();
    if (fs.existsSync(ingestedPath)) {
      const ingestedRows = JSON.parse(fs.readFileSync(ingestedPath, "utf8")) as Array<{
        symbol: string; name?: string | null; exchange?: string | null; countryCode?: string | null; provider?: string | null; active?: boolean;
      }>;
      for (const row of ingestedRows) {
        if (row.active === false) continue;
        tickersList.push({
          symbol: row.symbol,
          name: row.name || row.symbol,
          exchange: row.exchange || "UNKNOWN",
          sector: "",
          assetClass: row.exchange === "CRYPTO" ? "crypto" : "equity",
          region: row.countryCode || undefined,
          isPrimaryListing: false,
        });
      }
      console.log(`Directory: merged ${ingestedRows.length} provider-ingested rows into the ${tickersList.length}-row directory.`);
    }
  } catch (err) {
    console.error("Failed to load tickers.json directory file:", err);
  }

  app.get("/api/finance/directory", (req, res) => {
    const exchange = String(req.query.exchange || "").trim().toUpperCase();
    const search = String(req.query.q || "").trim().toLowerCase();
    const sector = String(req.query.sector || "").trim().toLowerCase();
    const assetClass = String(req.query.assetClass || "").trim().toLowerCase();
    const region = String(req.query.region || "").trim().toUpperCase();
    const primaryListingOnly = String(req.query.primaryListingOnly || "").trim().toLowerCase() === "true";
    const page = Math.max(1, parseInt(String(req.query.page || "1")));
    const limit = 20;

    let filtered = tickersList;
    if (exchange) {
      if (exchange === "US") {
        filtered = filtered.filter(item => item.exchange === "NASDAQ" || item.exchange === "NYSE");
      } else {
        filtered = filtered.filter(item => item.exchange.toUpperCase() === exchange);
      }
    }
    if (sector && sector !== "all") {
      filtered = filtered.filter(item => (item.sector || "").toLowerCase() === sector);
    }
    if (assetClass && assetClass !== "all") {
      filtered = filtered.filter(item => (item.assetClass || "equity").toLowerCase() === assetClass);
    }
    if (region && region !== "ALL") {
      filtered = filtered.filter(item => (item.region || "").toUpperCase() === region);
    }
    // The bundled legacy directory predates canonical listing IDs and does
    // not tag most rows. Preserve those rows for compatibility; when a
    // provider supplies an explicit flag, primary-only mode excludes the
    // known secondary listings without inventing identity data.
    if (primaryListingOnly) {
      filtered = filtered.filter(item => item.isPrimaryListing !== false);
    }
    if (search) {
      filtered = filtered.filter(item => 
        item.symbol.toLowerCase().includes(search) || 
        item.name.toLowerCase().includes(search) || 
        (item.sector || "").toLowerCase().includes(search)
      );
    }

    const total = filtered.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const items = filtered.slice(startIndex, endIndex);

    res.json({
      items,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  });

  // Distinct region/country codes present in the ticker directory -- powers
  // the Country Screener's dropdown without shipping the full 80k+-row list
  // (legacy catalog + provider-ingested rows, see the tickersList
  // population above).
  app.get("/api/finance/directory/regions", (_req, res) => {
    const regions = Array.from(new Set(tickersList.map(t => t.region).filter((r): r is string => !!r))).sort();
    res.json(regions);
  });

  // Ground-truth coverage map -- what's actually covered per region across
  // quotes/history/statements/corporate-actions, so a user can tell before
  // they hit a gap rather than after. See server/dataCoverageRegistry.ts.
  app.get("/api/finance/coverage-map", (_req, res) => {
    res.json(getCoverageMap());
  });

  app.get("/api/finance/provider-status", async (_req, res) => {
    res.json(await getProviderStatuses());
  });

  // Canonical identity lookup. Consumers can pass a bare ticker, an
  // exchange-qualified ticker (AAPL@NASDAQ), or a durable identifier such as
  // CIK:0000320193. Ambiguous bare tickers are returned as candidates rather
  // than arbitrarily resolving to the wrong listing.
  app.get("/api/finance/entities/resolve", async (req, res) => {
    const query = String(req.query.q || "");
    if (!query.trim()) return res.status(400).json({ error: "q is required" });
    try {
      const entity = await resolveEntity(query);
      return entity ? res.json(entity) : res.status(404).json({ error: "Entity not found" });
    } catch (err) {
      console.error("Entity resolution failed:", err);
      return res.status(500).json({ error: "Entity resolution unavailable" });
    }
  });

  app.get("/api/finance/search", (req, res) => {
    const query = String(req.query.q || "").trim().toUpperCase();
    if (!query) {
      return res.json([]);
    }

    const queryLower = query.toLowerCase();
    const exactMatches: typeof tickersList = [];
    const prefixMatches: typeof tickersList = [];
    const categoryMatches: typeof tickersList = [];
    const nameMatches: typeof tickersList = [];

    for (const item of tickersList) {
      const symUpper = item.symbol.toUpperCase();
      const assetClassLower = (item.assetClass || "").toLowerCase();
      
      if (symUpper === query) {
        exactMatches.push(item);
      } else if (symUpper.startsWith(query)) {
        prefixMatches.push(item);
      } else if (assetClassLower === queryLower) {
        categoryMatches.push(item);
      } else if (
        item.name.toLowerCase().includes(queryLower) ||
        (item.sector || "").toLowerCase().includes(queryLower)
      ) {
        nameMatches.push(item);
      }
    }

    const merged = [...exactMatches, ...prefixMatches, ...categoryMatches, ...nameMatches].slice(0, 15);
    res.json(merged);
  });

  app.get("/api/finance/premarket-brief", async (_req, res) => {
    try {
      // Same state directory the writer in server/index.ts uses (see dataRoot.ts).
      const briefFile = path.join(stateDir(), "premarket-brief.json");
      if (fs.existsSync(briefFile)) {
        res.json(JSON.parse(fs.readFileSync(briefFile, "utf8")));
      } else {
        res.status(404).json({ error: "Premarket brief not generated yet" });
      }
    } catch (err) {
      res.status(500).json({ error: "Failed to read premarket brief" });
    }
  });

  app.post("/api/admin/generate-key", requireRole("internal_admin"), (_req, res) => {
    try {
      const newKey = generateKey();
      auditLog("admin_generate_key", { keyPreview: newKey.slice(0, 4) + "..." });
      res.json({ key: newKey });
    } catch (err) {
      res.status(500).json({ error: "Failed to generate API key" });
    }
  });
}
