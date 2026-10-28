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
const { options, main } = require("./script/beta_release_manifest.cjs");

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
  assert.deepEqual(result.multipartRequiredTargets, []);
  assert.equal(result.assetHashes[0].target, "mac-arm64-dmg");
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
  }));
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
test("SI07 release CLI refuses duplicate and missing flag values", () => {
  assert.deepEqual(options(["--version", version, "--commit", commit]), { version, commit });
  assert.throws(() => options(["--version", version, "--version", version]), /Duplicate flag/);
  assert.throws(() => options(["--private-key", "--out"]), /Invalid beta release flag/);
});


test("SI07 owner CLI signs only with off-repo key and verifies with independent public key", async t => {
  const f = fixture(t);
  const privatePath = path.join(f.dir, "owner-private.pem");
  const publicPath = path.join(f.dir, "independently-trusted-public.pem");
  const output = path.join(f.dir, "beta-manifest.json");
  fs.writeFileSync(privatePath, f.privateKeyPem, { mode: 0o600 });
  fs.writeFileSync(publicPath, f.trustedPublicKeyPem);
  await main(["sign", "--version", version, "--commit", commit,
    "--assets-dir", f.dir, "--private-key", privatePath, "--out", output]);
  assert.equal(fs.existsSync(output), true);
  await assert.rejects(main(["sign", "--version", version, "--commit", commit,
    "--assets-dir", f.dir, "--private-key", privatePath, "--out", output]), /overwrite/);
  const bytes = fs.readFileSync(output, "utf8");
  assert.equal(bytes.includes("PRIVATE KEY"), false);
  await main(["verify", "--manifest", output, "--assets-dir", f.dir,
    "--trusted-public-key", publicPath, "--commit", commit, "--current-version", "1.0.0-beta.1"]);
  await assert.rejects(main(["verify", "--manifest", output, "--assets-dir", f.dir,
    "--trusted-public-key", publicPath, "--commit", commit, "--current-version", version]), /replay/);
});

test("SI07 beta release version rejects unsafe huge integers, ambiguous zeros, and production versions", async t => {
  const f = fixture(t);
  for (const bad of ["1.0.0", "1.0.0-beta.0", "01.0.0-beta.1",
    "1.0.0-beta.9007199254740993", "1.0.0-beta.1+unsigned"]) {
    await assert.rejects(signBetaManifest({
      ...f, assetDir: f.dir, version: bad, commit,
    }), /version|integer/);
  }
});

test("SI07 signing refuses repository-resident material through external directory aliases", async t => {
  const f = fixture(t);
  const repository = fs.mkdtempSync(path.join(__dirname, ".beta-key-custody-test-"));
  t.after(() => fs.rmSync(repository, { recursive: true, force: true }));
  // Non-secret sentinel: rejection must happen before any signing-key parsing.
  fs.writeFileSync(path.join(repository, "not-a-key.txt"), "NON_SECRET_CUSTODY_SENTINEL");
  const alias = path.join(f.dir, "repository-alias");
  fs.symlinkSync(repository, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(main(["sign", "--version", version, "--commit", commit,
    "--assets-dir", f.dir, "--private-key", path.join(alias, "not-a-key.txt"),
    "--out", path.join(f.dir, "must-not-exist.json")]), /outside the public repository/);
  assert.equal(fs.existsSync(path.join(f.dir, "must-not-exist.json")), false);
  const casedKey = path.join(repository, "not-a-key.txt").toUpperCase();
  if (fs.existsSync(casedKey)) {
    await assert.rejects(main(["sign", "--version", version, "--commit", commit,
      "--assets-dir", f.dir, "--private-key", casedKey,
      "--out", path.join(f.dir, "must-not-exist.json")]), /outside the public repository/);
  }
});

test("D10 signed root manifest represents large local Mac installer without allowing oversized direct Windows assets", async t => {
  const f = await signed(t);
  const { signature, ...body } = f.manifest;
  const bigMacDmg = { ...body.assets[0], bytes: 2_752_494_208 };
  const bigMacZip = { ...body.assets[1], bytes: 2_500_000_000 };
  assert.doesNotThrow(() => validateBody({ ...body, assets: [bigMacDmg, bigMacZip, body.assets[2]] }));
  assert.throws(() => validateBody({ ...body, assets: [
    body.assets[0], body.assets[1], { ...body.assets[2], bytes: 2_000_000_001 },
  ] }), /size invalid/);
  assert.throws(() => validateBody({ ...body, assets: [
    { ...bigMacDmg, bytes: 16_000_000_001 }, body.assets[1], body.assets[2],
  ] }), /size invalid/);
});
