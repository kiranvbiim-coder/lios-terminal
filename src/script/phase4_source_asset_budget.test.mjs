import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { evaluateSourceAssetBudget } from "./phase4_source_asset_budget.mjs";

test("missing and empty client builds never pass the source performance gate", () => {
  const root = mkdtempSync(join(tmpdir(), "lios-assets-empty-"));
  try {
    assert.equal(evaluateSourceAssetBudget(join(root, "absent")).status, "failed");
    assert.equal(evaluateSourceAssetBudget(root).status, "failed");
    assert.match(evaluateSourceAssetBudget(root).failures.join(" "), /No built JavaScript assets/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("source asset budget counts JS/CSS but not images, fonts or sourcemaps as executable bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "lios-assets-valid-"));
  try {
    writeFileSync(join(root, "main.js"), Buffer.alloc(90));
    writeFileSync(join(root, "theme.css"), Buffer.alloc(20));
    writeFileSync(join(root, "bundle.js.map"), Buffer.alloc(1000));
    writeFileSync(join(root, "image.webp"), Buffer.alloc(1000));
    const result = evaluateSourceAssetBudget(root, { maxSingleJsBytes: 100, maxTotalJsBytes: 200, maxTotalCssBytes: 30 });
    assert.equal(result.status, "passed");
    assert.deepEqual(result.counts, { js: 1, css: 1 });
    assert.deepEqual(result.bytes, { js: 90, css: 20, largestJs: 90 });
    assert.equal(result.scope, "SOURCE_BUNDLE_ONLY_NOT_NATIVE_P14");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("unexpected JS growth fails instead of hiding a bundle regression", () => {
  const root = mkdtempSync(join(tmpdir(), "lios-assets-large-"));
  try {
    writeFileSync(join(root, "one.js"), Buffer.alloc(130));
    writeFileSync(join(root, "two.js"), Buffer.alloc(80));
    writeFileSync(join(root, "styles.css"), Buffer.alloc(40));
    const result = evaluateSourceAssetBudget(root, { maxSingleJsBytes: 120, maxTotalJsBytes: 180, maxTotalCssBytes: 30 });
    assert.equal(result.status, "failed");
    assert.equal(result.failures.length, 3);
    assert.ok(result.failures.some(x => x.includes("one.js")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
