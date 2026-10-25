import fs from "node:fs";
import path from "node:path";
import { validateWS65ReleaseBundle } from "../evals/ws65InstalledUxValidator";

function arg(name: string): string | null {
  const value = process.argv.slice(2).find((item) => item.startsWith(`--${name}=`));
  return value ? value.slice(name.length + 3).trim() || null : null;
}
function required(name: string): string {
  const found = arg(name);
  if (!found) throw new Error(`WS-65 requires --${name}; source CI is not installed release evidence.`);
  return found;
}
const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as { version: string };
const version = packageJson.version;
const report = required("report");
const evidenceDir = required("evidence-dir");
const flagshipReport = required("flagship-report");
const p14EvidenceDir = required("p14-evidence-dir");
const ownerSignoffFile = required("owner-signoff");
const expectedReleaseTag = required("release-tag");
const expectedCommit = required("commit-sha").toLowerCase();
if (!/^[0-9a-f]{40}$/.test(expectedCommit)) throw new Error("WS-65 requires an exact 40-character certification commit SHA.");
if (expectedReleaseTag.replace(/^v/, "") !== version) throw new Error("WS-65 release tag must match package.json version.");
if (process.env.GITHUB_SHA && process.env.GITHUB_SHA.toLowerCase() !== expectedCommit) {
  throw new Error("WS-65 supplied SHA does not match current GitHub CI checkout.");
}
const result = validateWS65ReleaseBundle({
  report, evidenceDir, flagshipReport, p14EvidenceDir, ownerSignoffFile,
  expectedReleaseTag, expectedCommit, expectedPackageVersion: version,
});
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
process.stdout.write("WS65_INSTALLED_UX_SUPPLIED_EVIDENCE: VALIDATED\n");
