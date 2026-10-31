import test from "node:test";
import assert from "node:assert/strict";
import type { DirectoryEntry } from "./finance";
import { pickCatalogEntry, resolveInstrumentPriceState } from "./referenceOnlyInstrument";

const reliance: DirectoryEntry = { symbol: "RELIANCE.NS", name: "Reliance Industries Limited", exchange: "NSE", sector: "Energy", source: "financedatabase" };
const base = { symbol: "RELIANCE.NS", hasQuote: false, quoteSettled: true, quoteFailed: false, catalogSettled: true, entry: reliance };

test("a catalog-only symbol is Reference only with a data-source call to action, never a price", () => {
  const state = resolveInstrumentPriceState(base);
  assert.equal(state.kind, "reference_only");
  if (state.kind !== "reference_only") return;
  assert.equal(state.headline, "Reference only — no live price");
  assert.match(state.detail, /Reliance Industries Limited \(NSE · Energy\)/);
  assert.match(state.detail, /Connect a data source/);
});

test("an observed quote always wins over catalog status", () => {
  assert.equal(resolveInstrumentPriceState({ ...base, hasQuote: true }).kind, "live");
});

test("nothing is claimed while the quote or catalog lookup is still running", () => {
  assert.equal(resolveInstrumentPriceState({ ...base, quoteSettled: false }).kind, "checking");
  assert.equal(resolveInstrumentPriceState({ ...base, catalogSettled: false, entry: null }).kind, "checking");
});

test("a failed quote request is reported as unavailable, not as reference-only", () => {
  const state = resolveInstrumentPriceState({ ...base, quoteFailed: true });
  assert.equal(state.kind, "unavailable");
  assert.match(state.detail, /nothing has been estimated/i);
});

test("a symbol with neither a quote nor a catalog row says no live price", () => {
  const state = resolveInstrumentPriceState({ ...base, entry: null, symbol: "ZZZZ" });
  assert.equal(state.kind, "no_price");
  assert.match(state.detail, /ZZZZ/);
});

test("the catalog entry must match the symbol exactly and prefers the primary listing", () => {
  const other: DirectoryEntry = { ...reliance, symbol: "RELIANCE.BO", exchange: "BSE" };
  assert.equal(pickCatalogEntry([other, reliance], "reliance.ns"), reliance);
  assert.equal(pickCatalogEntry([other], "RELIANCE.NS"), null);
  assert.equal(pickCatalogEntry(undefined, "RELIANCE.NS"), null);
  const primary: DirectoryEntry = { ...reliance, exchange: "NYQ", isPrimaryListing: true };
  assert.equal(pickCatalogEntry([reliance, primary], "RELIANCE.NS"), primary);
});
