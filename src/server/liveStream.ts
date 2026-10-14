/**
 * Real-time quote streaming via Finnhub's free WebSocket feed.
 *
 * Finnhub's free tier includes real-time US trade streaming (60 REST
 * calls/min, WebSocket included) — register at https://finnhub.io to get a
 * key. Trades stream in per-tick; this module batches them (2s flush) and
 * re-emits through the app's existing `quote_update` broadcast, which the
 * client's useLiveQuotes hook already merges into every visible panel. No
 * client changes needed.
 *
 * Wholly optional: without a key the module logs once and does nothing — the
 * app keeps its 15s polling behavior. The key is read from FINNHUB_API_KEY or
 * from ~/.limuria-terminal/config.json ({"finnhubApiKey": "..."}), so packaged
 * app users can enable it without an env var.
 *
 * Free-tier limits: ~50 concurrent symbol subscriptions, US symbols only.
 * Subscriptions track the user's watchlist (refreshed every 60s), filtered to
 * plain US tickers — international/index/futures symbols keep polling.
 */
import WebSocket from "ws";
import { getCredential } from "./terminalConfig";
import { getQuotes } from "./marketData";

type QuoteUpdate = { symbol: string; price: number; change: number; changePercent: number };
type Broadcast = (quotes: QuoteUpdate[]) => void;

const FLUSH_INTERVAL_MS = 2_000;
const WATCHLIST_REFRESH_MS = 60_000;
const PREV_CLOSE_REFRESH_MS = 60 * 60 * 1000;
const MAX_SUBSCRIPTIONS = 45; // stay under Finnhub's ~50 free-tier cap
const RATE_LIMIT_COOLDOWN_MS = 60_000;

function resolveApiKey(): string | null {
  return getCredential("FINNHUB_API_KEY", "finnhubApiKey");
}

/** Finnhub free streaming covers plain US tickers; skip ^GSPC, GC=F, 7203.T, BRK-B is ok. */
function isStreamableSymbol(symbol: string): boolean {
  return /^[A-Z][A-Z0-9\-]{0,9}$/.test(symbol);
}

export function initLiveStream(broadcast: Broadcast, getWatchlistSymbols: () => Promise<string[]>): () => void {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    console.log("Live streaming disabled (no FINNHUB_API_KEY or ~/.limuria-terminal/config.json finnhubApiKey). Quotes fall back to polling.");
    return () => {};
  }

  let ws: WebSocket | null = null;
  let stopped = false;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectDelayMs = 1_000;
  const subscribed = new Set<string>();
  const prevClose = new Map<string, number>();
  const pending = new Map<string, number>(); // symbol -> latest trade price awaiting flush

  async function refreshPrevClose(symbols: string[]): Promise<void> {
    if (!symbols.length) return;
    try {
      const quotes = await getQuotes(symbols);
      for (const quote of quotes) {
        if (quote.previousClose > 0) prevClose.set(quote.symbol, quote.previousClose);
      }
    } catch (err) {
      console.warn("Live stream: failed to refresh previous closes:", err);
    }
  }

  function send(message: object): void {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  async function syncSubscriptions(): Promise<void> {
    let symbols: string[];
    try {
      symbols = await getWatchlistSymbols();
    } catch {
      return;
    }
    const wanted = new Set(
      symbols.map((s) => s.toUpperCase()).filter(isStreamableSymbol).slice(0, MAX_SUBSCRIPTIONS),
    );

    const toAdd = Array.from(wanted).filter((s) => !subscribed.has(s));
    const toRemove = Array.from(subscribed).filter((s) => !wanted.has(s));
    for (const symbol of toRemove) {
      send({ type: "unsubscribe", symbol });
      subscribed.delete(symbol);
    }
    for (const symbol of toAdd) {
      send({ type: "subscribe", symbol });
      subscribed.add(symbol);
    }
    if (toAdd.length) await refreshPrevClose(toAdd);
  }

  function flush(): void {
    if (!pending.size) return;
    const updates: QuoteUpdate[] = [];
    for (const [symbol, price] of Array.from(pending.entries())) {
      const base = prevClose.get(symbol);
      if (!base || base <= 0) continue;
      const change = price - base;
      updates.push({
        symbol,
        price,
        change,
        changePercent: (change / base) * 100,
      });
    }
    pending.clear();
    if (updates.length) broadcast(updates);
  }

  function connect(): void {
    if (stopped || ws || reconnectTimer) return;
    ws = new WebSocket(`wss://ws.finnhub.io?token=${apiKey}`);

    ws.on("open", () => {
      reconnectDelayMs = 1_000;
      console.log("Live stream connected to Finnhub.");
      subscribed.clear(); // server-side subs are gone after reconnect; re-add all
      void syncSubscriptions();
    });

    ws.on("message", (raw) => {
      try {
        const message = JSON.parse(String(raw));
        if (message.type === "trade" && Array.isArray(message.data)) {
          for (const trade of message.data) {
            if (typeof trade.s === "string" && typeof trade.p === "number") {
              pending.set(trade.s, trade.p);
            }
          }
        }
      } catch {
        // malformed frame — ignore
      }
    });

    const reconnect = () => {
      ws = null;
      if (stopped || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, reconnectDelayMs);
      reconnectTimer.unref();
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, 60_000);
    };
    ws.on("close", () => {
      console.warn("Live stream disconnected; reconnecting...");
      reconnect();
    });
    ws.on("error", (err) => {
      console.warn("Live stream error:", err.message);
      if (/429|rate limit/i.test(err.message)) {
        reconnectDelayMs = RATE_LIMIT_COOLDOWN_MS;
        console.warn("Live stream rate limited; polling remains active and streaming will retry in 60 seconds.");
      }
      ws?.close();
    });
  }

  connect();
  const flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
  const subscriptionTimer = setInterval(() => void syncSubscriptions(), WATCHLIST_REFRESH_MS);
  const closeTimer = setInterval(() => void refreshPrevClose(Array.from(subscribed)), PREV_CLOSE_REFRESH_MS);

  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    clearInterval(flushTimer);
    clearInterval(subscriptionTimer);
    clearInterval(closeTimer);
    ws?.close();
    ws = null;
  };
}
