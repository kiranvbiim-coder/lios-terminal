import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildNewsWindowQuery } from "./marketData";
import { parseNewsPageRequest } from "./newsPageRequest";

const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const backend = readFileSync(new URL("./marketData.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("../client/src/components/panels/NewsPanel.tsx", import.meta.url), "utf8");

test("exact News HTTP handler preserves legacy array and delegates paged shape to getNewsPage", () => {
  assert.match(routes, /parseNewsPageRequest\(req\.query/);
  assert.match(routes, /requested\.paged\s*\?\s*getNewsPage\(requested\.symbol, requested\.query, requested\.options\)/);
  assert.match(routes, /:\s*getNews\(requested\.symbol, requested\.query\)/);
  assert.match(routes, /res\.status\(400\)\.json/);
  assert.deepEqual(parseNewsPageRequest({ page: "2", from: "2026-10-01" }).options, {
    page: 2, limit: 20, windowDays: 7, from: "2026-10-01",
  });
});

test("first-page Next is available when the provider reports another window", () => {
  assert.match(panel, /disabled=\{!pagedNews\?\.hasMore \|\| page >= 52/);
  assert.doesNotMatch(panel, /disabled=\{page === 1 \|\| !pagedNews\?\.hasMore/);
  assert.match(panel, /Math\.min\(52, value \+ 1\)/);
  assert.match(panel, /params\.set\("page", String\(page\)\)/);
  assert.match(panel, /params\.set\("limit", "20"\)/);
});

test("rolling dated pages move into disjoint earlier provider windows", () => {
  const first = buildNewsWindowQuery("AAPL stock when:7d", 1, { to: "2026-10-27", windowDays: 7 });
  const second = buildNewsWindowQuery("AAPL stock when:7d", 2, { to: "2026-10-27", windowDays: 7 });
  assert.equal(first, "AAPL stock after:2026-10-20 before:2026-10-28");
  assert.equal(second, "AAPL stock after:2026-10-13 before:2026-10-21");
  assert.notEqual(first, second);
});

test("explicit from/to stay fixed through pagination and apply local item offsets", () => {
  const bounds = { from: "2026-10-01", to: "2026-10-27", windowDays: 7 };
  assert.equal(buildNewsWindowQuery("AAPL", 1, bounds), "AAPL after:2026-10-01 before:2026-10-28");
  assert.equal(buildNewsWindowQuery("AAPL", 2, bounds), "AAPL after:2026-10-01 before:2026-10-28");
  assert.match(backend, /options\.from \? "bounded" : String\(page\)/);
  assert.match(backend, /const offset = explicitFrom \? \(page - 1\) \* limit : 0/);
  assert.match(backend, /items\.slice\(offset, offset \+ limit\)/);
});
