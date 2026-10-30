import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readNodeRuntimeDiagnosis } from "./remoteNodeWorker";

// The dependency fixture changes the node's own OS observation, not any request-selected path.
test("an unavailable node home volume remains unknown without a path or Home-host fallback", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-node-disk-unavailable-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.mock.method(os, "homedir", () => path.join(root, "missing-home"));
  const report = readNodeRuntimeDiagnosis();
  assert.equal(report.diskHomeVolume, null);
  assert.equal(JSON.stringify(report).includes(root), false);
});

test("unrepresentable or inconsistent filesystem counters never become claimed disk capacity", t => {
  let counters = { bsize: 1n, blocks: 1n, bavail: 0n };
  t.mock.method(fs, "statfsSync", (() => counters) as unknown as typeof fs.statfsSync);
  for (const invalid of [
    { bsize: 0n, blocks: 100n, bavail: 1n },
    { bsize: 1n, blocks: -1n, bavail: 0n },
    { bsize: 1n, blocks: 100n, bavail: -1n },
    { bsize: 1n, blocks: 100n, bavail: 101n },
    { bsize: 4096n, blocks: BigInt(Number.MAX_SAFE_INTEGER), bavail: 0n },
  ]) {
    counters = invalid;
    assert.equal(readNodeRuntimeDiagnosis().diskHomeVolume, null);
  }
});
