import assert from "node:assert/strict";
import test from "node:test";
import type { RequestIdentity } from "./requestContext";
import {
  isMarketDataProviderAuthorized,
  isMarketDataProviderGloballyShareable,
  resolveMarketDataScope,
  shouldUseGlobalMarketHistory,
} from "./marketDataScope";

function identity(overrides: Partial<RequestIdentity> = {}): RequestIdentity {
  return {
    userId: 7,
    organizationId: 3,
    credentials: { TWELVE_DATA_API_KEY: "top-secret-value" },
    selectedConnectorIds: ["bse_india", "twelve_data", "yahoo_finance"],
    providerStackOrder: ["bse_india", "twelve_data", "yahoo_finance"],
    dataStackPins: [{
      id: "pin-1",
      scope: "symbol",
      family: "ohlcv",
      symbol: "AAPL",
      metric: null,
      providerId: "twelve_data",
      reason: null,
      createdAt: "2026-09-29T00:00:00.000Z",
      createdByUserId: 7,
    }],
    communityYahooConsent: true,
    publicFillerConsent: false,
    ...overrides,
  };
}

test("market-data scope is stable without embedding credential values", () => {
  const first = resolveMarketDataScope(
    { projectId: 41, sourceScope: "auto" },
    identity(),
    { retail: true },
  );
  const rotated = resolveMarketDataScope(
    { projectId: 41, sourceScope: "auto" },
    identity({ credentials: { TWELVE_DATA_API_KEY: "rotated-secret-value" } }),
    { retail: true },
  );

  assert.equal(first.key, rotated.key);
  assert.equal(first.key.includes("top-secret-value"), false);
  assert.equal(first.key.includes("rotated-secret-value"), false);
});

test("market-data scope changes across user, Project, source scope, consent, connector selection and pins", () => {
  const base = resolveMarketDataScope({ projectId: 41, sourceScope: "auto" }, identity(), { retail: true }).key;
  const variants = [
    resolveMarketDataScope({ projectId: 41, sourceScope: "auto" }, identity({ userId: 8 }), { retail: true }).key,
    resolveMarketDataScope({ projectId: 42, sourceScope: "auto" }, identity(), { retail: true }).key,
    resolveMarketDataScope({ projectId: 41, sourceScope: "web" }, identity(), { retail: true }).key,
    resolveMarketDataScope({ projectId: 41, sourceScope: "auto" }, identity({ communityYahooConsent: false }), { retail: true }).key,
    resolveMarketDataScope({ projectId: 41, sourceScope: "auto" }, identity({ selectedConnectorIds: ["bse_india"] }), { retail: true }).key,
    resolveMarketDataScope({ projectId: 41, sourceScope: "auto" }, identity({ dataStackPins: [] }), { retail: true }).key,
  ];

  for (const variant of variants) assert.notEqual(variant, base);
});

test("anonymous/system market data keeps the legacy global namespace", () => {
  const resolved = resolveMarketDataScope({}, undefined, { retail: false });
  assert.equal(resolved.key, "global");
  assert.equal(resolved.scoped, false);
});

test("provider authorization respects consent and selected keyed connectors", () => {
  const allowed = resolveMarketDataScope({ projectId: 41, sourceScope: "auto" }, identity(), { retail: true });
  assert.equal(isMarketDataProviderAuthorized("bse_india", allowed), true);
  assert.equal(isMarketDataProviderAuthorized("yahoo_finance", allowed), true);
  assert.equal(isMarketDataProviderAuthorized("stooq", allowed), false);
  assert.equal(isMarketDataProviderAuthorized("twelve_data", allowed), true);
  assert.equal(isMarketDataProviderAuthorized("polygon", allowed), false);

  const onlyKeyed = resolveMarketDataScope(
    { projectId: 41, sourceScope: "auto" },
    identity({ selectedConnectorIds: ["twelve_data"] }),
    { retail: true },
  );
  assert.equal(isMarketDataProviderAuthorized("bse_india", onlyKeyed), false);
  assert.equal(isMarketDataProviderAuthorized("yahoo_finance", onlyKeyed), false);
  assert.equal(isMarketDataProviderAuthorized("coingecko", onlyKeyed), false);
  assert.equal(isMarketDataProviderAuthorized("twelve_data", onlyKeyed), true);

  const revoked = resolveMarketDataScope(
    { projectId: 41, sourceScope: "auto" },
    identity({ communityYahooConsent: false }),
    { retail: true },
  );
  assert.equal(isMarketDataProviderAuthorized("yahoo_finance", revoked), false);
});

test("legacy-unattributed persisted history is never globally shared into an authenticated scope", () => {
  const scope = resolveMarketDataScope({ projectId: 41, sourceScope: "auto" }, identity(), { retail: true });
  assert.equal(
    shouldUseGlobalMarketHistory(["bse_india"], scope, ["provider:bse_india"]),
    true,
  );
  assert.equal(
    shouldUseGlobalMarketHistory(["bse_india"], scope, ["provenance:legacy-unattributed", "provider:bse_india"]),
    false,
  );
});

test("only explicitly public first-party observations are globally shareable", () => {
  assert.equal(isMarketDataProviderGloballyShareable("bse_india"), true);
  assert.equal(isMarketDataProviderGloballyShareable("yahoo_finance"), false);
  assert.equal(isMarketDataProviderGloballyShareable("stooq"), false);
  assert.equal(isMarketDataProviderGloballyShareable("twelve_data"), false);
  assert.equal(isMarketDataProviderGloballyShareable("unknown"), false);
});
