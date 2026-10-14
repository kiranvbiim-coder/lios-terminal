import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveMarketDataEntitlement,
  tierForProviderLabel,
  compareMarketDataTier,
  type MarketDataConnectorCapability,
} from "./marketDataEntitlement";

const catalog: MarketDataConnectorCapability[] = [
  { connectorId: "rt_provider", label: "RT Provider", assetClass: "equity", tier: "real_time" },
  { connectorId: "delayed_provider", label: "Delayed Provider", assetClass: "equity", tier: "delayed" },
  { connectorId: "eod_provider", label: "EOD Provider", assetClass: "equity", tier: "eod" },
  { connectorId: "crypto_rt", label: "Crypto RT", assetClass: "crypto", tier: "real_time" },
];

test("an unknown instrument never implies any data access", () => {
  const result = resolveMarketDataEntitlement({
    instrumentExists: false,
    servedTier: "delayed",
    connectedConnectorIds: ["rt_provider"],
    assetClass: "equity",
    capabilities: catalog,
  });
  assert.equal(result.state, "instrument_unknown");
  assert.equal(result.servedTier, "none");
  assert.equal(result.entitlementRequired, false);
});

test("reference-only data reports reference_only when no better tier exists anywhere to connect", () => {
  const result = resolveMarketDataEntitlement({
    instrumentExists: true,
    servedTier: "reference",
    connectedConnectorIds: [],
    assetClass: "equity",
    capabilities: [],
  });
  assert.equal(result.state, "reference_only");
  assert.equal(result.entitlementRequired, false);
});

test("reference-only data with an unconnected better tier available correctly flags entitlement_required, not reference_only", () => {
  const result = resolveMarketDataEntitlement({
    instrumentExists: true,
    servedTier: "reference",
    connectedConnectorIds: [],
    assetClass: "equity",
    capabilities: catalog,
  });
  assert.equal(result.state, "entitlement_required");
  assert.equal(result.upgradeConnectorId, "rt_provider");
});

test("a connected real-time connector reports real_time_available, never masked", () => {
  const result = resolveMarketDataEntitlement({
    instrumentExists: true,
    servedTier: "real_time",
    connectedConnectorIds: ["rt_provider"],
    assetClass: "equity",
    capabilities: catalog,
  });
  assert.equal(result.state, "real_time_available");
  assert.equal(result.entitlementRequired, false);
});

test("serving delayed data while a real-time connector exists but is not connected flags entitlement_required", () => {
  const result = resolveMarketDataEntitlement({
    instrumentExists: true,
    servedTier: "delayed",
    connectedConnectorIds: [],
    assetClass: "equity",
    capabilities: catalog,
  });
  assert.equal(result.state, "entitlement_required");
  assert.equal(result.upgradeConnectorId, "rt_provider");
  assert.equal(result.upgradeConnectorLabel, "RT Provider");
  assert.match(result.reason, /RT Provider/);
});

test("a connected connector that only reaches delayed does not falsely claim real-time is unlockable by connecting it again", () => {
  const result = resolveMarketDataEntitlement({
    instrumentExists: true,
    servedTier: "delayed",
    connectedConnectorIds: ["delayed_provider"],
    assetClass: "equity",
    capabilities: catalog,
  });
  // rt_provider is still unconnected and strictly better than what's connected -- still a gap.
  assert.equal(result.state, "entitlement_required");
  assert.equal(result.upgradeConnectorId, "rt_provider");
});

test("a transient degraded response from an already-connected top-tier connector is not mislabeled as an entitlement gap", () => {
  const result = resolveMarketDataEntitlement({
    instrumentExists: true,
    servedTier: "delayed", // this one call happened to fall back
    connectedConnectorIds: ["rt_provider"], // but the session does hold real-time access
    assetClass: "equity",
    capabilities: catalog,
  });
  assert.equal(result.state, "delayed_available");
  assert.equal(result.entitlementRequired, false);
});

test("crypto asset class only considers crypto-tagged capabilities", () => {
  const result = resolveMarketDataEntitlement({
    instrumentExists: true,
    servedTier: "delayed",
    connectedConnectorIds: [],
    assetClass: "crypto",
    capabilities: catalog,
  });
  assert.equal(result.upgradeConnectorId, "crypto_rt");
});

test("no available capability anywhere in the catalog never fabricates an upgrade path", () => {
  const result = resolveMarketDataEntitlement({
    instrumentExists: true,
    servedTier: "eod",
    connectedConnectorIds: [],
    assetClass: "equity",
    capabilities: [],
  });
  assert.equal(result.state, "eod_available");
  assert.equal(result.entitlementRequired, false);
  assert.equal(result.upgradeConnectorId, null);
});

test("compareMarketDataTier orders the full ladder correctly", () => {
  assert.ok(compareMarketDataTier("real_time", "delayed") > 0);
  assert.ok(compareMarketDataTier("delayed", "eod") > 0);
  assert.ok(compareMarketDataTier("eod", "reference") > 0);
  assert.ok(compareMarketDataTier("reference", "none") > 0);
});

test("tierForProviderLabel maps known catalog labels and honors explicit daily/reference self-labels", () => {
  assert.equal(tierForProviderLabel("EODHD"), "real_time");
  assert.equal(tierForProviderLabel("Yahoo Finance"), "delayed");
  assert.equal(tierForProviderLabel("Polygon.io"), "eod");
  assert.equal(tierForProviderLabel("CBOE daily"), "eod");
  assert.equal(tierForProviderLabel("Stooq daily fallback"), "eod");
  assert.equal(tierForProviderLabel("Cached daily history"), "eod");
  assert.equal(tierForProviderLabel("Reference fallback"), "reference");
  assert.equal(tierForProviderLabel("Some unmapped vendor"), "reference");
});
