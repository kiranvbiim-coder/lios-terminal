import { useQuery, useQueries } from "@tanstack/react-query";
import type { Quote, OHLCVSeries, NewsItem, NewsArticle, PortfolioAnalytics, PortfolioPositionInput, EconomicsSnapshot, EconomicCalendarEvent, EconomicEventDetail, DirectoryScreenResult, DirectoryEntry, CatalogScreenRow } from "./finance";
import { pickCatalogEntry } from "./referenceOnlyInstrument";
import { useLiveQuotes } from "./useWebSocket";
import { isObservedQuote, observedQuotes } from "./quoteObservation";

// Finance data hooks — all fetched from /api/finance/* proxy

export function useQuotes(symbols: string[]) {
  useLiveQuotes(symbols);
  return useQuery<Quote[]>({
    queryKey: ["/api/finance/quotes", symbols.join(",")],
    queryFn: async () => {
      if (!symbols.length) return [];
      const res = await fetch(`/api/finance/quotes?symbols=${symbols.join(",")}`);
      if (!res.ok) throw new Error("Failed to fetch quotes");
      return observedQuotes<Quote>(await res.json());
    },
    refetchInterval: 15000, // refresh every 15s
    staleTime: 10000,
    enabled: symbols.length > 0,
  });
}

export function useQuote(symbol: string) {
  useLiveQuotes(symbol ? [symbol] : []);
  return useQuery<Quote>({
    queryKey: ["/api/finance/quote", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/finance/quotes?symbols=${symbol}`);
      if (!res.ok) throw new Error("Failed to fetch quote");
      const data = await res.json();
      // An unobserved quote is "no data", never a zero price. null keeps the query resolved.
      const quote = Array.isArray(data) ? data[0] : data;
      return (isObservedQuote(quote) ? quote : null) as Quote;
    },
    refetchInterval: 10000,
    staleTime: 8000,
    enabled: !!symbol,
  });
}

// Same data as useQuote, but under a query key useLiveQuotes' WebSocket
// handler never writes to. useQuote's cache entry is intentionally kept
// "hot" by frequent narrow price-tick merges (symbol/price/change/
// changePercent only) for real-time ticking; a consumer that needs a
// stable full field like marketCap/pe/sector — which isn't in those ticks —
// can end up reading a cache entry that the REST fetch never gets a quiet
// window to fully populate. This hook sidesteps that by fetching into its
// own untouched cache slot.
export function useQuoteStatic(symbol: string) {
  return useQuery<Quote>({
    queryKey: ["/api/finance/quote-static", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/finance/quotes?symbols=${symbol}`);
      if (!res.ok) throw new Error("Failed to fetch quote");
      const data = await res.json();
      return data[0];
    },
    staleTime: 60000,
    enabled: !!symbol,
  });
}

export function useOHLCV(symbol: string, range: string = "1Y", interval: "5m" | "15m" | "1h" | "1d" = "1d") {
  return useQuery<OHLCVSeries>({
    queryKey: ["/api/finance/ohlcv", symbol, range, interval],
    queryFn: async () => {
      const params = new URLSearchParams({ symbol, range, interval });
      const res = await fetch(`/api/finance/ohlcv?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch OHLCV");
      return res.json();
    },
    staleTime: 60000,
    enabled: !!symbol,
  });
}

export interface Fundamentals {
  symbol: string;
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  trailingEps: number | null;
  forwardEps: number | null;
  priceToBook: number | null;
  dividendYield: number | null;
  beta: number | null;
  totalRevenue: number | null;
  profitMargins: number | null;
  revenueGrowth: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  sharesOutstanding: number | null;
  bookValue: number | null;
  returnOnEquity: number | null;
  debtToEquity: number | null;
  sector: string | null;
  industry: string | null;
  longName: string | null;
  currency: string | null;
}

// Live fundamentals (market cap, P/E, EPS, ...) via yfinance, server-cached
// for a day. Meant for single-symbol "calculation" panels, not bulk lists --
// see the route comment in server/routes.ts for why. Returns null (not an
// error) when the symbol has no fundamentals data, so callers can show an
// honest "no data" state instead of crashing on a missing field.
export function useFundamentals(symbol: string) {
  return useQuery<Fundamentals | null>({
    queryKey: ["/api/finance/fundamentals", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/finance/fundamentals?symbol=${encodeURIComponent(symbol)}`);
      if (!res.ok) throw new Error("Failed to fetch fundamentals");
      const data = await res.json();
      return data && !data.error ? data : null;
    },
    staleTime: 60 * 60 * 1000,
    enabled: !!symbol,
  });
}

