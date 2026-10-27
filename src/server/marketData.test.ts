import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregatePricePoints,
  buildNewsWindowQuery,
  buildQuoteFromSnapshot,
  dedupeNewsItems,
  extractArticleContent,
  filterAndPageScreenerResults,
  filterNewsItems,
  mapRangeToYahoo,
  parseNewsFeed,
  parseStooqCurrent,
  parseStooqHistory,
  parseYahooChart,
} from "./marketData";

test("aggregatePricePoints resamples five-minute points into fifteen-minute OHLCV bars", () => {
  const bars = aggregatePricePoints(
    [
      { timestamp: Date.parse("2026-03-17T14:00:00.000Z"), price: 100, volume: 10 },
      { timestamp: Date.parse("2026-03-17T14:05:00.000Z"), price: 105, volume: 12 },
      { timestamp: Date.parse("2026-03-17T14:10:00.000Z"), price: 103, volume: 11 },
      { timestamp: Date.parse("2026-03-17T14:15:00.000Z"), price: 108, volume: 20 },
    ],
    "15m",
  );

  assert.deepEqual(bars, [
    { date: "2026-03-17T14:00:00.000Z", open: 100, high: 105, low: 100, close: 103, volume: 33 },
    { date: "2026-03-17T14:15:00.000Z", open: 108, high: 108, low: 108, close: 108, volume: 20 },
  ]);
});

test("parseStooqCurrent parses current quote csv rows", () => {
  const current = parseStooqCurrent("AAPL.US,20260316,210017,252.105,253.885,249.88,252.82,32074210,");

  assert.deepEqual(current, {
    open: 252.105,
    high: 253.885,
    low: 249.88,
    close: 252.82,
    volume: 32074210,
    date: "2026-03-16",
    time: "21:00:17",
  });
});

test("parseStooqCurrent treats N/D volume as zero", () => {
  const current = parseStooqCurrent("^SPX,20260316,230000,6674.37,6729.79,6674.37,6699.38,N/D,");

  assert.equal(current.volume, 0);
});

test("parseStooqCurrent rejects non-csv payloads", () => {
  assert.throws(() => parseStooqCurrent("</html>"), /No current quote data|Malformed current quote row/);
});

test("parseStooqHistory returns ordered OHLCV bars", () => {
  const bars = parseStooqHistory([
    "Date,Open,High,Low,Close,Volume",
    "2026-03-13,241.25,244.91,240.10,242.84,51000000",
    "2026-03-14,243.10,246.12,242.90,245.18,49800000",
  ].join("\n"));

  assert.deepEqual(bars, [
    { date: "2026-03-13", open: 241.25, high: 244.91, low: 240.1, close: 242.84, volume: 51000000 },
    { date: "2026-03-14", open: 243.1, high: 246.12, low: 242.9, close: 245.18, volume: 49800000 },
  ]);
});

test("parseStooqHistory normalizes unavailable volume to zero", () => {
  const bars = parseStooqHistory([
    "Date,Open,High,Low,Close,Volume",
    "2026-03-13,17.24,17.24,17.24,17.24,N/D",
  ].join("\n"));

  assert.deepEqual(bars, [
    { date: "2026-03-13", open: 17.24, high: 17.24, low: 17.24, close: 17.24, volume: 0 },
  ]);
});

test("parseYahooChart returns ordered OHLCV bars and skips null closes", () => {
  const bars = parseYahooChart({
    chart: {
      result: [{
        timestamp: [1773667740, 1773667800, 1773667860],
        indicators: {
          quote: [{
            open: [252.77, 252.82, 252.81],
            high: [252.87, 252.97, 252.83],
            low: [252.72, 252.78, 252.8],
            close: [252.82, 252.78, null],
            volume: [170602, 470009, 10],
          }],
        },
      }],
      error: null,
    },
  }, "1m");

  assert.deepEqual(bars, [
    { date: "2026-03-16T13:29:00.000Z", open: 252.77, high: 252.87, low: 252.72, close: 252.82, volume: 170602 },
    { date: "2026-03-16T13:30:00.000Z", open: 252.82, high: 252.97, low: 252.78, close: 252.78, volume: 470009 },
  ]);
});

