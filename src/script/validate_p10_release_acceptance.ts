import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readQualificationWorkflow } from "./source_distribution";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.resolve(root, file), "utf8");

const roadmap = read("../docs/LIOS_EXECUTION_ROADMAP.md");
const plan = read("../docs/technical/P10_PRODUCTION_HARDENING_RELEASE.md");
const packaged = read("script/validate_p10_packaged_acceptance.ts");
const runtimePacks = read("server/p10RuntimePacks.ts");
const runtimeManager = read("server/pythonRuntimeManager.ts");
const runtimeManagerTest = read("server/pythonRuntimeManager.test.ts");
const environmentSetup = read("server/environmentSetupRoutes.ts");
const observability = read("server/p10Observability.ts");
const observabilityTest = read("server/p10Observability.test.ts");
const openLineage = read("server/p10OpenLineage.ts");
const openLineageTest = read("server/p10OpenLineage.test.ts");
const lineage = read("server/dataLineageService.ts");
const experience = read("client/src/pages/ExperienceCenter.tsx");
const connectionCenter = read("client/src/pages/DataConnectionCenter.tsx");
const audit = read("script/audit_p10_release.ts");
const auditTest = read("script/audit_p10_release.test.ts");
const notices = read("../THIRD_PARTY_NOTICES.md");
const registry = read("../third_party/components.json");
const lock = read("../third_party/upstream-lock.json");
const regression = read("../third_party/imported-oss-regression.json");
const lseInventory = read("../third_party/lse-release-inventory.json");
const lseProvider = read("server/lseDataProvider.ts");
const packageJson = read("package.json");
const qualityGate = readQualificationWorkflow(path.resolve(root, ".."), "lios-hardening.yml");
const releaseWorkflow = readQualificationWorkflow(path.resolve(root, ".."), "production-release-readiness.yml");
const windowsRelease = readQualificationWorkflow(path.resolve(root, ".."), "windows-release.yml");
const routes = read("server/routes.ts");
const p9 = read("server/p9AutomationService.ts");

assert.ok(
  packaged.includes("artifactPerformance") &&
  packaged.includes("calculationPerformance") &&
  packaged.includes("visualManifest") &&
  packaged.includes("ux_png_count") &&
  packaged.includes("analytical_png_count") &&
  packaged.includes("macOS VoiceOver") &&
  packaged.includes("Windows Narrator"),
  "P10-01 packaged performance/accessibility/visual acceptance contract missing.",
);
assert.ok(
  releaseWorkflow.includes("Package signed and notarized macOS customer distribution") &&
  releaseWorkflow.includes("Verify macOS signature, Gatekeeper, and notarization") &&
  releaseWorkflow.includes("Clean-machine macOS install acceptance") &&
  releaseWorkflow.includes("release-checksums.txt") &&
  windowsRelease.includes("Package signed Windows customer installer") &&
  windowsRelease.includes("Verify signed Windows installer") &&
  windowsRelease.includes("Clean-machine Windows install acceptance") &&
  packaged.includes("LIOS_P10_PACKAGED_APP"),
  "P10-02 signed release/update/recovery qualification missing.",
);
assert.ok(
  runtimePacks.includes('P10_RUNTIME_PACK_IDS = ["core", "research", "quant", "modeling", "data-lab", "local-ai"] as const') &&
  audit.includes("validateP10RuntimePackCatalog") &&
  audit.includes("audit:prod") &&
  audit.includes("audit:licenses"),
  "P10-03 dependency/license/runtime-pack release audit missing.",
);
assert.ok(
  experience.includes('data-experience-demo="read-only"') &&
  experience.includes("Read-only guided demo · 5–10 minutes") &&
  experience.includes("No login · no API key · no live data") &&
  experience.includes("Connect your data") &&
  experience.includes("Save the workflow"),
  "P10-04 Experience Center guided first-use demo missing.",
);
assert.ok(
  notices.includes("## P10 release reconciliation — 2026-09-23") &&
  registry.includes('"opentelemetry-js"') &&
  lock.includes('"opentelemetry-js"') &&
  audit.includes("THIRD_PARTY_NOTICES"),
  "P10-05 third-party notices/registry/upstream-lock release gate missing.",
);
for (const pack of ["core", "research", "quant", "modeling", "data-lab", "local-ai"]) {
  assert.ok(runtimePacks.includes('id: "' + pack + '"'), "P10-06 missing runtime pack " + pack + ".");
}
assert.ok(runtimePacks.includes('requested.add("core")') && runtimePacks.includes("does not silently download or bundle a model"), "P10-06 runtime pack default/BYOAI boundary missing.");
assert.ok(
  environmentSetup.includes("releasePacks: P10_RUNTIME_PACKS") &&
  environmentSetup.includes("releasePackIds") &&
  environmentSetup.includes("expandP10RuntimePacks(releasePackIds)") &&
  environmentSetup.includes("installManagedRuntime(managedPackIds, releasePackIds)"),
  "P10-06 canonical release packs are not wired into the existing managed-runtime installer.",
);
assert.ok(
  connectionCenter.includes("LiOS Runtime Packs") &&
  connectionCenter.includes("runtimeQuery.data?.releasePacks") &&
  connectionCenter.includes("releasePackIds: selectedReleasePackIds") &&
  connectionCenter.includes("additionalPackIds: selectedAddonPackIds") &&
  connectionCenter.includes("Community Yahoo / yfinance"),
  "P10-06 Connection Center does not expose the six release packs through the canonical installer while preserving the consent-gated community add-on.",
);
assert.ok(
  runtimeManager.includes("selectedReleasePackIds") &&
  runtimeManager.includes("RUNTIME_STATE_SNAPSHOT") &&
  runtimeManagerTest.includes("rollback restores the previous runtime pack-selection metadata"),
  "P10-06 managed-runtime rollback does not restore the canonical release-pack selection state.",
);

