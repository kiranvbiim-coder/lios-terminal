"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { TARGETS, targetName, signBetaManifest, verifyBetaManifest } = require("../betaReleaseManifest.cjs");
const { splitInstaller } = require("../betaReleaseParts.cjs");
const { checkNativeSelfTest, checkNativeUX, inspectNativeEvidence, parseFlags, verifyBetaMultipartTransport } = require("./beta_release_acceptance.cjs");

const checksum = "a".repeat(64);
const BETA_VERSION = "1.0.0-beta.1";
const BETA_COMMIT = "b".repeat(40);
function packaged(platform, arch) {
  return {
    status: "verified", platform, arch, packageVersion: BETA_VERSION, sourceCommit: BETA_COMMIT,
    nativeSecretCustody: { mode: "native_protected", protectedAtRest: true, roundTripVerified: true },
    workspaceRecovery: { workspaceId: "local-workspace", persistedFileCount: 1 },
    pythonSidecar: { representativeRoute: { verified: true } },
    packagedResourceImmutability: { forbiddenPythonBytecodeBefore: 0, forbiddenPythonBytecodeAfter: 0 },
    updaterMetadataPresent: true,
    performance: {
      desktopSelfTestElapsedMs: 50,
      electronAppReadyElapsedMs: 250,
      mainProcessMemoryAtCompletion: {
        rssBytes: 128 * 1024 * 1024, heapUsedBytes: 64 * 1024 * 1024,
      },
    },
  };
}
function ui(target) {
  return {
    schema: 1, channel: "beta", target, assetSha256: checksum,
    capturedAt: "2026-10-27T09:00:00Z", osWarningDisclosure: true,
    checks: {
      signedIn: true, sourceAccess: true, briefingSavedAndReopened: true,
      artifactVersionReopened: true, offlineAndReconnect: true,
      keyboardOnly: true, screenReader: true, zoom200: true,
      reducedMotion: true, nativeSecretCustody: true,
      pulseFollowMutePersistsAfterRestart: true, sourceSearchToChatContinuity: true,
      projectGraphKeyboardPanZoom: true, offlineProjectGeography: true,
      evidenceAndContradictionReview: true, governedChatVisualsNoFakeData: true,
      reviewedModelResultSavedToP4: true, recordedConsequencePathsNoAction: true,
      briefingP4ChartAndTableEditable: true, pptxChartAndTableRoundtrip: true,
      sourceRevocationBlocksBriefingSave: true, projectSwitchKeepsSourcesIsolated: true,
      narrow390NoClippedControls: true,
      c06ExactRunSavedArtifactVersionReopened: true,
      c06SaveAcknowledgementAndP4ReceiptVerified: true,
      c07DraftInactiveUntilExplicitActivation: true,
      c08PartialActionReviewWithoutAutoRetry: true,
      d04BriefingFocusAndNativePreview: true,
      d05SystemDoctorReadOnlyPermissions: true,
    }, evidencePaths: ["screenshots/discovery.png", "screenshots/investigation.png", "screenshots/briefing.png", "screenshots/narrow.png", "logs/acceptance.txt"],
    reviewer: "Owner native QA",
  };
}

test("beta native gate accepts only target-matched actual self-test fields", () => {
  assert.deepEqual(checkNativeSelfTest(packaged("darwin", "arm64"), "darwin", "arm64", BETA_VERSION, BETA_COMMIT),
    { platform: "darwin", arch: "arm64", nativeSelfTest: true });
  assert.deepEqual(checkNativeSelfTest(packaged("win32", "x64"), "win32", "x64", BETA_VERSION, BETA_COMMIT),
    { platform: "win32", arch: "x64", nativeSelfTest: true });
  assert.throws(() => checkNativeSelfTest(packaged("darwin", "arm64"), "win32", "x64", BETA_VERSION, BETA_COMMIT), /wrong|not from this target/);
  assert.throws(() => checkNativeSelfTest({ ...packaged("darwin", "arm64"), status: "pending" }, "darwin", "arm64", BETA_VERSION, BETA_COMMIT), /not from this target/);
});

