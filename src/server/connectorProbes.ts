/**
 * Registers cheap, user-initiated live probes for connectors whose "Test
 * connection" click should actually call the vendor's API rather than
 * just re-reading a cached credential-presence guess.
 *
 * Scoped to the six keyedQuoteAdapters.ts providers, which already expose
 * a uniform fetchQuote(symbol) built for exactly this kind of one-off
 * call. Other real-but-domain-specific connectors (FRED, Finnhub, LSE,
 * SimFin, FMP, SEC EDGAR, World Bank, BLS, Yahoo Finance, and CoinGecko) are verified passively from real production traffic instead
 * (see each module's own fetch call plus connectorVerification.ts); a
 * forced synthetic probe isn't wired for those yet, so their "Test
 * connection" action reports the connector's last passively-observed
 * state rather than a fabricated live result.
 *
 * Importing this module registers the probes as a side effect --
 * sourceConnectionService.ts imports it once for that purpose.
 */
import { KEYED_QUOTE_ADAPTERS } from "./keyedQuoteAdapters";
import { registerConnectorProbe } from "./connectorVerification";

const CANARY_SYMBOL: Record<"equity" | "crypto", string> = {
  equity: "AAPL",
  crypto: "BTC",
};

for (const adapter of KEYED_QUOTE_ADAPTERS) {
  const symbol = CANARY_SYMBOL[adapter.assetClasses[0]] ?? CANARY_SYMBOL.equity;
  registerConnectorProbe(adapter.id, async () => {
    if (!adapter.isAvailable()) {
      return { ok: false, detail: `${adapter.label} has no credential configured, or is in an active rate-limit cooldown.` };
    }
    const quote = await adapter.fetchQuote(symbol);
    if (!quote) return { ok: false, detail: `${adapter.label} returned no usable quote for ${symbol}.` };
    return { ok: true, detail: `${adapter.label} returned a live quote for ${symbol} (close ${quote.close}).` };
  });
}
