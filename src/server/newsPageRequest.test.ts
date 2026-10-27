import test from "node:test";
import assert from "node:assert/strict";
import { InvalidNewsRequest, parseNewsPageRequest } from "./newsPageRequest";

test("legacy news callers retain array response shape without paging parameters", () => {
  assert.deepEqual(parseNewsPageRequest({}), {
    paged: false, options: { page: 1, limit: 20, windowDays: 7 },
  });
  const legacy = parseNewsPageRequest({ symbol: "brk-b", query: " earnings " });
  assert.equal(legacy.paged, false);
  assert.equal(legacy.symbol, "BRK-B");
  assert.equal(legacy.query, "earnings");
});

test("news feed window parameters are normalized into bounded provider options", () => {
  assert.deepEqual(parseNewsPageRequest({
    symbol: "aapl", query: " technology ", page: "2", limit: "20",
    from: "2026-10-01", to: "2026-10-27", windowDays: "7",
  }), {
    symbol: "AAPL", query: "technology", paged: true,
    options: { page: 2, limit: 20, windowDays: 7, from: "2026-10-01", to: "2026-10-27" },
  });
  assert.equal(parseNewsPageRequest({ from: "2026-10-01" }).paged, true);
  assert.equal(parseNewsPageRequest({ page: "1" }).paged, true);
});

test("invalid or resource-abusive inputs fail closed before any RSS fetch", () => {
  for (const query of [
    { page: "0" }, { page: "-1" }, { page: "9999" }, { page: "1.5" }, { page: ["1", "2"] },
    { limit: "101" }, { windowDays: "500" }, { symbol: "AAPL;DROP" },
    { query: "a".repeat(161) }, { from: "2026-02-30" }, { to: "2026-13-03" },
    { from: "2026-10-28", to: "2026-10-27" }, { from: ["2026-10-01"] },
    { symbol: { nested: "AAPL" } },
  ]) {
    assert.throws(() => parseNewsPageRequest(query), InvalidNewsRequest, JSON.stringify(query));
  }
});

test("date only must be a valid calendar date, including leap years", () => {
  assert.equal(parseNewsPageRequest({ from: "2024-02-29" }).options.from, "2024-02-29");
  assert.throws(() => parseNewsPageRequest({ from: "2025-02-29" }), InvalidNewsRequest);
});
