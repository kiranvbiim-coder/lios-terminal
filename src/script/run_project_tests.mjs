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
  // Keep worker groups bounded even when all paths fit Windows' CLI limit.
  // A test that retains a native/PGlite handle must not immobilize 300+ other
  // files or hide which group failed for an entire hosted CI window.
  const maxFilesPerBatch = 75;
  // Windows CreateProcess has a 32,767-character command-line limit. Leave room
  // for Node/loader paths and quoting, even when a checkout path contains spaces.
  const batches = [];
  let batch = [];
  let characters = 0;
  for (const filename of files) {
    const cost = filename.length * 2 + 3;
    if (cost > 24_000) throw new Error("A test path exceeds the portable argument limit.");
    if (batch.length && (characters + cost > 24_000 || batch.length >= maxFilesPerBatch)) {
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

// High-load batch neighbours distort a wall-clock p95 benchmark. Keep the
// original benchmark and strict <50 ms routing budget, but run this exact
// test in its own child process rather than alongside PGlite/native suites.
export const TIMING_SENSITIVE_TESTS = new Set(["server/goldenRouting.test.ts"]);

export function splitTimingSensitiveTests(files) {
  const isolated = [];
  const parallel = [];
  for (const filename of files) {
    (TIMING_SENSITIVE_TESTS.has(filename) ? isolated : parallel).push(filename);
  }
  return { isolated, parallel };
}

export function runProjectTests(selected = []) {
  const files = discoverTests(selected);
  const { isolated, parallel } = splitTimingSensitiveTests(files);
  // A singleton is a *real* test batch with the same fail-closed checks;
  // execution order changes, discovery/coverage/count never does.
  const batches = [...isolated.map(filename => [filename]), ...partitionTestFiles(parallel)];
  const batchTimeoutMs = 8 * 60_000;
  console.log(`Running ${files.length} project-owned test files in ${batches.length} bounded batch(es); file concurrency 2; per-file deadline 5 minutes; per-batch deadline 8 minutes.`);
  console.log(`Isolated timing-sensitive files: ${isolated.length}; none skipped; benchmark budgets unchanged.`);
  console.log("Scope: source regression only. Entitled real-data benchmarks and packaged SP/P14 qualification: NOT_RUN.");
  // Run every batch even after one fails, so a single hosted run reports all failures instead of one per ~20-minute run.
  // The exit code is still non-zero if any batch failed or was terminated; nothing is masked.
  let exitCode = 0;
  for (const [index, batch] of batches.entries()) {
    console.log(`Starting test batch ${index + 1}/${batches.length}: ${batch.length} files; ${batch[0]} through ${batch.at(-1)}.`);
    // Fail a stuck file with its filename rather than losing every diagnostic
    // when the hosted workflow eventually kills the entire 30-minute step.
    const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=2", "--test-timeout=300000", ...batch], {
      cwd: root, stdio: "inherit", env: process.env, timeout: batchTimeoutMs, killSignal: "SIGKILL",
    });
    // Timeout is a failure, not a pass. Diagnose the *specific* bounded set of
    // files and retain every test so the root handle leak can be repaired.
    if (result.error?.code === "ETIMEDOUT") {
      console.error(`Test batch ${index + 1} exceeded 8 minutes. Inspect these ${batch.length} files:`);
      console.error(batch.join("\n"));
      exitCode ||= 1;
      continue;
    }
    if (result.error) throw result.error;
    if (result.signal) {
      console.error(`Test batch ${index + 1} terminated by ${result.signal}. Files: ${batch.join(", ")}.`);
      exitCode ||= 1;
    } else if (result.status !== 0) {
      console.error(`Test batch ${index + 1} failed. Files: ${batch.join(", ")}.`);
      exitCode ||= result.status ?? 1;
    } else {
      console.log(`Test batch ${index + 1}/${batches.length} completed successfully.`);
    }
  }
  return exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runProjectTests(process.argv.slice(2));
}
