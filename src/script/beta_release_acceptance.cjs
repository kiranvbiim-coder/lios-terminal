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
const { verifyBetaManifest } = require("../betaReleaseManifest.cjs");

const FIELDS = Object.freeze([
  "manifest", "asset-dir", "trusted-key", "commit",
  "mac-self-test", "win-self-test", "mac-ux", "win-ux",
]);
const UX_CHECKS = Object.freeze([
  "signedIn", "sourceAccess", "briefingSavedAndReopened",
  "artifactVersionReopened", "offlineAndReconnect", "keyboardOnly",
  "screenReader", "zoom200", "reducedMotion", "nativeSecretCustody",
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
  assert(Number.isFinite(value.performance?.desktopSelfTestElapsedMs) &&
    value.performance.desktopSelfTestElapsedMs >= 0, platform + " self-test timing missing.");
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
  assert(Array.isArray(value.evidencePaths) && value.evidencePaths.length >= 2 &&
    value.evidencePaths.length <= 40 &&
    value.evidencePaths.every(item => typeof item === "string" && item.trim().length > 0 && item.length <= 1000),
    target + " actual test evidence paths have not been recorded.");
  return { target, checks: UX_CHECKS.length, evidenceEntries: value.evidencePaths.length };
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
  const stat = fs.lstatSync(absolute);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size < 2_000_000,
    "evidence file must be a small regular non-symlink file.");
  return JSON.parse(fs.readFileSync(absolute, "utf8"));
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
module.exports = { checkNativeSelfTest, checkNativeUX, parseFlags, auditBetaRelease };
