"use strict";

/**
 * SI-07/P10 $0 beta offline release asset integrity.
 * This is NOT macOS notarization, Windows Authenticode, native acceptance,
 * user approval for installation, or a production auto-updater.
 * Signing private keys must stay outside the public repository and CI.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAX_RELEASE_ASSET_BYTES = 2_000_000_000;
const TARGETS = Object.freeze(["mac-arm64-dmg", "mac-arm64-zip", "win-x64-nsis"]);
const VERSION = /^\d+\.\d+\.\d+-beta\.[1-9]\d*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{1,180}$/;

function assert(condition, message) {
  if (!condition) throw new Error("LiOS beta manifest: " + message);
}
function keysExactly(object, keys, kind) {
  assert(object && typeof object === "object" && !Array.isArray(object), kind + " must be an object.");
  assert(JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...keys].sort()),
    kind + " has missing or unrecognized fields.");
}
function targetName(version, target) {
  assert(TARGETS.includes(target), "unsupported beta asset target.");
  const [os, arch, kind] = target.split("-");
  return "LiOS-" + version + "-" + os + "-" + arch + "-beta." + (kind === "nsis" ? "exe" : kind);
}
function validateBody(body) {
  keysExactly(body, ["schema", "channel", "version", "commit", "assets"], "signed body");
  assert(body.schema === 1 && body.channel === "beta", "only schema 1 beta releases may be checked.");
  assert(typeof body.version === "string" && VERSION.test(body.version), "invalid explicit beta version.");
  const numericVersion = body.version.match(/^(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/).slice(1);
  assert(numericVersion.every(part => (part === "0" || !part.startsWith("0")) && Number.isSafeInteger(Number(part))),
    "beta version has noncanonical or unsafe numeric components.");
  assert(typeof body.commit === "string" && COMMIT.test(body.commit), "exact source commit SHA is required.");
  assert(Array.isArray(body.assets) && body.assets.length === TARGETS.length,
    "macOS DMG/ZIP and Windows NSIS x64 assets are all mandatory.");
  const seen = new Set();
  for (const entry of body.assets) {
    keysExactly(entry, ["name", "target", "bytes", "sha256"], "asset");
    assert(typeof entry.target === "string" && TARGETS.includes(entry.target), "unknown asset target.");
    assert(!seen.has(entry.target), "duplicate asset target.");
    seen.add(entry.target);
    assert(typeof entry.name === "string" && NAME.test(entry.name)
      && entry.name === targetName(body.version, entry.target), "asset filename must match exact beta version/platform.");
    assert(Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= MAX_RELEASE_ASSET_BYTES,
      "asset size invalid or exceeds zero-cost release limit.");
    assert(typeof entry.sha256 === "string" && SHA256.test(entry.sha256), "SHA-256 must be lowercase hex.");
  }
  assert(TARGETS.every(target => seen.has(target)), "all target installers required.");
  assert(body.assets.every((asset, index) => asset.target === TARGETS[index]), "noncanonical asset order.");
  return body;
}
function publicKeyFingerprint(publicKey) {
  const key = publicKey instanceof crypto.KeyObject && publicKey.type === "public"
    ? publicKey : crypto.createPublicKey(publicKey);
  assert(key.asymmetricKeyType === "ed25519", "trusted key must be Ed25519.");
  return crypto.createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
}
async function hashAsset(folder, name) {
  assert(typeof name === "string" && NAME.test(name) && path.basename(name) === name, "unsafe filename.");
  const directory = fs.lstatSync(folder);
  assert(directory.isDirectory() && !directory.isSymbolicLink(), "asset folder must be a real directory.");
  const filename = path.join(folder, name);
  const before = fs.lstatSync(filename);
  assert(before.isFile() && !before.isSymbolicLink(), "asset must be a regular non-symlink file.");
  assert(before.size > 0 && before.size <= MAX_RELEASE_ASSET_BYTES,
    "asset missing content or exceeds free release size limit.");
  const descriptor = await fs.promises.open(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = await descriptor.stat();
    assert(opened.isFile() && opened.size === before.size, "asset changed before hashing.");
    if (Number.isSafeInteger(before.ino) && before.ino > 0) {
      assert(opened.ino === before.ino && opened.dev === before.dev, "asset file identity changed.");
    }
    const hash = crypto.createHash("sha256");
    let bytes = 0;
    for await (const chunk of descriptor.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      assert(bytes <= MAX_RELEASE_ASSET_BYTES, "asset grew beyond free release size limit.");
      hash.update(chunk);
    }
    const after = await descriptor.stat();
    assert(after.size === before.size && bytes === before.size, "asset changed while hashing.");
    return { name, bytes, sha256: hash.digest("hex") };
  } finally {
    await descriptor.close();
  }
}
function payloadBytes(body) {
  validateBody(body);
  return Buffer.from(JSON.stringify(body), "utf8");
}
function parseManifest(manifest) {
  keysExactly(manifest, ["schema", "channel", "version", "commit", "assets", "signature"], "manifest");
  const { signature, ...body } = manifest;
  validateBody(body);
  keysExactly(signature, ["algorithm", "publicKeyFingerprint", "value"], "signature");
  assert(signature.algorithm === "Ed25519", "only Ed25519 signatures permitted.");
  assert(typeof signature.publicKeyFingerprint === "string" && SHA256.test(signature.publicKeyFingerprint),
    "missing signing key fingerprint.");
  assert(typeof signature.value === "string" && /^[A-Za-z0-9+/]{86}==$/.test(signature.value),
    "invalid Ed25519 signature encoding.");
  return { body, signature };
}
async function signBetaManifest({ version, commit, assetDir, privateKeyPem }) {
  betaVersionParts(version);
  assert(COMMIT.test(commit), "exact source SHA required.");
  const key = crypto.createPrivateKey(privateKeyPem);
  assert(key.asymmetricKeyType === "ed25519", "signing key must be Ed25519.");
  const assets = [];
  for (const target of TARGETS) {
    const name = targetName(version, target);
    const item = await hashAsset(assetDir, name);
    assets.push({ name, target, bytes: item.bytes, sha256: item.sha256 });
  }
  const body = validateBody({ schema: 1, channel: "beta", version, commit, assets });
  return {
    ...body,
    signature: {
      algorithm: "Ed25519",
      publicKeyFingerprint: publicKeyFingerprint(crypto.createPublicKey(key)),
      value: crypto.sign(null, payloadBytes(body), key).toString("base64"),
    },
  };
}
function betaVersionParts(version) {
  assert(typeof version === "string" && VERSION.test(version), "invalid installed beta version.");
  const parts = version.match(/^(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/).slice(1);
  assert(parts.every(part => (part === "0" || !part.startsWith("0")) && Number.isSafeInteger(Number(part))),
    "beta version components must be bounded, canonical integers.");
  return parts.map(Number);
}
async function verifyBetaManifest({ manifest, assetDir, trustedPublicKeyPem, expectedCommit, currentVersion = null }) {
  const { body, signature } = parseManifest(manifest);
  if (expectedCommit !== undefined && expectedCommit !== null) {
    assert(COMMIT.test(expectedCommit) && body.commit === expectedCommit, "source commit differs from reviewed SHA.");
  }
  if (currentVersion !== null) {
    const old = betaVersionParts(currentVersion), next = betaVersionParts(body.version);
    const difference = next.findIndex((part, index) => part !== old[index]);
    assert(difference !== -1 && next[difference] > old[difference],
      "manual beta upgrade must be newer; downgrade and replay refused.");
  }
  const key = crypto.createPublicKey(trustedPublicKeyPem);
  assert(publicKeyFingerprint(key) === signature.publicKeyFingerprint,
    "signer differs from separately trusted public key.");
  assert(crypto.verify(null, payloadBytes(body), key, Buffer.from(signature.value, "base64")),
    "manifest signature failed; no asset trusted.");
  for (const item of body.assets) {
    const actual = await hashAsset(assetDir, item.name);
    assert(actual.bytes === item.bytes && actual.sha256 === item.sha256,
      "asset integrity mismatch for " + item.target + ".");
  }
  return {
    verified: true, channel: body.channel, version: body.version, commit: body.commit,
    assetCount: body.assets.length,
    assetHashes: body.assets.map(({ name, sha256 }) => ({ name, sha256 })),
    qualification: "release_asset_integrity_only",
    productionCodeSigning: false, macNotarized: false, installApproved: false,
  };
}
module.exports = {
  MAX_RELEASE_ASSET_BYTES, TARGETS, targetName, validateBody, parseManifest,
  publicKeyFingerprint, signBetaManifest, verifyBetaManifest,
};
