import test from "node:test";
import assert from "node:assert/strict";

import { isSecuritySearchResult, rankSecuritySearchResults, resolveVerifiedSecuritySelection } from "./terminalSecuritySearch";

test("security search ranks a matching public company above incidental token names", () => {
  const results = rankSecuritySearchResults([
    { symbol: "APPLE-USD", name: "dog with apple in mouth", exchange: "CRYPTO", assetClass: "crypto" },
    { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", assetClass: "equity" },
  ], "APPLE");

  assert.equal(results[0].symbol, "AAPL");
});

test("security search gives an exact symbol match highest priority", () => {
  const results = rankSecuritySearchResults([
    { symbol: "META.L", name: "WisdomTree Meta Platforms", exchange: "LSE", assetClass: "equity" },
    { symbol: "META", name: "Meta Platforms Inc.", exchange: "NASDAQ", assetClass: "equity" },
  ], "META");

  assert.equal(results[0].symbol, "META");
});

test("security search retains an exact crypto symbol match", () => {
  const results = rankSecuritySearchResults([
    { symbol: "BTC.AX", name: "Bitcoin Group", exchange: "ASX", assetClass: "equity" },
    { symbol: "BTC", name: "Bitcoin", exchange: "CRYPTO", assetClass: "crypto" },
  ], "BTC");

  assert.equal(results[0].symbol, "BTC");
});

test("security search preserves provider order when relevance scores tie", () => {
  const results = rankSecuritySearchResults([
    { symbol: "ABC1", name: "ABC Holdings", assetClass: "equity" },
    { symbol: "ABC2", name: "ABC Industries", assetClass: "equity" },
  ], "ABC");

  assert.deepEqual(results.map((result) => result.symbol), ["ABC1", "ABC2"]);
});

test("unrelated equities and exchange bonuses cannot appear as company search matches", () => {
  assert.deepEqual(rankSecuritySearchResults([
    { symbol: "MSFT", name: "Microsoft Corp", exchange: "NASDAQ", assetClass: "equity" },
    { symbol: "NVDA", name: "NVIDIA Corp", exchange: "NASDAQ", assetClass: "equity" },
  ], "NONEXISTENT"), []);
  assert.deepEqual(rankSecuritySearchResults([
    { symbol: "MSFT", name: "Microsoft Corp", exchange: "NASDAQ", assetClass: "equity" },
  ], ""), []);
});

test("security lookup drops malformed provider rows before ranking", () => {
  const results: unknown[] = [
    { symbol: "XYZ", name: "XYZ Inc", exchange: "NASDAQ" },
    { symbol: "BAD NAME", name: "Invalid symbol", exchange: "LSE" },
    { symbol: "VOID", name: "", exchange: "LSE" },
    { symbol: "EQUITY", name: "Equity fake", exchange: 123 },
    null,
  ];
  assert.deepEqual(results.filter(isSecuritySearchResult).map(row => row.symbol), ["XYZ"]);
  assert.deepEqual(rankSecuritySearchResults(results.filter(isSecuritySearchResult), "XYZ").map(row => row.symbol), ["XYZ"]);
});

test("GO never manufactures tickers from a company name, fuzzy row or stale response", () => {
  const apple = { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", assetClass: "equity" };
  const other = { symbol: "MSFT", name: "Microsoft", exchange: "NASDAQ", assetClass: "equity" };
  assert.equal(resolveVerifiedSecuritySelection("Apple", [apple], "Apple"), null);
  assert.equal(resolveVerifiedSecuritySelection("MSFT", [apple], "MSFT"), null);
  assert.equal(resolveVerifiedSecuritySelection("AAPL", [apple], "MSFT"), null);
  assert.equal(resolveVerifiedSecuritySelection("AAPL", [], "AAPL"), null);
  assert.equal(resolveVerifiedSecuritySelection("AAPL", [apple], null), null);
  assert.equal(resolveVerifiedSecuritySelection("AAPL", [apple, other], "AAPL")?.symbol, "AAPL");
  assert.equal(resolveVerifiedSecuritySelection(" aapl ", [apple], "aapl")?.symbol, "AAPL");
});

test("duplicate ticker across ambiguous listings requires explicit selection", () => {
  const us = { symbol: "ABC", name: "ABC Inc", exchange: "NYSE" };
  const other = { symbol: "ABC", name: "ABC Group", exchange: "LSE" };
  assert.equal(resolveVerifiedSecuritySelection("ABC", [us, other], "ABC"), null);
  assert.equal(resolveVerifiedSecuritySelection("ABC", [us], "ABC"), us);
});

test("client TopBar submits resolved provider-listed symbols only and surfaces missing data", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../components/terminal/TopBar.tsx", import.meta.url), "utf8");
  assert.match(source, /resolveVerifiedSecuritySelection\(searchVal, searchResults, completedSearch\)/);
  assert.match(source, /if \(resolved\) chooseSecurity\(resolved\)/);
  assert.match(source, /onSymbol\(result\.symbol\.trim\(\)\.toUpperCase\(\)\)/);
  assert.doesNotMatch(source, /onSymbol\(v\)/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /No matching securities returned by the source/);
});
