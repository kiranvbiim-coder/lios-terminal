import assert from "node:assert/strict";
import test from "node:test";
import {
  collectInstrumentDirectoryRows,
  queryInstrumentDirectory,
  searchInstrumentDirectory,
  instrumentDirectoryFacets,
  instrumentDirectoryRegions,
} from "./instrumentDirectory";

const eq = (symbol: string, name: string, exchange: string, mic: string, extra = {}) =>
  ({ symbol, name, exchange, mic, currency: "USD", assetClass: "equities", provider: "financedatabase", active: true, ...extra });
test("300k-ready directory unifies data without symbol-only collisions or fake coverage", () => {
  const snapshot = collectInstrumentDirectoryRows(
    [
      { symbol: "DUP", name: "Legacy Same", exchange: "NMS", sector: "Technology", assetClass: "equity" },
      { symbol: "FILE CREATION TIME: 2026-10-25", name: "footer", exchange: "NMS" },
      { symbol: "", name: "empty", exchange: "NMS" },
    ],
    [
      { symbol: "C", name: "Crypto Sample", exchange: "CRYPTO", provider: "coingecko", active: true },
      { symbol: "DUP", name: "Duplicate Provider", exchange: "NMS", provider: "sec_edgar" },
    ],
    [
      eq("DUP", "A Company", "NMS", "XNAS", { sector: "Information Technology", countryName: "United States", isin: "US0378331005" }),
      eq("DUP", "A Company", "NYQ", "XNYS", { active: false }),
      eq("FUND", "Synthetic ETF", "AMS", "XAMS", { assetClass: "etfs", currency: "EUR", countryName: "Netherlands", category: "Equities" }),
      eq("FUND", "Synthetic ETF", "AMS", "XAMS", { assetClass: "etfs", currency: "EUR" }),
    ],
  );
  assert.equal(snapshot.uniqueListingCount, 5);
  assert.equal(snapshot.uniqueSymbolCount, 3);
  assert.equal(snapshot.sources.financedatabase, 3);
  assert.equal(snapshot.sources.legacy67k, 1);
  assert.equal(snapshot.sources.coingecko, 1);
  assert.equal(queryInstrumentDirectory(snapshot.items, {}).total, 4, "Historical rows excluded by default");
  assert.equal(queryInstrumentDirectory(snapshot.items, { includeHistorical: true }).total, 5);
  assert.equal(queryInstrumentDirectory(snapshot.items, { assetClass: "etf" }).total, 1);
  assert.equal(queryInstrumentDirectory(snapshot.items, { exchange: "NYQ", includeHistorical: true }).total, 1);
  assert.equal(queryInstrumentDirectory(snapshot.items, { region: "NL" }).total, 1);
  assert.equal(queryInstrumentDirectory(snapshot.items, { q: "synthetic", limit: 1 }).items.length, 1);
  assert.equal(queryInstrumentDirectory(snapshot.items, { q: "synthetic", page: 2, limit: 1 }).total, 1);
  assert.deepEqual(instrumentDirectoryRegions(snapshot.items), ["NL", "US"]);
  const facets = instrumentDirectoryFacets(snapshot.items);
  assert.equal(facets.active, 4);
  assert.equal(facets.historical, 1);
  assert.equal(facets.assetClasses.find(x => x.value === "etf")?.count, 1);
  assert.equal(facets.referenceOnly, true);
  const matches = searchInstrumentDirectory(snapshot.items, "DUP");
  assert.equal(matches.length, 2, "Two venues, same ticker, not merged");
  assert.equal(matches[0].symbol, "DUP");
  assert.equal(matches[1].symbol, "DUP");
});

test("directory bounds output for a common short query and paginated scan", () => {
  const source = Array.from({ length: 12_000 }, (_, i) => eq("A" + i, "Example " + i, "NMS", "XNAS"));
  const rows = collectInstrumentDirectoryRows([], [], source).items;
  assert.equal(rows.length, 12_000);
  assert.equal(searchInstrumentDirectory(rows, "A", 15).length, 15);
  const page = queryInstrumentDirectory(rows, { q: "Example", page: 7 });
  assert.equal(page.total, 12_000);
  assert.equal(page.items.length, 20);
  assert.equal(page.totalPages, 600);
  // Equal-relevance rows page in deterministic alphabetical symbol order.
  const alphabetical = source.map(row => row.symbol).sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1);
  assert.equal(page.items[0].symbol, alphabetical[120]);
  assert.deepEqual(queryInstrumentDirectory(rows, { q: "Example", page: 7 }).items.map(r => r.symbol),
    page.items.map(r => r.symbol), "Paging is stable across identical queries");
});

