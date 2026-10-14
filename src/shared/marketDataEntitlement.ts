/**
 * LiOS V4 market-data entitlement resolver (LV4-05-09).
 *
 * Separates what an instrument *has* from what the current session is
 * actually entitled to see, per the six states the V4-05 master plan
 * requires: instrument exists, reference data available, EOD available,
 * delayed quote available, real-time available, entitlement required/not
 * granted. A quote's freshness badge (see shared/dataStatus.ts) answers
 * "was this specific response fetched just now or served from cache" --
 * a different question from this module's "what access tier does the
 * source that served it actually have." A Yahoo Finance quote can be
 * `freshness: "current"` (fetched this second) while still being tier
 * `"delayed"` here, because Yahoo carries no documented real-time SLA.
 * Never infer a higher tier than a connector's own documented behavior
 * supports, and never infer real-time simply because an instrument
 * exists or a fetch just succeeded.
 */

export type MarketDataTier = "none" | "reference" | "eod" | "delayed" | "real_time";

const TIER_RANK: Record<MarketDataTier, number> = {
  none: 0,
  reference: 1,
  eod: 2,
  delayed: 3,
  real_time: 4,
};

/** Positive when `a` outranks `b`, negative when `b` outranks `a`, zero when equal. */
export function compareMarketDataTier(a: MarketDataTier, b: MarketDataTier): number {
  return TIER_RANK[a] - TIER_RANK[b];
}

/**
 * Declares the *ceiling* tier a connector can serve for one asset class,
 * grounded in that connector's actual adapter implementation and its own
 * documented endpoint behavior -- never a vendor-marketing claim this
 * codebase can't verify from the code that calls it. See the inline
 * evidence comment on each catalog entry below.
 */
export interface MarketDataConnectorCapability {
  connectorId: string;
  label: string;
  assetClass: "equity" | "crypto";
  tier: MarketDataTier;
}

export const MARKET_DATA_CONNECTOR_CAPABILITIES: readonly MarketDataConnectorCapability[] = [
  // Finnhub: dedicated wss://ws.finnhub.io real-time trade stream
  // (server/liveStream.ts); registry description: "Real-time US equity
  // quotes...WebSocket streaming."
  { connectorId: "finnhub", label: "Finnhub", assetClass: "equity", tier: "real_time" },
  // EODHD: server/keyedQuoteAdapters.ts calls EODHD's own documented
  // live-realtime-stocks-api endpoint, not an EOD-only one.
  { connectorId: "eodhd", label: "EODHD", assetClass: "equity", tier: "real_time" },
  // Twelve Data: adapter calls the /quote endpoint (Twelve Data's
  // real-time quote endpoint); registry: "real-time and historical
  // coverage."
  { connectorId: "twelve_data", label: "Twelve Data", assetClass: "equity", tier: "real_time" },
  // Tiingo: IEX top-of-book snapshot; registry: "IEX real-time prices."
  // Delivered via polling REST rather than a websocket push, but the
  // underlying IEX feed itself is real-time, not delayed.
  { connectorId: "tiingo", label: "Tiingo", assetClass: "equity", tier: "real_time" },
  // Alpha Vantage: no real-time SLA is documented anywhere in this
  // codebase's own registry copy for GLOBAL_QUOTE -- treated
  // conservatively as delayed rather than assumed real-time.
  { connectorId: "alpha_vantage", label: "Alpha Vantage", assetClass: "equity", tier: "delayed" },
  // Polygon.io free tier as actually called by this adapter: the
  // previous-day aggregate bar endpoint only (prior day's close), not a
  // live quote -- see polygonAdapter's own header comment. The
  // registry's general-product description mentions Polygon's paid
  // real-time tier, but this codebase does not call that endpoint, so
  // what's actually served is EOD.
  { connectorId: "polygon", label: "Polygon.io", assetClass: "equity", tier: "eod" },
  // Yahoo Finance: this app's default/base fallback path for both equity
  // and crypto quotes. No documented real-time SLA.
  { connectorId: "yahoo_finance", label: "Yahoo Finance", assetClass: "equity", tier: "delayed" },
  { connectorId: "yahoo_finance", label: "Yahoo Finance", assetClass: "crypto", tier: "delayed" },
  // BSE India: server/bseIndiaQuote.ts's own header comment labels this an
  // unofficial, unauthenticated endpoint with no documented SLA -- the
  // author already made this exact call at the source (freshness:
  // "delayed", "labeled honestly rather than claimed as true real-time").
  { connectorId: "bse_india", label: "BSE India", assetClass: "equity", tier: "delayed" },
  // CoinMarketCap: aggregated "latest quotes" snapshot, not a live tick
  // feed.
  { connectorId: "coinmarketcap", label: "CoinMarketCap", assetClass: "crypto", tier: "delayed" },
  // CoinGecko: free public aggregator with no documented real-time SLA.
  { connectorId: "coingecko", label: "CoinGecko", assetClass: "crypto", tier: "delayed" },
] as const;

