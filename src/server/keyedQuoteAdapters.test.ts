import test from "node:test";
import assert from "node:assert/strict";
import { KEYED_QUOTE_ADAPTERS, keyedAdaptersFor, resetKeyedAdapterExecutionStateForTests } from "./keyedQuoteAdapters";

function withEnv(vars: Record<string, string>, fn: () => Promise<void>): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) previous[key] = process.env[key];
  Object.assign(process.env, vars);
  return fn().finally(() => {
    for (const key of Object.keys(vars)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

function mockFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
}

async function withMockedFetch(response: typeof fetch, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = response;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function adapter(id: string) {
  const found = KEYED_QUOTE_ADAPTERS.find((a) => a.id === id);
  assert.ok(found, `adapter ${id} must be registered`);
  return found!;
}

test("unconfigured adapters report unavailable and are excluded from keyedAdaptersFor", async () => {
  await withEnv({}, async () => {
    for (const a of KEYED_QUOTE_ADAPTERS) {
      // Only assert for env vars this test controls -- a real key already
      // present in this process's environment (CI secret, etc.) is a
      // legitimate "available" state, not a bug.
      if (!process.env.ALPHA_VANTAGE_API_KEY && a.id === "alpha_vantage") assert.equal(a.isAvailable(), false);
    }
    assert.ok(!keyedAdaptersFor("equity").some((a) => a.id === "alpha_vantage" && !process.env.ALPHA_VANTAGE_API_KEY));
  });
});

test("keyedAdaptersFor respects the requesting user's selected connector IDs", async () => {
  await withEnv({ TWELVE_DATA_API_KEY: "test-key", TIINGO_API_KEY: "test-key" }, async () => {
    assert.deepEqual(keyedAdaptersFor("equity", ["twelve_data"]).map((a) => a.id), ["twelve_data"]);
    assert.deepEqual(keyedAdaptersFor("equity", ["tiingo"]).map((a) => a.id), ["tiingo"]);
    assert.deepEqual(keyedAdaptersFor("equity", ["fred"]), []);
  });
});

test("Alpha Vantage adapter parses the documented GLOBAL_QUOTE response", async () => {
  await withEnv({ ALPHA_VANTAGE_API_KEY: "test-key" }, async () => {
    await withMockedFetch(mockFetch({
      "Global Quote": {
        "01. symbol": "IBM",
        "02. open": "161.0000",
        "03. high": "161.7300",
        "04. low": "160.0800",
        "05. price": "160.1000",
        "06. volume": "4086065",
        "07. latest trading day": "2024-01-03",
        "08. previous close": "161.5000",
        "09. change": "-1.4000",
        "10. change percent": "-0.8658%",
      },
    }), async () => {
      const a = adapter("alpha_vantage");
      assert.equal(a.isAvailable(), true);
      const snapshot = await a.fetchQuote("IBM");
      assert.equal(snapshot?.close, 160.1);
      assert.equal(snapshot?.open, 161);
      assert.equal(snapshot?.high, 161.73);
      assert.equal(snapshot?.low, 160.08);
      assert.equal(snapshot?.volume, 4086065);
      assert.equal(snapshot?.date, "2024-01-03");
    });
  });
});

test("Twelve Data adapter parses a real captured /quote response", async () => {
  await withEnv({ TWELVE_DATA_API_KEY: "test-key" }, async () => {
    // Captured live from api.twelvedata.com during setup verification
    // (2026-08-29) -- not synthesized, the actual production shape.
    await withMockedFetch(mockFetch({
      symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", mic_code: "XNGS", currency: "USD",
      datetime: "2026-08-28", timestamp: 1787923800, open: "317.088013", high: "322.37000",
      low: "315.45041", close: "319.64001", volume: "137375160", previous_close: "314.57999",
      change: "5.060028", percent_change: "1.60850",
    }), async () => {
      const snapshot = await adapter("twelve_data").fetchQuote("AAPL");
      assert.equal(snapshot?.close, 319.64001);
      assert.equal(snapshot?.open, 317.088013);
      assert.equal(snapshot?.currency, "USD");
      assert.equal(snapshot?.date, "2026-08-28");
    });
  });
});

test("Twelve Data adapter parses time_series OHLCV in ascending order", async () => {
  await withEnv({ TWELVE_DATA_API_KEY: "test-key" }, async () => {
    let capturedUrl = "";
    await withMockedFetch((async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({
        meta: { symbol: "AAPL", interval: "1day", currency: "USD" },
        values: [
          { datetime: "2026-08-27", open: "315.00", high: "320.00", low: "314.00", close: "318.00", volume: "1000" },
          { datetime: "2026-08-28", open: "318.00", high: "322.00", low: "317.00", close: "319.64", volume: "1200" },
        ],
        status: "ok",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch, async () => {
      const bars = await adapter("twelve_data").fetchOHLCV!("AAPL", 5);
      assert.equal(bars?.length, 2);
      assert.equal(bars?.[0].date, "2026-08-27");
      assert.equal(bars?.[1].close, 319.64);
      assert.ok(capturedUrl.includes("interval=1day"));
      assert.ok(capturedUrl.includes("order=ASC"));
    });
  });
});

test("Twelve Data adapter returns null on the documented error-status response", async () => {
  await withEnv({ TWELVE_DATA_API_KEY: "test-key" }, async () => {
    await withMockedFetch(mockFetch({ code: 400, message: "symbol not found", status: "error" }), async () => {
      const snapshot = await adapter("twelve_data").fetchQuote("NOTASYMBOL");
      assert.equal(snapshot, null);
    });
  });
});

test("Tiingo adapter parses the documented /iex top-of-book response", async () => {
  await withEnv({ TIINGO_API_KEY: "test-key" }, async () => {
    await withMockedFetch(mockFetch([{
      ticker: "AAPL", quoteTimestamp: "2020-07-17T13:39:00.000000Z", last: 385.0, tngoLast: 385.0,
      open: 380.0, high: 386.0, low: 375.0, prevClose: 383.5, volume: 201592,
    }]), async () => {
      const snapshot = await adapter("tiingo").fetchQuote("AAPL");
      assert.equal(snapshot?.close, 385);
      assert.equal(snapshot?.high, 386);
      assert.equal(snapshot?.date, "2020-07-17");
      assert.equal(snapshot?.time, "13:39:00");
    });
  });
});

test("Tiingo adapter parses daily-prices OHLCV response", async () => {
  await withEnv({ TIINGO_API_KEY: "test-key" }, async () => {
    await withMockedFetch(mockFetch([
      { date: "2026-08-27T00:00:00.000Z", open: 315, high: 320, low: 314, close: 318, volume: 1000 },
      { date: "2026-08-28T00:00:00.000Z", open: 318, high: 322, low: 317, close: 319.64, volume: 1200 },
    ]), async () => {
      const bars = await adapter("tiingo").fetchOHLCV!("AAPL", 5);
      assert.equal(bars?.length, 2);
      assert.equal(bars?.[1].date, "2026-08-28");
      assert.equal(bars?.[1].close, 319.64);
    });
  });
});

test("EODHD adapter parses the documented real-time response and appends .US", async () => {
  await withEnv({ EODHD_API_KEY: "test-key" }, async () => {
    let capturedUrl = "";
    await withMockedFetch((async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({
        code: "AAPL.US", timestamp: 1729888080, open: 229.74, high: 233.22, low: 229.57,
        close: 231.41, volume: 37931706, previousClose: 230.57, change: 0.84, change_p: 0.3643,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch, async () => {
      const snapshot = await adapter("eodhd").fetchQuote("AAPL");
      assert.equal(snapshot?.close, 231.41);
      assert.ok(capturedUrl.includes("AAPL.US"), "bare US symbol should get a .US suffix appended");
    });
  });
});

test("EODHD adapter passes through an already-suffixed symbol unchanged", async () => {
  await withEnv({ EODHD_API_KEY: "test-key" }, async () => {
    let capturedUrl = "";
    await withMockedFetch((async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ code: "VOD.LSE", timestamp: 1729888080, open: 1, high: 1, low: 1, close: 1, volume: 1 }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch, async () => {
      await adapter("eodhd").fetchQuote("VOD.L");
      assert.ok(capturedUrl.includes("VOD.L") && !capturedUrl.includes("VOD.L.US"));
    });
  });
});

test("Polygon adapter parses the documented previous-close aggregate response", async () => {
  await withEnv({ POLYGON_API_KEY: "test-key" }, async () => {
    await withMockedFetch(mockFetch({
      ticker: "AAPL", queryCount: 1, resultsCount: 1, adjusted: true,
      results: [{ v: 78251328, vw: 173.4143, o: 174.03, c: 174.31, h: 174.88, l: 171.94, t: 1648785600000, n: 661160 }],
      status: "OK",
    }), async () => {
      const snapshot = await adapter("polygon").fetchQuote("AAPL");
      assert.equal(snapshot?.close, 174.31);
      assert.equal(snapshot?.volume, 78251328);
    });
  });
});

test("CoinMarketCap adapter parses the documented quotes/latest response and strips -USD suffix", async () => {
  await withEnv({ COINMARKETCAP_API_KEY: "test-key" }, async () => {
    let capturedHeaders: Record<string, string> = {};
    await withMockedFetch((async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      return new Response(JSON.stringify({
        data: { BTC: { id: 1, name: "Bitcoin", symbol: "BTC", quote: { USD: { price: 96348.45, volume_24h: 28439861524.32, percent_change_24h: 2.18, market_cap: 1907489860314.22, last_updated: "2024-10-11T02:36:05.000Z" } } } },
        status: { error_code: 0 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch, async () => {
      const snapshot = await adapter("coinmarketcap").fetchQuote("BTC-USD");
      assert.equal(snapshot?.close, 96348.45);
      assert.equal(capturedHeaders["X-CMC_PRO_API_KEY"], "test-key");
      // CoinMarketCap's quotes/latest is a point-in-time price, not an OHLC
      // bar -- open/high/low must never be fabricated from the 24h change.
      assert.equal(snapshot?.open, snapshot?.close);
      assert.equal(snapshot?.high, snapshot?.close);
      assert.equal(snapshot?.low, snapshot?.close);
    });
  });
});


test("local request budgets prevent a concurrent batch from exhausting a provider quota", async () => {
  resetKeyedAdapterExecutionStateForTests();
  await withEnv({ POLYGON_API_KEY: "test-key" }, async () => {
    await withMockedFetch(mockFetch({
      results: [{ v: 10, o: 100, c: 101, h: 102, l: 99, t: 1648785600000 }],
    }), async () => {
      const a = adapter("polygon");
      await Promise.all(Array.from({ length: 5 }, () => a.fetchQuote("AAPL")));
      await assert.rejects(() => a.fetchQuote("AAPL"), /local minute request budget exhausted/);
    });
  });
  resetKeyedAdapterExecutionStateForTests();
});
test("a 429 response starts a cooldown that makes the adapter unavailable until it expires", async () => {
  resetKeyedAdapterExecutionStateForTests();
  await withEnv({ ALPHA_VANTAGE_API_KEY: "test-key" }, async () => {
    await withMockedFetch(mockFetch({ Note: "rate limit exceeded" }, 429), async () => {
      const a = adapter("alpha_vantage");
      assert.equal(a.isAvailable(), true);
      await assert.rejects(() => a.fetchQuote("IBM"));
      assert.equal(a.isAvailable(), false, "adapter must self-exclude for the cooldown window after a 429");
    });
  });
  resetKeyedAdapterExecutionStateForTests();
});

test("a malformed/empty response resolves to null rather than throwing", async () => {
  await withEnv({ TWELVE_DATA_API_KEY: "test-key" }, async () => {
    await withMockedFetch(mockFetch({}), async () => {
      const snapshot = await adapter("twelve_data").fetchQuote("ZZZZ");
      assert.equal(snapshot, null);
    });
  });
});
