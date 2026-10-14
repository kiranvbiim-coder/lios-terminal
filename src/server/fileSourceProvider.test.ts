import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readConfiguredLocalFile } from "./fileSourceProvider";
import type { SourceConnection } from "@shared/schema";

function connection(filePath: string): SourceConnection {
  return {
    id: 1,
    userId: 1,
    organizationId: null,
    connectorId: "file_import",
    name: "Fixture",
    sourceType: "file",
    config: { path: filePath },
    credentialRef: null,
    status: "configured",
    lastTestedAt: null,
    lastHealthyAt: null,
    statusDetail: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

test("P5 local file provider reads bounded JSON without exposing path in result", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p5-file-"));
  try {
    const file = path.join(root, "rows.json");
    fs.writeFileSync(file, JSON.stringify([{ symbol: "ABC", revenue: 10 }, { symbol: "XYZ", revenue: 20 }]));
    const result = await readConfiguredLocalFile(connection(file), { maxRows: 1 });
    assert.equal(result.format, "json");
    assert.equal(result.rowCount, 1);
    assert.equal(result.rows[0].symbol, "ABC");
    assert.match(result.contentHash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(result).includes(root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("P5 local file provider rejects unsupported formats", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p5-file-"));
  try {
    const file = path.join(root, "rows.exe");
    fs.writeFileSync(file, "not data");
    await assert.rejects(readConfiguredLocalFile(connection(file)), /supports JSON/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
