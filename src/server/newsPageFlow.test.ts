import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildNewsWindowQuery, filterNewsPageWindow, newsPageWindowBounds } from "./marketData";
import type { NewsItem } from "./marketData";
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
  assert.equal(buildNewsWindowQuery("AAPL", 1, bounds), "AAPL after:2026-09-30 before:2026-10-28");
  assert.equal(buildNewsWindowQuery("AAPL", 2, bounds), "AAPL after:2026-09-30 before:2026-10-28");
  assert.match(backend, /options\.from \? "bounded" : String\(page\)/);
  assert.match(backend, /const offset = explicitFrom \? \(page - 1\) \* limit : 0/);
  assert.match(backend, /items\.slice\(offset, offset \+ limit\)/);
});

test("paged page 1 rewrites provider when windows, while legacy getNews keeps original queries", () => {
  assert.match(backend, /options\.page === undefined && !options\.from && !options\.to/);
  assert.doesNotMatch(backend, /if \(page <= 1 && !options\.from && !options\.to\) return url/);
  assert.equal(buildNewsWindowQuery("Nifty when:1d", 1, { to: "2026-10-27", windowDays: 7 }),
    "Nifty after:2026-10-20 before:2026-10-28");
  assert.equal(buildNewsWindowQuery("Nifty when:30d", 2, { to: "2026-10-27", windowDays: 7 }),
    "Nifty after:2026-10-13 before:2026-10-21");
});

test("inclusive fixed dates and rolling windows filter providers returning the wrong date", () => {
  const dates = [
    "2026-09-30T20:00:00Z", "2026-10-01T00:00:00Z",
    "2026-10-20T23:00:00Z", "2026-10-21T00:00:00Z",
    "2026-10-27T23:59:59Z", "2026-10-28T00:00:00Z",
    "invalid",
  ];
  const items = dates.map((publishedAt, index) =>
    ({ url: "https://publisher.example/news/" + index, publishedAt } as NewsItem));
  const toIndices = (records: NewsItem[]) =>
    records.map(item => Number(item.url.split("/").at(-1)));
  assert.deepEqual(newsPageWindowBounds(1, { to: "2026-10-27", windowDays: 7 }),
    { from: "2026-10-21", to: "2026-10-27" });
  assert.deepEqual(toIndices(filterNewsPageWindow(items, 1,
    { to: "2026-10-27", windowDays: 7 })), [3, 4]);
  assert.deepEqual(toIndices(filterNewsPageWindow(items, 2,
    { to: "2026-10-27", windowDays: 7 })), [2]);
  assert.deepEqual(toIndices(filterNewsPageWindow(items, 1,
    { from: "2026-10-01", to: "2026-10-27" })), [1, 2, 3, 4]);
});

test("ticker-specific filtering cannot reintroduce out-of-window RSS articles", () => {
  assert.match(backend, /let items = filterNewsPageWindow\(feedItems, page, options\)/);
  assert.match(backend, /items = items\.filter\(\(item\) =>/);
  assert.doesNotMatch(backend, /items = feedItems\.filter\(\(item\) =>/);
});

test("paged RSS queries and server-side UTC validation share one request anchor", () => {
  assert.match(backend, /const effectiveOptions = \{ \.\.\.options, page, to: options\.to \?\?/);
  assert.match(backend, /fetchNewsFeeds\([^\n]+, effectiveOptions\)/);
  assert.match(backend, /filterNewsPageWindow\(feedItems, page, effectiveOptions\)/);
  assert.deepEqual(newsPageWindowBounds(2, { windowDays: 7 },
    new Date("2026-10-27T23:59:59.000Z")), { from: "2026-10-14", to: "2026-10-20" });
});

test("total upstream RSS failure is not represented as empty but successful News", () => {
  assert.match(backend, /options\.page !== undefined && settled\.length > 0 && settled\.every\(result => result\.status === "rejected"\)/);
  assert.match(panel, /News could not be fetched/);
  assert.match(panel, /Retry news/);
});

test("bounded older-period paging is not terminated merely because an RSS window is sparse", () => {
  assert.match(backend, /const hasMore = explicitFrom \? items\.length > offset \+ limit : page < 52/);
  assert.match(backend, /coverage: explicitFrom && !hasMore \? "window-exhausted"/);
});
