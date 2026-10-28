"use strict";

/**
 * Owner-operated, read-only $0 BETA readiness check. This is NOT P14 production
 * qualification and JSON evidence does not replace human native acceptance.
 *
 * Example:
 * node script/beta_release_acceptance.cjs --manifest /release/beta-manifest.json
 *   --asset-dir /release --trusted-key /outside-repo/trusted-public.pem
 *   --commit <40-hex> --mac-self-test /evidence/mac.json
 *   --win-self-test /evidence/windows.json --mac-ux /evidence/mac-ux.json
 *   --win-ux /evidence/win-ux.json
 *
 * No signing key, publishing, auto-updater, download, installation or network call.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { verifyBetaManifest } = require("../betaReleaseManifest.cjs");
const { evaluateP14PackagedPerformance } = require("../p14PerformanceBudget.cjs");

const FIELDS = Object.freeze([
  "manifest", "asset-dir", "trusted-key", "commit",
  "mac-self-test", "win-self-test", "mac-ux", "win-ux",
]);
const UX_CHECKS = Object.freeze([
  "signedIn", "sourceAccess", "briefingSavedAndReopened",
  "artifactVersionReopened", "offlineAndReconnect", "keyboardOnly",
  "screenReader", "zoom200", "reducedMotion", "nativeSecretCustody",
  // Website assimilation A–D native journeys. Source CI can NEVER set these.
  "pulseFollowMutePersistsAfterRestart", "sourceSearchToChatContinuity",
  "projectGraphKeyboardPanZoom", "offlineProjectGeography",
  "evidenceAndContradictionReview", "governedChatVisualsNoFakeData",
  "reviewedModelResultSavedToP4", "recordedConsequencePathsNoAction",
  "briefingP4ChartAndTableEditable", "pptxChartAndTableRoundtrip",
  "sourceRevocationBlocksBriefingSave", "projectSwitchKeepsSourcesIsolated",
  "narrow390NoClippedControls",
  // New C06–C08 and D04–D06 paths on the consolidated product must be
  // exercised on the actual installed beta; source CI cannot supply proof.
  "c06ExactRunSavedArtifactVersionReopened",
  "c06SaveAcknowledgementAndP4ReceiptVerified",
  "c07DraftInactiveUntilExplicitActivation",
  "c08PartialActionReviewWithoutAutoRetry",
  "d04BriefingFocusAndNativePreview",
  "d05SystemDoctorReadOnlyPermissions",
]);
function assert(condition, message) {
  if (!condition) throw new Error("LiOS beta gate BLOCKED: " + message);
}
function keysExactly(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), label + " is not an object.");
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys.slice().sort()), label + " has missing or unexpected fields.");
}
function checkNativeSelfTest(value, platform, arch) {
  assert(value && typeof value === "object", platform + " packaged self-test missing.");
  assert(value.status === "verified" && value.platform === platform && value.arch === arch, platform + " packaged self-test is not from this target.");
  assert(value.nativeSecretCustody?.mode === "native_protected" &&
    value.nativeSecretCustody?.protectedAtRest === true &&
    value.nativeSecretCustody?.roundTripVerified === true,
    platform + " OS secret custody was not proven.");
  assert(typeof value.workspaceRecovery?.workspaceId === "string" &&
    value.workspaceRecovery.workspaceId.length > 0 &&
    Number.isInteger(value.workspaceRecovery.persistedFileCount) &&
    value.workspaceRecovery.persistedFileCount > 0,
    platform + " workspace reopening was not proven.");
  assert(value.pythonSidecar?.representativeRoute?.verified === true,
    platform + " Python sidecar calculation was not proven.");
  assert(value.packagedResourceImmutability?.forbiddenPythonBytecodeBefore === 0 &&
    value.packagedResourceImmutability?.forbiddenPythonBytecodeAfter === 0,
    platform + " packaged Python resources were modified.");
  assert(value.updaterMetadataPresent === true, platform + " beta package updater metadata not checked.");
  // Reuse the already qualified native safety ceilings; a finite but
  // multi-minute cold start or excessive RSS must not pass the $0 beta gate.
  // This does not imply the separate P14 signed-production qualification.
  const budget = evaluateP14PackagedPerformance(value.performance);
  assert(budget.ok, platform + " packaged performance violates existing P14 safety limits: " +
    budget.errors.join(" "));
  return { platform, arch, nativeSelfTest: true };
}
function checkNativeUX(value, target, expectedHash) {
  keysExactly(value, ["schema", "channel", "target", "assetSha256", "capturedAt", "osWarningDisclosure", "checks", "evidencePaths", "reviewer"], target + " native UX report");
  assert(value.schema === 1 && value.channel === "beta" && value.target === target,
    target + " acceptance report has wrong version/channel/target.");
  assert(typeof value.assetSha256 === "string" && value.assetSha256 === expectedHash,
    target + " acceptance did not inspect exact manifest installer bytes.");
  assert(typeof value.capturedAt === "string" && Number.isFinite(Date.parse(value.capturedAt)),
    target + " native test date missing.");
  assert(value.osWarningDisclosure === true,
    target + " unsigned/notarization warning has not been disclosed.");
  assert(typeof value.reviewer === "string" && value.reviewer.trim().length >= 3 &&
    value.reviewer.length <= 200, target + " reviewer identity missing.");
  keysExactly(value.checks, UX_CHECKS, target + " UX checks");
  for (const check of UX_CHECKS) assert(value.checks[check] === true, target + " acceptance is unverified: " + check);
  assert(Array.isArray(value.evidencePaths) && value.evidencePaths.length >= 5 &&
    value.evidencePaths.length <= 40 &&
    value.evidencePaths.every(item => typeof item === "string" && item.trim().length > 0 && item.length <= 1000),
    target + " actual test evidence paths have not been recorded.");
  assert(new Set(value.evidencePaths).size === value.evidencePaths.length,
    target + " repeated evidence filenames cannot prove distinct native captures.");
  return { target, checks: UX_CHECKS.length, evidenceEntries: value.evidencePaths.length };
}
/** Read the same inode whose local-file identity was checked. A prior lstat
 * followed by readFileSync(path) could consume a substituted symlink; this
 * follows the existing WS-65 fd-pinned acceptance pattern. Even on Windows,
 * where O_NOFOLLOW may be unavailable, both pre-open and post-open identities
 * must remain a nonlinked regular file. This is local proof inspection only.
 */
