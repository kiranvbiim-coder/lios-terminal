import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLseSubscribeMessage,
  createLseDataProviderAdapter,
  createLseParquetExport,
  lseCatalogRowToCandidate,
  lseEntitlementDecision,
  normalizeLseStreamMessage,
  parseLseUsageQuota,
  searchLseCatalogCandidates,
} from "./lseDataProvider";
import { createCanonicalDataRequest } from "./providerSdk";

function request(
  capability: "security_resolution" | "prices" | "statements" | "options" | "curves" | "macro" | "provider_extension",
  parameters: Record<string, unknown> = {},
) {
  return createCanonicalDataRequest({
    projectId: 7,
    capability,
    entity: { ref: "AAPL", symbol: "AAPL", identifiers: {} },
    fields: [],
    parameters,
    pointInTime: {
      mode: "latest",
      asKnownOn: null,
      revision: null,
      requirePublicationTime: false,
      allowLaterRevisions: false,
    },
    providerAllow: ["lse"],
    providerDeny: [],
  });
}

test("P5 LSE usage parser preserves provider quota evidence without inventing unknown fields", () => {
  const quota = parseLseUsageQuota({
    monthly_limit_bytes: 1_000,
    monthly_used_bytes: 250,
    reset_at: "2026-10-01T00:00:00Z",
  });
  assert.equal(quota.limit, 1_000);
  assert.equal(quota.remaining, 750);
  assert.equal(quota.resetAt, "2026-10-01T00:00:00.000Z");

  const unknown = parseLseUsageQuota({});
  assert.equal(unknown.limit, null);
  assert.equal(unknown.remaining, null);
});

test("P5 LSE catalogue rows remain provider aliases until canonical identity is resolved", () => {
  const candidate = lseCatalogRowToCandidate({
    dataset: "stocks",
    symbol: "AAPL",
    name: "Apple Inc.",
    category: "Stocks",
    exchange: "US",
  });
  assert.ok(candidate);
  assert.equal(candidate.canonical, false);
  assert.equal(candidate.source, "lse");
  assert.ok(candidate.identifiers.some((item) => item.type === "provider_id" && item.provider === "lse"));
});

test("P5 LSE remains optional when no key is connected unless the user pins it", () => {
  const unpinned = request("prices");
  unpinned.providerAllow = [];
  assert.equal(lseEntitlementDecision(unpinned, null).decision, "unknown");
  assert.equal(lseEntitlementDecision(request("prices"), null).decision, "denied");
});

test("P5 LSE local-use policy rejects redistribution before provider execution", () => {
  const decision = lseEntitlementDecision(request("prices", { redistribute: true }), "lse_test_key");
  assert.equal(decision.decision, "denied");
  assert.equal(decision.policyId, "lse-no-redistribution");
});

