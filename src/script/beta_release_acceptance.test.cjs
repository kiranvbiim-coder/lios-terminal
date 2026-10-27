"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkNativeSelfTest, checkNativeUX, parseFlags } = require("./beta_release_acceptance.cjs");

const checksum = "a".repeat(64);
function packaged(platform, arch) {
  return {
    status: "verified", platform, arch,
    nativeSecretCustody: { mode: "native_protected", protectedAtRest: true, roundTripVerified: true },
    workspaceRecovery: { workspaceId: "local-workspace", persistedFileCount: 1 },
    pythonSidecar: { representativeRoute: { verified: true } },
    packagedResourceImmutability: { forbiddenPythonBytecodeBefore: 0, forbiddenPythonBytecodeAfter: 0 },
    updaterMetadataPresent: true,
    performance: { desktopSelfTestElapsedMs: 50 },
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
    }, evidencePaths: ["screenshots/desktop.png", "logs/acceptance.txt"],
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
  assert.equal(checkNativeUX(ui("mac-arm64-dmg"), "mac-arm64-dmg", checksum).checks, 10);
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
