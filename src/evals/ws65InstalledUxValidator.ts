import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { flagshipReleaseReportSchema } from "../shared/flagshipReleaseEvidence";
import {
  P14_RELEASE_EVIDENCE_CATEGORIES, assertP14QualificationBoardComplete,
  buildP14QualificationBoard, p14ReleaseEvidenceSchema,
} from "../shared/p14ReleaseEvidence";
import { WS65_PLATFORMS, ws65InstalledUxReleaseReportSchema } from "./ws65InstalledUxEvidence";

export interface WS65ValidationPaths {
  report: string;
  evidenceDir: string;
  flagshipReport: string;
  p14EvidenceDir: string;
  ownerSignoffFile: string;
  expectedReleaseTag: string;
  expectedCommit: string;
  expectedPackageVersion: string;
}
function evidencePath(name: string): string {
  let resolved = path.resolve(name);
  // Normalize only the standard macOS aliases, not arbitrary evidence links.
  if (process.platform === "darwin") {
    for (const alias of ["/tmp", "/var", "/etc"]) {
      if (resolved === alias || resolved.startsWith(alias + "/")) { resolved = "/private" + resolved; break; }
    }
  }
  let current = path.parse(resolved).root;
  for (const part of path.relative(current, path.dirname(resolved)).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = fs.lstatSync(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Evidence parent must be a nonlinked directory: ${current}`);
  }
  return resolved;
}
function openEvidence(name: string): number {
  const fd = fs.openSync(evidencePath(name), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  const info = fs.fstatSync(fd);
  if (!info.isFile() || info.size <= 0) {
    fs.closeSync(fd);
    throw new Error(`Evidence is not a nonempty regular file: ${name}`);
  }
  return fd;
}
function exactFile(name: string): Buffer {
  const fd = openEvidence(name);
  try {
    if (fs.fstatSync(fd).size > 16 * 1024 * 1024) throw new Error("Evidence JSON exceeds the metadata limit.");
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
function sha256(file: string): string {
  const fd = openEvidence(file);
  try {
    const before = fs.fstatSync(fd);
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let size;
    while ((size = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, size));
    const after = fs.fstatSync(fd);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("Evidence changed while hashing.");
    return hash.digest("hex");
  } finally { fs.closeSync(fd); }
}
function readJson(file: string): unknown {
  return JSON.parse(exactFile(file).toString("utf8")) as unknown;
}

/**
 * Fail closed: this only validates provenance-bound supplied observations.
 * It does not run VoiceOver/Narrator or observe a real packaged desktop.
 * Both OS witnesses AND the already-existing P14 authority must be complete.
 */
export function validateWS65ReleaseBundle(paths: WS65ValidationPaths) {
  const report = ws65InstalledUxReleaseReportSchema.parse(readJson(paths.report));
  if (report.releaseTag !== paths.expectedReleaseTag
    || report.packageVersion !== paths.expectedPackageVersion
    || report.build.commitSha !== paths.expectedCommit.toLowerCase()) {
    throw new Error("WS-65 installed UX report is not bound to this exact release, package and commit.");
  }
  if (sha256(paths.ownerSignoffFile) !== report.releaseOwner.signoffEvidenceSha256) {
    throw new Error("Owner sign-off file missing or does not match recorded SHA256.");
  }
  const artifactHashes: Array<{ platform: string; name: string; sha256: string }> = [];
  for (const platform of WS65_PLATFORMS) {
    const run = report.runs.find((item) => item.platform === platform);
    if (!run) throw new Error("Missing installed UX run for " + platform);
    for (const [filename, expected, role] of [
      [run.installerName, run.installerSha256, "signed installer"],
      [run.installedAppName, run.installedAppSha256, "installed executable"],
    ] as const) {
      if (sha256(path.resolve(paths.evidenceDir, platform, filename)) !== expected) {
        throw new Error(`WS-65 ${platform} ${role} bytes do not match the recorded package digest.`);
      }
    }
    for (const artifact of run.evidence) {
      const evidencePath = path.resolve(paths.evidenceDir, platform, artifact.name);
      const computed = sha256(evidencePath);
      if (computed !== artifact.sha256) throw new Error(`WS-65 evidence hash mismatch: ${platform}/${artifact.name}`);
      artifactHashes.push({ platform, name: artifact.name, sha256: computed });
    }
  }
  const flagship = flagshipReleaseReportSchema.parse(readJson(paths.flagshipReport));
  if (flagship.releaseTag !== report.releaseTag || flagship.packageVersion !== report.packageVersion
    || flagship.build.commitSha !== report.build.commitSha) {
    throw new Error("Canonical P14 flagship report is not bound to the WS-65 release and exact commit.");
  }
  const typedP14 = fs.readdirSync(paths.p14EvidenceDir)
    .filter((name) => /^p14-[a-z0-9-]+-evidence\.json$/.test(name))
    .sort().map((name) => p14ReleaseEvidenceSchema.parse(readJson(path.join(paths.p14EvidenceDir, name))));
  const board = buildP14QualificationBoard({
    evidence: typedP14,
    expectedReleaseTag: report.releaseTag,
    expectedPackageVersion: report.packageVersion,
  });
  assertP14QualificationBoardComplete(board);
  const flagshipRecord = typedP14.find((item) => item.category === "flagship");
  const flagshipSha = sha256(paths.flagshipReport);
  if (!flagshipRecord?.sourceArtifacts.some((item) => item.sha256 === flagshipSha)) {
    throw new Error("P14 flagship category is not cryptographically bound to the canonical flagship report.");
  }
  if (board.evidenceCategories.present.length !== P14_RELEASE_EVIDENCE_CATEGORIES.length) {
    throw new Error("P14 canonical qualification still has missing evidence categories.");
  }
  return {
    status: "WS65_SUPPLIED_EVIDENCE_VALIDATED",
    releaseTag: report.releaseTag,
    commitSha: report.build.commitSha,
    platformCount: report.runs.length,
    scenarioRuns: report.runs.reduce((n, item) => n + item.scenarioRuns.length, 0),
    hashedArtifactsChecked: artifactHashes.length,
    p14CategoriesChecked: board.evidenceCategories.present.length,
    p14TaskCount: board.tasks.length,
    flagshipSha256: flagshipSha,
    reportSha256: sha256(paths.report),
    // A typed, hashed claim cannot prove whether a human really ran a device;
    // physical installation and owner authority still require independent audit.
    physicalObservationIndependentlyVerified: false,
  };
}