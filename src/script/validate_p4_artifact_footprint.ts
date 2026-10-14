import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const benchmark = JSON.parse(fs.readFileSync(path.join(root, "..", "third_party", "artifact-renderer-benchmark.json"), "utf8"));
const pane = fs.readFileSync(path.join(root, "client/src/components/terminal/ArtifactPane.tsx"), "utf8");

for (const name of ["@duckdb/node-api", "lightweight-charts", "recharts", "xlsx"]) {
  assert.ok(pkg.dependencies?.[name], `P4 expected existing production engine ${name} is missing.`);
}
assert.equal(benchmark.baseDesktop.heavyRendererPackagesInStartupBundle, 0);
// Univer is the one measured heavy renderer: exact-pinned, and reachable only through a dynamic import so it never enters the startup chunk.
for (const name of ["@univerjs/presets", "@univerjs/preset-sheets-core"]) {
  assert.match(pkg.dependencies?.[name] ?? "", /^\d+\.\d+\.\d+(-[\w.]+)?$/, `${name} must be exactly pinned.`);
}
const univerBenchmark = benchmark.lazyRenderers?.find((entry: { id: string }) => entry.id === "univer");
assert.ok(univerBenchmark && univerBenchmark.chunkGzipBytes > 0 && univerBenchmark.startupChunkReferences === 0, "Univer requires a recorded lazy-chunk measurement.");
assert.ok(/lazy\(\s*\(\)\s*=>\s*import\(["']\.\/UniverSpreadsheetEditor["']\)\s*\)/.test(pane), "ArtifactPane must load the Univer editor with a dynamic import.");
const clientRoot = path.join(root, "client/src");
const staticUniverImporters: string[] = [];
for (const entry of fs.readdirSync(clientRoot, { recursive: true, encoding: "utf8" })) {
  if (!/\.(ts|tsx)$/.test(entry) || entry.endsWith("UniverSpreadsheetEditor.tsx")) continue;
  if (/^import (?!type\b)[^;]*["']@univerjs\//m.test(fs.readFileSync(path.join(clientRoot, entry), "utf8"))) staticUniverImporters.push(entry);
}
assert.deepEqual(staticUniverImporters, [], "Only the lazily loaded editor may import Univer at runtime.");
assert.equal(benchmark.ciMicrobenchmarks.spreadsheetCells, 10_000);

console.log("P4 Artifact packaged-desktop footprint contract: PASS");
