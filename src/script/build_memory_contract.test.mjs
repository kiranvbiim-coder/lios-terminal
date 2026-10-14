import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const buildSource = await readFile(new URL("./build.ts", import.meta.url), "utf8");

test("production build relaunches heavy bundling with a bounded 4 GiB V8 heap", () => {
  assert.match(buildSource, /const BUILD_HEAP_MB = 4096;/);
  assert.match(buildSource, /LIOS_BUILD_HEAP_CONFIGURED/);
  assert.match(buildSource, /--max-old-space-size=\$\{BUILD_HEAP_MB\}/);
  assert.match(buildSource, /spawnSync\(\s*process\.execPath,/s);
});

test("bundlers are loaded only after the heap guard is invoked", () => {
  const guardCallIndex = buildSource.indexOf("ensureBuildHeap();");
  const viteImportIndex = buildSource.indexOf('import("vite")');
  const esbuildImportIndex = buildSource.indexOf('import("esbuild")');

  assert.notEqual(guardCallIndex, -1);
  assert.ok(viteImportIndex > guardCallIndex, "vite must load after the heap relaunch guard is invoked");
  assert.ok(esbuildImportIndex > guardCallIndex, "esbuild must load after the heap relaunch guard is invoked");
});
