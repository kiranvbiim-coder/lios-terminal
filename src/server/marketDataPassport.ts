/**
 * Market Data Passport Service: bridges the existing market data
 * infrastructure (getQuotes, getFundamentals, getOHLCV) to the data
 * truth pipeline. Every market data response can now carry a DataPassport
 * recording source, freshness, quality, and provenance.
 *
 * This does NOT replace the existing market data functions — it wraps
 * them so callers that need passported data can request it, while the
 * existing zero-overhead path stays unchanged for panels that just
 * want fast quotes.
 */
import type { Quote, OHLCVBar } from "./marketData";
import type { DataStatus } from "@shared/dataStatus";
import {
  buildDataPassport,
  buildPassportEntry,
  computeFreshnessDays,
  type DataPassport,
  type DataPassportEntry,
  type SourceBinding,
} from "@shared/dataTruth";

// ─── Quote Passport ───────────────────────────────────────────────────────

export interface PassportedQuote {
  quote: Quote;
  passport: DataPassport;
}

function quoteSourceBinding(quote: Quote): SourceBinding {
  return {
    contractFamily: "market_data",
    field: "",
    connectorId: mapProviderToConnectorId(quote.quoteSource),
    provider: quote.status.provider,
    priority: quote.status.isFallback ? "fallback" : "primary",
  };
}

function mapProviderToConnectorId(quoteSource: string): string {
  const lower = quoteSource.toLowerCase();
  if (lower.includes("lse") || lower.includes("london strategic")) return "lse";
  if (lower.includes("finnhub")) return "finnhub";
  if (lower.includes("fmp")) return "fmp";
  if (lower.includes("yahoo") || lower.includes("yfinance")) return "yfinance";
  if (lower.includes("stooq")) return "stooq";
  if (lower.includes("bse")) return "bse_india";
  if (lower.includes("coingecko")) return "coingecko";
  return "unknown";
}

function statusToRetrievedAt(status: DataStatus): string {
  return status.asOf ?? new Date().toISOString();
}

export function buildQuotePassport(quote: Quote): PassportedQuote {
  const binding = quoteSourceBinding(quote);
  const retrievedAt = statusToRetrievedAt(quote.status);

  const entries: DataPassportEntry[] = [
    buildPassportEntry("price", quote.price, { ...binding, field: "price" }, retrievedAt),
    buildPassportEntry("marketCap", quote.marketCap, { ...binding, field: "marketCap" }, retrievedAt),
    buildPassportEntry("volume", quote.volume, { ...binding, field: "volume" }, retrievedAt),
    buildPassportEntry("change", quote.change, { ...binding, field: "change" }, retrievedAt),
    buildPassportEntry("changePercent", quote.changePercent, { ...binding, field: "changePercent" }, retrievedAt),
    buildPassportEntry("currency", quote.currency, { ...binding, field: "currency" }, retrievedAt),
    buildPassportEntry("exchange", quote.exchange, { ...binding, field: "exchange" }, retrievedAt),
    buildPassportEntry("name", quote.name, { ...binding, field: "name" }, retrievedAt),
  ];

  if (quote.pe != null) entries.push(buildPassportEntry("peRatio", quote.pe, { ...binding, field: "peRatio" }, retrievedAt));
  if (quote.eps != null) entries.push(buildPassportEntry("eps", quote.eps, { ...binding, field: "eps" }, retrievedAt));
  if (quote.sector) entries.push(buildPassportEntry("sector", quote.sector, { ...binding, field: "sector" }, retrievedAt));

  const requiredFields = ["price", "marketCap", "volume"];
  const passport = buildDataPassport("market_data", quote.symbol, entries, requiredFields);

  return { quote, passport };
}

// ─── OHLCV Passport ───────────────────────────────────────────────────────

export interface PassportedOHLCV {
  symbol: string;
  bars: OHLCVBar[];
  status: DataStatus;
  passport: DataPassport;
}