test("beta gate rejects absence of OS protected secret custody, persisted work or Python calculation", () => {
  for (const mutation of [
    { nativeSecretCustody: { mode: "development", protectedAtRest: false, roundTripVerified: false } },
    { workspaceRecovery: { workspaceId: "w", persistedFileCount: 0 } },
    { pythonSidecar: { representativeRoute: { verified: false } } },
    { packagedResourceImmutability: { forbiddenPythonBytecodeBefore: 0, forbiddenPythonBytecodeAfter: 1 } },
    { updaterMetadataPresent: false },
    { performance: {} },
  ]) {
    assert.throws(() => checkNativeSelfTest({ ...packaged("darwin", "arm64"), ...mutation }, "darwin", "arm64", BETA_VERSION, BETA_COMMIT), /BLOCKED/);
  }
});

test("beta UX requires exact signed manifest installer and every native acceptance control", () => {
  assert.equal(checkNativeUX(ui("mac-arm64-dmg"), "mac-arm64-dmg", checksum).checks, 29);
  for (const bad of [
    { assetSha256: "b".repeat(64) },
    { osWarningDisclosure: false },
    { reviewer: "" },
    { evidencePaths: [] },
    { checks: { ...ui("mac-arm64-dmg").checks, screenReader: false } },
    { checks: { ...ui("mac-arm64-dmg").checks, keyboardOnly: undefined } },
    { target: "win-x64-nsis" },
    { channel: "production" },
  ]) {
    assert.throws(() => checkNativeUX({ ...ui("mac-arm64-dmg"), ...bad }, "mac-arm64-dmg", checksum), /BLOCKED/);
  }
});

test("beta acceptance CLI never defaults missing evidence or accepts duplicate flags", () => {
  assert.throws(() => parseFlags([]), /BLOCKED/);
  const names=["manifest","asset-dir","trusted-key","commit","mac-self-test","win-self-test","mac-ux","win-ux"];
  const input=names.flatMap(name=>["--"+name,"local-"+name]);
  assert.equal(parseFlags(input)["mac-self-test"],"local-mac-self-test");
  assert.equal(parseFlags([...input,"--multipart-dir","/owner/release-parts"])["multipart-dir"],
    "/owner/release-parts");
  assert.throws(() => parseFlags([...input,"--multipart-dir"]), /BLOCKED/);
  assert.throws(() => parseFlags([...input,"--multipart-dir","/owner/parts","--extra","no"]), /BLOCKED/);
  assert.throws(() => parseFlags([...input.slice(0,-2),"--mac-self-test","other"]), /BLOCKED/);
  assert.throws(() => parseFlags([...input.slice(0,-2),"--secret-key","key"]), /BLOCKED/);
});

