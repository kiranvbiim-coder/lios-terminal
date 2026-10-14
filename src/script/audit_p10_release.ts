#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateP10RuntimePackCatalog } from "../server/p10RuntimePacks";
import { SOURCE_QUALIFICATION, validateSourceDistribution } from "./source_distribution";

type JsonObject = Record<string, any>;

function readJson(file: string): JsonObject {
  return JSON.parse(fs.readFileSync(file, "utf8")) as JsonObject;
}
function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}
function expect(condition: unknown, message: string, errors: string[]): void {
  if (!condition) errors.push(message);
}
function fileExists(file: string): boolean {
  return fs.existsSync(file) && fs.statSync(file).isFile();
}

export interface P10ReleaseAuditResult {
  errors: string[];
  warnings: string[];
  regressionEntries: number;
  lseComponents: number;
  qualification: typeof SOURCE_QUALIFICATION;
}

export function auditP10Release(repoRoot: string): P10ReleaseAuditResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const srcRoot = path.join(repoRoot, "src");
  const thirdParty = path.join(repoRoot, "third_party");
  const registry = readJson(path.join(thirdParty, "components.json"));
  const lock = readJson(path.join(thirdParty, "upstream-lock.json"));
  const regression = readJson(path.join(thirdParty, "imported-oss-regression.json"));
  const lseInventory = readJson(path.join(thirdParty, "lse-release-inventory.json"));
  const rightsMatrix = readJson(path.join(thirdParty, "release-rights-matrix.json"));
  const notices = read(path.join(repoRoot, "THIRD_PARTY_NOTICES.md"));
  const packageJson = readJson(path.join(srcRoot, "package.json"));
  errors.push(...validateSourceDistribution(repoRoot));
  warnings.push("Source-distribution audit only: binary release, signed installers, native hardware, packaged SP/P14 and real-data benchmark NOT_RUN.");
  const lseProvider = read(path.join(srcRoot, "server", "lseDataProvider.ts"));

  errors.push(...validateP10RuntimePackCatalog());

  const components = Array.isArray(registry.components) ? registry.components : [];
  const locks = Array.isArray(lock.locks) ? lock.locks : [];
  const componentById = new Map<string, any>(components.map((item: any) => [String(item.id), item]));
  const lockById = new Map<string, any>(locks.map((item: any) => [String(item.id), item]));

  expect(regression.schemaVersion === "1", "imported-oss-regression.json schemaVersion must be 1.", errors);
  expect(Array.isArray(regression.entries), "imported-oss-regression.json must contain entries.", errors);
  expect(
    typeof regression?.policy?.upstreamUpdateRule === "string" && /license review/i.test(regression.policy.upstreamUpdateRule) && /regression/i.test(regression.policy.upstreamUpdateRule),
    "Imported-OSS upstream update policy must require license and regression review.",
    errors,
  );

  for (const entry of regression.entries ?? []) {
    const id = String(entry.componentId ?? "");
    const component = componentById.get(id);
    const pinned = lockById.get(id);
    expect(Boolean(component), `Regression entry ${id} is missing from components.json.`, errors);
    expect(Boolean(pinned), `Regression entry ${id} is missing from upstream-lock.json.`, errors);
    if (component && pinned) {
      expect(component.repository === pinned.repository, `Repository drift for regression component ${id}.`, errors);
      expect(component.commitSha === pinned.commitSha, `Commit drift for regression component ${id}.`, errors);
      expect(component.license === pinned.license, `License drift for regression component ${id}.`, errors);
      const registeredDestinations = new Set(Array.isArray(component.destinationPaths) ? component.destinationPaths : []);
      for (const destination of entry.destinationPaths ?? []) {
        expect(registeredDestinations.has(destination), `Regression destination ${destination} for ${id} is absent from components.json.`, errors);
        expect(fileExists(path.join(srcRoot, destination)), `Regression destination file is missing for ${id}: ${destination}.`, errors);
      }
      for (const evidence of entry.regressionEvidence ?? []) {
        expect(fileExists(path.join(srcRoot, evidence)), `Regression evidence file is missing for ${id}: ${evidence}.`, errors);
      }
      expect(notices.toLowerCase().includes(String(component.name).toLowerCase()), `THIRD_PARTY_NOTICES is missing ${component.name}.`, errors);
    }
  }

  expect(lseInventory.schemaVersion === "1", "lse-release-inventory.json schemaVersion must be 1.", errors);
  expect(lseInventory.releasePosture === "optional_provider_fail_closed", "LSE release posture must remain optional_provider_fail_closed.", errors);
  const lseComponents = Array.isArray(lseInventory.components) ? lseInventory.components : [];
  for (const item of lseComponents) {
    const id = String(item.id ?? "");
    const component = componentById.get(id);
    const pinned = lockById.get(id);
    expect(Boolean(component), `LSE inventory component ${id} is missing from components.json.`, errors);
    expect(Boolean(pinned), `LSE inventory component ${id} is missing from upstream-lock.json.`, errors);
    if (component && pinned) {
      for (const key of ["repository", "commitSha", "license"] as const) {
        expect(item[key] === component[key], `LSE inventory ${id} ${key} differs from components.json.`, errors);
        expect(item[key] === pinned[key], `LSE inventory ${id} ${key} differs from upstream-lock.json.`, errors);
      }
      const registryDestinations = new Set(Array.isArray(component.destinationPaths) ? component.destinationPaths : []);
      for (const destination of item.adaptedLiOSPaths ?? []) {
        expect(registryDestinations.has(destination), `LSE adapted path ${destination} for ${id} is absent from components.json.`, errors);
        expect(fileExists(path.join(srcRoot, destination)), `LSE adapted path is missing: ${destination}.`, errors);
      }
      expect(Array.isArray(item.verbatimImportedPaths), `LSE inventory ${id} must explicitly declare verbatimImportedPaths.`, errors);
    }
  }

  const lseData = lseComponents.find((item: any) => item.id === "lse-data");
  if (lseData) {
    expect(lseData.redistribution === "not_permitted_by_lios_release_posture", "LSE Data redistribution posture drifted.", errors);
    expect(lseData.releaseDecision === "optional_connector_only", "LSE Data must remain optional_connector_only.", errors);
    expect(lseProvider.includes(`LSE_DATA_UPSTREAM_COMMIT = "${lseData.commitSha}"`), "LSE provider upstream commit constant drifted from release inventory.", errors);
  }

  const req = lseInventory.providerReleaseRequirements ?? {};
  for (const key of ["userOwnedCredential","centralRedistribution","localOnlyHostedDataUse","featureCanBeDisabled","otherProvidersRemainEligible","quotaHealthEntitlementVisible","upstreamCommitMustMatchRegistry","thirdPartyNoticeRequired"]) {
    expect(typeof req[key] === "boolean", `LSE release requirements must declare boolean ${key}.`, errors);
  }
  expect(req.userOwnedCredential === true, "LSE release requires a user-owned credential.", errors);
  expect(req.centralRedistribution === false, "LSE central redistribution must remain disabled.", errors);
  expect(req.localOnlyHostedDataUse === true, "LSE hosted-data use must remain local-only.", errors);
  expect(req.featureCanBeDisabled === true, "LSE connector must remain disable-able.", errors);
  expect(req.otherProvidersRemainEligible === true, "LSE cannot become a mandatory provider.", errors);

  for (const marker of [
    "resolveCredential(\"LSE_API_KEY\"",
    "isHostedProductionRuntime()",
    "central hosted redistribution is prohibited",
    "requestAsksRedistribution",
    "other providers remain eligible",
    'state: "disabled"',
    "lseEntitlementDecision",
  ]) {
    expect(lseProvider.includes(marker), `LSE release guard missing source marker: ${marker}.`, errors);
  }

  const scripts = packageJson.scripts ?? {};
  for (const name of ["audit:prod", "audit:licenses", "audit:p10-release", "test:p10", "acceptance:p10"]) {
    expect(typeof scripts[name] === "string" && scripts[name].trim(), `package.json is missing P10 release script ${name}.`, errors);
  }
  expect(String(scripts["test:trust"] ?? "").includes("npm run test:p10"), "test:trust must include test:p10.", errors);


  if (!notices.includes("## P10 release reconciliation — 2026-09-23")) {
    errors.push("THIRD_PARTY_NOTICES is missing the P10 release reconciliation section.");
  }

  expect(rightsMatrix.schemaVersion === "1", "release-rights-matrix.json schemaVersion must be 1.", errors);
  expect(rightsMatrix?.externalDataAndApis?.softwareLicenseDoesNotGrantDataRights === true, "P10 rights matrix must separate software licenses from provider data/API rights.", errors);
  expect(rightsMatrix?.externalDataAndApis?.centralRedistributionAssumed === false, "P10 rights matrix must not assume provider-data redistribution rights.", errors);
  expect(rightsMatrix?.modelWeights?.bundledInCoreRelease === false, "Core release must not bundle model weights without a separate license decision.", errors);
  expect(rightsMatrix?.modelWeights?.separateWeightLicenseRequiredBeforeBundling === true, "Model-weight bundling must require a separate license decision.", errors);
  expect(rightsMatrix?.datasets?.thirdPartyProviderDatasetsBundledInCoreRelease === false, "Core release must not bundle third-party provider datasets by default.", errors);
  expect(rightsMatrix?.datasets?.userConnectedDataRedistributedByLiOS === false, "LiOS must not redistribute user-connected data by default.", errors);
  expect(rightsMatrix?.trademarksAndAssets?.donorBrandingBundled === false, "Donor branding must not be bundled.", errors);
  expect(rightsMatrix?.trademarksAndAssets?.donorLogosBundled === false, "Donor logos must not be bundled.", errors);

  const assetRoots = Array.isArray(rightsMatrix?.trademarksAndAssets?.packagedAssetRoots) ? rightsMatrix.trademarksAndAssets.packagedAssetRoots : [];
  const forbiddenBrandTokens = Array.isArray(rightsMatrix?.trademarksAndAssets?.forbiddenDonorBrandTokens) ? rightsMatrix.trademarksAndAssets.forbiddenDonorBrandTokens : [];
  const forbiddenArtifacts = new Set(Array.isArray(rightsMatrix?.trademarksAndAssets?.forbiddenDevelopmentArtifacts) ? rightsMatrix.trademarksAndAssets.forbiddenDevelopmentArtifacts : []);
  const walk = (directory: string): string[] => {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.isFile() ? [full] : [];
    });
  };
  for (const relativeRoot of assetRoots) {
    const fullRoot = path.join(repoRoot, relativeRoot);
    for (const file of walk(fullRoot)) {
      const basename = path.basename(file);
      expect(!forbiddenArtifacts.has(basename), `Forbidden development artifact is present in packaged assets: ${path.relative(repoRoot, file)}.`, errors);
      const normalized = path.relative(repoRoot, file).toLowerCase();
      for (const token of forbiddenBrandTokens) {
        expect(!normalized.includes(String(token).toLowerCase()), `Donor-branded asset token "${token}" is present in packaged assets: ${normalized}.`, errors);
      }
    }
  }

  return {
    errors,
    warnings,
    regressionEntries: Array.isArray(regression.entries) ? regression.entries.length : 0,
    lseComponents: lseComponents.length,
    qualification: SOURCE_QUALIFICATION,
  };
}

const isCli = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isCli) {
  const repoRoot = path.resolve(process.cwd(), "..");
  const result = auditP10Release(repoRoot);
  for (const warning of result.warnings) console.warn("WARN p10-release:", warning);
  if (result.errors.length) {
    console.error("P10 release audit failed:\n- " + result.errors.join("\n- "));
    process.exitCode = 1;
  } else {
    console.log(`P10 source-distribution governance audit passed: regressionEntries=${result.regressionEntries}; lseComponents=${result.lseComponents}; release/native/SP/real-data qualification NOT_RUN.`);
  }
}
