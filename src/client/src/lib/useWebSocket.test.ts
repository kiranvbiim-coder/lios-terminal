import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { applyQuoteUpdate } from "./useWebSocket";

const full = { symbol: "AAPL", price: 1, marketCap: 9, status: { isFallback: false } };

test("single quotes merge onto the cached entry and never seed a missing one", () => {
  const qc = new QueryClient();
  qc.setQueryData(["/api/finance/quote", "AAPL"], full);
  applyQuoteUpdate(qc, [{ symbol: "AAPL", price: 2 }, { symbol: "MSFT", price: 3 }]);
  assert.deepEqual(qc.getQueryData(["/api/finance/quote", "AAPL"]), { ...full, price: 2 });
  assert.equal(qc.getQueryData(["/api/finance/quote", "MSFT"]), undefined);
});

test("multi-quote and mover lists merge by symbol and leave other entries and non-arrays alone", () => {
  const qc = new QueryClient();
  qc.setQueryData(["/api/finance/quotes", "AAPL,MSFT"], [full, { symbol: "MSFT", price: 5 }]);
  qc.setQueryData(["/api/finance", "gainers"], [full]);
  qc.setQueryData(["/api/finance", "losers"], [{ symbol: "ZZZ", price: 1 }]);
  qc.setQueryData(["/api/finance", "active"], { not: "array" });
  applyQuoteUpdate(qc, [{ symbol: "AAPL", price: 2 }]);
  assert.deepEqual(qc.getQueryData(["/api/finance/quotes", "AAPL,MSFT"]), [{ ...full, price: 2 }, { symbol: "MSFT", price: 5 }]);
  assert.deepEqual(qc.getQueryData(["/api/finance", "gainers"]), [{ ...full, price: 2 }]);
  assert.deepEqual(qc.getQueryData(["/api/finance", "losers"]), [{ symbol: "ZZZ", price: 1 }]);
  assert.deepEqual(qc.getQueryData(["/api/finance", "active"]), { not: "array" });
});
