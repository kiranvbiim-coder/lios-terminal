import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DuckDBInstance } from "@duckdb/node-api";
import { canAccessDatasetSnapshot, flattenSnapshotForColumnar, writeParquetRecords } from "./columnarArtifactStore";

test("market snapshots flatten into one scalar row per observation", () => {
  const result = flattenSnapshotForColumnar({ id: "snapshot", dataClass: "market_series", entityKey: "TEST", payload: {
    symbol: "TEST", interval: "1d", assetClass: "equity", baseCurrency: null, quoteCurrency: null, currency: "USD", calendar: "XNYS", timezone: "America/New_York", priceBasis: "raw", returnMethodology: "price only",
    bars: [{ date: "2026-08-21", open: 10, high: 12, low: 9, close: 11, volume: 100, priceReturn: null, logReturn: null, totalReturn: null }], corporateActions: [],
  } });
  assert.equal(result.records.length, 1); assert.equal(result.records[0].close, 11); assert.ok(result.numericColumns.includes("log_return"));
});

test("DuckDB writes and reads a real compressed Parquet projection", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "limuria-parquet-")); const output = path.join(dir, "fixture.parquet");
  try {
    const written = await writeParquetRecords([{ date: "2026-08-20", value: 1 }, { date: "2026-08-21", value: 2 }], output);
    assert.equal(written.rowCount, 2); assert.ok(fs.statSync(output).size > 0);
    const instance = await DuckDBInstance.create(":memory:"); const connection = await instance.connect();
    try { const rows = await (await connection.run(`SELECT count(*) count, sum(value) total FROM read_parquet('${output}')`)).getRowObjects(); assert.deepEqual(rows, [{ count: 2n, total: 3n }]); }
    finally { connection.closeSync(); }
    assert.match(crypto.createHash("sha256").update(fs.readFileSync(output)).digest("hex"), /^[a-f0-9]{64}$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


test("columnar snapshot access is tenant-bound and global snapshots remain readable", () => {
  const clientA = { userId: 10, organizationId: 100, role: "client_user" } as const;
  const clientB = { userId: 20, organizationId: 200, role: "client_user" } as const;

  assert.equal(canAccessDatasetSnapshot({ organizationId: 100, createdByUserId: 10 }, clientA), true);
  assert.equal(canAccessDatasetSnapshot({ organizationId: 100, createdByUserId: 10 }, clientB), false);
  assert.equal(canAccessDatasetSnapshot({ organizationId: null, createdByUserId: 10 }, clientA), true);
  assert.equal(canAccessDatasetSnapshot({ organizationId: null, createdByUserId: 10 }, clientB), false);
  assert.equal(canAccessDatasetSnapshot({ organizationId: null, createdByUserId: null }, clientA), true);
  assert.equal(canAccessDatasetSnapshot({ organizationId: 100, createdByUserId: 10 }, 10), true);
  assert.equal(canAccessDatasetSnapshot({ organizationId: 100, createdByUserId: 10 }, 20), false);
});
