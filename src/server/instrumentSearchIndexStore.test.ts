import assert from "node:assert/strict";
import test from "node:test";
import { matchSecTickers, searchFederatedInstrumentCandidates, secEdgarFederatedFallback } from "./instrumentSearchIndexStore";
import { adaptLegacySymbolCatalogRow, resolveInstrument, type InstrumentMasterCandidate } from "@shared/globalInstrumentMaster";
import type { InstrumentSearchOptions } from "@shared/instrumentSearchIndex";
import { createConversationInstrumentFallback, resolveConversationInstrument } from "./conversationInstrumentResolution";
import { lseFederatedInstrumentFallback } from "./lseDataProvider";

const FIXTURE_TICKERS = [
  { cik: "0000320193", ticker: "AAPL", name: "Apple Inc." },
  { cik: "0000789019", ticker: "MSFT", name: "Microsoft Corp" },
  { cik: "0001652044", ticker: "GOOGL", name: "Alphabet Inc." },
];

test("matchSecTickers matches by ticker substring", () => {
  const results = matchSecTickers(FIXTURE_TICKERS, "AAPL", {});
  assert.equal(results.length, 1);
  assert.equal(results[0].symbol, "AAPL");
  assert.equal(results[0].canonical, false, "a live SEC fallback hit is provisional, never silently canonical");
  assert.equal(results[0].source, "sec_edgar");
  assert.equal(results[0].exchange, null, "the SEC ticker file does not identify a trading venue");
  assert.equal(results[0].countryCode, "US");
});

test("matchSecTickers matches by company name substring, case-insensitively", () => {
  const results = matchSecTickers(FIXTURE_TICKERS, "alphabet", {});
  assert.equal(results.length, 1);
  assert.equal(results[0].symbol, "GOOGL");
});

test("matchSecTickers returns no matches for an unrelated query, without throwing", () => {
  assert.deepEqual(matchSecTickers(FIXTURE_TICKERS, "ZZZNOTHING", {}), []);
});

test("matchSecTickers returns [] for an empty/whitespace query rather than the entire universe", () => {
  assert.deepEqual(matchSecTickers(FIXTURE_TICKERS, "   ", {}), []);
});

test("matchSecTickers respects the limit option", () => {
  const manyTickers = Array.from({ length: 50 }, (_, i) => ({ cik: String(i), ticker: `ACME${i}`, name: "Acme Holdings" }));
  const results = matchSecTickers(manyTickers, "ACME", { limit: 5 });
  assert.equal(results.length, 5);
});

test("matchSecTickers carries the real CIK as a provider_id identifier", () => {
  const results = matchSecTickers(FIXTURE_TICKERS, "MSFT", {});
  assert.ok(results[0].identifiers.some((i) => i.type === "provider_id" && i.value === "0000789019" && i.provider === "sec_edgar"));
});

test("conversation federation honors provider policy and keeps synthetic SEC provenance", async (t) => {
  const calls: string[] = [];
  t.mock.method(secEdgarFederatedFallback, "search", async (query: string) => {
    calls.push(query);
    return matchSecTickers([{ cik: "SYNTHETIC_CIK", ticker: "SYNTHX", name: "Synthetic Industries" }], query, {});
  });
  const candidates = await searchFederatedInstrumentCandidates("SYNTHX", {}, {
    providerAllow: ["sec_edgar"],
    propagateErrors: true,
    signal: new AbortController().signal,
  });
  assert.deepEqual(calls, ["SYNTHX"]);
  assert.equal(candidates[0].source, "sec_edgar");
  assert.equal(candidates[0].canonical, false);
  assert.equal(candidates[0].entityId, null);
  assert.deepEqual(await searchFederatedInstrumentCandidates("SYNTHX", {}, {
    providerAllow: ["sec_edgar"],
    providerDeny: ["sec_edgar"],
    propagateErrors: true,
  }), []);
  assert.deepEqual(calls, ["SYNTHX"], "provider denial wins over allowance without contacting any provider");
});

test("strict conversation federation reports real provider failures while ordinary search stays best effort", async (t) => {
  const failure = Object.assign(new Error("Synthetic provider denial"), { status: 403 });
  t.mock.method(secEdgarFederatedFallback, "search", async () => { throw failure; });
  await assert.rejects(
    () => searchFederatedInstrumentCandidates("SYNTHX", {}, { providerAllow: ["sec_edgar"], propagateErrors: true }),
    (error) => error === failure,
  );
  assert.deepEqual(await searchFederatedInstrumentCandidates("SYNTHX", {}, { providerAllow: ["sec_edgar"] }), []);
});