test("parseYahooChart deduplicates repeated daily timestamps for the same session", () => {
  const bars = parseYahooChart({
    chart: {
      result: [{
        timestamp: [1773667800, 1773691203],
        indicators: {
          quote: [{
            open: [252.11, 252.1],
            high: [253.89, 253.88],
            low: [249.88, 249.88],
            close: [252.82, 252.82],
            volume: [32060100, 30091880],
          }],
        },
      }],
      error: null,
    },
  }, "1d");

  assert.deepEqual(bars, [
    { date: "2026-03-16", open: 252.1, high: 253.89, low: 249.88, close: 252.82, volume: 30091880 },
  ]);
});

test("buildQuoteFromSnapshot derives observed price fields without injecting catalog fundamentals", () => {
  const quote = buildQuoteFromSnapshot({
    symbol: "AAPL",
    provider: "Yahoo Finance",
    profile: {
      name: "Apple Inc.",
      exchange: "NASDAQ",
      sector: "Technology",
      marketCap: 3_400_000_000_000,
      referencePrice: 242,
      eps: 6.5,
    },
    current: {
      open: 252.105,
      high: 253.885,
      low: 249.88,
      close: 252.82,
      volume: 32074210,
      date: "2026-03-16",
      time: "21:00:17",
    },
    history: [
      { date: "2026-03-13", open: 241.25, high: 244.91, low: 240.1, close: 242.84, volume: 51000000 },
      { date: "2026-03-14", open: 243.1, high: 246.12, low: 242.9, close: 245.18, volume: 49800000 },
      { date: "2026-03-16", open: 252.11, high: 253.89, low: 249.88, close: 252.82, volume: 32074210 },
    ],
  });

  assert.equal(quote.symbol, "AAPL");
  assert.equal(quote.name, "Apple Inc.");
  assert.equal(quote.exchange, "NASDAQ");
  assert.equal(quote.sector, "Technology");
  assert.equal(quote.previousClose, 245.18);
  assert.equal(quote.change, 7.64);
  assert.equal(quote.changePercent, 3.12);
  assert.equal(quote.dayHigh, 253.885);
  assert.equal(quote.dayLow, 249.88);
  assert.equal(quote.avgVolume, 44291403);
  assert.equal(quote.high52, 253.89);
  assert.equal(quote.low52, 240.1);
  assert.equal(quote.eps, null);
  assert.equal(quote.pe, null);
  assert.equal(quote.marketCap, null);
  assert.equal(quote.quoteSource, "Limuria Intelligence");
  assert.equal(quote.isLive, true);
  assert.deepEqual(quote.status, {
    provider: "Limuria Intelligence",
    freshness: "current",
    asOf: "2026-03-16T21:00:17.000Z",
    delayLabel: "Current session",
    isFallback: false,
  });
});

test("buildQuoteFromSnapshot attaches a well-formed entitlement snapshot instead of leaving access tier unclassified", () => {
  const quote = buildQuoteFromSnapshot({
    symbol: "AAPL",
    provider: "Yahoo Finance",
    profile: { name: "Apple Inc.", exchange: "NASDAQ" },
    current: { open: 100, high: 101, low: 99, close: 100.5, volume: 1000, date: "2026-03-16", time: "21:00:00" },
    history: [],
  });
  const validStates = [
    "instrument_unknown", "reference_only", "eod_available",
    "delayed_available", "real_time_available", "entitlement_required",
  ];
  assert.ok(validStates.includes(quote.entitlement.state), `unexpected entitlement state: ${quote.entitlement.state}`);
  // A profile was supplied, so this is never "the instrument doesn't exist".
  assert.notEqual(quote.entitlement.state, "instrument_unknown");
  // Yahoo Finance is never the real-time tier -- no documented SLA backs that claim.
  assert.notEqual(quote.entitlement.servedTier, "real_time");
});

test("buildQuoteFromSnapshot without a profile reports the instrument as unknown, never inferring reference data that wasn't resolved", () => {
  const quote = buildQuoteFromSnapshot({
    symbol: "ZZZZ-NOT-REAL",
    provider: "Yahoo Finance",
    current: { open: 1, high: 1, low: 1, close: 1, volume: 0, date: "2026-03-16", time: "00:00:00" },
    history: [],
  });
  assert.equal(quote.entitlement.state, "instrument_unknown");
  assert.equal(quote.entitlement.servedTier, "none");
});

