import fs from "node:fs";
import path from "node:path";

export const SOURCE_QUALIFICATION = {
  binaryRelease: "NOT_RUN",
  signedInstallers: "NOT_RUN",
  packagedShippingPoints: "NOT_RUN",
  nativeHardware: "NOT_RUN",
  realDatasetBenchmark: "NOT_RUN",
} as const;

/** Validate deliberate absence, never reinterpret a withheld release gate as passed. */
export function validateSourceDistribution(repoRoot: string): string[] {
  const errors: string[] = [];
  const require = (condition: unknown, message: string) => { if (!condition) errors.push(message); };
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "third_party/source-distribution.json"), "utf8"));
  const workflowPath = ".github/workflows/source-cross-platform.yml";
  require(manifest.schemaVersion === "1", "Source distribution schemaVersion must be 1.");
  require(manifest.distribution === "sanitized_proprietary_source_only", "Distribution must remain sanitized proprietary source only.");
  require(manifest.sourceWorkflow === workflowPath, "Source distribution must identify the hosted source workflow.");
  require(JSON.stringify(manifest.sourcePlatforms) === JSON.stringify(["ubuntu-24.04", "macos-15", "windows-2022"]), "All three standard hosted source platforms must remain required.");
  require(JSON.stringify(manifest.qualification) === JSON.stringify(SOURCE_QUALIFICATION), "Binary, signed, SP, native and real-data qualification must remain NOT_RUN.");
  for (const [key, prefix] of [["withheldWorkflows", ".github/workflows/"], ["withheldDatasets", "src/server/data/"]] as const) {
    const entries = manifest[key];
    require(Array.isArray(entries) && entries.length > 0, `${key} must explicitly inventory withheld files.`);
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry !== "string" || !entry.startsWith(prefix) || entry.includes("..") || path.isAbsolute(entry)) {
        errors.push(`Invalid withheld path in ${key}: ${String(entry)}.`);
        continue;
      }
      require(!fs.existsSync(path.join(repoRoot, entry)), `Withheld file must be absent from source distribution: ${entry}.`);
    }
  }
  for (const name of ["production-release-readiness.yml", "windows-release.yml", "desktop-website-release.yml", "p14-release-certification.yml", "lios-hardening.yml", "p11-cross-platform.yml"]) {
    require(manifest.withheldWorkflows?.includes(`.github/workflows/${name}`), `Missing withheld execution contract: ${name}.`);
  }
  for (const name of ["tickers.json", "provider_ingested_universe.json", "crypto_coingecko_ids.json", "shillerCape.json"]) {
    require(manifest.withheldDatasets?.includes(`src/server/data/${name}`), `Missing withheld dataset contract: ${name}.`);
  }
  const workflows = fs.readdirSync(path.join(repoRoot, ".github/workflows")).filter(name => /\.ya?ml$/.test(name)).sort();
  require(JSON.stringify(workflows) === JSON.stringify(["source-cross-platform.yml"]), "Only the hosted source workflow may be runnable in this distribution.");
  const workflow = fs.readFileSync(path.join(repoRoot, workflowPath), "utf8");
  require(!/self-hosted|secrets\.|pull_request_target|workflow_run|upload-artifact|continue-on-error|app:dist|acceptance:sp\d|acceptance:p14/.test(workflow), "Hosted source workflow must not expose privileged, release or masked-failure execution.");
  for (const platform of ["ubuntu-24.04", "macos-15", "windows-2022"]) require(workflow.includes(platform), `Hosted source matrix is missing ${platform}.`);
  for (const command of ["npm run check", "npm run test:offline", "npm run test:desktop", "python -m unittest discover", "npm run build"]) require(workflow.includes(command), `Hosted source workflow is missing ${command}.`);
  const benchmark = manifest.realDatasetBenchmark;
  require(benchmark?.file === "src/server/instrumentSearchIndexBenchmark.bench.ts" && fs.existsSync(path.join(repoRoot, benchmark.file)), "Explicit real-data benchmark must exist outside source test discovery.");
  require(benchmark?.minimumRealCandidates === 80000 && benchmark?.syntheticSubstitutionPermitted === false && benchmark?.dataRedistributionGranted === false && benchmark?.missingPrerequisites === "FAIL_WITH_NOT_RUN", "Real-data benchmark must retain scale, entitlement and failing prerequisite boundaries.");
  return errors;
}

/** Private qualification callers fail with an explicit prerequisite, not a fake gate. */
export function readQualificationWorkflow(repoRoot: string, basename: string): string {
  const relative = `.github/workflows/${basename}`;
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "third_party/source-distribution.json"), "utf8"));
  if (manifest.withheldWorkflows?.includes(relative)) {
    throw new Error(`NOT_RUN: ${relative} is intentionally withheld from this source-only distribution; private native/SP/P14 release qualification is required.`);
  }
  return fs.readFileSync(path.join(repoRoot, relative), "utf8");
}