assert.ok(
  observability.includes("localOnlyByDefault: true") &&
  observability.includes('LIOS_OBSERVABILITY_REMOTE_CONFIRMATION !== "redacted-only"') &&
  observability.includes("/v1/traces") &&
  observability.includes("/v1/metrics") &&
  observability.includes("/v1/logs") &&
  observabilityTest.includes("strips credential and content-shaped fields") &&
  observability.includes("otlpBytesFromHex") &&
  observability.includes("p10SafeHttpRoute") &&
  observabilityTest.includes("prefers route templates") &&
  routes.includes("app.use(p10ObservabilityMiddleware)") &&
  p9.includes('"automation.workflow.run"'),
  "P10-07 local/redacted OpenTelemetry-compatible observability missing.",
);
assert.ok(
  openLineage.includes('authoritative: false') &&
  openLineage.includes("boundedLocalFileBytes") &&
  openLineage.includes("fingerprint") &&
  openLineage.includes('LIOS_OPENLINEAGE_REMOTE_CONFIRMATION !== "fingerprinted-only"') &&
  openLineageTest.includes("fingerprints raw entity and dataset references") &&
  lineage.includes("emitP10OpenLineageReceipt"),
  "P10-08 optional non-authoritative OpenLineage projection missing.",
);
assert.ok(
  qualityGate.includes("pip-audit") &&
  releaseWorkflow.includes("pip-audit") &&
  qualityGate.includes("npm run audit:prod") &&
  qualityGate.includes("npm run audit:licenses") &&
  releaseWorkflow.includes("npm run audit:prod") &&
  releaseWorkflow.includes("npm run audit:licenses") &&
  windowsRelease.includes("pip-audit") &&
  windowsRelease.includes("npm run audit:prod") &&
  windowsRelease.includes("npm run audit:licenses") &&
  windowsRelease.includes("npm run audit:p10-release"),
  "P10-09 vulnerability/license scanning is not mandatory in CI and production release.",
);
assert.ok(
  regression.includes('"upstreamUpdateRule"') &&
  regression.includes('"regressionEvidence"') &&
  audit.includes("Regression evidence file is missing") &&
  auditTest.includes("release governance reconciles runtime packs OSS pins regressions"),
  "P10-10 imported-OSS regression/upstream-update gate missing.",
);
assert.ok(
  lseInventory.includes('"verbatimImportedPaths"') &&
  lseInventory.includes('"adaptedLiOSPaths"') &&
  lseInventory.includes('"modifications"') &&
  lseInventory.includes('"lse-terminal"') &&
  lseInventory.includes('"lse-data"') &&
  lseInventory.includes('"brue-language"') &&
  notices.includes("lse-release-inventory.json"),
  "P10-11 final LSE imported-path/license/notices/modification inventory missing.",
);
assert.ok(
  lseInventory.includes('"optional_provider_fail_closed"') &&
  lseInventory.includes('"centralRedistribution": false') &&
  lseInventory.includes('"otherProvidersRemainEligible": true') &&
  lseProvider.includes("LSE_DATA_UPSTREAM_COMMIT") &&
  lseProvider.includes("central hosted redistribution is prohibited") &&
  lseProvider.includes("other providers remain eligible") &&
  lseProvider.includes('state: "disabled"') &&
  audit.includes("LSE release posture must remain optional_provider_fail_closed"),
  "P10-12 LSE data-rights/upstream/fallback/disable release posture missing.",
);

