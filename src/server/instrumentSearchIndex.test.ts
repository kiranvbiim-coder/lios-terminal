import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInstrumentSearchIndex,
  searchInstrumentIndexLocal,
  searchInstruments,
  type InstrumentSearchFederatedFallback,
} from "../shared/instrumentSearchIndex";
import { formatLiosId, type InstrumentMasterCandidate } from "../shared/globalInstrumentMaster";

function candidate(
  overrides: Partial<InstrumentMasterCandidate> & Pick<InstrumentMasterCandidate, "name" | "symbol">,
): InstrumentMasterCandidate {
  return {
    entityId: formatLiosId("entity", overrides.symbol.toLowerCase()),
    listingId: formatLiosId("listing", overrides.symbol.toLowerCase()),
    name: overrides.name,
    symbol: overrides.symbol,
    exchange: "NASDAQ",
    mic: "XNAS",
    countryCode: "US",
    currency: "USD",
    isPrimaryListing: true,
    lifecycleStatus: "active",
    identifiers: [{ type: "ticker", value: overrides.symbol }],
    aliases: [],
    canonical: true,
    ...overrides,
  };
}

test("a short ticker prefix resolves through the coarse bucket without a full scan", () => {
  const apple = candidate({ name: "Apple Inc.", symbol: "AAPL" });
  const index = buildInstrumentSearchIndex([apple]);

  const results = searchInstrumentIndexLocal(index, "AA");
  assert.equal(results.length, 1);
  assert.equal(results[0].primary.symbol, "AAPL");
});

test("an exact ticker match outranks a prefix match on a different symbol", () => {
  const exact = candidate({ name: "Example Exact", symbol: "ABC" });
  const prefixOnly = candidate({ name: "Example Prefix", symbol: "ABCD", entityId: formatLiosId("entity", "abcd-co") });
  const index = buildInstrumentSearchIndex([exact, prefixOnly]);

  const results = searchInstrumentIndexLocal(index, "ABC");
  assert.equal(results.length, 2);
  assert.equal(results[0].primary.symbol, "ABC");
  assert.equal(results[1].primary.symbol, "ABCD");
  assert.ok(results[0].score > results[1].score);
});

test("mid-name token search matches a company by a word inside its name", () => {
  const infosys = candidate({ name: "Infosys Limited", symbol: "INFY", entityId: formatLiosId("entity", "infosys") });
  const index = buildInstrumentSearchIndex([infosys]);

  const results = searchInstrumentIndexLocal(index, "LIMITED");
  assert.equal(results.length, 1);
  assert.equal(results[0].primary.symbol, "INFY");
});

test("two listings of one durable entity group together with the primary listing first", () => {
  const entityId = formatLiosId("entity", "acme");
  const secondary = candidate({
    name: "Acme Corp",
    symbol: "ACME",
    entityId,
    listingId: formatLiosId("listing", "acme-lse"),
    mic: "XLON",
    exchange: "LSE",
    countryCode: "GB",
    isPrimaryListing: false,
  });
  const primary = candidate({
    name: "Acme Corp",
    symbol: "ACME",
    entityId,
    listingId: formatLiosId("listing", "acme-nasdaq"),
    isPrimaryListing: true,
  });
  const index = buildInstrumentSearchIndex([secondary, primary]);

  const results = searchInstrumentIndexLocal(index, "ACME");
  assert.equal(results.length, 1, "both listings of the same entity must collapse into one group");
  assert.equal(results[0].groupKey, entityId);
  assert.equal(results[0].primary.mic, "XNAS", "the primary listing must surface as the group head");
  assert.equal(results[0].relatedListings.length, 1);
  assert.equal(results[0].relatedListings[0].mic, "XLON");
});

test("unlinked legacy rows with identical name and symbol collapse without inventing an entity", () => {
  const duplicateA = candidate({
    name: "Legacy Coin",
    symbol: "LGC",
    entityId: null,
    listingId: null,
    canonical: false,
    isPrimaryListing: false,
    source: "legacy67k",
  });
  const duplicateB = candidate({
    name: "Legacy Coin",
    symbol: "LGC",
    entityId: null,
    listingId: null,
    canonical: false,
    isPrimaryListing: false,
    source: "legacy67k",
  });
  const distinct = candidate({
    name: "Legacy Metal",
    symbol: "LGM",
    entityId: null,
    listingId: null,
    canonical: false,
    isPrimaryListing: false,
    source: "legacy67k",
  });
  const index = buildInstrumentSearchIndex([duplicateA, duplicateB, distinct]);

  const results = searchInstrumentIndexLocal(index, "LEGACY");
  assert.equal(results.length, 2, "identical unlinked rows collapse; distinct unlinked rows stay separate");
  const coinGroup = results.find((group) => group.primary.symbol === "LGC");
  assert.ok(coinGroup);
  assert.equal(coinGroup!.groupKey, "legacy:LEGACY COIN:LGC:XNAS:USD");
  assert.equal(coinGroup!.relatedListings.length, 1);
});

