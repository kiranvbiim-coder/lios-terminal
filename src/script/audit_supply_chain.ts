#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MANAGED_RUNTIME_MANIFEST, type ManagedRuntimeManifest } from "../server/runtimeManifest";

const HIGH_OBLIGATION_LICENSE = /(?:^|\b)(?:AGPL|GPL|SSPL|BUSL)(?:-|\b)|Elastic License|Commons Clause/i;
const PERMISSIVE_LICENSES: Record<string, true> = {
  MIT: true, "Apache-2.0": true, "BSD-2-Clause": true, "BSD-3-Clause": true,
  ISC: true, "0BSD": true, "CC0-1.0": true, Unlicense: true, NCSA: true,
};
// These terms are eligible only with exact-package evidence in the canonical
// matrix; this table never approves a package or a LicenseRef/exception.
const EVIDENCE_REQUIRED_TERMS: Record<string, true> = {
  "OFL-1.1": true, Zlib: true, "Python-2.0": true, "MIT-0": true, "BlueOak-1.0.0": true,
};
const require = createRequire(import.meta.url);
type SpdxExpression = { license: string; plus?: boolean; exception?: string } |
  { conjunction: "and" | "or"; left: SpdxExpression; right: SpdxExpression };
const parseSpdx: (expression: string) => SpdxExpression = require("spdx-expression-parse");

export interface LicenseFinding {
  component: string;
  license: string;
  source: "node" | "runtime";
  severity: "allow" | "review" | "block";
  detail: string;
  selectedExpression?: string;
  selectedTerms?: string[];
  legalFiles?: GrantFile[];
}

type Classification = Pick<LicenseFinding, "severity" | "detail" | "selectedExpression" | "selectedTerms">;

function classifyExpression(expression: SpdxExpression, reviewedTerms: ReadonlySet<string>): Classification {
  if ("license" in expression) {
    const term = `${expression.license}${expression.plus ? "+" : ""}`;
    if (expression.exception) {
      return { severity: "review", detail: `Unapproved SPDX exception: ${term} WITH ${expression.exception}.` };
    }
    if (HIGH_OBLIGATION_LICENSE.test(term)) {
      return { severity: "block", detail: `Restricted/high-obligation term ${term} requires an explicit distribution decision.` };
    }
    if (Object.hasOwn(PERMISSIVE_LICENSES, term) || reviewedTerms.has(term)) {
      return { severity: "allow", detail: "Selected complete license branch; preserve every selected obligation.", selectedExpression: term, selectedTerms: [term] };
    }
    return { severity: "review", detail: `Unreviewed license term: ${term}.` };
  }
  const left = classifyExpression(expression.left, reviewedTerms);
  const right = classifyExpression(expression.right, reviewedTerms);
  if (expression.conjunction === "or") {
    if (left.severity === "allow") return left;
    if (right.severity === "allow") return right;
  } else if (left.severity === "allow" && right.severity === "allow") {
    return {
      severity: "allow",
      detail: "All conjunctive terms apply; preserve every selected obligation.",
      selectedExpression: `(${left.selectedExpression} AND ${right.selectedExpression})`,
      selectedTerms: [...new Set([...left.selectedTerms!, ...right.selectedTerms!])],
    };
  }
  return {
    severity: left.severity === "block" || right.severity === "block" ? "block" : "review",
    detail: `${left.detail} ${expression.conjunction.toUpperCase()} ${right.detail}`,
  };
}

function parseLicense(license: string, reviewedTerms: ReadonlySet<string>): Classification {
  if (!license.trim()) return { severity: "review", detail: "No license metadata was declared." };
  try {
    return classifyExpression(parseSpdx(license), reviewedTerms);
  } catch {
    return { severity: HIGH_OBLIGATION_LICENSE.test(license) ? "block" : "review", detail: "Malformed/non-SPDX license metadata requires exact-package grant review." };
  }
}

export function classifyLicense(license: string): Classification {
  return parseLicense(String(license || "").trim(), new Set());
}

interface GrantFile {
  scope: "package" | "distribution";
  path: string;
  sha256: string;
}

interface PackageRightsReview {
  name: string;
  version: string;
  declaredLicense: string;
  selectedExpression: string;
  reviewedTerms: string[];
  metadataCorrection?: string;
  additionalExpression?: string;
  legalFiles: GrantFile[];
  obligations: string[];
}