test("beta evidence checker reads and hashes actual screenshot and test log, never bare paths", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-beta-evidence-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const report = path.join(dir, "mac-ux.json");
  const image = path.join(dir, "screen.png");
  const log = path.join(dir, "test.log");
  fs.writeFileSync(image, Buffer.from("89504e470d0a1a0a" + "01".repeat(90), "hex"));
  fs.writeFileSync(log, "Keyboard-only Project reopening was exercised.");
  for (const name of ["investigation.png", "briefing.png", "narrow.png"])
    fs.writeFileSync(path.join(dir, name), Buffer.concat([fs.readFileSync(image), Buffer.from(name)]));
  const valid = ["screen.png", "investigation.png", "briefing.png", "narrow.png", "test.log"];
  const found = inspectNativeEvidence(report, valid);
  assert.equal(found.length, 5);
  assert.match(found[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(found[0].bytes, fs.statSync(image).size);
  assert.throws(() => inspectNativeEvidence(report, [...valid, "missing.png"]), /ENOENT/);
  assert.throws(() => inspectNativeEvidence(report, ["screen.png", "investigation.png", "briefing.png", "narrow.png", "missing.log"]), /ENOENT/);
  fs.writeFileSync(path.join(dir, "spoof.png"), "not a screenshot");
  assert.throws(() => inspectNativeEvidence(report, ["spoof.png", ...valid.slice(1)]), /BLOCKED.*PNG/);

  assert.throws(() => inspectNativeEvidence(report, ["screen.png"]), /BLOCKED/);
  assert.throws(() => inspectNativeEvidence(report, ["screen.png", "test.log"]), /BLOCKED/);
  assert.throws(() => inspectNativeEvidence(report, ["screen.png", "screen.png", "screen.png", "screen.png", "test.log"]), /BLOCKED/);
  assert.throws(() => checkNativeUX({ ...ui("mac-arm64-dmg"), evidencePaths: ["same.png", "same.png", "x.png", "y.png", "run.log"] }, "mac-arm64-dmg", checksum), /BLOCKED/);
  assert.throws(() => checkNativeUX({ ...ui("mac-arm64-dmg"), checks: { ...ui("mac-arm64-dmg").checks, pptxChartAndTableRoundtrip: false } }, "mac-arm64-dmg", checksum), /BLOCKED/);
  assert.throws(() => inspectNativeEvidence(report, ["screen.png", "../outside.log"]), /BLOCKED/);
  assert.throws(() => inspectNativeEvidence(report, ["/tmp/screen.png", "test.log"]), /BLOCKED/);
  if (process.platform !== "win32") {
    fs.symlinkSync(log, path.join(dir, "linked.log"));
    assert.throws(() => inspectNativeEvidence(report, ["screen.png", "linked.log"]), /BLOCKED/);
    fs.mkdirSync(path.join(dir, "nested"));
    fs.symlinkSync(dir, path.join(dir, "nested", "linked"));
    assert.throws(() => inspectNativeEvidence(report, ["screen.png", "nested/linked/test.log"]), /BLOCKED/);
  }
});

test("native screenshot and UX evidence may never be inferred from an unchecked path label", () => {
  assert.throws(() => inspectNativeEvidence("/missing/ux.json", ["screen.png", "test.log"]), /ENOENT/);
});

test("D08 beta evidence gate refuses a replaced file between lstat and open", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-beta-evidence-swap-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const imageHeader = Buffer.from("89504e470d0a1a0a", "hex");
  for (const [i, name] of ["discovery.png", "investigation.png", "briefing.png", "narrow.png"].entries()) {
    fs.writeFileSync(path.join(dir, name), Buffer.concat([imageHeader, Buffer.alloc(80, i + 1)]));
  }
  const log = path.join(dir, "session.log");
  const malicious = path.join(dir, "foreign.log");
  fs.writeFileSync(log, "Recorded local macOS installed walkthrough.");
  fs.writeFileSync(malicious, "Substituted file is not the inspected file.");
  const files = ["discovery.png", "investigation.png", "briefing.png", "narrow.png", "session.log"];
  const open = fs.openSync;
  let swapped = false;
  fs.openSync = function (name, flags, ...rest) {
    if (!swapped && path.resolve(String(name)) === log) {
      swapped = true;
      fs.renameSync(log, path.join(dir, "original-session.log"));
      fs.copyFileSync(malicious, log);
    }
    return open.call(this, name, flags, ...rest);
  };
  try {
    assert.throws(() => inspectNativeEvidence(path.join(dir, "mac-ux.json"), files),
      /BLOCKED.*changed/);
    assert.equal(swapped, true);
  } finally {
    fs.openSync = open;
  }
});

test("D08 $0 beta gate reuses native performance ceilings rather than finite-only timing", () => {
  const original = packaged("darwin", "arm64");
  assert.equal(checkNativeSelfTest(original, "darwin", "arm64", BETA_VERSION, BETA_COMMIT).nativeSelfTest, true);
  for (const performance of [
    { ...original.performance, desktopSelfTestElapsedMs: 60_001 },
    { ...original.performance, electronAppReadyElapsedMs: 20_001 },
    { ...original.performance, mainProcessMemoryAtCompletion: {
      ...original.performance.mainProcessMemoryAtCompletion,
      rssBytes: 1024 * 1024 * 1024 + 1,
    } },
    { ...original.performance, mainProcessMemoryAtCompletion: {
      ...original.performance.mainProcessMemoryAtCompletion,
      heapUsedBytes: 512 * 1024 * 1024 + 1,
    } },
    { ...original.performance, electronAppReadyElapsedMs: Infinity },
    { ...original.performance, mainProcessMemoryAtCompletion: undefined },
  ]) {
    assert.throws(() => checkNativeSelfTest({ ...original, performance }, "darwin", "arm64", BETA_VERSION, BETA_COMMIT),
      /BLOCKED.*performance/i);
  }
});

