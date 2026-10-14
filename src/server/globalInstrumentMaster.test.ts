import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptLegacySymbolCatalogRow,
  formatLiosId,
  resolveInstrument,
  resolveInstrumentLocal,
  type InstrumentMasterCandidate,
} from "../shared/globalInstrumentMaster";

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

test("stable LiOS ids are kind-prefixed and reject empty persisted ids", () => {
  assert.equal(formatLiosId("entity", 42), "lios:entity:42");
  assert.equal(formatLiosId("listing", "abc"), "lios:listing:abc");
  assert.throws(() => formatLiosId("instrument", "   "), /empty persisted id/);
});

test("ticker plus MIC resolves duplicate global symbols deterministically", () => {
  const nasdaq = candidate({ name: "Example US", symbol: "ABC", mic: "XNAS", exchange: "NASDAQ" });
  const london = candidate({
    name: "Example UK",
    symbol: "ABC",
    mic: "XLON",
    exchange: "LSE",
    countryCode: "GB",
    currency: "GBP",
    entityId: formatLiosId("entity", "uk-abc"),
    listingId: formatLiosId("listing", "uk-abc"),
  });

  const result = resolveInstrumentLocal({ ticker: "abc", mic: "XLON" }, [nasdaq, london]);
  assert.equal(result.status, "resolved");
  assert.equal(result.match?.mic, "XLON");
  assert.equal(result.source, "local");
});

test("an unscoped duplicate ticker is surfaced as ambiguous instead of guessed", () => {
  const first = candidate({ name: "Example A", symbol: "XYZ", mic: "XNAS", exchange: "NASDAQ" });
  const second = candidate({
    name: "Example B",
    symbol: "XYZ",
    mic: "XNYS",
    exchange: "NYSE",
    entityId: formatLiosId("entity", "xyz-b"),
    listingId: formatLiosId("listing", "xyz-b"),
  });

  const result = resolveInstrumentLocal({ ticker: "XYZ" }, [first, second]);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.match, null);
  assert.equal(result.candidates.length, 2);
});

test("primary active canonical listing outranks an otherwise matching secondary listing", () => {
  const primary = candidate({ name: "Example Corp", symbol: "EXM", isPrimaryListing: true });
  const secondary = candidate({
    name: "Example Corp",
    symbol: "EXM",
    mic: "BATS",
    exchange: "CBOE",
    isPrimaryListing: false,
    listingId: formatLiosId("listing", "exm-secondary"),
  });

  const result = resolveInstrumentLocal({ ticker: "EXM" }, [secondary, primary]);
  assert.equal(result.status, "resolved");
  assert.equal(result.match?.isPrimaryListing, true);
});

test("historical aliases are excluded by default and opt-in searchable", () => {
  const renamed = candidate({
    name: "New Name Plc",
    symbol: "NEW",
    lifecycleStatus: "renamed",
    validTo: "2024-12-31",
    aliases: [{ kind: "ticker", value: "OLD", validTo: "2024-12-31" }],
  });

  const defaultResult = resolveInstrumentLocal({ ticker: "OLD" }, [renamed]);
  assert.equal(defaultResult.status, "not_found");

  const historicalResult = resolveInstrumentLocal({ ticker: "OLD", includeHistorical: true }, [renamed]);
  assert.equal(historicalResult.status, "resolved");
  assert.equal(historicalResult.match?.symbol, "NEW");
});

test("LV4-04-13: asOfDate resolves a now-delisted candidate that was valid on that date", () => {
  const delisted = candidate({
    name: "Old Corp",
    symbol: "OLDCO",
    lifecycleStatus: "delisted",
    validFrom: "2010-01-01",
    validTo: "2019-06-30",
  });

  const today = resolveInstrumentLocal({ ticker: "OLDCO" }, [delisted]);
  assert.equal(today.status, "not_found");

  const asOf = resolveInstrumentLocal({ ticker: "OLDCO", asOfDate: "2015-03-15" }, [delisted]);
  assert.equal(asOf.status, "resolved");
  assert.equal(asOf.match?.symbol, "OLDCO");
  // scoreCandidate must not apply the "historical listing" penalty for a
  // candidate that already passed the point-in-time window check.
  assert.ok(asOf.candidates[0]?.reasons.includes("valid as of requested date"));
});

