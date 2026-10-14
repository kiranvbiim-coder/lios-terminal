import assert from "node:assert/strict";
import test from "node:test";
import { chooseColumnarExecutionPath } from "./columnarInterchangePolicy";

test("P5 columnar policy keeps DuckDB/Parquet as Core when optional packs are absent", () => {
  const result = chooseColumnarExecutionPath(
    { rowCount: 5_000_000, columnCount: 40, estimatedBytes: 700_000_000, requiresZeroCopyInterop: true, transformComplexity: "heavy" },
    { arrow: false, polars: false },
  );
  assert.equal(result.path, "duckdb_parquet");
  assert.equal(result.optionalPackRequired, false);
});

test("P5 columnar policy selects Arrow only for measured zero-copy workloads", () => {
  const result = chooseColumnarExecutionPath(
    { rowCount: 2_000_000, columnCount: 30, estimatedBytes: 100_000_000, requiresZeroCopyInterop: true, transformComplexity: "moderate" },
    { arrow: true, polars: false },
  );
  assert.equal(result.path, "arrow_optional");
});

test("P5 columnar policy selects Polars only for measured heavy high-volume transforms", () => {
  const result = chooseColumnarExecutionPath(
    { rowCount: 1_500_000, columnCount: 100, estimatedBytes: 500_000_000, transformComplexity: "heavy" },
    { arrow: false, polars: true },
  );
  assert.equal(result.path, "polars_optional");
});