test("historical listings are excluded by default and included only on request", () => {
  const delisted = candidate({
    name: "Old Ticker Inc.",
    symbol: "OLD",
    lifecycleStatus: "delisted",
    entityId: formatLiosId("entity", "old"),
  });
  const index = buildInstrumentSearchIndex([delisted]);

  const defaultResults = searchInstrumentIndexLocal(index, "OLD");
  assert.equal(defaultResults.length, 0);

  const historicalResults = searchInstrumentIndexLocal(index, "OLD", { includeHistorical: true });
  assert.equal(historicalResults.length, 1);
  assert.equal(historicalResults[0].primary.symbol, "OLD");
});

test("LV4-04-13: asOfDate finds a now-historical listing that was valid on that date", () => {
  const delisted = candidate({
    name: "Old Ticker Inc.",
    symbol: "OLDDATE",
    lifecycleStatus: "delisted",
    entityId: formatLiosId("entity", "olddate"),
    validFrom: "2010-01-01",
    validTo: "2019-06-30",
  });
  const index = buildInstrumentSearchIndex([delisted]);

  const today = searchInstrumentIndexLocal(index, "OLDDATE");
  assert.equal(today.length, 0);

  const asOf = searchInstrumentIndexLocal(index, "OLDDATE", { asOfDate: "2015-03-15" });
  assert.equal(asOf.length, 1);
  assert.equal(asOf[0].primary.symbol, "OLDDATE");
});

test("LV4-04-13: asOfDate distinguishes two non-overlapping listings sharing a ticker", () => {
  const early = candidate({
    name: "Reuse Early Co",
    symbol: "SREUSE",
    lifecycleStatus: "delisted",
    entityId: formatLiosId("entity", "sreuse-early"),
    validFrom: "2000-01-01",
    validTo: "2005-12-31",
  });
  const later = candidate({
    name: "Reuse Later Co",
    symbol: "SREUSE",
    lifecycleStatus: "active",
    entityId: formatLiosId("entity", "sreuse-later"),
    validFrom: "2015-01-01",
  });
  const index = buildInstrumentSearchIndex([early, later]);

  const asOf2003 = searchInstrumentIndexLocal(index, "SREUSE", { asOfDate: "2003-06-01" });
  assert.equal(asOf2003.length, 1);
  assert.equal(asOf2003[0].primary.name, "Reuse Early Co");

  const asOf2020 = searchInstrumentIndexLocal(index, "SREUSE", { asOfDate: "2020-06-01" });
  assert.equal(asOf2020.length, 1);
  assert.equal(asOf2020[0].primary.name, "Reuse Later Co");
});

test("LV4-04-13: asOfDate supersedes includeHistorical rather than requiring both", () => {
  const delisted = candidate({
    name: "Old Ticker Inc.",
    symbol: "OLDSUP",
    lifecycleStatus: "delisted",
    entityId: formatLiosId("entity", "oldsup"),
    validFrom: "2010-01-01",
    validTo: "2019-06-30",
  });
  const index = buildInstrumentSearchIndex([delisted]);

  const results = searchInstrumentIndexLocal(index, "OLDSUP", { includeHistorical: false, asOfDate: "2015-03-15" });
  assert.equal(results.length, 1);
});

test("LV4-04-13: asOfDate exactly equal to validFrom or validTo is inclusive, not excluded", () => {
  const bounded = candidate({
    name: "Bounded Co",
    symbol: "SBOUND",
    lifecycleStatus: "delisted",
    entityId: formatLiosId("entity", "sbound"),
    validFrom: "2010-01-01",
    validTo: "2019-06-30",
  });
  const index = buildInstrumentSearchIndex([bounded]);

  const onValidFrom = searchInstrumentIndexLocal(index, "SBOUND", { asOfDate: "2010-01-01" });
  assert.equal(onValidFrom.length, 1, "the exact start date must be included, not excluded");

  const onValidTo = searchInstrumentIndexLocal(index, "SBOUND", { asOfDate: "2019-06-30" });
  assert.equal(onValidTo.length, 1, "the exact end date must be included, not excluded");

  const oneDayBeforeStart = searchInstrumentIndexLocal(index, "SBOUND", { asOfDate: "2009-12-31" });
  assert.equal(oneDayBeforeStart.length, 0);

  const oneDayAfterEnd = searchInstrumentIndexLocal(index, "SBOUND", { asOfDate: "2019-07-01" });
  assert.equal(oneDayAfterEnd.length, 0);
});