// Multi-symbol variant for small, fixed-size comparison lists (Peer Comp,
// etc.) -- deliberately not used for large bulk views (Screener/Heatmap),
// where a per-symbol yfinance fetch for 50+ names would be too slow on a
// cold cache. Returns a symbol -> Fundamentals map, omitting any symbol that
// failed to resolve rather than padding the map with nulls.
export function useFundamentalsMany(symbols: string[]) {
  const results = useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: ["/api/finance/fundamentals", symbol],
      queryFn: async () => {
        const res = await fetch(`/api/finance/fundamentals?symbol=${encodeURIComponent(symbol)}`);
        if (!res.ok) throw new Error("Failed to fetch fundamentals");
        const data = await res.json();
        return data && !data.error ? (data as Fundamentals) : null;
      },
      staleTime: 60 * 60 * 1000,
      enabled: !!symbol,
    })),
  });
  const map = new Map<string, Fundamentals>();
  symbols.forEach((symbol, i) => {
    const data = results[i]?.data;
    if (data) map.set(symbol, data);
  });
  return { map, isLoading: results.some((r) => r.isLoading) };
}

export interface BreadthDailyPoint {
  date: string;
  advances: number;
  declines: number;
  unchanged: number;
  netAdvances: number;
  advanceDeclineLine: number;
  newHighs: number;
  newLows: number;
  mcClellanOscillator: number | null;
}

export interface MarketBreadthResult {
  universeSize: number;
  series: BreadthDailyPoint[];
  latest: {
    date: string;
    advances: number;
    declines: number;
    unchanged: number;
    newHighs: number;
    newLows: number;
    armsIndex: number | null;
    mcClellanOscillator: number | null;
  } | null;
  putCallRatio: null;
}

