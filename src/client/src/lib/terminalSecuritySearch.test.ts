import test from "node:test";
import assert from "node:assert/strict";

import { rankSecuritySearchResults } from "./terminalSecuritySearch";

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