export function buildOhlcvPassport(symbol: string, bars: OHLCVBar[], status: DataStatus): PassportedOHLCV {
  const connectorId = mapProviderToConnectorId(status.provider);
  const retrievedAt = statusToRetrievedAt(status);

  const binding: SourceBinding = {
    contractFamily: "price_history",
    field: "",
    connectorId,
    provider: status.provider,
    priority: status.isFallback ? "fallback" : "primary",
  };

  const latestBar = bars.at(-1);
  const earliestBar = bars.at(0);

  const entries: DataPassportEntry[] = [
    buildPassportEntry("barCount", bars.length, { ...binding, field: "barCount" }, retrievedAt),
    buildPassportEntry("startDate", earliestBar?.date ?? null, { ...binding, field: "startDate" }, retrievedAt),
    buildPassportEntry("endDate", latestBar?.date ?? null, { ...binding, field: "endDate" }, retrievedAt),
    buildPassportEntry("latestClose", latestBar?.close ?? null, { ...binding, field: "latestClose" }, retrievedAt),
    buildPassportEntry("latestVolume", latestBar?.volume ?? null, { ...binding, field: "latestVolume" }, retrievedAt),
  ];

  const passport = buildDataPassport("price_history", symbol, entries, ["barCount", "endDate"]);

  return { symbol, bars, status, passport };
}

// ─── Fundamentals Passport ────────────────────────────────────────────────

export interface FundamentalsData {
  symbol: string;
  marketCap: number | null;
  pe: number | null;
  forwardPe: number | null;
  eps: number | null;
  revenue: number | null;
  beta: number | null;
  dividendYield: number | null;
  debtToEquity: number | null;
  returnOnEquity: number | null;
  priceToBook: number | null;
  sector: string | null;
  industry: string | null;
  status: DataStatus;
}

export interface PassportedFundamentals {
  data: FundamentalsData;
  passport: DataPassport;
}

export function buildFundamentalsPassport(data: FundamentalsData): PassportedFundamentals {
  const connectorId = mapProviderToConnectorId(data.status.provider);
  const retrievedAt = statusToRetrievedAt(data.status);

  const binding: SourceBinding = {
    contractFamily: "market_data",
    field: "",
    connectorId,
    provider: data.status.provider,
    priority: data.status.isFallback ? "fallback" : "primary",
  };

  const entries: DataPassportEntry[] = [];
  const fields: Array<{ name: string; value: unknown }> = [
    { name: "marketCap", value: data.marketCap },
    { name: "peRatio", value: data.pe },
    { name: "forwardPeRatio", value: data.forwardPe },
    { name: "eps", value: data.eps },
    { name: "revenue", value: data.revenue },
    { name: "beta", value: data.beta },
    { name: "dividendYield", value: data.dividendYield },
    { name: "debtToEquity", value: data.debtToEquity },
    { name: "returnOnEquity", value: data.returnOnEquity },
    { name: "priceToBook", value: data.priceToBook },
    { name: "sector", value: data.sector },
    { name: "industry", value: data.industry },
  ];

  for (const field of fields) {
    if (field.value != null) {
      entries.push(buildPassportEntry(field.name, field.value, { ...binding, field: field.name }, retrievedAt));
    }
  }

  const requiredFields = ["marketCap"];
  const passport = buildDataPassport("market_data", data.symbol, entries, requiredFields);

  return { data, passport };
}

// ─── Passport Headers ─────────────────────────────────────────────────────

/**
 * Returns HTTP headers that carry passport metadata without
 * bloating the JSON response body. Consumers that need the full
 * passport can request it via a dedicated endpoint later.
 */
export function passportResponseHeaders(passport: DataPassport): Record<string, string> {
  return {
    "X-Limuria-Passport-Id": passport.id,
    "X-Limuria-Passport-Quality": passport.quality.level,
    "X-Limuria-Passport-Completeness": String(passport.quality.completeness.toFixed(4)),
    "X-Limuria-Passport-Freshness": String(passport.quality.freshnessScore.toFixed(4)),
    "X-Limuria-Passport-Hash": passport.snapshotHash,
    "X-Limuria-Passport-Conflicts": String(passport.quality.conflictCount),
  };
}