/**
 * Maps the exact provider label strings server/marketData.ts already
 * attaches to a quote's status onto a served tier. Labels that explicitly
 * self-describe as daily/EOD ("CBOE daily", "Stooq daily fallback",
 * "Cached daily history") are honored as `eod` even though they aren't in
 * the connector capability catalog above -- they are bespoke daily feeds,
 * not connectors a user can upgrade by connecting a key. An unrecognized
 * label degrades to `reference` rather than guessing a higher tier.
 */
export function tierForProviderLabel(providerLabel: string): MarketDataTier {
  const catalogMatch = MARKET_DATA_CONNECTOR_CAPABILITIES.find((c) => c.label === providerLabel);
  if (catalogMatch) return catalogMatch.tier;
  if (/daily|cached/i.test(providerLabel)) return "eod";
  if (/reference/i.test(providerLabel)) return "reference";
  return "reference";
}

export type MarketDataEntitlementState =
  | "instrument_unknown"
  | "reference_only"
  | "eod_available"
  | "delayed_available"
  | "real_time_available"
  | "entitlement_required";

export interface MarketDataEntitlementSnapshot {
  state: MarketDataEntitlementState;
  servedTier: MarketDataTier;
  bestAvailableTier: MarketDataTier;
  entitlementRequired: boolean;
  upgradeConnectorId: string | null;
  upgradeConnectorLabel: string | null;
  reason: string;
}

function stateForTier(tier: MarketDataTier): Exclude<MarketDataEntitlementState, "entitlement_required" | "instrument_unknown"> {
  switch (tier) {
    case "real_time":
      return "real_time_available";
    case "delayed":
      return "delayed_available";
    case "eod":
      return "eod_available";
    case "reference":
    case "none":
      return "reference_only";
  }
}

function servedTierReason(tier: MarketDataTier): string {
  switch (tier) {
    case "real_time":
      return "Served from a verified real-time connector.";
    case "delayed":
      return "Served from a delayed quote feed; no verified real-time connector is connected for this instrument.";
    case "eod":
      return "Only end-of-day data is being served for this instrument.";
    case "reference":
    case "none":
      return "Only reference/profile data is available; no priced quote could be served.";
  }
}

export interface MarketDataEntitlementInput {
  /** Whether the local instrument catalog resolves any reference record for this symbol at all. */
  instrumentExists: boolean;
  /** The tier the data actually served to this caller came from. */
  servedTier: MarketDataTier;
  /** Connector IDs the current session can reach right now (credentialed, not cooling down). */
  connectedConnectorIds: readonly string[];
  assetClass: "equity" | "crypto";
  /** Defaults to the module-level catalog; overridable for tests. */
  capabilities?: readonly MarketDataConnectorCapability[];
}

/**
 * Pure resolver: given what was actually served and what this session can
 * actually reach, produces one of the six master-plan entitlement states.
 * `entitlement_required` fires only when a strictly better tier exists in
 * the catalog for this asset class AND no currently-connected connector
 * can reach it -- a connected real-time connector that happened to serve
 * degraded data on this one call (a transient failure) still reports the
 * tier it served, not a spurious entitlement gap.
 */
export function resolveMarketDataEntitlement(input: MarketDataEntitlementInput): MarketDataEntitlementSnapshot {
  if (!input.instrumentExists) {
    return {
      state: "instrument_unknown",
      servedTier: "none",
      bestAvailableTier: "none",
      entitlementRequired: false,
      upgradeConnectorId: null,
      upgradeConnectorLabel: null,
      reason: "No reference record exists for this instrument in the local instrument catalog.",
    };
  }

  const capabilities = input.capabilities ?? MARKET_DATA_CONNECTOR_CAPABILITIES;
  const applicable = capabilities.filter((c) => c.assetClass === input.assetClass);
  const connected = new Set(input.connectedConnectorIds);

  let bestConnected: MarketDataConnectorCapability | null = null;
  let bestOverall: MarketDataConnectorCapability | null = null;
  for (const cap of applicable) {
    if (!bestOverall || compareMarketDataTier(cap.tier, bestOverall.tier) > 0) bestOverall = cap;
    if (connected.has(cap.connectorId) && (!bestConnected || compareMarketDataTier(cap.tier, bestConnected.tier) > 0)) {
      bestConnected = cap;
    }
  }

  const bestAvailableTier = bestOverall?.tier ?? "none";
  const bestConnectedTier = bestConnected?.tier ?? "none";
  const entitlementRequired = bestOverall !== null &&
    compareMarketDataTier(bestOverall.tier, input.servedTier) > 0 &&
    compareMarketDataTier(bestConnectedTier, bestOverall.tier) < 0;

  return {
    state: entitlementRequired ? "entitlement_required" : stateForTier(input.servedTier),
    servedTier: input.servedTier,
    bestAvailableTier,
    entitlementRequired,
    upgradeConnectorId: entitlementRequired ? bestOverall!.connectorId : null,
    upgradeConnectorLabel: entitlementRequired ? bestOverall!.label : null,
    reason: entitlementRequired
      ? `${bestOverall!.label} offers ${bestOverall!.tier.replace("_", " ")} data for this instrument; connect it to upgrade from ${input.servedTier.replace("_", " ")}.`
      : servedTierReason(input.servedTier),
  };
}