function readRightsReviews(cwd: string): PackageRightsReview[] {
  const matrix = JSON.parse(fs.readFileSync(path.resolve(cwd, "../third_party/release-rights-matrix.json"), "utf8")) as {
    nodePackageReviews?: PackageRightsReview[];
  };
  if (!Array.isArray(matrix.nodePackageReviews)) throw new Error("Release-rights matrix is missing nodePackageReviews.");
  const seen = new Set<string>();
  for (const review of matrix.nodePackageReviews) {
    const key = `${review.name}@${review.version}`;
    if (seen.has(key) || !review.name || !review.version || typeof review.declaredLicense !== "string" ||
        !review.selectedExpression || !Array.isArray(review.reviewedTerms) ||
        review.reviewedTerms.some((term) => !Object.hasOwn(EVIDENCE_REQUIRED_TERMS, term)) ||
        !review.legalFiles?.length || !review.obligations?.length) {
      throw new Error(`Invalid/duplicate exact-package rights review: ${key}`);
    }
    seen.add(key);
  }
  return matrix.nodePackageReviews;
}

function verifyGrantFile(root: string, grant: GrantFile): void {
  if (!["package", "distribution"].includes(grant.scope) || !/^[a-f0-9]{64}$/.test(grant.sha256) ||
      !grant.path || grant.path.includes("\\") || path.posix.isAbsolute(grant.path) ||
      grant.path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid reviewed legal-file path/hash.");
  }
  let target = root;
  for (const part of grant.path.split("/")) {
    target = path.join(target, part);
    if (fs.lstatSync(target).isSymbolicLink()) throw new Error(`Reviewed legal file traverses a symlink: ${grant.path}`);
  }
  if (!fs.statSync(target).isFile() || createHash("sha256").update(fs.readFileSync(target)).digest("hex") !== grant.sha256) {
    throw new Error(`Missing/tampered reviewed legal file: ${grant.path}`);
  }
}