test("D09 beta native acceptance refuses missing source-to-installed C06/C07/C08 and D04/D05 journeys", () => {
  const target = "mac-arm64-dmg";
  const report = ui(target);
  assert.equal(checkNativeUX(report, target, checksum).checks, 29);
  for (const required of [
    "c06ExactRunSavedArtifactVersionReopened",
    "c06SaveAcknowledgementAndP4ReceiptVerified",
    "c07DraftInactiveUntilExplicitActivation",
    "c08PartialActionReviewWithoutAutoRetry",
    "d04BriefingFocusAndNativePreview",
    "d05SystemDoctorReadOnlyPermissions",
  ]) {
    const broken = { ...report, checks: { ...report.checks, [required]: false } };
    assert.throws(() => checkNativeUX(broken, target, checksum), /BLOCKED.*unverified/);
    const omitted = { ...report, checks: { ...report.checks } };
    delete omitted.checks[required];
    assert.throws(() => checkNativeUX(omitted, target, checksum), /BLOCKED.*missing or unexpected/);
  }
  assert.equal(checkNativeUX(ui("win-x64-nsis"), "win-x64-nsis", checksum).checks, 29);
});

test("D10 installed self-test cannot be replayed across signed beta versions", () => {
  const latest = packaged("darwin", "arm64");
  assert.equal(checkNativeSelfTest(latest, "darwin", "arm64", BETA_VERSION, BETA_COMMIT).nativeSelfTest, true);
  assert.throws(() => checkNativeSelfTest(latest, "darwin", "arm64", "1.0.0-beta.2"), /BLOCKED.*version/);
  assert.throws(() => checkNativeSelfTest({ ...latest, packageVersion: "1.0.0-beta.2" },
    "darwin", "arm64", BETA_VERSION, BETA_COMMIT), /BLOCKED.*version/);
  assert.throws(() => checkNativeSelfTest({ ...latest, packageVersion: undefined },
    "darwin", "arm64", BETA_VERSION, BETA_COMMIT), /BLOCKED.*version/);
  assert.throws(() => checkNativeSelfTest(latest, "darwin", "arm64"), /BLOCKED.*version/);
  assert.throws(() => checkNativeSelfTest(latest, "darwin", "arm64", "dev"), /BLOCKED.*version/);
});

test("D10 installed receipt must match reviewed source commit as well as package version", () => {
  const mac = packaged("darwin", "arm64");
  assert.equal(checkNativeSelfTest(mac, "darwin", "arm64", BETA_VERSION, BETA_COMMIT).nativeSelfTest, true);
  assert.throws(() => checkNativeSelfTest(mac, "darwin", "arm64", BETA_VERSION, "c".repeat(40)), /BLOCKED.*source commit/);
  assert.throws(() => checkNativeSelfTest({ ...mac, sourceCommit: "c".repeat(40) },
    "darwin", "arm64", BETA_VERSION, BETA_COMMIT), /BLOCKED.*source commit/);
  assert.throws(() => checkNativeSelfTest({ ...mac, sourceCommit: null },
    "darwin", "arm64", BETA_VERSION, BETA_COMMIT), /BLOCKED.*source commit/);
  assert.throws(() => checkNativeSelfTest(mac, "darwin", "arm64", BETA_VERSION),
    /BLOCKED.*source commit/);
  assert.equal(checkNativeSelfTest(packaged("win32", "x64"), "win32", "x64", BETA_VERSION, BETA_COMMIT).nativeSelfTest, true);
});