test("parseNewsFeed normalizes rss items and infers sentiment", () => {
  const items = parseNewsFeed(`<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <item>
          <title>Apple jumps after earnings beat - Reuters</title>
          <description>Shares rally as revenue tops expectations and guidance improves.</description>
          <link>https://example.com/apple</link>
          <pubDate>Mon, 17 Mar 2026 10:00:00 GMT</pubDate>
        </item>
        <item>
          <title>Oil falls as recession fears grow</title>
          <description>Demand concerns pressure crude lower in early trading.</description>
          <link>https://example.com/oil</link>
          <pubDate>Mon, 17 Mar 2026 09:00:00 GMT</pubDate>
          <source url="https://www.cnbc.com">CNBC</source>
        </item>
      </channel>
    </rss>`, "Google News");

  assert.deepEqual(items, [
    {
      title: "Apple jumps after earnings beat",
      summary: "Shares rally as revenue tops expectations and guidance improves.",
      url: "https://example.com/apple",
      source: "Reuters",
      feedProvider: "Limuria Intelligence",
      publishedAt: "2026-03-17T10:00:00.000Z",
      sentiment: "positive",
      status: {
        provider: "Limuria Intelligence",
        freshness: "feed",
        asOf: "2026-03-17T10:00:00.000Z",
        delayLabel: "Feed-based publication metadata",
        isFallback: false,
      },
    },
    {
      title: "Oil falls as recession fears grow",
      summary: "Demand concerns pressure crude lower in early trading.",
      url: "https://example.com/oil",
      source: "CNBC",
      feedProvider: "Limuria Intelligence",
      publishedAt: "2026-03-17T09:00:00.000Z",
      sentiment: "negative",
      status: {
        provider: "Limuria Intelligence",
        freshness: "feed",
        asOf: "2026-03-17T09:00:00.000Z",
        delayLabel: "Feed-based publication metadata",
        isFallback: false,
      },
    },
  ]);
});

test("parseNewsFeed tags feed-based items with transport metadata", () => {
  const [item] = parseNewsFeed(`<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <item>
          <title>Apple supplier expands production - Reuters</title>
          <description>Production capacity rises ahead of the new launch cycle.</description>
          <link>https://example.com/apple-supplier</link>
          <pubDate>Mon, 17 Mar 2026 10:00:00 GMT</pubDate>
        </item>
      </channel>
    </rss>`, "Google News");

  assert.equal(item.feedProvider, "Limuria Intelligence");
  assert.deepEqual(item.status, {
    provider: "Limuria Intelligence",
    freshness: "feed",
    asOf: "2026-03-17T10:00:00.000Z",
    delayLabel: "Feed-based publication metadata",
    isFallback: false,
  });
});


test("filterNewsItems matches query across title summary and source", () => {
  const items = [
    {
      title: "Apple launches enterprise AI push",
      summary: "New tooling targets large business deployments.",
      url: "https://example.com/apple-ai",
      source: "CNBC",
      publishedAt: "2026-03-17T10:00:00.000Z",
      sentiment: "positive" as const,
    },
    {
      title: "Oil slides after inventory build",
      summary: "Crude weakens as supply fears ease.",
      url: "https://example.com/oil",
      source: "Reuters",
      publishedAt: "2026-03-17T09:00:00.000Z",
      sentiment: "negative" as const,
    },
  ];

  assert.deepEqual(filterNewsItems(items, "enterprise"), [items[0]]);
  assert.deepEqual(filterNewsItems(items, "reuters"), [items[1]]);
  assert.deepEqual(filterNewsItems(items, "crude"), [items[1]]);
});

