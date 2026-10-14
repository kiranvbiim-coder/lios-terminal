import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { prepareVisualSmokeOutput } = require("../../../script/prepare_visual_smoke_output.cjs") as {
  prepareVisualSmokeOutput: (environmentVariable: string, defaultDirectory: string) => string;
};
const temporaryRoots: string[] = [];

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-visual-smoke-output-"));
  temporaryRoots.push(root);
  return root;
}

function withOutputPath<T>(environmentVariable: string, outputPath: string, run: () => T): T {
  const previousValue = process.env[environmentVariable];
  process.env[environmentVariable] = outputPath;
  try {
    return run();
  } finally {
    if (previousValue === undefined) delete process.env[environmentVariable];
    else process.env[environmentVariable] = previousValue;
  }
}

after(() => {
  for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
});

test("visual-smoke output creates only a fresh capture directory", () => {
  const root = createRoot();
  const outputPath = path.join(root, "fresh-captures");
  const result = withOutputPath("LIOS_TEST_VISUAL_SMOKE_OUTPUT", outputPath, () =>
    prepareVisualSmokeOutput("LIOS_TEST_VISUAL_SMOKE_OUTPUT", "fallback-captures"),
  );

  assert.equal(result, outputPath);
  assert.equal(fs.statSync(outputPath).isDirectory(), true);
});

test("visual-smoke output creates missing parent folders for an explicit fresh path", () => {
  const root = createRoot();
  const outputPath = path.join(root, "nested", "fresh-captures");
  const result = withOutputPath("LIOS_TEST_VISUAL_SMOKE_OUTPUT", outputPath, () =>
    prepareVisualSmokeOutput("LIOS_TEST_VISUAL_SMOKE_OUTPUT", "fallback-captures"),
  );

  assert.equal(result, outputPath);
  assert.equal(fs.statSync(outputPath).isDirectory(), true);
});

test("visual-smoke output preserves existing evidence directories", () => {
  const root = createRoot();
  const outputPath = path.join(root, "existing-captures");
  fs.mkdirSync(outputPath);
  fs.writeFileSync(path.join(outputPath, "manifest.json"), "preserve-me");

  assert.throws(
    () => withOutputPath("LIOS_TEST_VISUAL_SMOKE_OUTPUT", outputPath, () =>
      prepareVisualSmokeOutput("LIOS_TEST_VISUAL_SMOKE_OUTPUT", "fallback-captures"),
    ),
    /Refusing to overwrite existing visual-smoke output/,
  );
  assert.equal(fs.readFileSync(path.join(outputPath, "manifest.json"), "utf8"), "preserve-me");
});

test("visual-smoke output refuses to replace a file at its target", () => {
  const root = createRoot();
  const outputPath = path.join(root, "existing-file");
  fs.writeFileSync(outputPath, "keep-this-file");

  assert.throws(
    () => withOutputPath("LIOS_TEST_VISUAL_SMOKE_OUTPUT", outputPath, () =>
      prepareVisualSmokeOutput("LIOS_TEST_VISUAL_SMOKE_OUTPUT", "fallback-captures"),
    ),
    /Refusing to overwrite existing visual-smoke output/,
  );
  assert.equal(fs.readFileSync(outputPath, "utf8"), "keep-this-file");
});
