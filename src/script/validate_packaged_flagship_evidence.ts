import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { flagshipReleaseReportSchema } from "../shared/flagshipReleaseEvidence";
import { p14ReleaseEvidenceSchema } from "../shared/p14ReleaseEvidence";

function argument(name: string): string | null {
  const prefix = "--" + name + "=";
  const match = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() || null : null;
}

const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };
const reportPath = path.resolve(
  root,
  argument("report") || process.env.LIOS_FLAGSHIP_RELEASE_REPORT?.trim() || "",
);
if (!process.env.LIOS_FLAGSHIP_RELEASE_REPORT?.trim() && !argument("report")) {
  throw new Error("Set LIOS_FLAGSHIP_RELEASE_REPORT or pass --report=<path>.");
}
if (!fs.existsSync(reportPath) || !fs.statSync(reportPath).isFile()) {
  throw new Error("Packaged flagship release report does not exist: " + reportPath);
}

const report = flagshipReleaseReportSchema.parse(JSON.parse(fs.readFileSync(reportPath, "utf8")));
const expectedReleaseTag = (argument("release-tag") || process.env.RELEASE_TAG?.trim() || report.releaseTag).trim();

if (report.releaseTag !== expectedReleaseTag) {
  throw new Error(`Flagship report belongs to ${report.releaseTag}, expected ${expectedReleaseTag}.`);
}
if (report.packageVersion !== packageJson.version) {
  throw new Error(`Flagship report package ${report.packageVersion} does not match package.json ${packageJson.version}.`);
}
if (expectedReleaseTag.replace(/^v/, "") !== packageJson.version) {
  throw new Error(`Release tag ${expectedReleaseTag} does not match package version ${packageJson.version}.`);
}
const expectedCommit = process.env.GITHUB_SHA?.trim().toLowerCase();
if (expectedCommit && report.build.commitSha !== expectedCommit) {
  throw new Error(`Flagship report commit ${report.build.commitSha} does not match exact certification commit ${expectedCommit}.`);
}

const bytes = fs.readFileSync(reportPath);
const reportSha256 = crypto.createHash("sha256").update(bytes).digest("hex");

const attachedEvidencePath = process.env.LIOS_P14_FLAGSHIP_EVIDENCE?.trim() || null;
if (attachedEvidencePath && fs.existsSync(path.resolve(root, attachedEvidencePath))) {
  const attached = p14ReleaseEvidenceSchema.parse(
    JSON.parse(fs.readFileSync(path.resolve(root, attachedEvidencePath), "utf8")),
  );
  if (attached.category !== "flagship") throw new Error("Attached P14 evidence is not flagship evidence.");
  if (attached.releaseTag !== report.releaseTag || attached.packageVersion !== report.packageVersion) {
    throw new Error("Attached P14 flagship evidence does not belong to this release report.");
  }
  if (!attached.sourceArtifacts.some((artifact) => artifact.sha256 === reportSha256)) {
    throw new Error("Attached P14 flagship evidence is not bound to the validated flagship release report.");
  }
}

const outputPath = argument("write-p14");
if (outputPath) {
  const evidence = p14ReleaseEvidenceSchema.parse({
    schemaVersion: "1",
    category: "flagship",
    status: "passed",
    releaseTag: report.releaseTag,
    packageVersion: report.packageVersion,
    generatedAt: new Date().toISOString(),
    evidenceKind: "human_assisted",
    platform: "macos+windows",
    sourceArtifacts: [{
      name: path.basename(reportPath),
      sha256: reportSha256,
    }],
    notes: [
      "Validated packaged flagship report includes signed macOS and Windows client runs.",
      "Report rejects service-only, mock/fixture-data and developer-assisted completion.",
    ],
  });
  const resolvedOutput = path.resolve(root, outputPath);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, JSON.stringify(evidence, null, 2) + "\n", "utf8");
}

process.stdout.write(JSON.stringify({
  contract: "LiOS packaged flagship release",
  releaseTag: report.releaseTag,
  packageVersion: report.packageVersion,
  commitSha: report.build.commitSha,
  platforms: report.runs.map((run) => run.platform),
  workflows: report.runs.map((run) => run.workflow),
  providerModelsRecorded: report.runs.every((run) => Boolean(run.aiProvider && run.aiModel)),
  nativeSecretCustody: report.runs.every((run) => run.nativeSecretCustody === "native_protected"),
  relaunchContinuity: report.runs.every((run) => run.desktopRelaunchCompleted && run.projectReopened && run.chatReopened && run.artifactReopened),
  revocationFailClosed: report.runs.every((run) => run.connectorOrProviderRevoked && run.revokedAccessFailsClosed),
  outputEvidence: outputPath,
}, null, 2) + "\n");
process.stdout.write("PACKAGED_FLAGSHIP_RELEASE_EVIDENCE: PASS\n");