test("D10 signed root to multipart acceptance checks real two-Mac installer bytes, not only separate helpers", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-beta-full-part-gate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const assets = path.join(root, "local-assembled");
  const parts = path.join(root, "owner-parts");
  fs.mkdirSync(assets);
  fs.mkdirSync(parts);
  const version = "1.0.0-beta.2";
  const commit = "f".repeat(40);
  const keys = crypto.generateKeyPairSync("ed25519");
  const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" });
  const trustedPublicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" });
  const expectedSizes = [513, 425, 150];
  for (const [i, target] of TARGETS.entries()) {
    fs.writeFileSync(path.join(assets, targetName(version, target)),
      crypto.randomBytes(expectedSizes[i]));
  }
  const manifest = await signBetaManifest({
    version, commit, assetDir: assets, privateKeyPem: privateKey,
  });
  const verified = await verifyBetaManifest({
    manifest, assetDir: assets, trustedPublicKeyPem, expectedCommit: commit,
  });
  assert.deepEqual(verified.assetHashes.map(item => item.bytes), expectedSizes);
  for (const target of ["mac-arm64-dmg", "mac-arm64-zip"]) {
    const name = targetName(version, target);
    const index = await splitInstaller({
      file: path.join(assets, name), outputDir: parts, privateKey, partBytes: 200,
    });
    fs.writeFileSync(path.join(parts, name + ".parts.json"),
      JSON.stringify(index), { flag: "wx" });
  }
  const args = { verified, multipartDir: parts, trustedPublicKey: trustedPublicKeyPem,
    maxDirectBytes: 300 };
  const accepted = await verifyBetaMultipartTransport(args);
  assert.deepEqual(accepted.map(item => item.target), ["mac-arm64-dmg", "mac-arm64-zip"]);
  assert.deepEqual(accepted.map(item => item.partCount), [3, 3]);
  assert.ok(accepted.every(item => item.verified === true && item.sha256.length === 64));
  assert.equal(fs.readdirSync(parts).length, 8);
  await assert.rejects(verifyBetaMultipartTransport({ ...args, multipartDir: null }),
    /BLOCKED.*multipart directory/);
  await assert.rejects(verifyBetaMultipartTransport({
    ...args, trustedPublicKey: crypto.generateKeyPairSync("ed25519").publicKey
      .export({ type: "spki", format: "pem" }),
  }), /Untrusted multipart manifest/);
  // Signed transport is also bound to the signed ROOT's installer identity.
  const dmg = targetName(version, "mac-arm64-dmg");
  const indexFile = path.join(parts, dmg + ".parts.json");
  const originalIndex = fs.readFileSync(indexFile);
  const other = path.join(assets, "different-mac-installer.dmg");
  fs.writeFileSync(other, crypto.randomBytes(513));
  const foreign = await splitInstaller({
    file: other, outputDir: parts, privateKey, partBytes: 200,
  });
  fs.writeFileSync(indexFile, JSON.stringify(foreign));
  await assert.rejects(verifyBetaMultipartTransport(args),
    /BLOCKED.*does not match the exact reviewed installer/);
  fs.writeFileSync(indexFile, originalIndex);
  const part = path.join(parts, dmg + ".part001");
  const original = fs.readFileSync(part);
  fs.writeFileSync(part, Buffer.alloc(original.length, 0xaa));
  await assert.rejects(verifyBetaMultipartTransport(args), /integrity mismatch/);
  fs.writeFileSync(part, original);
  assert.equal((await verifyBetaMultipartTransport(args)).length, 2);
  await assert.rejects(verifyBetaMultipartTransport({ ...args, maxDirectBytes: 0 }),
    /BLOCKED.*authenticated beta root/);
  await assert.rejects(verifyBetaMultipartTransport({ ...args, maxDirectBytes: 2_000_000_001 }),
    /BLOCKED.*authenticated beta root/);
  assert.deepEqual(await verifyBetaMultipartTransport({
    ...args, maxDirectBytes: 600, multipartDir: null,
  }), []);
  await assert.rejects(verifyBetaMultipartTransport({
    ...args, maxDirectBytes: 600,
  }), /BLOCKED.*multipart directory/);
});
