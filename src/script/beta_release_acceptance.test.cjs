"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { checkNativeSelfTest, checkNativeUX, inspectNativeEvidence, parseFlags } = require("./beta_release_acceptance.cjs");

const checksum = "a".repeat(64);
function packaged(platform, arch) {
  return {
    status: "verified", platform, arch,
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
    }, evidencePaths: ["screenshots/discovery.png", "screenshots/investigation.png", "screenshots/briefing.png", "screenshots/narrow.png", "logs/acceptance.txt"],
    reviewer: "Owner native QA",
  };
}

test("beta native gate accepts only target-matched actual self-test fields", () => {
  assert.deepEqual(checkNativeSelfTest(packaged("darwin", "arm64"), "darwin", "arm64"),
    { platform: "darwin", arch: "arm64", nativeSelfTest: true });
  assert.deepEqual(checkNativeSelfTest(packaged("win32", "x64"), "win32", "x64"),
    { platform: "win32", arch: "x64", nativeSelfTest: true });
  assert.throws(() => checkNativeSelfTest(packaged("darwin", "arm64"), "win32", "x64"), /wrong|not from this target/);
  assert.throws(() => checkNativeSelfTest({ ...packaged("darwin", "arm64"), status: "pending" }, "darwin", "arm64"), /not from this target/);
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
    assert.throws(() => checkNativeSelfTest({ ...packaged("darwin", "arm64"), ...mutation }, "darwin", "arm64"), /BLOCKED/);
  }
});

test("beta UX requires exact signed manifest installer and every native acceptance control", () => {
  assert.equal(checkNativeUX(ui("mac-arm64-dmg"), "mac-arm64-dmg", checksum).checks, 23);
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
  assert.equal(checkNativeSelfTest(original, "darwin", "arm64").nativeSelfTest, true);
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
    assert.throws(() => checkNativeSelfTest({ ...original, performance }, "darwin", "arm64"),
      /BLOCKED.*performance/i);
  }
});
