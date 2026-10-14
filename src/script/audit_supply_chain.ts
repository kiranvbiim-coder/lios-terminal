#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MANAGED_RUNTIME_MANIFEST, type ManagedRuntimeManifest } from "../server/runtimeManifest";

const HIGH_OBLIGATION_LICENSE = /(?:^|\b)(?:AGPL|GPL|SSPL|BUSL)(?:-|\b)|Elastic License|Commons Clause/i;
const MANUAL_REVIEW_LICENSE = /SEE LICENSE|UNKNOWN|UNLICENSED|CUSTOM/i;
const PERMISSIVE_LICENSE = /^(?:MIT|Apache-2\.0|BSD-(?:2|3)-Clause|ISC|0BSD|CC0-1\.0|Unlicense|NCSA)$/i;
const require = createRequire(import.meta.url);
const { shouldCopy }: { shouldCopy: (source: string, root: string) => boolean } =
  require("./afterPackCopyNodeModules.cjs");

export interface LicenseFinding {
  component: string;
  license: string;
  source: "node" | "runtime";
  severity: "allow" | "review" | "block";
  detail: string;
}

export function classifyLicense(license: string): Pick<LicenseFinding, "severity" | "detail"> {
  const normalized = String(license || "").trim();
  if (!normalized) {
    return { severity: "review", detail: "No license metadata was declared." };
  }
  if (MANUAL_REVIEW_LICENSE.test(normalized)) {
    return { severity: "review", detail: "License metadata requires manual review." };
  }

  const alternatives = normalized.split(/\s+OR\s+/i).map((part) => part.replace(/[()]/g, "").trim());
  // Deliberately conservative: mixed AND/WITH expressions need an explicit
  // terms review rather than assuming any permissive token clears everything.
  const permissiveAlternative = !/\b(?:AND|WITH)\b/i.test(normalized) &&
    alternatives.some((part) => PERMISSIVE_LICENSE.test(part));

  if (HIGH_OBLIGATION_LICENSE.test(normalized) && !permissiveAlternative) {
    return {
      severity: "block",
      detail: "High-obligation/copyleft/restricted license requires an explicit distribution decision before proprietary-core bundling.",
    };
  }
  if (HIGH_OBLIGATION_LICENSE.test(normalized) && permissiveAlternative) {
    return {
      severity: "allow",
      detail: "License expression includes an explicit permissive OR alternative; release notices must preserve the selected license terms.",
    };
  }
  if (alternatives.every((part) => PERMISSIVE_LICENSE.test(part))) {
    return { severity: "allow", detail: "Recognized permissive metadata; retained terms and distribution obligations still require reconciliation." };
  }
  return { severity: "review", detail: "Unrecognized or mixed license expression requires a distribution-rights review." };
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
  if (Array.isArray(pkg.licenses)) {
    const values = pkg.licenses
      .map((value) => typeof value === "string" ? value : value && typeof value === "object" && "type" in value ? String(value.type) : "")
      .filter(Boolean);
    if (values.length) return values.join(" OR ");
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
          const classification = classifyLicense(license);
          // Export-subpath manifests (e.g. helpers/esm/package.json) are not
          // independently installed packages. Explicit nested licenses are
          // still inspected, but only actual package roots require lock rows.
          const drift = !packageRoot ? "" : !locked
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
        // The installed-source mode inventories precisely the hook's retained
        // paths. Exact-package mode inspects every directory actually present.
        if (!packagedNodeModules && !shouldCopy(source, nodeModules)) continue;
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
