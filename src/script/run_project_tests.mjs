// Reused from the continuation's project-owned discovery runner; do not rely on shell glob expansion.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const groups = { server: "server", shared: "shared", client: "client/src", desktop: ".", script: "script" };

export function discoverTests(selected = [], directory = root) {
  const names = selected.length ? [...new Set(selected)] : Object.keys(groups);
  if (names.some(name => !Object.hasOwn(groups, name))) {
    throw new Error(`Choose test groups: ${Object.keys(groups).join(", ")}.`);
  }
  const files = [];
  function collect(current, recursive = true) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (recursive && entry.name !== "node_modules" && !entry.name.startsWith(".")) collect(filename);
      } else if (entry.isFile() && /\.test\.(?:ts|tsx|js|cjs|mjs)$/.test(entry.name)) {
        files.push(path.relative(directory, filename).split(path.sep).join("/"));
      }
    }
  }
  for (const name of names) {
    const before = files.length;
    collect(path.join(directory, groups[name]), name !== "desktop");
    if (files.length === before) throw new Error(`No project tests discovered for ${name}; refusing an empty passing gate.`);
  }
  return files.sort();
}

export function partitionTestFiles(files) {
  // Windows CreateProcess has a 32,767-character command-line limit. Leave room
  // for Node/loader paths and quoting, even when a checkout path contains spaces.
  const batches = [];
  let batch = [];
  let characters = 0;
  for (const filename of files) {
    const cost = filename.length * 2 + 3;
    if (cost > 24_000) throw new Error("A test path exceeds the portable argument limit.");
    if (batch.length && characters + cost > 24_000) {
      batches.push(batch);
      batch = [];
      characters = 0;
    }
    batch.push(filename);
    characters += cost;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export function runProjectTests(selected = []) {
  const files = discoverTests(selected);
  const batches = partitionTestFiles(files);
  console.log(`Running ${files.length} project-owned test files in ${batches.length} batch(es); file concurrency 2.`);
  console.log("Scope: source regression only. Entitled real-data benchmarks and packaged SP/P14 qualification: NOT_RUN.");
  for (const batch of batches) {
    const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=2", ...batch], {
      cwd: root, stdio: "inherit", env: process.env,
    });
    if (result.error) throw result.error;
    if (result.signal) {
      console.error(`Project tests terminated by ${result.signal}.`);
      return 1;
    }
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runProjectTests(process.argv.slice(2));
}
