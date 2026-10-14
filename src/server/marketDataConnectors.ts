/**
 * LV4-05-09: which market-data connectors the current session can actually
 * reach right now. Deliberately its own module (not part of marketData.ts)
 * so server/bseIndiaQuote.ts can use it too without creating the circular
 * import marketData.ts already documents avoiding (marketData.ts imports
 * getBseIndiaQuote from bseIndiaQuote.ts, so bseIndiaQuote.ts cannot import
 * anything back from marketData.ts).
 */
import { hasCredential } from "./terminalConfig";
import { connectedKeyedAdapterIds } from "./keyedQuoteAdapters";
import {
  resolveMarketDataEntitlement,
  tierForProviderLabel,
  type MarketDataEntitlementSnapshot,
} from "@shared/marketDataEntitlement";

// Connector IDs treated as always reachable: no credential is required to
// use them, so they're never gated behind an entitlement.
const UNGATED_QUOTE_CONNECTOR_IDS = ["yahoo_finance", "coingecko", "bse_india"] as const;

export function connectedMarketDataConnectorIds(): string[] {
  return [
    ...UNGATED_QUOTE_CONNECTOR_IDS,
    ...(hasCredential("FINNHUB_API_KEY", "finnhubApiKey") ? ["finnhub"] : []),
    ...connectedKeyedAdapterIds(),
  ];
}

/** Resolves the entitlement snapshot for a quote already served from `providerLabel`,
 * without ever inferring a higher tier than what was actually served. */
export function resolveQuoteEntitlementFor(
  providerLabel: string,
  assetClass: "equity" | "crypto",
  instrumentExists: boolean,
): MarketDataEntitlementSnapshot {
  return resolveMarketDataEntitlement({
    instrumentExists,
    servedTier: tierForProviderLabel(providerLabel),
    connectedConnectorIds: connectedMarketDataConnectorIds(),
    assetClass,
  });
}
