import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInstrumentSearchIndex,
  instrumentSearchGroupKey,
  searchInstrumentIndexLocal,
} from "./instrumentSearchIndex";
import type { InstrumentMasterCandidate } from "./globalInstrumentMaster";

const candidate = (venue: string | null, currency: string | null, source: string): InstrumentMasterCandidate => ({
  entityId: null, listingId: null, canonical: false, isPrimaryListing: false,
  lifecycleStatus: "active", name: "Fixture Shared", symbol: "SHARED", exchange: venue,
  currency, identifiers: [{ type: "ticker", value: "SHARED", provider: source }],
  aliases: [], source,
});

test("unlinked identically named symbols across venues remain unmerged until P5 resolves identity", () => {
  const a = candidate("NMS", "USD", "financedatabase");
  const b = candidate("NYQ", "USD", "financedatabase");
  const c = candidate("NMS", "EUR", "financedatabase");
  const d = candidate(null, "USD", "source_a");
  const e = candidate(null, "USD", "source_b");
  assert.equal(new Set([a, b, c, d, e].map(instrumentSearchGroupKey)).size, 5);
  const index = buildInstrumentSearchIndex([a, b, c, d, e]);
  const result = searchInstrumentIndexLocal(index, "SHARED", { limit: 20 });
  assert.equal(result.length, 5);
  assert.equal(result.every(group => group.relatedListings.length === 0), true);
});

test("persisted entity listings remain grouped by verified entity id", () => {
  const a = { ...candidate("NMS", "USD", "verified"), entityId: "lios:entity:confirmed", canonical: true };
  const b = { ...candidate("NYQ", "USD", "verified"), entityId: "lios:entity:confirmed", canonical: true };
  const grouped = searchInstrumentIndexLocal(buildInstrumentSearchIndex([a, b]), "SHARED");
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].relatedListings.length, 1);
});