test("P5 LSE provider searches live catalogue and fetches normalized candles through x-api-key", async () => {
  const calls: Array<{ url: string; key: string | null }> = [];
  const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, key: headers.get("x-api-key") });
    if (url.endsWith("/catalog")) {
      return new Response(JSON.stringify([
        { dataset: "stocks", symbol: "AAPL", name: "Apple Inc.", category: "Stocks", ticks: 100 },
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/candles?")) {
      return new Response(JSON.stringify([
        { ts: "2026-09-22T09:30:00Z", open: 100, high: 102, low: 99, close: 101, volume: 10 },
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error("Unexpected URL: " + url);
  }) as typeof fetch;

  const adapter = createLseDataProviderAdapter({ fetchFn: mockFetch, credential: "lse_test_key" });
  const searched = await adapter.search?.({ query: "AAPL", capability: "security_resolution", limit: 5 }, { userId: 1, organizationId: null, role: "internal_admin" });
  assert.equal(searched?.providerId, "lse");
  assert.equal(searched?.rows.length, 1);

  const prices = await adapter.fetch(request("prices", { timeframe: "1m", limit: 1 }), { userId: 1, organizationId: null, role: "internal_admin" });
  assert.ok(prices);
  const data = prices.data as { kind: string; rows: Array<Record<string, unknown>> };
  assert.equal(data.kind, "ohlcv_series");
  assert.equal(data.rows[0].timestamp, "2026-09-22T09:30:00Z");
  assert.ok(calls.every((call) => call.key === "lse_test_key"));
});

test("P5 LSE Parquet path creates a governed export job rather than redistributing data centrally", async () => {
  let posted: unknown = null;
  const mockFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    posted = init?.body ? JSON.parse(String(init.body)) : null;
    return new Response(JSON.stringify({ job_id: "job_123", status: "queued" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const job = await createLseParquetExport({
    dataset: "stocks",
    symbol: "AAPL",
    timeframe: "1m",
    start: "2026-01-01",
  }, { credential: "lse_test_key", fetchFn: mockFetch });

  assert.equal(job.job_id, "job_123");
  assert.deepEqual(posted, {
    dataset: "stocks",
    symbol: "AAPL",
    timeframe: "1m",
    start: "2026-01-01",
    end: null,
    format: "parquet",
  });
});

test("P5 LSE replay-to-live protocol preserves replay markers on generic stream events", () => {
  assert.deepEqual(buildLseSubscribeMessage("AAPL", "2026-09-22T09:00:00.000Z"), {
    action: "subscribe",
    symbol: "AAPL",
    start: "2026-09-22T09:00:00.000Z",
  });
  const tick = normalizeLseStreamMessage({
    type: "tick",
    symbol: "AAPL",
    price: 101.5,
    ts: "2026-09-22T09:30:01Z",
    replay: true,
  });
  assert.equal(tick?.type, "tick");
  assert.equal(tick?.replay, true);
  assert.equal((tick?.data as Record<string, unknown>).timestamp, "2026-09-22T09:30:01Z");
});

test("catalog discovery keeps absent access unavailable and propagates provider denial", async () => {
  const noFetch = (async () => { throw new Error("missing credentials must not fetch"); }) as typeof fetch;
  assert.deepEqual(await searchLseCatalogCandidates("SYNTHX", {}, { credential: null, fetchFn: noFetch }), []);
  await assert.rejects(() => searchLseCatalogCandidates("SYNTHX", {}, {
    credential: "synthetic_catalog_denied",
    fetchFn: (async () => new Response(JSON.stringify({ detail: "Synthetic denied" }), { status: 403 })) as typeof fetch,
  }), (error: unknown) => error instanceof Error && "status" in error && error.status === 403);
});

test("catalog discovery cancels its caller without aborting the shared provider read", async () => {
  const controller = new AbortController();
  const receivedSignals: AbortSignal[] = [];
  const response = Promise.withResolvers<Response>();
  const pending = searchLseCatalogCandidates("SYNTHX", {}, {
    credential: "synthetic_catalog_abort",
    signal: controller.signal,
    fetchFn: (async (_input, init) => {
      const signal = init?.signal;
      if (signal) {
        receivedSignals.push(signal);
        signal.addEventListener("abort", () => response.reject(signal.reason), { once: true });
      }
      return response.promise;
    }) as typeof fetch,
  });
  const abort = new DOMException("Synthetic catalog cancelled", "AbortError");
  controller.abort(abort);
  await assert.rejects(pending, (error) => error === abort);
  assert.equal(receivedSignals.length, 1);
  assert.equal(receivedSignals[0].aborted, false);
  // A remaining observer sees the eventual provider error after the first
  // caller has cancelled; the shared read must still have rejection handlers.
  const remaining = searchLseCatalogCandidates("SYNTHX", {}, {
    credential: "synthetic_catalog_abort",
    fetchFn: (async () => { throw new Error("must reuse the shared read"); }) as typeof fetch,
  });
  const providerError = new Error("Synthetic provider failure after cancellation");
  response.reject(providerError);
  await assert.rejects(remaining, (error) => error === providerError);
});

test("concurrent catalog consumers share one fetch when one caller aborts", async () => {
  const controller = new AbortController();
  const survivingController = new AbortController();
  const response = Promise.withResolvers<Response>();
  let fetches = 0;
  const providerSignals: AbortSignal[] = [];
  const fetchFn = (async (_input, init) => {
    fetches += 1;
    if (init?.signal) providerSignals.push(init.signal);
    return response.promise;
  }) as typeof fetch;
  const credential = "synthetic_catalog_shared_abort";
  const cancelled = searchLseCatalogCandidates("SYNTHX", {}, {
    credential, fetchFn, signal: controller.signal,
  });
  const surviving = searchLseCatalogCandidates("SYNTHX", {}, {
    credential, fetchFn, signal: survivingController.signal,
  });
  const abort = new DOMException("Synthetic consumer cancelled", "AbortError");
  controller.abort(abort);
  await assert.rejects(cancelled, (error) => error === abort);
  assert.equal(providerSignals.length, 1);
  assert.equal(providerSignals[0].aborted, false);
  assert.equal(fetches, 1);
  response.resolve(new Response(JSON.stringify([
    { dataset: "stocks", symbol: "SYNTHX", name: "Synthetic Industries" },
  ]), { status: 200 }));
  const candidates = await surviving;
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].symbol, "SYNTHX");
  assert.deepEqual(await searchLseCatalogCandidates("SYNTHX", {}, { credential, fetchFn }), candidates);
  assert.equal(fetches, 1);
});

test("option-chain catalogue availability is not another identity for the underlying ticker", async () => {
  const stock = { dataset: "stocks", symbol: "SYNTHX", name: "Synthetic Industries", country: "US" };
  const optionFeeds = ["options", "options_chain", "options_flow"].map((dataset) => ({
    dataset, symbol: "SYNTHX", name: "Synthetic Industries options", country: "US",
  }));
  for (const row of optionFeeds) assert.equal(lseCatalogRowToCandidate(row), null);
  const candidates = await searchLseCatalogCandidates("SYNTHX", { limit: 100 }, {
    credential: "synthetic_mixed_dataset_catalog",
    fetchFn: (async () => new Response(JSON.stringify([stock, ...optionFeeds]), { status: 200 })) as typeof fetch,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].symbol, "SYNTHX");
  assert.equal(candidates[0].name, "Synthetic Industries");
  assert.equal(candidates[0].canonical, false);
});

test("catalog candidate conversion only accepts verified stock identity datasets", () => {
  for (const dataset of [
    "options", "options_chain", "options_flow", "economics", "bonds",
    "commodities", "forex", "crypto", "news", "unknown", "", null, undefined,
  ]) {
    assert.equal(lseCatalogRowToCandidate({
      dataset, symbol: "SYNTHX", name: "Synthetic Industries", category: "Stocks",
    }), null, `unexpected identity from dataset ${String(dataset)}`);
  }
  assert.equal(lseCatalogRowToCandidate({
    dataset: "stocks", symbol: "", name: "Synthetic Industries",
  }), null);
});

test("non-instrument catalogue rows cannot consume the candidate match limit", async () => {
  const nonInstruments = [
    "options", "options_chain", "options_flow", "economics", "bonds", "unknown", null,
  ].map((dataset) => ({ dataset, symbol: "SYNTHX", name: "Synthetic Industries" }));
  const candidates = await searchLseCatalogCandidates("SYNTHX", { limit: 1 }, {
    credential: "synthetic_catalog_dataset_starvation",
    fetchFn: (async () => new Response(JSON.stringify([
      ...nonInstruments,
      { dataset: "stocks", name: "SYNTHX availability without a symbol" },
      { dataset: "stocks", symbol: "SYNTHX", name: "Synthetic Industries" },
    ]), { status: 200 })) as typeof fetch,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].symbol, "SYNTHX");
  assert.equal(candidates[0].name, "Synthetic Industries");
  assert.equal(candidates[0].canonical, false);
});
