import { useQuery } from "@tanstack/react-query";
import type { DataStatus } from "@/lib/finance";

export interface LsePage<T> {
  rows: T[];
  page: number;
  limit: number;
  hasMore: boolean;
  nextCursor?: string;
  provenance: { provider: string; sourceReference: string; asOf: string | null; retrievedAt: string | null; freshness: string; cache: string; fallback: boolean };
}
export interface LseQueryOptions {
  start?: string; end?: string; order?: "asc" | "desc"; limit?: number; page?: number; cursor?: string; mode?: "page";
}

export interface LseInsiderTrade {
  symbol: string; transaction_date: string; filing_date: string; transaction_type: string;
  acquisition_or_disposition: string | null; reporting_name: string; type_of_owner: string | null;
  securities_transacted: number | null; securities_owned: number | null; price: number | null;
  security_name: string | null; form_type: string | null; url: string | null;
  office: string | null; district: string | null; owner: string | null; amount: string | null;
}
export interface LseOptionFlowPrint {
  id: number; ts: string; ticker: string; underlying: string; contract_type: "call" | "put"; strike: number;
  expiry: string; last_price: number; volume: number; premium: number; underlying_price: number; dte: number;
  iv: number | null; delta: number | null;
}
export interface LseCotRow { symbol: string; date: string; [key: string]: unknown }
export interface LseCatalogRow {
  dataset: string; symbol: string; name?: string; ticks: number; first_tick?: string; last_tick?: string; years?: number;
  last_value?: number; change_pct?: number; change_1y?: number; unit?: string; category?: string; frequency?: string;
  country?: string | null; country_name?: string | null;
}
export interface LseSeriesPoint { symbol: string; date: string; value: number }

export function useLseStatus() {
  return useQuery<{ configured: boolean }>({
    queryKey: ["/api/lse/status"],
    queryFn: async () => {
      const res = await fetch("/api/lse/status");
      if (!res.ok) throw new Error("Failed to fetch LSE status");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useLseInsiderTrades(symbol?: string, type?: string) {
  return useQuery<LseInsiderTrade[]>({
    queryKey: ["/api/lse/insiders", symbol, type],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (symbol) params.set("symbol", symbol);
      if (type) params.set("type", type);
      const res = await fetch(`/api/lse/insiders?${params}`);
      if (!res.ok) throw new Error("Failed to fetch insider trades");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });
}
export interface LseOptionsQuery extends LseQueryOptions {
  underlying?: string; type?: "call" | "put"; expiry?: string; minDte?: number; maxDte?: number; minPremium?: number;
}

function appendQuery(params: URLSearchParams, values: object): void {
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "number") params.set(key, String(value));
  }
}

export function useLseOptionsFlow(underlying?: string, type?: "call" | "put", minPremium?: number, options: LseOptionsQuery = {}) {
  return useQuery<LseOptionFlowPrint[]>({
    queryKey: ["/api/lse/options-flow", underlying, type, minPremium, options],
    queryFn: async () => {
      const params = new URLSearchParams();
      appendQuery(params, { underlying, type, minPremium, ...options });
      const res = await fetch(`/api/lse/options-flow?${params}`);
      if (!res.ok) throw new Error("Failed to fetch options flow");
      return res.json();
    },
    refetchInterval: 60 * 1000,
  });
}

export function useLseOptionsFlowPage(options: LseOptionsQuery = {}) {
  return useQuery<LsePage<LseOptionFlowPrint>>({
    queryKey: ["/api/lse/options-flow/page", options],
    queryFn: async () => {
      const params = new URLSearchParams({ mode: "page" });
      appendQuery(params, options);
      const res = await fetch(`/api/lse/options-flow?${params}`);
      if (!res.ok) throw new Error("Failed to fetch options flow page");
      return res.json();
    },
    refetchInterval: 60 * 1000,
  });
}

export function useLseCot(symbol: string) {
  return useQuery<LseCotRow[]>({
    queryKey: ["/api/lse/cot", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/lse/cot/${symbol}`);
      if (!res.ok) throw new Error("Failed to fetch COT data");
      return res.json();
    },
    enabled: !!symbol,
    refetchInterval: 60 * 60 * 1000,
  });
}

export interface LseCompanyProfile {
  symbol: string; company_name: string; exchange: string; currency: string; country: string;
  sector: string; industry: string; ceo: string | null; description: string | null; website: string | null;
  full_time_employees: number | null; address: string | null; city: string | null; state: string | null;
  price: number | null; market_cap: number | null; beta: number | null; last_dividend: number | null;
  price_range: string | null; volume: number | null; average_volume: number | null; ipo_date: string | null;
  image_url_dark: string | null;
}
export interface LseStockFundamentals {
  symbol: string; name: string; exchange: string; sector: string; industry: string; country: string;
  ipo_date: string | null; current_price: number | null; market_cap: number | null; beta: number | null;
  pe_ratio: number | null; week_52_high: number | null; week_52_low: number | null;
  dividend_yield: number | null; revenue_ttm: number | null; profit_margin: number | null;
}
export interface LseFinancialReport {
  symbol: string; report_type: string; date: string; fiscal_year: string; period: string;
  reported_currency: string; data: string; filing_date: string | null;
  /** Which provider actually supplied this row (e.g. "London Strategic Edge") --
   * see server/financialDataProviders.ts. Optional since older cached
   * responses predate this field. */
  data_source?: string;
  /** Freshness/provenance for the shared DataStatusBadge. Optional for the
   * same reason as data_source above. */
  status?: DataStatus;
  sourcePriority?: "private" | "public";
  joinConflict?: { publicProvider: string; differingFields: string[] };
}
export interface LseDividend {
  symbol: string; effective_date: string; declaration_date: string | null; record_date: string | null;
  payment_date: string | null; dividend_amount: number; currency: string; frequency: string | null;
}
export interface LseStockSplit { symbol: string; effective_date: string; split_from: number; split_to: number }
export interface LseBondYield {
  symbol: string; country_name: string; maturity: string; currency: string; date: string;
  open: number; high: number; low: number; close: number;
}

export function useLseCompany(symbol: string) {
  return useQuery<{ profile: LseCompanyProfile | null; fundamentals: LseStockFundamentals | null }>({
    queryKey: ["/api/lse/company", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/lse/company/${symbol}`);
      if (!res.ok) throw new Error("Failed to fetch company data");
      return res.json();
    },
    enabled: !!symbol,
  });
}

export function useLseFinancials(symbol: string, reportType = "income", period = "FY") {
  return useQuery<LseFinancialReport[]>({
    queryKey: ["/api/lse/financials", symbol, reportType, period],
    queryFn: async () => {
      const res = await fetch(`/api/lse/financials/${symbol}?reportType=${reportType}&period=${period}`);
      if (!res.ok) throw new Error("Failed to fetch financial reports");
      return res.json();
    },
    enabled: !!symbol,
  });
}

export function useLseDividends(symbol: string) {
  return useQuery<LseDividend[]>({
    queryKey: ["/api/lse/dividends", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/lse/dividends/${symbol}`);
      if (!res.ok) throw new Error("Failed to fetch dividends");
      return res.json();
    },
    enabled: !!symbol,
  });
}

export function useLseSplits(symbol: string) {
  return useQuery<LseStockSplit[]>({
    queryKey: ["/api/lse/splits", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/lse/splits/${symbol}`);
      if (!res.ok) throw new Error("Failed to fetch stock splits");
      return res.json();
    },
    enabled: !!symbol,
  });
}