test("LV4-04-13: a candidate with no persisted validity window fails closed for any asOfDate", () => {
  // Mirrors the bundled ~67k legacy ticker catalog, which never sets
  // validFrom/validTo at all -- unknown temporal bounds must not be
  // silently treated as "valid at every possible date".
  const noTemporalData = candidate({ name: "Undated Legacy Row", symbol: "SUNDATED" });
  assert.equal(noTemporalData.validFrom, undefined);
  assert.equal(noTemporalData.validTo, undefined);
  const index = buildInstrumentSearchIndex([noTemporalData]);

  const withAsOfDate = searchInstrumentIndexLocal(index, "SUNDATED", { asOfDate: "1800-01-01" });
  assert.equal(withAsOfDate.length, 0);

  // Without asOfDate, the same candidate is findable exactly as before --
  // this fail-closed rule only applies to the point-in-time query path.
  const withoutAsOfDate = searchInstrumentIndexLocal(index, "SUNDATED");
  assert.equal(withoutAsOfDate.length, 1);
});

test("legacy compatibility rows rank below a linked canonical row for the same query", () => {
  const canonical = candidate({ name: "Dual Listed Co", symbol: "DUAL", entityId: formatLiosId("entity", "dual") });
  const legacy = candidate({
    name: "Dual Listed Co",
    symbol: "DUAL",
    entityId: null,
    listingId: null,
    canonical: false,
    isPrimaryListing: false,
    source: "legacy67k",
  });
  const index = buildInstrumentSearchIndex([legacy, canonical]);

  const results = searchInstrumentIndexLocal(index, "DUAL");
  assert.equal(results.length, 2, "an unlinked legacy row and its linked canonical entity are distinct groups");
  assert.equal(results[0].primary.canonical, true, "the canonical entity ranks first for the identical query text");
});

test("the limit option bounds the number of returned groups", () => {
  const candidates = ["AAA", "AAB", "AAC", "AAD"].map((symbol) =>
    candidate({ name: `Example ${symbol}`, symbol, entityId: formatLiosId("entity", symbol.toLowerCase()) }),
  );
  const index = buildInstrumentSearchIndex(candidates);

  const results = searchInstrumentIndexLocal(index, "AA", { limit: 2 });
  assert.equal(results.length, 2);
});

test("a federated fallback runs only when the local index has zero matching groups", async () => {
  const local = candidate({ name: "Local Only Co", symbol: "LOC" });
  const index = buildInstrumentSearchIndex([local]);

  let fallbackCalls = 0;
  const fallback: InstrumentSearchFederatedFallback = {
    search: async () => {
      fallbackCalls += 1;
      return [];
    },
  };

  const result = await searchInstruments(index, "LOC", {}, fallback);
  assert.equal(fallbackCalls, 0, "an existing local match must never trigger the federated fallback");
  assert.equal(result.source, "local");
  assert.equal(result.groups.length, 1);
});

test("a federated fallback supplies results only when the local index finds nothing", async () => {
  const index = buildInstrumentSearchIndex([]);
  const providerRow = candidate({
    name: "Federated Only Co",
    symbol: "FED",
    entityId: null,
    listingId: null,
    canonical: false,
    isPrimaryListing: false,
    source: "federated_provider",
  });

  const fallback: InstrumentSearchFederatedFallback = {
    search: async () => [providerRow],
  };

  const result = await searchInstruments(index, "FED", {}, fallback);
  assert.equal(result.source, "provider_fallback");
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].primary.symbol, "FED");
});

test("a query with no local or federated match reports source none without throwing", async () => {
  const index = buildInstrumentSearchIndex([]);
  const fallback: InstrumentSearchFederatedFallback = { search: async () => [] };

  const result = await searchInstruments(index, "NOTHING", {}, fallback);
  assert.equal(result.source, "none");
  assert.deepEqual(result.groups, []);
});
