import assert from "node:assert/strict";
import test from "node:test";
import { runWithRequestIdentity } from "./requestContext";
import { getForexQuotes, getEconomicsSnapshot } from "./marketData";

// Covers the P0.1 data-truth fixes: no fabricated FX_REFERENCE fallback, no
// synthesized day-high/day-low, no hard-coded macro placeholder numbers.
// Missing data must come back as an explicit unavailable state, never a
// guessed number.

test("forex quotes are an explicit unavailable state, never a fabricated reference rate, when community consent is missing on retail", async () => {
  const previousAudience = process.env.LIOS_SOFTWARE_PROFILE;
  process.env.LIOS_SOFTWARE_PROFILE = "retail";
  try {
    const quotes = await runWithRequestIdentity({
      userId: 1,
      organizationId: 1,
      selectedConnectorIds: [],
      communityYahooConsent: false,
    }, () => getForexQuotes());

    assert.equal(quotes.length, 10, "all 10 tracked pairs are still returned, just unavailable");
    for (const quote of quotes) {
      assert.equal(quote.rate, null, `${quote.pair} rate must be null, not a guessed reference rate`);
      assert.equal(quote.change, null);
      assert.equal(quote.changePercent, null);
      assert.equal(quote.high, null);
      assert.equal(quote.low, null);
      assert.equal(quote.isLive, false);
      assert.equal(quote.status.isFallback, true);
    }
  } finally {
    if (previousAudience === undefined) delete process.env.LIOS_SOFTWARE_PROFILE;
    else process.env.LIOS_SOFTWARE_PROFILE = previousAudience;
  }
});

test("forex Yahoo access stays unavailable when Yahoo consent exists but Yahoo is not selected", async () => {
  const previousAudience = process.env.LIOS_SOFTWARE_PROFILE;
  process.env.LIOS_SOFTWARE_PROFILE = "retail";
  try {
    const quotes = await runWithRequestIdentity({
      userId: 2,
      organizationId: 1,
      selectedConnectorIds: ["stooq"],
      communityYahooConsent: true,
      publicFillerConsent: true,
    }, () => getForexQuotes());

    assert.equal(quotes.length, 10);
    for (const quote of quotes) {
      assert.equal(quote.rate, null);
      assert.equal(quote.isLive, false);
    }
  } finally {
    if (previousAudience === undefined) delete process.env.LIOS_SOFTWARE_PROFILE;
    else process.env.LIOS_SOFTWARE_PROFILE = previousAudience;
  }
});

test("economics snapshot never returns the old hard-coded placeholder numbers, and unsourced fields are explicitly null", async () => {
  const previousAudience = process.env.LIOS_SOFTWARE_PROFILE;
  process.env.LIOS_SOFTWARE_PROFILE = "retail";
  try {
    const snapshot = await runWithRequestIdentity({
      userId: 1,
      organizationId: 1,
      selectedConnectorIds: [],
      communityYahooConsent: false,
    }, () => getEconomicsSnapshot());

    // The previously hard-coded literals from every request, regardless of
    // any real economic condition. If FRED is unconfigured in this test
    // environment (the common case), the honest result is null, not one of
    // these old fixed numbers.
    if (!process.env.FRED_API_KEY) {
      assert.equal(snapshot.gdp.value, null);
      assert.equal(snapshot.cpi.value, null);
      assert.equal(snapshot.unemployment.value, null);
      assert.equal(snapshot.fedFunds.value, null);
      assert.equal(snapshot.t10y.value, null);
      assert.equal(snapshot.t2y.value, null);
      assert.equal(snapshot.t30y.value, null);
    } else {
      assert.notEqual(snapshot.unemployment.value, 3.7);
      assert.notEqual(snapshot.fedFunds.value, 5.33);
    }

    // No connected DXY source exists yet -- must never fabricate an index
    // level regardless of provider/consent state.
    assert.equal(snapshot.dolllarIndex.value, null);
    assert.equal(snapshot.dolllarIndex.prev, null);

    // FX legs must not silently reappear as the old fabricated defaults
    // (1.08 / 1.27 / 150.0) when Yahoo is unavailable.
    assert.equal(snapshot.eurUsd.value, null);
    assert.equal(snapshot.gbpUsd.value, null);
    assert.equal(snapshot.usdJpy.value, null);
  } finally {
    if (previousAudience === undefined) delete process.env.LIOS_SOFTWARE_PROFILE;
    else process.env.LIOS_SOFTWARE_PROFILE = previousAudience;
  }
});
