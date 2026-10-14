import test from "node:test";
import assert from "node:assert/strict";
import {
  buildQuotePassport,
  buildOhlcvPassport,
  buildFundamentalsPassport,
  passportResponseHeaders,
  type FundamentalsData,
} from "./marketDataPassport";
import type { Quote, OHLCVBar } from "./marketData";
import type { DataStatus } from "@shared/dataStatus";

const STATUS: DataStatus = {
  provider: "Limuria Intelligence",
  freshness: "delayed",
  asOf: "2026-08-25T12:00:00.000Z",
  delayLabel: "Delayed feed",
  isFallback: false,
};

const MOCK_QUOTE: Quote = {
  symbol: "AAPL",
  name: "Apple Inc.",
  price: 227.50,
  change: 2.30,
  changePercent: 1.02,
  volume: 58_000_000,
  marketCap: 3_470_000_000_000,
  pe: 33.2,
  eps: 6.85,
  revenue: 391_035_000_000,
  high52: 260.10,
  low52: 164.08,
  open: 225.20,
  previousClose: 225.20,
  dayHigh: 228.10,
  dayLow: 224.90,
  avgVolume: 65_000_000,
  exchange: "NASDAQ",
  sector: "Technology",
  quoteSource: "yfinance",
  isLive: false,
  status: STATUS,
  currency: "USD",
};

test("buildQuotePassport produces a valid passport with all required fields", () => {
  const { quote, passport } = buildQuotePassport(MOCK_QUOTE);
  assert.equal(quote.symbol, "AAPL");
  assert.ok(passport.id.startsWith("ppt_"));
  assert.equal(passport.contractFamily, "market_data");
  assert.equal(passport.entityKey, "AAPL");
  assert.equal(passport.quality.completeness, 1); // price, marketCap, volume all present
  assert.ok(passport.entries.length >= 8);

  // Check price entry
  const priceEntry = passport.entries.find((e) => e.field === "price");
  assert.ok(priceEntry);
  assert.equal(priceEntry.value, 227.50);
  assert.equal(priceEntry.source.priority, "primary");

  // Check sector is included
  const sectorEntry = passport.entries.find((e) => e.field === "sector");
  assert.ok(sectorEntry);
  assert.equal(sectorEntry.value, "Technology");
});

test("buildQuotePassport marks fallback quotes correctly", () => {
  const fallbackQuote = { ...MOCK_QUOTE, status: { ...STATUS, isFallback: true }, quoteSource: "stooq_history" };
  const { passport } = buildQuotePassport(fallbackQuote);
  const priceEntry = passport.entries.find((e) => e.field === "price");
  assert.equal(priceEntry?.source.priority, "fallback");
});

test("buildQuotePassport handles null optional fields", () => {
  const sparseQuote = { ...MOCK_QUOTE, pe: null, eps: null, sector: undefined };
  const { passport } = buildQuotePassport(sparseQuote);
  assert.ok(!passport.entries.some((e) => e.field === "peRatio"));
  assert.ok(!passport.entries.some((e) => e.field === "eps"));
  assert.ok(!passport.entries.some((e) => e.field === "sector"));
});

test("buildOhlcvPassport produces a valid passport", () => {
  const bars: OHLCVBar[] = [
    { date: "2026-08-20", open: 220, high: 225, low: 218, close: 224, volume: 50_000_000 },
    { date: "2026-08-21", open: 224, high: 228, low: 223, close: 227, volume: 55_000_000 },
  ];
  const { passport, symbol } = buildOhlcvPassport("AAPL", bars, STATUS);
  assert.equal(symbol, "AAPL");
  assert.equal(passport.contractFamily, "price_history");
  assert.equal(passport.entityKey, "AAPL");
  assert.equal(passport.quality.completeness, 1);

  const barCount = passport.entries.find((e) => e.field === "barCount");
  assert.equal(barCount?.value, 2);
  const endDate = passport.entries.find((e) => e.field === "endDate");
  assert.equal(endDate?.value, "2026-08-21");
});

test("buildOhlcvPassport handles empty bars array", () => {
  const { passport } = buildOhlcvPassport("AAPL", [], STATUS);
  const barCount = passport.entries.find((e) => e.field === "barCount");
  assert.equal(barCount?.value, 0);
});

test("buildFundamentalsPassport produces a valid passport", () => {
  const data: FundamentalsData = {
    symbol: "AAPL",
    marketCap: 3_470_000_000_000,
    pe: 33.2,
    forwardPe: 28.5,
    eps: 6.85,
    revenue: 391_035_000_000,
    beta: 1.24,
    dividendYield: 0.44,
    debtToEquity: 1.87,
    returnOnEquity: 160.5,
    priceToBook: 62.3,
    sector: "Technology",
    industry: "Consumer Electronics",
    status: STATUS,
  };
  const { passport } = buildFundamentalsPassport(data);
  assert.equal(passport.contractFamily, "market_data");
  assert.equal(passport.entityKey, "AAPL");
  assert.equal(passport.quality.completeness, 1); // marketCap required, present
  assert.ok(passport.entries.length >= 10);
});

test("buildFundamentalsPassport handles sparse data", () => {
  const sparse: FundamentalsData = {
    symbol: "SPARSE",
    marketCap: null,
    pe: null,
    forwardPe: null,
    eps: null,
    revenue: null,
    beta: null,
    dividendYield: null,
    debtToEquity: null,
    returnOnEquity: null,
    priceToBook: null,
    sector: null,
    industry: null,
    status: STATUS,
  };
  const { passport } = buildFundamentalsPassport(sparse);
  assert.equal(passport.entries.length, 0);
  assert.equal(passport.quality.completeness, 0); // required marketCap missing
});

test("passportResponseHeaders returns correct header keys", () => {
  const { passport } = buildQuotePassport(MOCK_QUOTE);
  const headers = passportResponseHeaders(passport);
  assert.ok(headers["X-Limuria-Passport-Id"].startsWith("ppt_"));
  assert.equal(headers["X-Limuria-Passport-Quality"], passport.quality.level);
  assert.equal(headers["X-Limuria-Passport-Completeness"], "1.0000");
  assert.ok(headers["X-Limuria-Passport-Hash"].length === 64);
  assert.equal(headers["X-Limuria-Passport-Conflicts"], "0");
});

test("passport snapshot hashes are deterministic", () => {
  const a = buildQuotePassport(MOCK_QUOTE);
  const b = buildQuotePassport(MOCK_QUOTE);
  assert.equal(a.passport.snapshotHash, b.passport.snapshotHash);
});

test("different quote data produces different passport hashes", () => {
  const a = buildQuotePassport(MOCK_QUOTE);
  const b = buildQuotePassport({ ...MOCK_QUOTE, price: 230.00 });
  assert.notEqual(a.passport.snapshotHash, b.passport.snapshotHash);
});
