import assert from "node:assert/strict";
import test from "node:test";
import { runWithRequestIdentity, type RequestIdentity } from "./requestContext";
import { getOHLCVSeries } from "./marketData";
import { NO_MARKET_SOURCE_MESSAGE } from "@shared/marketDataAccess";

function owner(overrides: Partial<RequestIdentity>): RequestIdentity {
  return {
    userId: 4,
    organizationId: null,
    credentials: {},
    selectedConnectorIds: [],
    providerStackOrder: [],
    dataStackPins: [],
    communityYahooConsent: false,
    publicFillerConsent: false,
    ...overrides,
  };
}

test("an empty price series for a person with no market-data source says how to fix it", async () => {
  const series = await runWithRequestIdentity(owner({}), () => getOHLCVSeries("ZZNOSOURCE1", "1M", "1d"));
  assert.equal(series.bars.length, 0);
  assert.equal(series.status.reason, "no_source_selected");
  assert.equal(series.status.delayLabel, NO_MARKET_SOURCE_MESSAGE);
  assert.equal(series.status.isFallback, true);
});

test("a selected source that still needs consent is reported as needing consent, not as nothing selected", async () => {
  const series = await runWithRequestIdentity(owner({ selectedConnectorIds: ["yahoo_finance"], providerStackOrder: ["yahoo_finance"] }), () => getOHLCVSeries("ZZNOSOURCE2", "1M", "1d"));
  assert.equal(series.bars.length, 0);
  assert.notEqual(series.status.reason, "no_source_selected");
});