export function useLseBondYields(symbol: string) {
  return useQuery<LseBondYield[]>({
    queryKey: ["/api/lse/bondyields", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/lse/bondyields/${symbol}`);
      if (!res.ok) throw new Error("Failed to fetch bond yields");
      return res.json();
    },
    enabled: !!symbol,
  });
}

export function useLseEconomicsSearch(query: string, country?: string, options: LseQueryOptions = {}) {
  return useQuery<LseCatalogRow[]>({
    queryKey: ["/api/lse/economics/search", query, country, options],
    queryFn: async () => {
      const params = new URLSearchParams({ q: query });
      if (country) params.set("country", country);
      appendQuery(params, options);
      const res = await fetch(`/api/lse/economics/search?${params}`);
      if (!res.ok) throw new Error("Failed to search LSE economics catalog");
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });
}

export function useLseEconomicsSearchPage(query: string, country?: string, options: LseQueryOptions = {}) {
  return useQuery<LsePage<LseCatalogRow>>({
    queryKey: ["/api/lse/economics/search/page", query, country, options],
    queryFn: async () => {
      const params = new URLSearchParams({ q: query, mode: "page" });
      if (country) params.set("country", country);
      appendQuery(params, options);
      const res = await fetch(`/api/lse/economics/search?${params}`);
      if (!res.ok) throw new Error("Failed to search LSE economics catalog");
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });
}

export function useLseEconomicsSeries(symbol: string, options: LseQueryOptions = {}) {
  return useQuery<LseSeriesPoint[]>({
    queryKey: ["/api/lse/economics/series", symbol, options],
    queryFn: async () => {
      const params = new URLSearchParams();
      appendQuery(params, options);
      const res = await fetch(`/api/lse/economics/series/${symbol}?${params}`);
      if (!res.ok) throw new Error("Failed to fetch LSE series");
      return res.json();
    },
    enabled: !!symbol,
  });
}

export function useLseEconomicsSeriesPage(symbol: string, options: LseQueryOptions = {}) {
  return useQuery<LsePage<LseSeriesPoint>>({
    queryKey: ["/api/lse/economics/series/page", symbol, options],
    queryFn: async () => {
      const params = new URLSearchParams({ mode: "page" });
      appendQuery(params, options);
      const res = await fetch(`/api/lse/economics/series/${symbol}?${params}`);
      if (!res.ok) throw new Error("Failed to fetch LSE series");
      return res.json();
    },
    enabled: !!symbol,
  });
}

export function useLseEconomicsCountries() {
  return useQuery<{ code: string; name: string }[]>({
    queryKey: ["/api/lse/economics/countries"],
    queryFn: async () => {
      const res = await fetch("/api/lse/economics/countries");
      if (!res.ok) throw new Error("Failed to fetch LSE countries");
      return res.json();
    },
    staleTime: 30 * 60 * 1000,
  });
}

export interface LseCandle { ts: string; symbol: string; open: number; high: number; low: number; close: number; volume: number | null }

// Cross-asset candles (stocks/FX/crypto/commodities/indices/ETFs/futures).
// Independent of the platform's own Yahoo/Stooq/yfinance OHLCV pipeline --
// see server/lseRoutes.ts's comment on why this stays a separate, explicit
// source rather than an implicit fallback layer.
export function useLseCandles(symbol: string, timeframe = "1d", limit = 500, options: LseQueryOptions = {}) {
  return useQuery<LseCandle[]>({
    queryKey: ["/api/lse/candles", symbol, timeframe, limit, options],
    queryFn: async () => {
      const params = new URLSearchParams({ timeframe, limit: String(options.limit ?? limit) });
      appendQuery(params, { ...options, limit: undefined });
      const res = await fetch(`/api/lse/candles/${symbol}?${params}`);
      if (!res.ok) throw new Error("Failed to fetch LSE candles");
      return res.json();
    },
    enabled: !!symbol,
    staleTime: 60 * 1000,
  });
}

export function useLseCandlesPage(symbol: string, timeframe = "1d", options: LseQueryOptions = {}) {
  return useQuery<LsePage<LseCandle>>({
    queryKey: ["/api/lse/candles/page", symbol, timeframe, options],
    queryFn: async () => {
      const params = new URLSearchParams({ timeframe, mode: "page" });
      appendQuery(params, options);
      const res = await fetch(`/api/lse/candles/${symbol}?${params}`);
      if (!res.ok) throw new Error("Failed to fetch LSE candles");
      return res.json();
    },
    enabled: !!symbol,
    staleTime: 60 * 1000,
  });
}

export function useLseBondsCountries() {
  return useQuery<{ code: string; name: string }[]>({
    queryKey: ["/api/lse/bonds/countries"],
    queryFn: async () => {
      const res = await fetch("/api/lse/bonds/countries");
      if (!res.ok) throw new Error("Failed to fetch LSE bond countries");
      return res.json();
    },
    staleTime: 30 * 60 * 1000,
  });
}

export interface LseBondScreenRow extends LseCatalogRow {}

// Current sovereign yield level per instrument for a country, sourced from
// the bonds catalog's pre-aggregated last_value (see screenCatalog in
// server/lseData.ts) -- one HTTP call for a whole country's curve rather
// than one per tenor.
export function useLseBondsScreen(country?: string) {
  return useQuery<LseBondScreenRow[]>({
    queryKey: ["/api/lse/bonds/screen", country],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (country) params.set("country", country);
      const res = await fetch(`/api/lse/bonds/screen?${params}`);
      if (!res.ok) throw new Error("Failed to screen LSE bond yields");
      return res.json();
    },
    enabled: !!country,
    staleTime: 5 * 60 * 1000,
  });
}

export interface LseOptionContract {
  ticker: string; underlying: string; contract_type: "call" | "put"; strike: number; expiry: string;
  last_price: number; volume_today: number; premium_today: number; underlying_price: number; dte: number;
  iv: number | null; delta: number | null; gamma: number | null; theta: number | null; vega: number | null;
}

export function useLseOptionsChain(underlying: string, options: LseOptionsQuery = {}) {
  return useQuery<LseOptionContract[]>({
    queryKey: ["/api/lse/options-chain", underlying, options],
    queryFn: async () => {
      const params = new URLSearchParams();
      appendQuery(params, options);
      const res = await fetch(`/api/lse/options-chain/${underlying}?${params}`);
      if (!res.ok) throw new Error("Failed to fetch LSE options chain");
      return res.json();
    },
    enabled: !!underlying,
    staleTime: 60 * 1000,
  });
}

export function useLseOptionsChainPage(underlying: string, options: LseOptionsQuery = {}) {
  return useQuery<LsePage<LseOptionContract>>({
    queryKey: ["/api/lse/options-chain/page", underlying, options],
    queryFn: async () => {
      const params = new URLSearchParams({ mode: "page" });
      appendQuery(params, options);
      const res = await fetch(`/api/lse/options-chain/${underlying}?${params}`);
      if (!res.ok) throw new Error("Failed to fetch LSE options chain");
      return res.json();
    },
    enabled: !!underlying,
    staleTime: 60 * 1000,
  });
}
