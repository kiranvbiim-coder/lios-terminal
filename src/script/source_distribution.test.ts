import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readQualificationWorkflow, validateSourceDistribution } from "./source_distribution";

function fixture(t: { after(fn: () => void): void }) {
  const original = path.resolve(process.cwd(), "..");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios source distribution "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of ["third_party/source-distribution.json", ".github/workflows/source-cross-platform.yml", "src/server/instrumentSearchIndexBenchmark.bench.ts"]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(original, file), path.join(root, file));
  }
  return root;
}

test("source distribution validates withheld contracts without qualifying real release evidence", t => {
  const root = fixture(t);
  assert.deepEqual(validateSourceDistribution(root), []);
  assert.throws(() => readQualificationWorkflow(root, "production-release-readiness.yml"), /NOT_RUN:.*intentionally withheld/);
});

test("private data, runnable private workflows and promoted qualifications fail the source boundary", t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, ".github/workflows/lios-hardening.yml"), "name: forbidden\n");
  fs.mkdirSync(path.join(root, "src/server/data"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/server/data/tickers.json"), "[]");
  const file = path.join(root, "third_party/source-distribution.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  manifest.qualification.binaryRelease = "PASSED";
  fs.writeFileSync(file, JSON.stringify(manifest));
  const errors = validateSourceDistribution(root).join("\n");
  assert.match(errors, /qualification must remain NOT_RUN/);
  assert.match(errors, /Withheld file must be absent.*lios-hardening/);
  assert.match(errors, /Withheld file must be absent.*tickers/);
  assert.match(errors, /Only the hosted source workflow/);
  assert.throws(() => readQualificationWorkflow(root, "lios-hardening.yml"), /NOT_RUN/);
});