export function useMarketBreadth() {
  return useQuery<MarketBreadthResult>({
    queryKey: ["/api/finance/breadth"],
    queryFn: async () => {
      const res = await fetch("/api/finance/breadth");
      if (!res.ok) throw new Error("Failed to fetch market breadth");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useMarketSentiment() {
  return useQuery<{ sentiment: string; score: number; bullish: number; bearish: number }>({
    queryKey: ["/api/finance/sentiment"],
    queryFn: async () => {
      const res = await fetch("/api/finance/sentiment");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 30000,
    staleTime: 25000,
  });
}

export function useMarketGainers(region?: string) {
  const query = region ? `?region=${region}` : "";
  return useQuery<Quote[]>({
    queryKey: ["/api/finance/gainers", region],
    queryFn: async () => {
      const res = await fetch(`/api/finance/gainers${query}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 30000,
    staleTime: 25000,
  });
}

export function useMarketLosers(region?: string) {
  const query = region ? `?region=${region}` : "";
  return useQuery<Quote[]>({
    queryKey: ["/api/finance/losers", region],
    queryFn: async () => {
      const res = await fetch(`/api/finance/losers${query}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 30000,
    staleTime: 25000,
  });
}

export function useMostActive(region?: "US" | "IN" | "JP" | "HK") {
  const query = region ? `?region=${region}` : "";
  return useQuery<Quote[]>({
    queryKey: ["/api/finance/active", region],
    queryFn: async () => {
      const res = await fetch(`/api/finance/active${query}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 30000,
    staleTime: 25000,
  });
}


export function useNews(symbol?: string, query?: string) {
  return useQuery<NewsItem[]>({
    queryKey: ["/api/finance/news", symbol ?? "market", query ?? ""],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (symbol) params.set("symbol", symbol);
      if (query?.trim()) params.set("query", query.trim());
      const url = params.size ? `/api/finance/news?${params.toString()}` : "/api/finance/news";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 60000,
    staleTime: 55000,
  });
}

type NewsArticleRequest = Pick<NewsItem, "url" | "title" | "source" | "feedProvider" | "publishedAt" | "summary">;

export function buildNewsArticleParams(item: NewsArticleRequest) {
  const params = new URLSearchParams({
    url: item.url,
    title: item.title,
    source: item.source,
    publishedAt: item.publishedAt,
  });

  if (item.feedProvider) params.set("feedProvider", item.feedProvider);
  if (item.summary) params.set("summary", item.summary);

  return params;
}

export function useNewsArticle(item?: NewsArticleRequest | null) {
  return useQuery<NewsArticle>({
    queryKey: ["/api/finance/news/read", item?.url ?? "", item?.title ?? ""],
    queryFn: async () => {
      if (!item) throw new Error("Missing article");
      const params = buildNewsArticleParams(item);
      const res = await fetch(`/api/finance/news/read?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch article");
      return res.json();
    },
    // Fallback summaries are successfully delivered metadata, not successful
    // publisher extraction. Retry them sooner without refetching good articles.
    staleTime: query => query.state.data?.readThrough === "feed_summary" ? 30_000 : 5 * 60_000,
    enabled: Boolean(item?.url),
  });
}

export interface PremarketBrief {
  generatedAt: string;
  summary: string;
  macroStatus: EconomicsSnapshot | null;
  movers: Array<{ title: string; source: string; url: string }>;
  forexRate: Array<{ symbol: string; price: number | null; change: number | null; changePercent: number | null }>;
}

export function usePremarketBrief(refreshToken = 0) {
  return useQuery<PremarketBrief | null>({
    queryKey: ["/api/finance/premarket-brief", refreshToken],
    queryFn: async () => {
      const res = await fetch("/api/finance/premarket-brief");
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch premarket brief");
      return res.json();
    },
    staleTime: 60_000,
  });
}

export interface ClientPortfolioHolding {
  symbol: string;
  shares: number;
  avgCost: number;
  price: number | null;
  marketValue: number | null;
  sector: string;
}

export interface ClientPortfolio {
  id: number;
  name: string;
  positions: ClientPortfolioHolding[];
}

export function useClientPortfolios() {
  return useQuery<ClientPortfolio[]>({
    queryKey: ["/api/client/dashboard/portfolio"],
    queryFn: async () => {
      const res = await fetch("/api/client/dashboard/portfolio");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function usePortfolioAnalytics(positions: PortfolioPositionInput[]) {
  return useQuery<PortfolioAnalytics>({
    queryKey: ["/api/finance/portfolio-analytics", JSON.stringify(positions)],
    queryFn: async () => {
      const res = await fetch("/api/finance/portfolio-analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positions }),
      });
      if (!res.ok) throw new Error("Failed to fetch portfolio analytics");
      return res.json();
    },
    staleTime: 60_000,
    enabled: positions.length > 0,
  });
}

export function useEconomics() {
  return useQuery<EconomicsSnapshot>({
    queryKey: ["/api/finance/economics"],
    queryFn: async () => {
      const res = await fetch("/api/finance/economics");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 300000,
    staleTime: 250000,
  });
}

export function useEconomicCalendar() {
  return useQuery<EconomicCalendarEvent[]>({
    queryKey: ["/api/finance/economics/calendar"],
    queryFn: async () => {
      const res = await fetch("/api/finance/economics/calendar");
      if (!res.ok) throw new Error("Failed to fetch economic calendar");
      return res.json();
    },
    refetchInterval: 15 * 60_000,
    staleTime: 14 * 60_000,
  });
}

export function useEconomicEventDetail(releaseId?: number | null) {
  return useQuery<EconomicEventDetail>({
    queryKey: ["/api/finance/economics/events", releaseId ?? 0],
    queryFn: async () => {
      if (!releaseId) throw new Error("Missing releaseId");
      const res = await fetch(`/api/finance/economics/events/${releaseId}`);
      if (!res.ok) throw new Error("Failed to fetch economic event detail");
      return res.json();
    },
    staleTime: 60 * 60_000,
    enabled: Boolean(releaseId),
  });
}

export function usePeers(symbol: string) {
  return useQuery<Quote[]>({
    queryKey: ["/api/finance/peers", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/finance/peers?symbol=${symbol}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 300000,
    enabled: !!symbol,
  });
}

export function useIndexSparklines() {
  return useQuery<Record<string, number[]>>({
    queryKey: ["/api/finance/sparklines"],
    queryFn: async () => {
      const res = await fetch("/api/finance/sparklines");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 300000, // sparklines are intraday, refresh every 5 min
    refetchInterval: 300000,
  });
}

export function useScreener(filters: Record<string, string>) {
  const params = new URLSearchParams(filters).toString();
  return useQuery<Quote[]>({
    queryKey: ["/api/finance/screener", params],
    queryFn: async () => {
      const res = await fetch(`/api/finance/screener?${params}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 60000,
  });
}

// Country/asset-class directory screener -- filters the full 57k-ticker
// universe (equities, indices, commodities, forex, crypto, mutual funds) by
// region/exchange/sector/asset-class, paginated server-side.
export function useDirectoryScreener(filters: Record<string, string>, page: number) {
  const params = new URLSearchParams({ ...filters, page: String(page) }).toString();
  return useQuery<DirectoryScreenResult>({
    queryKey: ["/api/finance/directory", params],
    queryFn: async () => {
      const res = await fetch(`/api/finance/directory?${params}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 60000,
  });
}

/** The global-securities catalog row for exactly this symbol (null when it is not in the catalog). */
export function useCatalogEntry(symbol: string) {
  return useQuery<DirectoryEntry | null>({
    queryKey: ["/api/finance/directory", "entry", symbol.toUpperCase()],
    queryFn: async () => {
      const res = await fetch(`/api/finance/directory?q=${encodeURIComponent(symbol)}`);
      if (!res.ok) throw new Error("Catalog lookup unavailable");
      const page: DirectoryScreenResult = await res.json();
      return pickCatalogEntry(page.items, symbol);
    },
    staleTime: 5 * 60_000,
    enabled: !!symbol,
  });
}

export interface DirectoryCatalogFacets {
  total: number;
  active: number;
  historical: number;
  assetClasses: Array<{ value: string; count: number }>;
  exchanges: Array<{ value: string; count: number }>;
  sectors: Array<{ value: string; count: number }>;
  regions: Array<{ value: string; count: number }>;
  currencies: Array<{ value: string; count: number }>;
  referenceOnly: true;
}
export interface DirectoryCatalogStatus {
  referenceOnly: true;
  uniqueListingCount: number;
  uniqueSymbolCount: number;
  sources: Record<string, number>;
  financeDatabase: {
    imported: boolean;
    searchCount: number;
    upstreamCommit: string | null;
    importedAt: string | null;
    countsByAssetClass: Record<string, number>;
    discontinuedMaintenance: { funds: "2026-10"; moneymarkets: "2026-10" };
    maintenanceCaveat: string;
    referenceOnly: true;
  };
  priceCoverage: string;
}
export function useDirectoryFacets() {
  return useQuery<DirectoryCatalogFacets>({
    queryKey: ["/api/finance/directory/facets"],
    queryFn: async () => {
      const res = await fetch("/api/finance/directory/facets");
      if (!res.ok) throw new Error("Directory facets unavailable");
      return res.json();
    },
    staleTime: 60_000,
  });
}
export interface DirectoryCatalogInstallStatus {
  state: "idle" | "fetching" | "extracting" | "verifying" | "completed" | "failed";
  startedAt: string | null;
  completedAt: string | null;
  filesExtracted: number;
  bytesExtracted: number;
  bytesDownloaded: number;
  stepDetail: string | null;
  importedCount: number | null;
  upstreamCommit: string;
  error: string | null;
}
export function useDirectoryInstallStatus() {
  return useQuery<DirectoryCatalogInstallStatus>({
    queryKey: ["/api/finance/directory/install/status"],
    queryFn: async () => {
      const res = await fetch("/api/finance/directory/install/status");
      if (!res.ok) throw new Error("Reference import state unavailable");
      return res.json();
    },
    refetchInterval: (query) => ["fetching", "extracting", "verifying"].includes(query.state.data?.state ?? "") ? 1000 : 5000,
  });
}

export function useDirectoryStatus() {
  return useQuery<DirectoryCatalogStatus>({
    queryKey: ["/api/finance/directory/status"],
    queryFn: async () => {
      const res = await fetch("/api/finance/directory/status");
      if (!res.ok) throw new Error("Directory source status unavailable");
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function useDirectoryRegions() {
  return useQuery<string[]>({
    queryKey: ["/api/finance/directory/regions"],
    queryFn: async () => {
      const res = await fetch("/api/finance/directory/regions");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 24 * 60 * 60 * 1000,
  });
}

// Bond screener -- sovereign/reference bond yields, filterable by
// country/category and yield range (LSE's "bonds" catalog dataset).
export function useBondScreener(filters: Record<string, string>) {
  const params = new URLSearchParams(filters).toString();
  return useQuery<CatalogScreenRow[]>({
    queryKey: ["/api/lse/bonds/screen", params],
    queryFn: async () => {
      const res = await fetch(`/api/lse/bonds/screen?${params}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 60000,
  });
}

// Macro screener -- economic indicators across countries, filterable by
// country/category and value range (LSE's "economics" catalog dataset).
export function useMacroScreener(filters: Record<string, string>) {
  const params = new URLSearchParams(filters).toString();
  return useQuery<CatalogScreenRow[]>({
    queryKey: ["/api/lse/economics/screen", params],
    queryFn: async () => {
      const res = await fetch(`/api/lse/economics/screen?${params}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 60000,
  });
}
