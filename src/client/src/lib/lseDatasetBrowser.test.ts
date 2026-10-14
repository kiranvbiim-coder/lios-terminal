import assert from "node:assert/strict";
import test from "node:test";
import { datasetSearchPath, datasetSeriesPath, filterCatalogRows, formatSnapshotMessage, observationsCsv, optionRows, pageRows } from "./lseDatasetBrowser";

test("dataset paths preserve page mode and safe filters", () => {
  assert.equal(datasetSearchPath("bonds", { query: "US 10Y", country: "US", category: "rates", page: 2, limit: 50 }), "/api/lse/bonds/search?mode=page&q=US+10Y&country=US&category=rates&page=2&limit=50");
  assert.equal(datasetSeriesPath("economics", "CPI/US", { start: "2020-01-01", end: "2024-01-01", limit: 100 }), "/api/lse/economics/series/CPI%2FUS?mode=page&start=2020-01-01&end=2024-01-01&limit=100");
});

test("catalog filtering and pagination are deterministic", () => {
  const rows = [
    { dataset: "economics", symbol: "US.CPI", name: "Consumer prices", ticks: 3, country: "US", category: "prices" },
    { dataset: "economics", symbol: "GB.GDP", name: "GDP", ticks: 3, country: "GB", category: "activity" },
  ];
  assert.deepEqual(filterCatalogRows(rows, { query: "consumer", country: "US" }).map((row) => row.symbol), ["US.CPI"]);
  assert.deepEqual(pageRows([1, 2, 3, 4, 5], 2, 2), { rows: [3, 4], page: 2, limit: 2, hasMore: true });
  assert.deepEqual(pageRows([1, 2], 5, 2).rows, []);
});

test("option metadata and snapshot wording never confuse visible and saved rows", () => {
  const page = optionRows({ rows: [{ ticker: "A", expiry: "2026-09-01" }], page: 1, limit: 1, hasMore: true, total: 10, availableExpiries: ["2026-09-01", "2026-10-01"] });
  assert.equal(page.total, 10);
  assert.deepEqual(page.availableExpiries, ["2026-09-01", "2026-10-01"]);
  assert.match(formatSnapshotMessage({ created: true, snapshot: { id: "abcdef123" } }, 1), /visible page: 1/);
  assert.match(formatSnapshotMessage({ created: true, snapshot: { id: "abcdef123" }, savedCount: 10 }, 1), /10 contracts/);
});

test("loaded observation export is valid CSV", () => {
  assert.equal(observationsCsv([{ symbol: "US.CPI", date: "2024-01-01", value: 3.2 }]), 'symbol,date,value\n"US.CPI","2024-01-01","3.2"');
});
