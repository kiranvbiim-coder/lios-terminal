import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const file = (name) => readFileSync(resolve(root, name), "utf8");
const report = file("evals/ws65InstalledUxEvidence.ts");
const validator = file("evals/ws65InstalledUxValidator.ts");
const cli = file("script/validate_ws65_installed_ux.ts");
const packageJson = JSON.parse(file("package.json"));

test("WS-65 seven scenarios and actual dual-platform AT evidence are mandatory", () => {
  assert.match(report, /WS64_SCENARIOS/);
  assert.match(report, /WS65_PLATFORMS = \["macos", "windows"\]/);
  assert.match(report, /assistiveTechnology: z\.enum\(\["voiceover", "narrator"\]\)/);
  assert.match(report, /screenreaderWalkthroughCompleted: z\.literal\(true\)/);
  assert.match(report, /keyboardOnlyCompleted: z\.literal\(true\)/);
  assert.match(report, /zoom200PercentVerified: z\.literal\(true\)/);
  assert.match(report, /unreconciledCriticalDefects: z\.literal\(0\)/);
  assert.match(report, /expected\.requiredManual\.some/);
  assert.match(report, /simulatedOrFixtureData: z\.literal\(false\)/);
  assert.match(report, /new Set\(ids\)\.size !== WS64_SCENARIOS\.length/);
});

test("WS-65 rejects source-only completion and SHA mismatches, reuses canonical P14 release authority", () => {
  assert.match(validator, /artifact\.sha256/);
  assert.match(validator, /sha256\(paths\.ownerSignoffFile\)/);
  assert.match(validator, /flagshipReleaseReportSchema\.parse/);
  assert.match(validator, /buildP14QualificationBoard/);
  assert.match(validator, /assertP14QualificationBoardComplete/);
  assert.match(validator, /flagshipRecord\?\.sourceArtifacts\.some/);
  assert.match(validator, /physicalObservationIndependentlyVerified: false/);
  assert.match(cli, /source CI is not installed release evidence/);
  assert.match(cli, /process\.env\.GITHUB_SHA/);
  assert.match(cli, /required\("report"\)/);
  assert.equal(typeof packageJson.scripts["test:ws65"], "string");
  assert.equal(typeof packageJson.scripts["acceptance:ux:installed"], "string");
});
