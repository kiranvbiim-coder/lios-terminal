import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeParquetRecords } from "./columnarArtifactStore";
import {
  readP11DataPlaneSnapshot,
  removeP11DataPlaneSnapshot,
  writeP11DataPlaneSnapshot,
} from "./p11DataPlane";

test("P11 data plane accepts, stores and rereads a real DuckDB Parquet file", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p11-data-"));
  const parquetPath = path.join(root, "fixture.parquet");
  try {
    await writeParquetRecords([{ value: 2 }, { value: 7 }], parquetPath);
    const bytes = fs.readFileSync(parquetPath);
    const ref = await writeP11DataPlaneSnapshot({ rootDir: root, format: "parquet", bytes, rows: 2, maxBytes: 1024 * 1024 });
    assert.equal(ref.format, "parquet");
    assert.equal(ref.rows, 2);
    assert.deepEqual(await readP11DataPlaneSnapshot(ref, root), bytes);
    removeP11DataPlaneSnapshot(ref, root);
    assert.equal(fs.existsSync(ref.path), false);

    await assert.rejects(() => writeP11DataPlaneSnapshot({
      rootDir: root,
      format: "parquet",
      bytes: Buffer.from("columnar-proof"),
      rows: 4,
      maxBytes: 1024,
    }), /PAR1|DuckDB/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("P11 data plane defers Arrow IPC until it is reintroduced through an isolated runtime pack", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p11-arrow-"));
  try {
    await assert.rejects(() => writeP11DataPlaneSnapshot({
      rootDir: root,
      format: "arrow-ipc",
      bytes: Buffer.from("irrelevant-until-reintroduced"),
      rows: 2,
      maxBytes: 1024 * 1024,
    }), /P5 runtime-pack candidate/i);
    assert.equal(fs.readdirSync(root).length, 0, "a deferred format must not leave a partial snapshot on disk");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("P11 data plane blocks giant JSON and scoped-directory escapes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p11-data-"));
  try {
    await assert.rejects(() => writeP11DataPlaneSnapshot({
      rootDir: root,
      format: "json",
      bytes: Buffer.alloc(1024 * 1024 + 1),
      maxBytes: 2 * 1024 * 1024,
    }), /Arrow\/Parquet/i);

    await assert.rejects(() => readP11DataPlaneSnapshot({
      schemaVersion: "1",
      id: "00000000-0000-4000-8000-000000000999",
      format: "parquet",
      path: path.join(root, "..", "outside.parquet"),
      sha256: "a".repeat(64),
      bytes: 1,
      rows: null,
      immutable: true,
    }, root), /escapes/i);

    const unrelated = path.join(root, "unrelated.json");
    fs.writeFileSync(unrelated, "{\"private\":true}");
    const forgedRef = {
      schemaVersion: "1" as const,
      id: "00000000-0000-4000-8000-000000000998",
      format: "json" as const,
      path: unrelated,
      sha256: "a".repeat(64),
      bytes: 15,
      rows: null,
      immutable: true as const,
    };
    await assert.rejects(() => readP11DataPlaneSnapshot(forgedRef, root), /id and format path/i);
    assert.throws(() => removeP11DataPlaneSnapshot(forgedRef, root), /id and format path/i);
    assert.equal(fs.existsSync(unrelated), true, "forged data-plane refs must not remove an unrelated scoped file");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