test("search puts the home primary listing of the intended security first", () => {
  // Fixture mirrors the real FinanceDatabase rows that previously outranked
  // the intended security (catalog insertion order, venue-blind).
  const fx = (symbol: string, name: string, exchange: string, mic: string, countryName: string, marketCapTier: string | null, assetClass = "equities") =>
    eq(symbol, name, exchange, mic, { countryName, marketCapTier, assetClass });
  const rows = collectInstrumentDirectoryRows([], [], [
    fx("RWC.AX", "Reliance Worldwide Corporation Limited", "ASX", "XASX", "United States", "Mid Cap"),
    fx("EUPIC.AT", "European Reliance General Insurance Company S.A.", "ATH", "ASEX", "Greece", "Micro Cap"),
    fx("RLI.BE", "Reliance Industries Ltd Sponsored GDR 144A", "BER", "XBER", "India", "Large Cap"),
    fx("NIOSAD.BO", "Reliance Mutual Fund", "BSE", "XBOM", "India", null),
    fx("RPOWER.NS", "Reliance Power Limited", "NSE", "XNSE", "India", "Small Cap"),
    fx("500325.BO", "Reliance Industries Limited", "BSE", "XBOM", "India", "Large Cap"),
    fx("RELIANCE.NS", "Reliance Industries Limited", "NSE", "XNSE", "India", "Large Cap"),
    fx("MSF.BE", "Microsoft Corporation", "BER", "XBER", "United States", "Mega Cap"),
    fx("MSFT.BA", "Microsoft Corporation", "BUE", "XBUE", "United States", "Mega Cap"),
    fx("MSF.DE", "Microsoft Corporation", "GER", "XETR", "United States", "Mega Cap"),
    fx("MSFT", "Microsoft Corporation", "NMS", "XNAS", "United States", "Mega Cap"),
    fx("MSFTX", "Microsoft Tracker Index", "NIM", "", "United States", null, "indices"),
    fx("INFY", "Infosys Limited", "NYQ", "XNYS", "India", "Large Cap"),
    fx("INFY.NS", "Infosys Limited", "NSE", "XNSE", "India", "Large Cap"),
  ]).items;
  const top = (q: string, n: number) => searchInstrumentDirectory(rows, q, 15).slice(0, n).map(r => r.symbol);

  assert.deepEqual(top("Reliance", 4), ["RELIANCE.NS", "RPOWER.NS", "500325.BO", "NIOSAD.BO"],
    "base-ticker match, then home primary NSE listings, then BSE, each by market-cap tier");
  assert.deepEqual(top("Reliance", 7).slice(4), ["RWC.AX", "RLI.BE", "EUPIC.AT"],
    "foreign venues and GDRs follow; a mid-name word match comes last");
  assert.equal(top("Microsoft", 1)[0], "MSFT", "home primary venue beats foreign venues");
  assert.equal(top("MSFT", 1)[0], "MSFT", "exact ticker on the primary venue first");
  assert.deepEqual(top("MSFT", 3), ["MSFT", "MSFT.BA", "MSFTX"], "base-ticker venue match outranks symbol prefix");
  assert.equal(top("RELIANCE.NS", 1)[0], "RELIANCE.NS");
  assert.equal(top("infosys", 1)[0], "INFY.NS", "home exchange over a foreign ADR");
  assert.deepEqual(top("INFY", 2), ["INFY.NS", "INFY"], "base and bare tickers are both exact; the home listing leads");

  // The paged directory uses the same order, and Markets tabs map to venues.
  assert.equal(queryInstrumentDirectory(rows, { q: "Reliance" }).items[0].symbol, "RELIANCE.NS");
  assert.equal(queryInstrumentDirectory(rows, { q: "microsoft", page: 1, limit: 1 }).items[0].symbol, "MSFT");
  assert.equal(queryInstrumentDirectory(rows, { q: "microsoft", page: 2, limit: 1 }).items[0].symbol, "MSF.DE");
  assert.deepEqual(queryInstrumentDirectory(rows, { exchange: "NSE" }).items.map(r => r.symbol),
    ["INFY.NS", "RELIANCE.NS", "RPOWER.NS"]);
  assert.equal(queryInstrumentDirectory(rows, { exchange: "XETRA" }).items[0].symbol, "MSF.DE");
  assert.equal(queryInstrumentDirectory(rows, { exchange: "US" }).items[0].symbol, "MSFT");
});