test("conversation federation aborts a pending shared provider read without returning late identity", async (t) => {
  const completion = Promise.withResolvers<InstrumentMasterCandidate[]>();
  t.mock.method(secEdgarFederatedFallback, "search", () => completion.promise);
  const controller = new AbortController();
  const pending = searchFederatedInstrumentCandidates("SYNTHX", {}, {
    providerAllow: ["sec_edgar"],
    propagateErrors: true,
    signal: controller.signal,
  });
  const abort = new DOMException("Synthetic discovery cancelled", "AbortError");
  controller.abort(abort);
  await assert.rejects(pending, (error) => error === abort);
  completion.resolve([]);
  await assert.rejects(
    () => searchFederatedInstrumentCandidates("SYNTHX", {}, { providerAllow: ["sec_edgar"], signal: controller.signal }),
    (error) => error === abort,
  );
});

test("structured federation retains a later exact match after an earlier provider fills the search page", async (t) => {
  const broadCandidates = Array.from({ length: 100 }, (_, index) => adaptLegacySymbolCatalogRow({
    symbol: `SYNTHX${index}`,
    name: `Synthetic Broad Industries ${index}`,
    provider: "lse",
    providerId: `SYNTHETIC_BROAD_${index}`,
  }));
  const exact = {
    ...adaptLegacySymbolCatalogRow({
      symbol: "SYNTHX",
      name: "Synthetic Exact Industries",
      provider: "sec_edgar",
      providerId: "SYNTHETIC_EXACT",
    }),
    source: "sec_edgar",
    countryCode: "US",
  };
  t.mock.method(lseFederatedInstrumentFallback, "search", async (query: string, options: InstrumentSearchOptions) => {
    assert.equal(query, "SYNTHX");
    assert.equal(options.limit, 100, "the provider request remains bounded");
    return broadCandidates;
  });
  t.mock.method(secEdgarFederatedFallback, "search", async (query: string, options: InstrumentSearchOptions) => {
    assert.equal(query, "SYNTHX");
    assert.equal(options.limit, 100, "the later provider retains the same request bound");
    return [exact];
  });
  const policy = { providerAllow: ["lse", "sec_edgar"] };
  const ordinary = await searchFederatedInstrumentCandidates("SYNTHX", { limit: 100 }, policy);
  assert.equal(ordinary.length, 100, "ordinary search keeps its global page limit");
  assert.ok(ordinary.every((candidate) => candidate.symbol !== "SYNTHX"));
  const fallback = createConversationInstrumentFallback({
    loadCatalog: () => [],
    allowExternal: true,
    signal: new AbortController().signal,
    searchProvider: async (query, signal) => {
      const candidates = await searchFederatedInstrumentCandidates(query, { limit: 100 }, {
        ...policy,
        signal,
        preserveProviderCandidates: true,
      });
      assert.equal(candidates.length, 101, "all bounded provider observations reach the structured matcher");
      return candidates;
    },
  });
  const result = await resolveConversationInstrument({ symbol: "SYNTHX" }, (query) => resolveInstrument(query, [], fallback));
  assert.equal(result.status, "resolved");
  assert.equal(result.match?.symbol, "SYNTHX");
  assert.equal(result.match?.source, "sec_edgar");
  assert.equal(result.match?.canonical, false);
  assert.equal(result.match?.entityId, null);
  assert.equal(result.match?.listingId, null);
});

test("structured federation preserves later conflicting exact observations beyond the global search cap", async (t) => {
  const broadCandidates = Array.from({ length: 100 }, (_, index) => adaptLegacySymbolCatalogRow({
    symbol: `SYNTHX${index}`,
    name: `Synthetic Broad Industries ${index}`,
    provider: "lse",
  }));
  const exact = {
    ...adaptLegacySymbolCatalogRow({
      symbol: "SYNTHX",
      name: "Synthetic Exact Industries",
      provider: "sec_edgar",
    }),
    source: "sec_edgar",
    countryCode: "US",
  };
  t.mock.method(lseFederatedInstrumentFallback, "search", async () => broadCandidates);
  // Same search dedup key, but conflicting countries must reach the master.
  t.mock.method(secEdgarFederatedFallback, "search", async () => [exact, { ...exact, countryCode: "GB" }]);
  const fallback = createConversationInstrumentFallback({
    loadCatalog: () => [],
    allowExternal: true,
    signal: new AbortController().signal,
    searchProvider: async (query, signal) => {
      const candidates = await searchFederatedInstrumentCandidates(query, { limit: 100 }, {
        providerAllow: ["lse", "sec_edgar"],
        signal,
        preserveProviderCandidates: true,
      });
      assert.equal(candidates.length, 102);
      return candidates;
    },
  });
  const result = await resolveConversationInstrument({ symbol: "SYNTHX" }, (query) => resolveInstrument(query, [], fallback));
  assert.equal(result.status, "ambiguous");
  assert.equal(result.match, null);
  assert.equal(result.candidates.length, 2);
});