test("LV4-04-13: asOfDate excludes a candidate whose listing had not started yet", () => {
  const future = candidate({
    name: "Newco",
    symbol: "NEWCO",
    lifecycleStatus: "active",
    validFrom: "2023-01-01",
  });

  const asOf = resolveInstrumentLocal({ ticker: "NEWCO", asOfDate: "2020-01-01" }, [future]);
  assert.equal(asOf.status, "not_found");
});

test("LV4-04-13: asOfDate distinguishes two non-overlapping listings for the same ticker", () => {
  const early = candidate({
    name: "Ticker Reuse Early",
    symbol: "REUSE",
    lifecycleStatus: "delisted",
    entityId: formatLiosId("entity", "reuse-early"),
    listingId: formatLiosId("listing", "reuse-early"),
    validFrom: "2000-01-01",
    validTo: "2005-12-31",
  });
  const later = candidate({
    name: "Ticker Reuse Later",
    symbol: "REUSE",
    lifecycleStatus: "active",
    entityId: formatLiosId("entity", "reuse-later"),
    listingId: formatLiosId("listing", "reuse-later"),
    validFrom: "2015-01-01",
  });

  const asOf2003 = resolveInstrumentLocal({ ticker: "REUSE", asOfDate: "2003-06-01" }, [early, later]);
  assert.equal(asOf2003.status, "resolved");
  assert.equal(asOf2003.match?.name, "Ticker Reuse Early");

  const asOf2020 = resolveInstrumentLocal({ ticker: "REUSE", asOfDate: "2020-06-01" }, [early, later]);
  assert.equal(asOf2020.status, "resolved");
  assert.equal(asOf2020.match?.name, "Ticker Reuse Later");

  const asOf2010 = resolveInstrumentLocal({ ticker: "REUSE", asOfDate: "2010-06-01" }, [early, later]);
  assert.equal(asOf2010.status, "not_found");
});

test("LV4-04-13: asOfDate supersedes includeHistorical rather than requiring both", () => {
  const delisted = candidate({
    name: "Old Corp",
    symbol: "OLDCO2",
    lifecycleStatus: "delisted",
    validFrom: "2010-01-01",
    validTo: "2019-06-30",
  });

  const result = resolveInstrumentLocal(
    { ticker: "OLDCO2", includeHistorical: false, asOfDate: "2015-03-15" },
    [delisted],
  );
  assert.equal(result.status, "resolved");
});

test("LV4-04-13: a malformed asOfDate fails closed instead of matching everything", () => {
  const active = candidate({ name: "Still Trading", symbol: "STILL", lifecycleStatus: "active" });

  const result = resolveInstrumentLocal({ ticker: "STILL", asOfDate: "not-a-date" }, [active]);
  assert.equal(result.status, "not_found");
});

test("LV4-04-13: asOfDate exactly equal to validFrom or validTo is inclusive, not excluded", () => {
  const bounded = candidate({
    name: "Bounded Co",
    symbol: "BOUND",
    lifecycleStatus: "delisted",
    validFrom: "2010-01-01",
    validTo: "2019-06-30",
  });

  const onValidFrom = resolveInstrumentLocal({ ticker: "BOUND", asOfDate: "2010-01-01" }, [bounded]);
  assert.equal(onValidFrom.status, "resolved", "the exact start date must be included, not excluded");

  const onValidTo = resolveInstrumentLocal({ ticker: "BOUND", asOfDate: "2019-06-30" }, [bounded]);
  assert.equal(onValidTo.status, "resolved", "the exact end date must be included, not excluded");

  const oneDayBeforeStart = resolveInstrumentLocal({ ticker: "BOUND", asOfDate: "2009-12-31" }, [bounded]);
  assert.equal(oneDayBeforeStart.status, "not_found");

  const oneDayAfterEnd = resolveInstrumentLocal({ ticker: "BOUND", asOfDate: "2019-07-01" }, [bounded]);
  assert.equal(oneDayAfterEnd.status, "not_found");
});

