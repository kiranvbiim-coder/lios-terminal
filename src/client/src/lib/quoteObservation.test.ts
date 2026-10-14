import assert from "node:assert/strict";
import test from "node:test";
import { isObservedQuote, observedQuotes } from "./quoteObservation";

test("zero-filled unavailable quotes are not observations", () => {
  assert.equal(isObservedQuote({ price: 0, quoteSource: "Unavailable", status: { provider: "unavailable" } }), false);
  assert.equal(isObservedQuote({ price: 0, quoteSource: "Yahoo" }), false);
  assert.equal(isObservedQuote({ price: 12.5, quoteSource: "Unavailable" }), false);
  assert.equal(isObservedQuote(undefined), false);
  assert.equal(isObservedQuote({ price: Number.NaN }), false);
});

test("served quotes pass through unchanged", () => {
  const served = { symbol: "AAPL", price: 231.4, quoteSource: "Polygon", status: { provider: "polygon" } };
  assert.equal(isObservedQuote(served), true);
  assert.deepEqual(observedQuotes([served, { symbol: "GC=F", price: 0, quoteSource: "Unavailable" }]), [served]);
  assert.deepEqual(observedQuotes(null), []);
});
