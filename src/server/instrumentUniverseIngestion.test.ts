import assert from "node:assert/strict";
import test from "node:test";
import { mergeProviderRows, INGESTION_PROVIDERS } from "./instrumentUniverseIngestion";
import type { LegacySymbolCatalogRow } from "@shared/globalInstrumentMaster";

test("mergeProviderRows skips symbols already covered by existingSymbols", () => {
  const existing = new Set(["AAPL"]);
  const { rows, summary } = mergeProviderRows(existing, [
    { provider: "sec_edgar", rows: [{ symbol: "AAPL", name: "Apple" }, { symbol: "NEWCO", name: "New Company" }] },
  ]);
  assert.deepEqual(rows.map((r) => r.symbol), ["NEWCO"]);
  assert.equal(summary[0].fetched, 2);
  assert.equal(summary[0].netNew, 1);
});

test("mergeProviderRows: a symbol appearing in two sources keeps only the first (highest-priority) source's row", () => {
  const { rows, summary } = mergeProviderRows(new Set(), [
    { provider: "sec_edgar", rows: [{ symbol: "ACME", name: "Acme (SEC)", provider: "sec_edgar" }] },
    { provider: "nasdaq_trader", rows: [{ symbol: "ACME", name: "Acme (NASDAQ)", provider: "nasdaq_trader" }] },
  ]);
  assert.equal(rows.length, 1, "the second source's duplicate row must be dropped, not duplicated");
  assert.equal(rows[0].name, "Acme (SEC)");
  assert.equal(summary[0].netNew, 1);
  assert.equal(summary[1].netNew, 0, "the NASDAQ source sees zero net-new once SEC has already claimed the symbol");
});

test("mergeProviderRows is idempotent: re-running with the previous run's output folded into existingSymbols produces zero net-new", () => {
  const first = mergeProviderRows(new Set(), [
    { provider: "sec_edgar", rows: [{ symbol: "AAPL", name: "Apple" }, { symbol: "MSFT", name: "Microsoft" }] },
  ]);
  const symbolsAfterFirstRun = new Set(first.rows.map((r) => r.symbol.toUpperCase()));
  const second = mergeProviderRows(symbolsAfterFirstRun, [
    { provider: "sec_edgar", rows: [{ symbol: "AAPL", name: "Apple" }, { symbol: "MSFT", name: "Microsoft" }] },
  ]);
  assert.equal(second.rows.length, 0);
  assert.equal(second.summary[0].netNew, 0);
});

test("mergeProviderRows drops a row with an empty/whitespace symbol rather than crashing or inventing one", () => {
  const { rows } = mergeProviderRows(new Set(), [
    { provider: "coingecko", rows: [{ symbol: "  ", name: "Nameless" }, { symbol: "REAL", name: "Real Coin" }] },
  ]);
  assert.deepEqual(rows.map((r) => r.symbol), ["REAL"]);
});

test("mergeProviderRows within one source: a duplicate symbol inside the same source's own rows is also deduped, not just across sources", () => {
  const rows: LegacySymbolCatalogRow[] = [
    { symbol: "DUP", name: "First" },
    { symbol: "DUP", name: "Second" },
  ];
  const { rows: merged, summary } = mergeProviderRows(new Set(), [{ provider: "coingecko", rows }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, "First");
  assert.equal(summary[0].netNew, 1);
});

test("INGESTION_PROVIDERS ids are stable strings usable as source tags", () => {
  assert.equal(INGESTION_PROVIDERS.secEdgar, "sec_edgar");
  assert.equal(INGESTION_PROVIDERS.nasdaqTrader, "nasdaq_trader");
  assert.equal(INGESTION_PROVIDERS.coinGecko, "coingecko");
});
