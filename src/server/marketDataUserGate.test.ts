import test from "node:test";
import assert from "node:assert/strict";
import { getQuotes, shouldUseKeyedQuoteFallback } from "./marketData";
import { runWithRequestIdentity } from "./requestContext";

test("authenticated users without configured sources receive no reference quote fallback", async () => {
  const quotes = await runWithRequestIdentity({ userId: 77, organizationId: null, selectedConnectorIds: [] }, () => getQuotes(["AAPL"]));
  assert.deepEqual(quotes, []);
});

test("configured source context permits provider resolution", async () => {
  const quotes = await runWithRequestIdentity({ userId: 77, organizationId: null, selectedConnectorIds: ["custom_api"] }, () => getQuotes([]));
  assert.deepEqual(quotes, []);
});

test("keyed-provider quota policy permits only single-symbol fallback requests", () => {
  assert.equal(shouldUseKeyedQuoteFallback(0), false);
  assert.equal(shouldUseKeyedQuoteFallback(1), true);
  assert.equal(shouldUseKeyedQuoteFallback(2), false);
  assert.equal(shouldUseKeyedQuoteFallback(200), false);
});


test("selected but unavailable sources return an explicit data gap instead of catalog prices", async () => {
  const [quote] = await runWithRequestIdentity({
    userId: 78,
    organizationId: null,
    selectedConnectorIds: ["custom_api"],
    communityYahooConsent: true,
    publicFillerConsent: true,
  }, () => getQuotes(["AAPL"]));

  assert.equal(quote.price, 0);
  assert.equal(quote.marketCap, null);
  assert.equal(quote.pe, null);
  assert.equal(quote.eps, null);
  assert.equal(quote.revenue, null);
  assert.equal(quote.isLive, false);
  assert.equal(quote.status.isFallback, true);
});
