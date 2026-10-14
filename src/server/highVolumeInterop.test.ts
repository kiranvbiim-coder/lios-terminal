import assert from "node:assert/strict";
import test from "node:test";
import { chooseHighVolumeInterop } from "./highVolumeInterop";

test("P5 measured high-volume policy selects existing DuckDB/Parquet before adding heavy runtimes", () => {
  const normal = chooseHighVolumeInterop({ rowCount: 10_000, estimatedBytes: 5_000_000 });
  assert.equal(normal.primary, "inline_json");
  assert.equal(normal.arrowIpc, "not_required");
  const large = chooseHighVolumeInterop({ rowCount: 1_000_000, estimatedBytes: 120_000_000 });
  assert.equal(large.primary, "duckdb_parquet");
  assert.equal(large.polars, "not_required");
  const transfer = chooseHighVolumeInterop({ rowCount: 1_000_000, estimatedBytes: 120_000_000, repeatedCrossProcessTransfer: true, dataframeTransforms: true });
  assert.equal(transfer.arrowIpc, "runtime_pack_candidate");
  assert.equal(transfer.polars, "runtime_pack_candidate");
});
