import assert from "node:assert/strict";
import test from "node:test";
import { adaptLegacySymbolCatalogRow, resolveInstrument, resolveInstrumentLocal, type InstrumentMasterCandidate } from "@shared/globalInstrumentMaster";
import { createConversationInstrumentFallback, resolveConversationInstrument } from "./conversationInstrumentResolution";

const catalog = [
  adaptLegacySymbolCatalogRow({ symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ" }),
  adaptLegacySymbolCatalogRow({ symbol: "APLE", name: "Apple Hospitality Reit, Inc.", exchange: "NYSE" }),
  adaptLegacySymbolCatalogRow({ symbol: "MSFT", name: "Microsoft Corp", exchange: "NASDAQ" }),
];
const resolve = async (query: Parameters<typeof resolveInstrumentLocal>[0]) => resolveInstrumentLocal(query, catalog);

test("a company name mistaken for a ticker still resolves by name", async () => {
  const result = await resolveConversationInstrument({ symbol: "APPLE", name: "" }, resolve);
  assert.equal(result.match?.symbol, "AAPL");
});

test("a real ticker resolves as a ticker, lowercase or not", async () => {
  assert.equal((await resolveConversationInstrument({ symbol: "msft" }, resolve)).match?.symbol, "MSFT");
});

test("unknown text is not found and never invented", async () => {
  const result = await resolveConversationInstrument({ symbol: "ZZQXV" }, resolve);
  assert.equal(result.match, null);
  assert.equal(result.status, "not_found");
});

test("name-only input resolves by name; empty input is rejected", async () => {
  assert.equal((await resolveConversationInstrument({ name: "Microsoft" }, resolve)).match?.symbol, "MSFT");
  await assert.rejects(() => resolveConversationInstrument({}, resolve));
});

const syntheticProviderCandidate = {
  ...adaptLegacySymbolCatalogRow({
    symbol: "SYNTHX",
    name: "Synthetic External Industries",
    exchange: "SYNTH_EXCHANGE",
    provider: "lse",
    providerId: "SYNTHX",
  }),
  source: "lse",
};

test("conversation discovers an external exact candidate through the existing master fallback without promotion", async () => {
  const local: InstrumentMasterCandidate[] = [];
  const queries: string[] = [];
  const signal = new AbortController().signal;
  const fallback = createConversationInstrumentFallback({
    loadCatalog: () => [],
    allowExternal: true,
    signal,
    searchProvider: async (query, receivedSignal) => {
      queries.push(query);
      assert.equal(receivedSignal, signal);
      return [syntheticProviderCandidate];
    },
  });
  const result = await resolveConversationInstrument(
    { symbol: "synthx" },
    (query) => resolveInstrument(query, local, fallback),
  );
  assert.equal(result.status, "resolved");
  assert.equal(result.source, "provider_fallback");
  assert.equal(result.match?.canonical, false);
  assert.equal(result.match?.source, "lse");
  assert.equal(result.match?.entityId, null);
  assert.equal(result.match?.listingId, null);
  assert.ok(result.match?.identifiers.some((identifier) => identifier.provider === "lse" && identifier.value === "SYNTHX"));
  assert.deepEqual(queries, ["SYNTHX"]);
  assert.deepEqual(local, [], "discovery must not persist/promote a provider identity");
});

test("local and compatibility ambiguity never fall through to external discovery", async () => {
  const ambiguous = [syntheticProviderCandidate, { ...syntheticProviderCandidate, name: "Synthetic Other Industries" }];
  for (const local of [true, false]) {
    const fallback = createConversationInstrumentFallback({
      loadCatalog: () => local ? [] : ambiguous,
      allowExternal: true,
      signal: new AbortController().signal,
      searchProvider: async () => { throw new Error("ambiguous identity must not contact a provider"); },
    });
    const result = await resolveConversationInstrument(
      { symbol: "SYNTHX" },
      (query) => resolveInstrument(query, local ? ambiguous : [], fallback),
    );
    assert.equal(result.status, "ambiguous");
    assert.equal(result.match, null);
  }
});

test("external ambiguity and unrelated search suggestions do not become resolved identity", async () => {
  for (const candidates of [
    [syntheticProviderCandidate, { ...syntheticProviderCandidate, name: "Synthetic Other Industries" }],
    [{ ...syntheticProviderCandidate, symbol: "UNRELATED", name: "Unrelated Corporation", identifiers: [], aliases: [] }],
  ]) {
    const fallback = createConversationInstrumentFallback({
      loadCatalog: () => [],
      allowExternal: true,
      signal: new AbortController().signal,
      searchProvider: async () => candidates,
    });
    const result = await resolveConversationInstrument({ symbol: "SYNTHX" }, (query) => resolveInstrument(query, [], fallback));
    assert.equal(result.match, null);
    assert.equal(result.status, candidates.length === 2 ? "ambiguous" : "not_found");
  }
});

test("restricted discovery stays unavailable while existing compatibility identity remains usable", async () => {
  for (const candidates of [[], [syntheticProviderCandidate]]) {
    const fallback = createConversationInstrumentFallback({
      loadCatalog: () => candidates,
      allowExternal: false,
      signal: new AbortController().signal,
      searchProvider: async () => { throw new Error("restricted scope must not contact providers"); },
    });
    const result = await resolveConversationInstrument({ symbol: "SYNTHX" }, (query) => resolveInstrument(query, [], fallback));
    assert.equal(result.status, candidates.length ? "resolved" : "not_found");
  }
});

test("provider failures and aborts propagate instead of masquerading as absent identity", async () => {
  const denied = Object.assign(new Error("Synthetic provider denied access"), { status: 403 });
  const fallback = createConversationInstrumentFallback({
    loadCatalog: () => [],
    allowExternal: true,
    signal: new AbortController().signal,
    searchProvider: async () => { throw denied; },
  });
  await assert.rejects(
    () => resolveConversationInstrument({ symbol: "SYNTHX" }, (query) => resolveInstrument(query, [], fallback)),
    (error) => error === denied,
  );
  const controller = new AbortController();
  const abort = new DOMException("Synthetic lookup cancelled", "AbortError");
  const abortedFallback = createConversationInstrumentFallback({
    loadCatalog: () => [],
    allowExternal: true,
    signal: controller.signal,
    searchProvider: async () => {
      controller.abort(abort);
      return [syntheticProviderCandidate];
    },
  });
  await assert.rejects(() => abortedFallback.resolve({ ticker: "SYNTHX" }), (error) => error === abort);
  await assert.rejects(() => abortedFallback.resolve({ ticker: "SYNTHX" }), (error) => error === abort);
});

test("repeated same-name ticker observations resolve provisionally with all provider identifiers retained", async () => {
  const first = { ...syntheticProviderCandidate, exchange: null };
  const second = {
    ...adaptLegacySymbolCatalogRow({
      symbol: "SYNTHX", name: first.name, provider: "sec_edgar", providerId: "SYNTHETIC_CIK",
    }),
    countryCode: "US", currency: "USD", mic: "XSYN", exchange: "SYNTH_VENUE", source: "sec_edgar",
  };
  const fallback = createConversationInstrumentFallback({
    loadCatalog: () => [], allowExternal: true, signal: new AbortController().signal,
    searchProvider: async () => [first, second],
  });
  const result = await resolveConversationInstrument({ symbol: "SYNTHX" }, (query) => resolveInstrument(query, [], fallback));
  assert.equal(result.status, "resolved");
  assert.equal(result.match?.canonical, false);
  assert.equal(result.match?.entityId, null);
  assert.equal(result.match?.listingId, null);
  assert.equal(result.match?.mic, "XSYN");
  assert.equal(result.match?.exchange, "SYNTH_VENUE");
  assert.equal(result.match?.countryCode, "US");
  assert.equal(result.match?.currency, "USD");
  assert.ok(result.match?.identifiers.some((identifier) => identifier.provider === "lse" && identifier.value === "SYNTHX"));
  assert.ok(result.match?.identifiers.some((identifier) => identifier.provider === "sec_edgar" && identifier.value === "SYNTHETIC_CIK"));
});

test("same-name ticker observations with conflicting venue, country or currency remain ambiguous", async () => {
  for (const candidates of [
    [
      { ...syntheticProviderCandidate, exchange: "SYNTH_VENUE_A" },
      { ...syntheticProviderCandidate, exchange: "SYNTH_VENUE_B" },
    ],
    [
      { ...syntheticProviderCandidate, exchange: null, mic: "XSYA" },
      { ...syntheticProviderCandidate, exchange: null, mic: "XSYB" },
    ],
    [
      { ...syntheticProviderCandidate, countryCode: "US" },
      { ...syntheticProviderCandidate, countryCode: "GB" },
    ],
    [
      { ...syntheticProviderCandidate, currency: "USD" },
      { ...syntheticProviderCandidate, currency: "GBP" },
    ],
  ]) {
    const fallback = createConversationInstrumentFallback({
      loadCatalog: () => [], allowExternal: true, signal: new AbortController().signal,
      searchProvider: async () => candidates,
    });
    const result = await resolveConversationInstrument({ symbol: "SYNTHX" }, (query) => resolveInstrument(query, [], fallback));
    assert.equal(result.status, "ambiguous");
    assert.equal(result.match, null);
  }
});

test("provider observations retain master-valid name-prefix and ticker-identifier matches without search relevance filtering", async () => {
  for (const fixture of [
    {
      input: { name: "Synthetic External Industries Inc." },
      candidate: syntheticProviderCandidate,
    },
    {
      input: { symbol: "SYNTHX" },
      candidate: { ...syntheticProviderCandidate, symbol: "SYNTH_PRIMARY", aliases: [] },
    },
  ]) {
    const fallback = createConversationInstrumentFallback({
      loadCatalog: () => [], allowExternal: true, signal: new AbortController().signal,
      searchProvider: async () => [fixture.candidate],
    });
    const result = await resolveConversationInstrument(fixture.input, (query) => resolveInstrument(query, [], fallback));
    assert.equal(result.status, "resolved");
    assert.equal(result.match?.name, fixture.candidate.name);
    assert.equal(result.match?.symbol, fixture.candidate.symbol);
    assert.equal(result.match?.canonical, false);
  }
});