function classifyPackageLicense(
  license: string, name: string, version: string, directory: string, distributionRoot: string,
  reviews: PackageRightsReview[],
): Classification & Pick<LicenseFinding, "legalFiles"> {
  const review = reviews.find((entry) => entry.name === name && entry.version === version);
  if (!review) return classifyLicense(license);
  try {
    if (review.declaredLicense !== license) throw new Error("Declared license differs from the exact-package rights review.");
    for (const grant of review.legalFiles) {
      verifyGrantFile(grant.scope === "package" ? directory : distributionRoot, grant);
    }
    let selected = parseLicense(review.selectedExpression, new Set(review.reviewedTerms));
    if (selected.severity !== "allow") throw new Error(`Reviewed branch is not approved: ${selected.detail}`);
    // A metadata correction is only valid for this exact declaration/version,
    // backed by the pinned grant. It never makes arbitrary malformed SPDX valid.
    if (review.metadataCorrection && HIGH_OBLIGATION_LICENSE.test(license)) {
      throw new Error("A metadata correction cannot clear declared restricted terms.");
    }
    if (!review.metadataCorrection) {
      const declared = parseLicense(license, new Set(review.reviewedTerms));
      if (declared.severity !== "allow" || declared.selectedExpression !== selected.selectedExpression) {
        throw new Error("Selected branch differs from the parsed declaration.");
      }
    }
    if (review.additionalExpression) {
      selected = parseLicense(`(${selected.selectedExpression}) AND (${review.additionalExpression})`, new Set(review.reviewedTerms));
      if (selected.severity !== "allow") throw new Error(`Unapproved constituent obligations: ${selected.detail}`);
    }
    return { ...selected, legalFiles: review.legalFiles, detail: `${selected.detail} Exact-package grant hashes reconciled; ${review.obligations.join(" ")}` };
  } catch (error) {
    const original = classifyLicense(license);
    return {
      severity: original.severity === "block" ? "block" : "review",
      detail: `Exact-package rights evidence failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function auditManagedRuntimeLicenses(
  manifest: ManagedRuntimeManifest = MANAGED_RUNTIME_MANIFEST,
): LicenseFinding[] {
  const findings: LicenseFinding[] = [];
  for (const pack of manifest.packs) {
    for (const pkg of pack.packages) {
      const classification = classifyLicense(pkg.license);
      findings.push({
        component: `${pkg.name}@${pkg.version} [pack:${pack.id}]`,
        license: pkg.license,
        source: "runtime",
        ...classification,
      });
    }
  }
  return findings;
}


function packageLicense(pkg: Record<string, unknown>): string {
  if (typeof pkg.license === "string" && pkg.license.trim()) return pkg.license.trim();
  if (Array.isArray(pkg.licenses) && pkg.licenses.length) {
    if (pkg.licenses.length === 1) {
      const only: unknown = pkg.licenses[0];
      if (typeof only === "string" && only.trim()) return only.trim();
      if (only && typeof only === "object" && "type" in only && typeof only.type === "string" && only.type.trim()) {
        return only.type.trim();
      }
    }
    // Multiple legacy entries do not establish alternative versus cumulative grants.
    return `AMBIGUOUS LEGACY LICENSES: ${JSON.stringify(pkg.licenses)}`;
  }
  return "";
}

export function auditInstalledNodeLicenses(
  cwd: string,
  packagedNodeModules?: string,
): { findings: LicenseFinding[]; missingPackageMetadata: string[] } {
  const lock = JSON.parse(fs.readFileSync(path.join(cwd, "package-lock.json"), "utf8")) as {
    lockfileVersion?: number;
    packages?: Record<string, Record<string, unknown>>;
  };
  if (!lock.packages || Number(lock.lockfileVersion) < 2) {
    throw new Error("Node license audit requires a package-lock v2+ packages tree.");
  }
  const packages = lock.packages;
  const nodeModules = path.resolve(packagedNodeModules ?? path.join(cwd, "node_modules"));
  if (!fs.statSync(nodeModules).isDirectory()) throw new Error(`Missing copied dependency directory: ${nodeModules}`);
  const findings: LicenseFinding[] = [];
  const missingPackageMetadata: string[] = [];
  const reviews = readRightsReviews(cwd);
  const distributionRoot = packagedNodeModules ? path.dirname(nodeModules) : path.resolve(cwd, "..");
  const ancestors = new Set<string>();

  function visit(directory: string, packageRoot: boolean): void {
    const realPath = fs.realpathSync(directory);
    if (ancestors.has(realPath)) throw new Error(`Dependency copy contains a directory cycle: ${directory}`);
    ancestors.add(realPath);
    try {
      const entries = fs.readdirSync(directory, { withFileTypes: true });
      const manifestPath = path.join(directory, "package.json");
      const relativePath = `node_modules/${path.relative(nodeModules, directory).split(path.sep).join("/")}`;
      if (packageRoot || fs.existsSync(manifestPath)) {
        let pkg: Record<string, unknown> | undefined;
        try {
          const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            pkg = parsed as Record<string, unknown>;
          }
        } catch {
          // Record missing/invalid metadata, but still inspect nested copies.
        }
        if (!pkg) {
          if (packageRoot) missingPackageMetadata.push(relativePath);
        } else if (packageRoot || packageLicense(pkg)) {
          const license = packageLicense(pkg);
          const name = typeof pkg.name === "string" && pkg.name.trim() ? pkg.name : relativePath;
          const version = typeof pkg.version === "string" && pkg.version.trim() ? pkg.version : "unknown";
          const locked = packages[relativePath];
          const classification = classifyPackageLicense(license, name, version, directory, distributionRoot, reviews);
          // Export-subpath manifests (e.g. helpers/esm/package.json) are not
          // independently installed packages. Explicit nested licenses are
          // still inspected, but only actual package roots require lock rows.
          const drift = !packageRoot ? "" : !pkg.name || !pkg.version
            ? "Copied package is missing its name/version metadata." : !locked
            ? "Copied package is absent from the lockfile."
            : locked.version !== version ? `Copied version ${version} differs from locked version ${String(locked.version)}.` : "";
          findings.push({
            component: `${name}@${version} [${relativePath}]`,
            license: license || "UNKNOWN",
            source: "node",
            ...classification,
            ...(drift ? {
              severity: classification.severity === "block" ? "block" : "review",
              detail: `${classification.detail} ${drift}`,
            } : {}),
          });
        }
      }
      const dependencyContainer = directory === nodeModules || path.basename(directory) === "node_modules";
      const scopeContainer = path.basename(directory).startsWith("@") && path.basename(path.dirname(directory)) === "node_modules";
      for (const entry of entries) {
        const source = path.join(directory, entry.name);
        if (!fs.statSync(source).isDirectory()) continue;
        const childPackageRoot = scopeContainer ||
          (dependencyContainer && !entry.name.startsWith("@") && !entry.name.startsWith("."));
        visit(source, childPackageRoot);
      }
    } finally {
      ancestors.delete(realPath);
    }
  }

  visit(nodeModules, false);
  return { findings, missingPackageMetadata: missingPackageMetadata.sort() };
}

function runRequired(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
  }
}

function pythonAudit(cwd: string): { ran: boolean; detail: string } {
  const python = process.env.PYTHON_EXECUTABLE?.trim() || (process.platform === "win32" ? "python" : "python3");
  const probe = spawnSync(python, ["-m", "pip_audit", "--version"], { cwd, encoding: "utf8" });
  if (probe.status !== 0) {
    if (process.env.LIOS_REQUIRE_PYTHON_AUDIT === "true") {
      throw new Error("LIOS_REQUIRE_PYTHON_AUDIT=true but pip-audit is unavailable.");
    }
    return {
      ran: false,
      detail: "pip-audit is not installed; Python vulnerability scan is optional in development and required only when LIOS_REQUIRE_PYTHON_AUDIT=true.",
    };
  }

  const requirements = path.join(cwd, "python-service", "requirements.txt");
  const result = spawnSync(
    python,
    ["-m", "pip_audit", "-r", requirements, "--progress-spinner", "off"],
    { cwd, encoding: "utf8", stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pip-audit failed with exit code ${result.status}.`);
  return { ran: true, detail: "pip-audit completed successfully." };
}

export function summarizeLicenseFindings(findings: LicenseFinding[]): {
  blocked: LicenseFinding[];
  review: LicenseFinding[];
} {
  return {
    blocked: findings.filter((finding) => finding.severity === "block"),
    review: findings.filter((finding) => finding.severity === "review"),
  };
}

export function runStaticLicenseAudit(cwd: string, packagedNodeModules?: string): void {
  const node = auditInstalledNodeLicenses(cwd, packagedNodeModules);
  // The exact copied graph is a Node gate, not proof of optional Python packs.
  const runtime = packagedNodeModules ? [] : auditManagedRuntimeLicenses();
  const summary = summarizeLicenseFindings([...node.findings, ...runtime]);
  for (const finding of [...node.findings, ...runtime]) {
    if (finding.severity === "allow") {
      console.log(`SELECTED license: ${finding.component}: ${finding.license} => ${finding.selectedExpression}`);
    }
  }

  for (const finding of summary.review) {
    console.warn(`REVIEW license: ${finding.component}: ${finding.license} — ${finding.detail}`);
  }
  for (const missing of node.missingPackageMetadata) {
    console.warn(`REVIEW license: copied dependency has missing/invalid package metadata: ${missing}`);
  }
  if (summary.blocked.length) {
    const detail = summary.blocked.map((finding) => `${finding.component}: ${finding.license}`).join(", ");
    throw new Error(`Supply-chain license audit found blocked high-obligation package licenses: ${detail}`);
  }
  if (packagedNodeModules && (summary.review.length || node.missingPackageMetadata.length || !node.findings.length)) {
    throw new Error(`Binary release blocked: copied Node graph has ${summary.review.length} unresolved license/lock review(s), ${node.missingPackageMetadata.length} missing metadata record(s), ${node.findings.length} inspected package(s).`);
  }

  console.log(
    `Supply-chain license metadata audit: node=${node.findings.length} (including copied dev dependencies), runtime=${runtime.length}, manual_review=${summary.review.length}, missing_metadata=${node.missingPackageMetadata.length}. ` +
    "Not complete redistribution-rights, notice-obligation, asset/model/data or vulnerability clearance.",
  );
}

export function runSupplyChainAudit(cwd: string): void {
  runRequired(process.execPath, ["script/audit_oss_registry.mjs"], cwd);
  runRequired(process.execPath, ["script/audit_production_dependencies.mjs"], cwd);
  runStaticLicenseAudit(cwd);
  const python = pythonAudit(cwd);
  console.log(python.detail);
}

const isCli = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isCli) {
  const option = (name: string): string | undefined => {
    const index = process.argv.indexOf(name);
    if (index < 0) return undefined;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a path.`);
    return path.resolve(value);
  };
  try {
    const cwd = option("--project-dir") ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const packagedNodeModules = option("--packaged-node-modules");
    if (process.argv.includes("--static") || packagedNodeModules) runStaticLicenseAudit(cwd, packagedNodeModules);
    else runSupplyChainAudit(cwd);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
