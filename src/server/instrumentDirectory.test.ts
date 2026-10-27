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
  assert.equal(page.items[0].symbol, "A120");
});