test("extractArticleContent prefers article paragraphs and strips boilerplate", () => {
  const article = extractArticleContent(`<!doctype html>
    <html>
      <head>
        <title>Example</title>
        <style>.hidden{display:none}</style>
      </head>
      <body>
        <header>Site Header</header>
        <article>
          <h1>Apple expands terminal workflow</h1>
          <p>Apple shares rose after the company detailed its new enterprise roadmap.</p>
          <p>The update includes newsroom search, article read-through, and terminal pane workflows.</p>
        </article>
        <footer>Footer boilerplate</footer>
      </body>
    </html>`);

  assert.deepEqual(article, [
    "Apple expands terminal workflow",
    "Apple shares rose after the company detailed its new enterprise roadmap.",
    "The update includes newsroom search, article read-through, and terminal pane workflows.",
  ]);
});

test("mapRangeToYahoo uses only valid Yahoo range tokens", () => {
  assert.equal(mapRangeToYahoo("3Y"), "5y");
  assert.equal(mapRangeToYahoo("5Y"), "5y");
  assert.equal(mapRangeToYahoo("25Y"), "max");
  assert.equal(mapRangeToYahoo("MAX"), "max");
});
test("news windows remove relative clauses and add bounded date clauses", () => {
  const query = buildNewsWindowQuery("AAPL stock when:7d", 2, { windowDays: 7 });
  assert.match(query, /^AAPL stock after:\d{4}-\d{2}-\d{2} before:\d{4}-\d{2}-\d{2}$/);
  // Google News "after" is exclusive; the inclusive FROM date is enforced locally on publishedAt.
  assert.equal(buildNewsWindowQuery("AAPL", 1, { from: "2026-01-01", to: "2026-01-31" }), "AAPL after:2025-12-31 before:2026-02-01");
});

test("news dedupe is deterministic by URL and publication time", () => {
  const [first, duplicate, second] = parseNewsFeed(`<rss><channel>
    <item><title>One - Reuters</title><link>https://example.test/one</link><pubDate>Tue, 17 Mar 2026 12:00:00 GMT</pubDate></item>
    <item><title>Duplicate - Reuters</title><link>https://example.test/one</link><pubDate>Tue, 17 Mar 2026 11:00:00 GMT</pubDate></item>
    <item><title>Two - AP</title><link>https://example.test/two</link><pubDate>Tue, 17 Mar 2026 13:00:00 GMT</pubDate></item>
  </channel></rss>`, "Google News");
  const result = dedupeNewsItems([first, duplicate, second, { ...first, url: "https://example.test/one" }]);
  assert.deepEqual(result.map((item) => item.url), ["https://example.test/two", "https://example.test/one"]);
});

test("screener filters before applying page boundaries", () => {
  const makeQuote = (symbol: string, sector: string, pe: number | null) => buildQuoteFromSnapshot({
    symbol, provider: "test", profile: { name: symbol, exchange: "TEST", sector },
    current: { open: 10, high: 11, low: 9, close: 10, volume: 100, date: "2026-03-17", time: "00:00:00" },
    history: [], isLive: false,
  });
  const input = [
    { ...makeQuote("A", "Technology", 1), pe: 10 },
    { ...makeQuote("B", "Healthcare", 1), pe: 10 },
    { ...makeQuote("C", "Technology", 1), pe: 20 },
  ];
  const page = filterAndPageScreenerResults(input, { sector: "Technology", minPe: "15", page: 1, limit: 1 });
  assert.deepEqual(page.items.map((quote) => quote.symbol), ["C"]);
  assert.equal(page.total, 1);
});

test("Wave C dynamic screener filters use an explicit quote-field allowlist", () => {
  const makeQuote = (symbol: string, price: number) => ({ ...buildQuoteFromSnapshot({
    symbol, provider: "test", profile: { name: symbol, exchange: "TEST" },
    current: { open: price, high: price + 1, low: price - 1, close: price, volume: 100, date: "2026-03-17", time: "00:00:00" },
    history: [], isLive: false,
  }), price });
  const input = [makeQuote("A", 10), makeQuote("B", 20), makeQuote("C", 30)];
  const page = filterAndPageScreenerResults(input, { dynamicField: "market_data.price", dynamicOperator: "gte", dynamicValue: "20" });
  assert.deepEqual(page.items.map((quote) => quote.symbol), ["B", "C"]);
  assert.equal(filterAndPageScreenerResults(input, { dynamicField: "hallucinated.field", dynamicOperator: "gte", dynamicValue: "0" }).total, 3);
});
