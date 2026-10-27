import test from "node:test";
import assert from "node:assert/strict";
import { buildNewsWindowQuery, filterNewsPageWindow, newsPageWindowBounds } from "./marketData";
import type { NewsItem } from "@shared/finance";
import { parseNewsPageRequest } from "./newsPageRequest";


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
});

test("paged page 1 rewrites provider when windows, while legacy getNews keeps original queries", () => {
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

