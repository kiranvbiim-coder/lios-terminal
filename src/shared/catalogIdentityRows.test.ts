import assert from "node:assert/strict";
import test from "node:test";
import { isUsableCatalogIdentityRow } from "./catalogIdentityRows";

test("legitimate exchange listings remain discoverable", () => {
  for (const row of [
    { symbol: "RELIANCE.NS", name: "Reliance Industries", exchange: "NSE" },
    { symbol: "500325.BO", name: "Reliance Industries", exchange: "BSE" },
    { symbol: "BTC-USD", name: "Bitcoin", exchange: "CRYPTO" },
  ]) {
    assert.equal(isUsableCatalogIdentityRow(row), true);
  }
});

test("original Nasdaq file-creation footer can never appear as an instrument", () => {
  for (const name of ["", "nonempty-but-still-metadata"]) {
    assert.equal(isUsableCatalogIdentityRow({
      symbol: "FILE CREATION TIME: 0820202603:02", name, exchange: "NASDAQ",
    }), false);
  }
  assert.equal(isUsableCatalogIdentityRow({
    symbol: "  file creation time: 12345", name: "Metadata",
  }), false);
});

test("missing, nonstring and blank source identities are not searchable", () => {
  for (const value of [
    null, undefined, [], "ABC", 25, {},
    { symbol: null, name: "Acme" },
    { symbol: "ABC", name: null },
    { symbol: " ", name: "Acme" },
    { symbol: "ABC", name: "  " },
  ]) {
    assert.equal(isUsableCatalogIdentityRow(value), false);
  }
});
