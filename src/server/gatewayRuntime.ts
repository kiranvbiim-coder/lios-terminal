import { GatewayHub } from "./gatewayHub";
import type { GatewayConnection } from "./gatewayHub";
import type { GatewayInvalidationTopic } from "@shared/gatewayProtocol";

/** The one Gateway of this LiOS Home (GM-08a). Features register their methods here; index.ts only attaches sockets.
 * Pairing is a handshake, not perpetual method authority. Revalidate the
 * canonical paired-device/account state for every RPC (including generic
 * conversation and quotes methods), without creating a second device store.
 */
export const gatewayHub = new GatewayHub({
  version: process.env.LIOS_PUBLIC_VERSION ?? "dev",
  authorizeRequest: async (connection, scope) => {
    // Lazy import avoids the deviceRuntime ↔ gatewayRuntime init cycle.
    const { requireCurrentGatewayUser } = await import("./gatewayDeviceContinuity");
    await requireCurrentGatewayUser(connection, scope);
  },
});

const QUOTE_SUBSCRIPTIONS = "quotes.symbols";
const MAX_SUBSCRIBED_SYMBOLS = 500;

function subscribedSymbols(connection: GatewayConnection): Set<string> {
  let symbols = connection.state.get(QUOTE_SUBSCRIPTIONS) as Set<string> | undefined;
  if (!symbols) {
    symbols = new Set<string>();
    connection.state.set(QUOTE_SUBSCRIPTIONS, symbols);
  }
  return symbols;
}

gatewayHub.register("quotes.subscribe", ({ symbols }, connection) => {
  const subscribed = subscribedSymbols(connection);
  const requested = symbols.map((symbol) => symbol.toUpperCase());
  for (const symbol of requested) {
    if (subscribed.size >= MAX_SUBSCRIBED_SYMBOLS && !subscribed.has(symbol)) break;
    subscribed.add(symbol);
  }
  return { subscribed: requested.filter((symbol) => subscribed.has(symbol)), total: subscribed.size };
});

gatewayHub.register("quotes.unsubscribe", ({ symbols }, connection) => {
  const subscribed = subscribedSymbols(connection);
  for (const symbol of symbols) subscribed.delete(symbol.toUpperCase());
  return { total: subscribed.size };
});

/** Sends each connection only the quotes it subscribed to (previously every client received every quote). */
export function publishQuoteUpdate(quotes: Array<{ symbol: string; price: number; change: number; changePercent: number }>): void {
  gatewayHub.publish("quotes.update", (connection) => {
    const subscribed = connection.state.get(QUOTE_SUBSCRIPTIONS) as Set<string> | undefined;
    if (!subscribed || subscribed.size === 0) return null;
    const selected = quotes.filter((quote) => subscribed.has(quote.symbol.toUpperCase()));
    return selected.length > 0 ? { quotes: selected } : null;
  });
}

/**
 * Tells connected clients that data they may hold has changed. `userId` limits it to that user's connections;
 * `homeOwner` limits it to connections with the admin scope (backups, licence). Nothing is sent about *what* changed.
 */
export function notifyDataChanged(topic: GatewayInvalidationTopic, audience: { userId: number } | { homeOwner: true }): void {
  gatewayHub.publish("data.invalidate", (connection) => {
    const allowed = "userId" in audience ? connection.identity.userId === audience.userId : connection.scopes.includes("admin");
    return allowed ? { topics: [topic] } : null;
  });
}
