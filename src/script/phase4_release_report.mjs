#!/usr/bin/env node
/**
 * Offline Phase 4 status utility. No native action, network, install, signing,
 * credentials or release upload is performed. Never write a "verified" result.
 *
 * node script/phase4_release_report.mjs [--evidence path.json --base-dir dir] [--require-ready]
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { assessPhase4Release } from "./phase4_release_gate.mjs";

const args = process.argv.slice(2);
function flag(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
if (args.some((value, i) => value.startsWith("--") && !["--evidence", "--base-dir", "--require-ready"].includes(value))) {
  process.stderr.write("Unknown Phase 4 release-report option.\n");
  process.exit(2);
}
const evidenceFile = flag("--evidence");
const baseDir = flag("--base-dir");
if (Boolean(evidenceFile) !== Boolean(baseDir)) {
  process.stderr.write("Use --evidence and --base-dir together to verify retained artifact bytes.\n");
  process.exit(2);
}
const report = evidenceFile ? JSON.parse(readFileSync(resolve(evidenceFile), "utf8")) : { commit: null, evidence: [] };
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
// Inspect the actual on-disk checkout. A manifest cannot nominate its own
// expected Git commit or claim that modified tracked files are release-ready.
let checkout = { commit: null, trackedFilesClean: false };
try {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const trackedFilesClean = [["diff", "--quiet", "--exit-code"], ["diff", "--cached", "--quiet", "--exit-code"]].every(args => {
    try {
      execFileSync("git", args, { cwd: repositoryRoot, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  });
  checkout = { commit, trackedFilesClean };
} catch {
  // Missing git, invalid checkout, absent HEAD or other errors are blockers.
}
const result = assessPhase4Release(report, baseDir ? resolve(baseDir) : null, checkout);
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
if (args.includes("--require-ready") && !result.releaseReady) {
  process.stderr.write("Phase 4 release gate: BLOCKED; see missing or invalid evidence above.\n");
  process.exitCode = 1;
}