test("LV4-04-13: a candidate with no persisted validity window fails closed for any asOfDate", () => {
  // Mirrors the bundled ~67k legacy ticker catalog, which never sets
  // validFrom/validTo at all -- unknown temporal bounds must not be
  // silently treated as "valid at every possible date".
  const noTemporalData = candidate({ name: "Undated Legacy Row", symbol: "UNDATED" });
  assert.equal(noTemporalData.validFrom, undefined);
  assert.equal(noTemporalData.validTo, undefined);

  const result = resolveInstrumentLocal({ ticker: "UNDATED", asOfDate: "1800-01-01" }, [noTemporalData]);
  assert.equal(result.status, "not_found");

  // Without asOfDate, the same candidate is findable exactly as before --
  // this fail-closed rule only applies to the point-in-time query path.
  const today = resolveInstrumentLocal({ ticker: "UNDATED" }, [noTemporalData]);
  assert.equal(today.status, "resolved");
});

test("LV4-04-13: a candidate with only one of validFrom/validTo set is still open-ended, not treated as unknown", () => {
  const stillActive = candidate({ name: "Open Ended Co", symbol: "OPENEND", validFrom: "2010-01-01" });
  const result = resolveInstrumentLocal({ ticker: "OPENEND", asOfDate: "2030-01-01" }, [stillActive]);
  assert.equal(result.status, "resolved", "a set validFrom with no validTo means still open, not unknown");
});

test("provider fallback runs only when the local master has no match", async () => {
  let calls = 0;
  const fallbackCandidate = candidate({ name: "Fallback Ltd", symbol: "FBK" });
  const fallback = {
    async resolve() {
      calls += 1;
      return [fallbackCandidate];
    },
  };

  const result = await resolveInstrument({ ticker: "FBK" }, [], fallback);
  assert.equal(calls, 1);
  assert.equal(result.status, "resolved");
  assert.equal(result.source, "provider_fallback");

  calls = 0;
  const localResult = await resolveInstrument({ ticker: "FBK" }, [fallbackCandidate], fallback);
  assert.equal(calls, 0);
  assert.equal(localResult.source, "local");
});

test("legacy catalog rows remain explicitly non-canonical until linked", () => {
  const legacy = adaptLegacySymbolCatalogRow({
    symbol: "INFY",
    name: "Infosys Limited",
    exchange: "NSE",
    mic: "XNSE",
    countryCode: "IN",
    currency: "INR",
    provider: "legacy67k",
    providerId: "legacy-infy",
  });

  assert.equal(legacy.entityId, null);
  assert.equal(legacy.listingId, null);
  assert.equal(legacy.canonical, false);
  assert.equal(legacy.identifiers.some((id) => id.type === "provider_id" && id.value === "legacy-infy"), true);
});


test("name resolution ignores legal suffixes, requires word-boundary prefixes and never invents identity", () => {
  const row = (symbol: string, name: string) => adaptLegacySymbolCatalogRow({ symbol, name, exchange: "NASDAQ" });
  const catalog = [
    row("AAPL", "Apple Inc."),
    row("AAPL.MX", "Apple Inc."),
    row("APLE", "Apple Hospitality Reit, Inc."),
    row("Z-USD", "Z"),
  ];
  for (const name of ["Apple", "apple company", "Apple Inc."]) {
    const result = resolveInstrumentLocal({ name }, catalog);
    assert.equal(result.status, "resolved", name);
    assert.equal(result.match?.symbol, "AAPL", name);
    assert.equal(result.match?.canonical, false);
  }
  // A one-letter catalog name must not match every query that begins with that letter.
  assert.equal(resolveInstrumentLocal({ name: "Zzzqx Holdings" }, catalog).status, "not_found");
  assert.equal(resolveInstrumentLocal({ name: "Ap" }, catalog).status, "not_found");
});

function entityOnly(
  id: number,
  name: string,
  overrides: Partial<InstrumentMasterCandidate> = {},
): InstrumentMasterCandidate {
  return {
    entityId: formatLiosId("entity", id),
    listingId: null,
    securityId: null,
    name,
    symbol: null,
    isPrimaryListing: false,
    lifecycleStatus: "active",
    identifiers: [],
    aliases: [],
    source: "entity_record",
    canonical: true,
    ...overrides,
  };
}

