"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  TARGETS, targetName, validateBody, signBetaManifest, verifyBetaManifest,
} = require("./betaReleaseManifest.cjs");
const { options } = require("./script/beta_release_manifest.cjs");

const version = "1.0.0-beta.2";
const commit = "c".repeat(40);
const sampleBytes = Buffer.from("LiOS offline fixture - test artifact, never a real installer");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-beta-manifest-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const target of TARGETS) fs.writeFileSync(path.join(dir, targetName(version, target)), sampleBytes);
  const keys = crypto.generateKeyPairSync("ed25519");
  return {
    dir,
    privateKeyPem: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    trustedPublicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}
async function signed(t) {
  const f = fixture(t);
  const manifest = await signBetaManifest({ ...f, assetDir: f.dir, version, commit });
  return { ...f, manifest };
}
test("SI07 $0 beta manifest signs and verifies the exact three local installer artifacts", async t => {
  const f = await signed(t);
  assert.deepEqual(f.manifest.assets.map(item => item.target), TARGETS);
  assert.equal(f.manifest.signature.algorithm, "Ed25519");
  assert.equal(f.manifest.signature.publicKeyFingerprint.length, 64);
  const result = await verifyBetaManifest({
    manifest: f.manifest, assetDir: f.dir,
    trustedPublicKeyPem: f.trustedPublicKeyPem,
    expectedCommit: commit, currentVersion: "1.0.0-beta.1",
  });
  assert.equal(result.verified, true);
  assert.equal(result.assetCount, 3);
  assert.equal(result.qualification, "release_asset_integrity_only");
  assert.equal(result.installApproved, false);
  assert.equal(result.macNotarized, false);
  assert.equal(result.productionCodeSigning, false);
});
test("SI07 manifest rejects changed bytes, wrong key and altered signature metadata", async t => {
  const f = await signed(t);
  fs.appendFileSync(path.join(f.dir, targetName(version, "win-x64-nsis")), "tampered");
  await assert.rejects(verifyBetaManifest({
    manifest: f.manifest, assetDir: f.dir, trustedPublicKeyPem: f.trustedPublicKeyPem,
  }), /integrity mismatch/);
  fs.writeFileSync(path.join(f.dir, targetName(version, "win-x64-nsis")), sampleBytes);
  const other = crypto.generateKeyPairSync("ed25519");
  await assert.rejects(verifyBetaManifest({
    manifest: f.manifest, assetDir: f.dir,
    trustedPublicKeyPem: other.publicKey.export({ type: "spki", format: "pem" }).toString(),
  }), /independently trusted public key/);
  await assert.rejects(verifyBetaManifest({
    manifest: { ...f.manifest, commit: "a".repeat(40) }, assetDir: f.dir,
    trustedPublicKeyPem: f.trustedPublicKeyPem,
  }), /signature failed/);
});
test("SI07 manifest refuses unsupported/replayed/downgraded releases and spoofed target paths", async t => {
  const f = await signed(t);
  for (const currentVersion of [version, "1.0.0-beta.3", "1.0.1-beta.1"]) {
    await assert.rejects(verifyBetaManifest({
      manifest: f.manifest, assetDir: f.dir,
      trustedPublicKeyPem: f.trustedPublicKeyPem,
      currentVersion,
    }), /downgrade and replay refused/);
  }
  await assert.rejects(verifyBetaManifest({
    manifest: f.manifest, assetDir: f.dir,
    trustedPublicKeyPem: f.trustedPublicKeyPem, expectedCommit: "a".repeat(40),
  }), /reviewed SHA/);
  assert.throws(() => validateBody({
    ...f.manifest,
    assets: [{ ...f.manifest.assets[0], name: "../fake.dmg" }, ...f.manifest.assets.slice(1)],
    signature: undefined,
  }), /unrecognized fields/);
  const { signature, ...body } = f.manifest;
  assert.throws(() => validateBody({
    ...body,
    assets: [{ ...body.assets[0], name: "../fake.dmg" }, ...body.assets.slice(1)],
  }), /asset filename/);
  assert.throws(() => validateBody({
    ...body,
    assets: [{ ...body.assets[0], bytes: 2_000_000_001 }, ...body.assets.slice(1)],
  }), /size invalid/);
  assert.throws(() => validateBody({
    ...body, assets: [body.assets[0], body.assets[0], body.assets[2]],
  }), /duplicate asset/);
  assert.throws(() => validateBody({
    ...body, channel: "production",
  }), /schema 1 beta/);
});
test("SI07 beta signing fails closed when assets are absent, symlinked or more than the free asset limit", async t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.dir, targetName(version, "win-x64-nsis")));
  await assert.rejects(signBetaManifest({ ...f, assetDir: f.dir, version, commit }), /ENOENT/);
  if (process.platform !== "win32") {
    fs.symlinkSync(path.join(f.dir, targetName(version, "mac-arm64-dmg")),
      path.join(f.dir, targetName(version, "win-x64-nsis")));
    await assert.rejects(signBetaManifest({ ...f, assetDir: f.dir, version, commit }), /non-symlink/);
    fs.unlinkSync(path.join(f.dir, targetName(version, "win-x64-nsis")));
  }
  const file = path.join(f.dir, targetName(version, "win-x64-nsis"));
  fs.writeFileSync(file, sampleBytes);
  fs.truncateSync(file, 2_000_000_001);
  await assert.rejects(signBetaManifest({ ...f, assetDir: f.dir, version, commit }), /free release size limit/);
});
test("SI07 release CLI refuses duplicate flags and has no implicit trust anchor", () => {
  assert.deepEqual(options(["--version", version, "--commit", commit]), { version, commit });
  assert.throws(() => options(["--version", version, "--version", version]), /Duplicate flag/);
  assert.throws(() => options(["--private-key", "--out"]), /Invalid beta release flag/);
  const source = fs.readFileSync(new URL("./script/beta_release_manifest.cjs", "file://" + __filename), "utf8");
  assert.match(source, /trusted-public-key/);
  assert.match(source, /outside the public repository/);
  assert.doesNotMatch(source, /autoDownload\s*=\s*true|quitAndInstall\(/);
});