assert.ok(
  read("script/lios_doctor.ts").includes("buildLiosDoctorSnapshot") &&
  read("script/lios_doctor.ts").includes("credentialValuesRead: false") &&
  read("script/lios_doctor.ts").includes("tenantRecordsEnumerated: false") &&
  read("script/lios_doctor.test.ts").includes("without credential values or tenant records") &&
  read("script/lios_doctor.test.ts").includes("does not expose absolute local paths"),
  "P10-13 secret-safe diagnostic CLI missing.",
);
assert.ok(
  !fs.existsSync(path.join(root, "desktopWorkspaceBackup.cjs")) &&
  read("desktopCsp.cjs").includes("imgSrcDirective"),
  "P10-14 folder-copy workspace backup must be retired in favour of the server backup.",
);
assert.ok(
  read("script/validate_p10_oss_footprint.ts").includes("react-resizable-panels") &&
  read("script/validate_p10_oss_footprint.ts").includes("dockview-enterprise") &&
  read("server/p10ResourceBudget.test.ts").includes("startup-scale budget") &&
  !packageJson.includes('"react-resizable-panels"'),
  "P10-15 OSS footprint/resource benchmark or redundant-runtime removal missing.",
);
assert.ok(
  read("../third_party/release-rights-matrix.json").includes('"softwareLicenseDoesNotGrantDataRights": true') &&
  read("../third_party/release-rights-matrix.json").includes('"bundledInCoreRelease": false') &&
  read("../third_party/release-rights-matrix.json").includes('"donorBrandingBundled": false') &&
  audit.includes("release-rights-matrix.json") &&
  notices.includes("release-rights-matrix.json"),
  "P10-16 separate code/data/model/dataset/trademark rights audit missing.",
);

const pkg = JSON.parse(packageJson) as { scripts?: Record<string, string> };
for (const script of ["test:p10", "acceptance:p10", "audit:p10-release"]) {
  assert.ok(pkg.scripts?.[script], "P10 package script missing " + script + ".");
}
assert.ok(pkg.scripts?.["test:trust"]?.includes("npm run test:p10"), "P10 trust chain does not include test:p10.");
assert.ok(qualityGate.includes("P10 Production hardening and release acceptance"), "P10 Quality Gate acceptance step missing.");
assert.ok(
  releaseWorkflow.includes("npm run acceptance:p10:packaged") &&
  pkg.scripts?.["acceptance:p10:packaged"]?.includes("validate_p10_packaged_acceptance.ts --mode=release"),
  "P10 production release evidence validation missing.",
);

for (let id = 1; id <= 16; id += 1) {
  const taskId = "LIOS-P10-" + String(id).padStart(2, "0");
  const rows = roadmap.split("\n").filter((line) => line.startsWith("| " + taskId + " |")).length;
  assert.equal(rows, 1, "Roadmap must contain exactly one canonical row for " + taskId + ".");
  assert.ok(plan.includes(taskId), "P10 technical source of truth missing " + taskId + ".");
}

console.log("P10 Production Hardening & Release acceptance P10-01…P10-16: PASS");