test("CA-03: an entity without a symbol resolves by exact name with no symbol, ticker or identifier invented", () => {
  const result = resolveInstrumentLocal({ name: "Zephyr Quantum Holdings Ltd" }, [
    entityOnly(1, "Zephyr Quantum Holdings Ltd"),
    candidate({ name: "Apple Inc.", symbol: "AAPL" }),
  ]);
  assert.equal(result.status, "resolved");
  assert.equal(result.match?.symbol, null);
  assert.equal(result.match?.listingId, null);
  assert.deepEqual(result.match?.identifiers, []);
  assert.deepEqual(result.candidates[0].reasons.filter((reason) => /ticker/i.test(reason)), []);
});

test("CA-03: two same-named symbol-less entities are ambiguous with both ranked, never one chosen", () => {
  const result = resolveInstrumentLocal({ name: "Meridian Cartography Ltd" }, [
    entityOnly(1, "Meridian Cartography Ltd", { entity: { jurisdiction: "GB", legalEntityKind: "corporation", legalForm: null, lifecycleStatus: "unknown", identityStatus: "provisional", nameIsPlaceholder: false } }),
    entityOnly(2, "Meridian Cartography Ltd", { entity: { jurisdiction: "DE", legalEntityKind: "corporation", legalForm: null, lifecycleStatus: "unknown", identityStatus: "provisional", nameIsPlaceholder: false } }),
  ]);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.match, null);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].score, result.candidates[1].score);
});

test("CA-03: a ticker query, even a blank one, never matches an entity that has no symbol", () => {
  const entities = [entityOnly(1, "Zephyr Quantum Holdings Ltd")];
  assert.equal(resolveInstrumentLocal({ ticker: "ZQH" }, entities).status, "not_found");
  assert.equal(resolveInstrumentLocal({ ticker: "   " }, entities).status, "not_found");
});

test("CA-03: registry_id is namespaced by registry and optionally jurisdiction; a bare number never matches", () => {
  const gb = entityOnly(1, "Harbour Freight Logistics Ltd", {
    identifiers: [{ type: "registry_id", value: "00012345", registry: "UK_COMPANIES_HOUSE", jurisdiction: "GB" }],
  });
  const de = entityOnly(2, "Hafen Fracht Logistik GmbH", {
    identifiers: [{ type: "registry_id", value: "00012345", registry: "HANDELSREGISTER", jurisdiction: "DE" }],
  });
  const scoped = resolveInstrumentLocal(
    { identifier: { type: "registry_id", value: "00012345", registry: "uk_companies_house", jurisdiction: "gb" } },
    [gb, de],
  );
  assert.equal(scoped.status, "resolved");
  assert.equal(scoped.match?.entityId, "lios:entity:1");

  const wrongJurisdiction = resolveInstrumentLocal(
    { identifier: { type: "registry_id", value: "00012345", registry: "UK_COMPANIES_HOUSE", jurisdiction: "DE" } },
    [gb, de],
  );
  assert.equal(wrongJurisdiction.status, "not_found");

  const noRegistry = resolveInstrumentLocal({ identifier: { type: "registry_id", value: "00012345" } }, [gb, de]);
  assert.equal(noRegistry.status, "not_found");

  const sameRegistryTwoJurisdictions = resolveInstrumentLocal(
    { identifier: { type: "registry_id", value: "00012345", registry: "OPENCORPORATES" } },
    [
      entityOnly(3, "Alpha Ltd", { identifiers: [{ type: "registry_id", value: "00012345", registry: "OPENCORPORATES", jurisdiction: "GB" }] }),
      entityOnly(4, "Beta GmbH", { identifiers: [{ type: "registry_id", value: "00012345", registry: "OPENCORPORATES", jurisdiction: "DE" }] }),
    ],
  );
  assert.equal(sameRegistryTwoJurisdictions.status, "ambiguous");
});

test("CA-03: a catalog record without a ticker adapts with a name and no ticker identifier", () => {
  const row = adaptLegacySymbolCatalogRow({ symbol: null, name: "PRIVATE ISSUER 2031 NOTE", provider: "openfigi", providerId: "BBG00NOTICKER" });
  assert.equal(row.symbol, null);
  assert.deepEqual(row.identifiers.map((item) => item.type), ["provider_id"]);
  assert.equal(row.name, "PRIVATE ISSUER 2031 NOTE");
});
