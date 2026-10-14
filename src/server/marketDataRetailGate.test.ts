import assert from "node:assert/strict";
import test from "node:test";
import { runWithRequestIdentity } from "./requestContext";
import { getFundamentals, getQuotes } from "./marketData";
import { saveFundamentals } from "./fundamentalsStore";

test("retail profile without community consent returns empty quotes when no connectors are selected", async () => {
  const previousAudience = process.env.LIOS_SOFTWARE_PROFILE;
  process.env.LIOS_SOFTWARE_PROFILE = "retail";
  try {
    const quotes = await runWithRequestIdentity({
      userId: 1,
      organizationId: 1,
      selectedConnectorIds: [],
      communityYahooConsent: false,
    }, () => getQuotes(["AAPL"]));
    assert.deepEqual(quotes, []);
  } finally {
    if (previousAudience === undefined) delete process.env.LIOS_SOFTWARE_PROFILE;
    else process.env.LIOS_SOFTWARE_PROFILE = previousAudience;
  }
});


test("retail profile with revoked Yahoo consent cannot read previously cached yfinance fundamentals", async () => {
  const previousAudience = process.env.LIOS_SOFTWARE_PROFILE;
  process.env.LIOS_SOFTWARE_PROFILE = "retail";
  const symbol = `ZZFUND${process.pid}${Date.now()}`;
  saveFundamentals(symbol, {
    symbol,
    marketCap: 123,
    trailingPE: null,
    forwardPE: null,
    trailingEps: null,
    forwardEps: null,
    priceToBook: null,
    dividendYield: null,
    beta: null,
    totalRevenue: null,
    profitMargins: null,
    revenueGrowth: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    sharesOutstanding: null,
    bookValue: null,
    returnOnEquity: null,
    debtToEquity: null,
    sector: null,
    industry: null,
    longName: null,
    currency: null,
  });
  try {
    const fundamentals = await runWithRequestIdentity({
      userId: 1,
      organizationId: 1,
      selectedConnectorIds: ["yahoo_finance"],
      communityYahooConsent: false,
    }, () => getFundamentals(symbol));
    assert.equal(fundamentals, null);
  } finally {
    if (previousAudience === undefined) delete process.env.LIOS_SOFTWARE_PROFILE;
    else process.env.LIOS_SOFTWARE_PROFILE = previousAudience;
  }
});
