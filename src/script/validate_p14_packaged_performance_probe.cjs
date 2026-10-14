"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  P14_PACKAGED_PERFORMANCE_SAFETY_CEILINGS,
  evaluateP14PackagedPerformance,
} = require("../p14PerformanceBudget.cjs");

function fail(message) {
  process.stderr.write("P14 packaged performance probe: " + message + "\n");
  process.exit(1);
}

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) fail("usage: node script/validate_p14_packaged_performance_probe.cjs <desktop-self-test-report.json> <performance-probe.json>");

const resolvedInput = path.resolve(inputPath);
if (!fs.existsSync(resolvedInput)) fail("desktop self-test report does not exist: " + resolvedInput);

let report;
try {
  report = JSON.parse(fs.readFileSync(resolvedInput, "utf8"));
} catch (error) {
  fail("desktop self-test report is not valid JSON: " + (error?.message || String(error)));
}

if (report.status !== "verified") fail("desktop self-test report is not verified.");
const evaluation = evaluateP14PackagedPerformance(report.performance);
if (!evaluation.ok) fail(evaluation.errors.join(" "));

const output = {
  schemaVersion: "1",
  kind: "p14-packaged-performance-probe",
  status: "passed",
  generatedAt: new Date().toISOString(),
  platform: String(report.platform || process.platform),
  arch: String(report.arch || process.arch),
  measurements: report.performance,
  safetyCeilings: P14_PACKAGED_PERFORMANCE_SAFETY_CEILINGS,
  scope: [
    "Electron main-process readiness to app.whenReady",
    "packaged native desktop self-test duration",
    "main-process RSS at self-test completion",
    "main-process heap used at self-test completion",
  ],
  exclusions: [
    "interactive renderer ready-to-show latency",
    "interactive search/stream latency",
    "interactive Artifact rendering latency",
    "large-data end-user workflow latency",
  ],
};

const resolvedOutput = path.resolve(outputPath);
fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
fs.writeFileSync(resolvedOutput, JSON.stringify(output, null, 2) + "\n", "utf8");
process.stdout.write("P14 packaged performance probe: PASS · " + resolvedOutput + "\n");
