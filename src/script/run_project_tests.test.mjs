import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverTests, partitionTestFiles } from "./run_project_tests.mjs";

test("discovery includes nested project tests once, without dependencies or hidden directories", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios test discovery "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const filename of ["server/root.test.ts", "server/nested/deep.test.tsx", "server/real-data.bench.ts", "server/node_modules/ignored.test.js", "server/.cache/ignored.test.mjs", "desktop.test.cjs", "script/nested.test.mjs"]) {
    fs.mkdirSync(path.dirname(path.join(root, filename)), { recursive: true });
    fs.writeFileSync(path.join(root, filename), "");
  }
  assert.deepEqual(discoverTests(["server", "server"], root), ["server/nested/deep.test.tsx", "server/root.test.ts"]);
  assert.deepEqual(discoverTests(["desktop"], root), ["desktop.test.cjs"]);
  assert.deepEqual(discoverTests(["script"], root), ["script/nested.test.mjs"]);
  assert.throws(() => discoverTests(["unknown"], root), /Choose test groups/);
  fs.mkdirSync(path.join(root, "shared"));
  assert.throws(() => discoverTests(["server", "shared"], root), /No project tests discovered for shared/);
});

test("argument batches preserve every spaced path and stay below Windows command-line limits", () => {
  const files = Array.from({ length: 1000 }, (_, i) => `server/space in directory/${i}-${"x".repeat(80)}.test.ts`);
  const batches = partitionTestFiles(files);
  assert.ok(batches.length > 1);
  assert.deepEqual(batches.flat(), files);
  for (const batch of batches) assert.ok(batch.reduce((size, filename) => size + filename.length * 2 + 3, 0) <= 24_000);
  assert.deepEqual(partitionTestFiles([]), []);
  assert.throws(() => partitionTestFiles(["x".repeat(24_000)]), /portable argument limit/);
});
