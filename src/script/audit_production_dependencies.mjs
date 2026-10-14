#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const BULK_AUDIT_URL = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const HIGH_SEVERITIES = new Set(["high", "critical"]);

export function packageNameFromLockPath(lockPath, entry) {
  if (typeof entry?.name === "string" && entry.name.trim()) return entry.name.trim();
  const marker = "node_modules/";
  const index = lockPath.lastIndexOf(marker);
  if (index < 0) return null;
  const suffix = lockPath.slice(index + marker.length);
  if (!suffix) return null;
  if (suffix.startsWith("@")) {
    const [scope, name] = suffix.split("/");
    return scope && name ? `${scope}/${name}` : null;
  }
  return suffix.split("/")[0] || null;
}

export function productionVersionsFromLock(lock) {
  if (!lock || typeof lock !== "object" || Number(lock.lockfileVersion) < 2 || !lock.packages || typeof lock.packages !== "object") {
    throw new Error("Production dependency audit requires a package-lock v2+ packages tree.");
  }
  const versions = new Map();
  for (const [lockPath, rawEntry] of Object.entries(lock.packages)) {
    if (!lockPath || !rawEntry || typeof rawEntry !== "object" || rawEntry.dev === true) continue;
    const name = packageNameFromLockPath(lockPath, rawEntry);
    if (!name) throw new Error(`Cannot determine production package name for lock entry ${lockPath}.`);
    const version = typeof rawEntry.version === "string" ? rawEntry.version.trim() : "";
    if (!version) throw new Error(`Production package ${name} is missing a concrete version in package-lock.json.`);
    const set = versions.get(name) ?? new Set();
    set.add(version);
    versions.set(name, set);
  }
  return Object.fromEntries([...versions.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, set]) => [name, [...set].sort()]));
}

export function summarizeBulkAdvisories(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("npm Bulk Advisory response is not an object.");
  const advisories = [];
  for (const [packageName, value] of Object.entries(payload)) {
    if (!Array.isArray(value)) throw new Error(`npm Bulk Advisory response for ${packageName} is not an array.`);
    for (const advisory of value) {
      if (!advisory || typeof advisory !== "object") throw new Error(`npm advisory for ${packageName} is malformed.`);
      const severity = String(advisory.severity ?? "").toLowerCase();
      if (!["info", "low", "moderate", "high", "critical"].includes(severity)) {
        throw new Error(`npm advisory for ${packageName} has unknown severity "${severity}".`);
      }
      advisories.push({
        packageName,
        severity,
        title: String(advisory.title ?? "Untitled advisory"),
        url: String(advisory.url ?? ""),
        vulnerableVersions: String(advisory.vulnerable_versions ?? ""),
      });
    }
  }
  return advisories;
}

function standardAuditResult() {
  const result = spawnSync("npm", ["audit", "--omit=dev", "--audit-level=high", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) return { kind: "infrastructure", detail: String(result.error) };
  let parsed = null;
  try { parsed = result.stdout?.trim() ? JSON.parse(result.stdout) : null; } catch {}
  const vulnerabilities = parsed?.metadata?.vulnerabilities;
  if (vulnerabilities && typeof vulnerabilities === "object") {
    const high = Number(vulnerabilities.high ?? 0);
    const critical = Number(vulnerabilities.critical ?? 0);
    if (high > 0 || critical > 0) return { kind: "vulnerable", high, critical, output: result.stdout };
    if (result.status === 0) return { kind: "clean", output: result.stdout };
  }
  return {
    kind: "infrastructure",
    detail: [result.stderr, result.stdout].filter(Boolean).join("\n").slice(-8000) || `npm audit exited ${result.status}`,
  };
}

async function bulkAuditWithRetry(versions, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(BULK_AUDIT_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json",
          "user-agent": `lios-security-audit node/${process.version}`,
        },
        body: JSON.stringify(versions),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`npm Bulk Advisory endpoint returned HTTP ${response.status}.`);
      const payload = await response.json();
      return summarizeBulkAdvisories(payload);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("npm Bulk Advisory audit failed.");
}

export async function runProductionDependencyAudit() {
  const standard = standardAuditResult();
  if (standard.kind === "clean") {
    process.stdout.write(standard.output || "npm production audit found no high/critical vulnerabilities.\n");
    return;
  }
  if (standard.kind === "vulnerable") {
    process.stderr.write(standard.output || "");
    throw new Error(`Production dependency audit found ${standard.high} high and ${standard.critical} critical vulnerabilities.`);
  }

  console.warn("Standard npm audit could not obtain a valid advisory report; using the official npm Bulk Advisory endpoint directly.");
  if (standard.detail) console.warn(standard.detail);

  const lockPath = path.resolve(process.cwd(), "package-lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const versions = productionVersionsFromLock(lock);
  const packageCount = Object.keys(versions).length;
  if (packageCount === 0) throw new Error("Production dependency audit found no locked production packages.");

  const advisories = await bulkAuditWithRetry(versions);
  const blocking = advisories.filter((item) => HIGH_SEVERITIES.has(item.severity));
  console.log(`npm Bulk Advisory scan checked ${packageCount} locked production packages; advisories=${advisories.length}; high_or_critical=${blocking.length}.`);
  for (const item of advisories) {
    console.log(`[${item.severity}] ${item.packageName}: ${item.title}${item.url ? ` (${item.url})` : ""}`);
  }
  if (blocking.length) {
    throw new Error(`Production dependency audit found ${blocking.length} high/critical advisory match(es).`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runProductionDependencyAudit().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
