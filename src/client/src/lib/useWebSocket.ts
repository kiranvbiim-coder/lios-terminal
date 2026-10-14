import { useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { GatewayClient } from "./gateway/gatewayClient";
import { useGateway, useGatewayEvent } from "./gateway/GatewayProvider";
import { queryClient } from "./queryClient";

export type QuoteUpdate = { symbol: string } & Record<string, unknown>;

/**
 * Applies live quote ticks to the TanStack Query cache.
 *
 * Merge onto the existing cached quote rather than replacing it -- the tick payload only
 * carries live-price fields (price/change/volume/...), not the full REST shape
 * (marketCap/pe/sector/status/...); a plain replace was silently wiping those fields on
 * every tick. If there's no existing entry yet, skip rather than seed the cache with a
 * partial quote -- returning undefined from the updater is a no-op, so we wait for the REST
 * fetch to populate the full shape instead of leaving consumers to dereference missing
 * fields (e.g. q.status.isFallback) on a narrow live-only object.
 */
export function applyQuoteUpdate(client: QueryClient, quotes: QuoteUpdate[]): void {
  // Single quotes.
  quotes.forEach((q) => {
    client.setQueryData(["/api/finance/quote", q.symbol], (old: any) => (old ? { ...old, ...q } : old));
  });

  // Multi-quote queries (watchlist).
  client.setQueriesData<any[]>({ queryKey: ["/api/finance/quotes"] }, (oldData) => {
    if (!Array.isArray(oldData)) return oldData;
    return oldData.map((oldQuote) => {
      const update = quotes.find((q) => q.symbol === oldQuote.symbol);
      return update ? { ...oldQuote, ...update } : oldQuote;
    });
  });

  // Movers/active lists.
  ["gainers", "losers", "active"].forEach((key) => {
    client.setQueriesData<any[]>({ queryKey: ["/api/finance", key] }, (oldData) => {
      if (!Array.isArray(oldData)) return oldData;
      return oldData.map((oldQuote) => {
        const update = quotes.find((q) => q.symbol === oldQuote.symbol);
        return update ? { ...oldQuote, ...update } : oldQuote;
      });
    });
  });
}

// Several hooks may watch the same symbol; the Gateway subscription is per connection, so a
// symbol is only unsubscribed when its last holder lets go.
const holders = new WeakMap<GatewayClient, Record<string, number>>();

function adjust(gateway: GatewayClient, symbols: string[], delta: 1 | -1): string[] {
  const counts = holders.get(gateway) ?? {};
  holders.set(gateway, counts);
  const changed: string[] = [];
  for (const symbol of symbols) {
    const next = (counts[symbol] ?? 0) + delta;
    if (next <= 0) delete counts[symbol];
    else counts[symbol] = next;
    if ((delta === 1 && next === 1) || (delta === -1 && next <= 0)) changed.push(symbol);
  }
  return changed;
}

function send(gateway: GatewayClient, method: "quotes.subscribe" | "quotes.unsubscribe", symbols: string[]): void {
  if (!symbols.length || gateway.state !== "ready") return;
  gateway.request(method, { symbols }).catch(() => {}); // live quotes are an enhancement only
}

export function useLiveQuotes(symbols: string[]) {
  const gateway = useGateway();
  const held = useRef<string[]>([]);
  const key = [...new Set(symbols.map((s) => s.trim()).filter(Boolean))].join(",");

  useEffect(() => {
    if (!gateway) return;
    const next = key ? key.split(",") : [];
    const added = next.filter((s) => !held.current.includes(s));
    const removed = held.current.filter((s) => !next.includes(s));
    held.current = next;
    send(gateway, "quotes.subscribe", adjust(gateway, added, 1));
    send(gateway, "quotes.unsubscribe", adjust(gateway, removed, -1));
  }, [gateway, key]);

  useEffect(() => {
    if (!gateway) return;
    const offReady = gateway.onReady(() => send(gateway, "quotes.subscribe", held.current));
    return () => {
      offReady();
      send(gateway, "quotes.unsubscribe", adjust(gateway, held.current, -1));
      held.current = [];
    };
  }, [gateway]);

  useGatewayEvent("quotes.update", (payload) => applyQuoteUpdate(queryClient, payload.quotes));
}
