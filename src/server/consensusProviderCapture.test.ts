import assert from "node:assert/strict";
import test from "node:test";
import { captureProviderConsensus } from "./consensusProviderCapture";

test("provider-neutral consensus capture rejects empty observations before persistence", async () => {
  await assert.rejects(
    captureProviderConsensus({
      symbol: "AAPL",
      provider: "licensed-feed",
      sourceName: "Licensed feed",
      sourceType: "licensed_provider",
      methodology: "Provider aggregate supplied by the connected licensed feed.",
      observations: [],
    }, 1),
    /No usable consensus observations/,
  );
});

test("provider-neutral consensus capture validates symbol and provider identity before persistence", async () => {
  await assert.rejects(
    captureProviderConsensus({
      symbol: " ",
      provider: "licensed-feed",
      sourceName: "Licensed feed",
      methodology: "Provider aggregate.",
      observations: [{
        metric: "eps",
        fiscalPeriod: "FY2026",
        unit: "currency-per-share",
        currency: "USD",
        mean: 1,
        median: 1,
        high: 1,
        low: 1,
        contributorCount: 1,
        metadata: {},
      }],
    }, 1),
    /Consensus symbol is required/,
  );

  await assert.rejects(
    captureProviderConsensus({
      symbol: "AAPL",
      provider: " ",
      sourceName: "Licensed feed",
      methodology: "Provider aggregate.",
      observations: [{
        metric: "eps",
        fiscalPeriod: "FY2026",
        unit: "currency-per-share",
        currency: "USD",
        mean: 1,
        median: 1,
        high: 1,
        low: 1,
        contributorCount: 1,
        metadata: {},
      }],
    }, 1),
    /Consensus provider id is required/,
  );
});