function readPinnedLocalEvidenceFile(file, maxBytes, label) {
  const initial = fs.lstatSync(file);
  assert(initial.isFile() && !initial.isSymbolicLink() &&
    initial.size > 0 && initial.size <= maxBytes,
    label + " must be a nonempty, bounded, nonlinked regular file.");
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch {
    throw new Error("LiOS beta gate BLOCKED: " + label + " changed or cannot be opened safely.");
  }
  try {
    const opened = fs.fstatSync(fd);
    assert(opened.isFile() && opened.size > 0 && opened.size <= maxBytes &&
      initial.dev === opened.dev && initial.ino === opened.ino,
      label + " changed between file check and open.");
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    const current = fs.lstatSync(file);
    assert(bytes.length === opened.size &&
      opened.dev === after.dev && opened.ino === after.ino &&
      opened.size === after.size && opened.mtimeMs === after.mtimeMs &&
      opened.ctimeMs === after.ctimeMs &&
      current.isFile() && !current.isSymbolicLink() &&
      current.dev === opened.dev && current.ino === opened.ino &&
      current.size === opened.size,
      label + " changed while it was being inspected.");
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

/** Verify real captured files, not mere user-typed path claims. Non-symlink files
 * must be inside the report's own directory and under the 30 MB evidence cap.
 * Hashes are returned for review, never treated as cryptographic attestations. */
function inspectNativeEvidence(uxFile, evidencePaths) {
  const ownerDir = path.dirname(path.resolve(uxFile));
  const evidence = [];
  for (const ref of evidencePaths) {
    const name = String(ref || "");
    assert(name.length > 0 && name.length < 1000 && !path.isAbsolute(name),
      "native evidence paths must be relative to the local UX report directory.");
    const full = path.resolve(ownerDir, name);
    assert(full.startsWith(ownerDir + path.sep), "native evidence path escapes owner report directory.");
    const relativeParts = path.relative(ownerDir, full).split(path.sep);
    let folder = ownerDir;
    for (const part of relativeParts.slice(0, -1)) {
      folder = path.join(folder, part);
      const dir = fs.lstatSync(folder);
      assert(dir.isDirectory() && !dir.isSymbolicLink(), "native evidence parent must be an actual local directory.");
    }
    const bytes = readPinnedLocalEvidenceFile(full, 30_000_000, "native evidence");
    const extension = path.extname(name).toLowerCase();
    const png = bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
    const jpg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const webp = bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    if (extension === ".png") assert(png, "native screenshot file lacks a valid PNG signature.");
    if (extension === ".jpg" || extension === ".jpeg") assert(jpg, "native screenshot file lacks a valid JPEG signature.");
    if (extension === ".webp") assert(webp, "native screenshot file lacks a valid WebP signature.");
    evidence.push({ path: name, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
  }
  assert(evidence.some(row => /\.(png|jpg|jpeg|webp)$/i.test(row.path)) &&
    evidence.some(row => /\.(txt|log|json)$/i.test(row.path)),
    "native acceptance requires an actual screenshot and an actual test log/report.");
  const images = evidence.filter(row => /\.(png|jpg|jpeg|webp)$/i.test(row.path));
  assert(images.length >= 4 && new Set(images.map(row => row.sha256)).size >= 4,
    "D2 native acceptance needs four different screenshot files for discovery, investigation, briefing/Office and narrow viewport.");
  assert(evidence.some(row => /\.(txt|log|json)$/i.test(row.path)), "D2 native acceptance needs a real session log.");
  return evidence;
}
function parseFlags(argv) {
  assert(argv.length === FIELDS.length * 2, "all eight evidence paths and source commit are required.");
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    assert(typeof key === "string" && key.startsWith("--") && typeof value === "string" && !value.startsWith("--"), "invalid flag pair.");
    const name = key.slice(2);
    assert(FIELDS.includes(name) && !(name in out), "unknown or duplicate flag.");
    out[name] = value;
  }
  assert(FIELDS.every(key => out[key]), "required evidence missing.");
  return out;
}
function readJson(file) {
  const absolute = path.resolve(file);
  return JSON.parse(readPinnedLocalEvidenceFile(absolute, 1_999_999, "evidence JSON").toString("utf8"));
}
async function auditBetaRelease(args) {
  const fields = parseFlags(args);
  const verified = await verifyBetaManifest({
    manifest: readJson(fields.manifest),
    assetDir: fields["asset-dir"],
    trustedPublicKeyPem: fs.readFileSync(fields["trusted-key"], "utf8"),
    expectedCommit: fields.commit,
  });
  assert(verified.verified === true && verified.qualification === "release_asset_integrity_only" &&
    verified.productionCodeSigning === false && verified.macNotarized === false,
    "expected independently verified lower-trust beta assets.");
  const byName = new Map(verified.assetHashes.map(row => [row.name, row.sha256]));
  const mac = verified.assetHashes.find(row => row.name.includes("-mac-arm64-beta.dmg"));
  const win = verified.assetHashes.find(row => row.name.includes("-win-x64-beta.exe"));
  assert(mac && win && byName.size === 3, "canonical DMG, ZIP and NSIS installers are required.");
  const selfTests = [
    checkNativeSelfTest(readJson(fields["mac-self-test"]), "darwin", "arm64"),
    checkNativeSelfTest(readJson(fields["win-self-test"]), "win32", "x64"),
  ];
  const ux = [
    checkNativeUX(readJson(fields["mac-ux"]), "mac-arm64-dmg", mac.sha256),
    checkNativeUX(readJson(fields["win-ux"]), "win-x64-nsis", win.sha256),
  ];
  ux[0].actualEvidence = inspectNativeEvidence(fields["mac-ux"], readJson(fields["mac-ux"]).evidencePaths);
  ux[1].actualEvidence = inspectNativeEvidence(fields["win-ux"], readJson(fields["win-ux"]).evidencePaths);
  return {
    evidenceChecksPassed: true,
    releasePublished: false,
    productionQualified: false,
    independentHumanAcceptanceStillRequired: true,
    channel: "beta", sourceCommit: verified.commit, checkedAssets: verified.assetCount,
    nativeSelfTests: selfTests, ux,
    qualification: "local_beta_evidence_gate_only",
  };
}
async function main(argv) {
  const result = await auditBetaRelease(argv);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
if (require.main === module) {
  main(process.argv.slice(2)).catch(() => {
    console.error("LiOS $0 beta acceptance BLOCKED: signed asset, independent key, exact native test or UX evidence is missing/invalid.");
    process.exitCode = 1;
  });
}
module.exports = { checkNativeSelfTest, checkNativeUX, inspectNativeEvidence, parseFlags, auditBetaRelease };
