#!/usr/bin/env node
"use strict";

/**
 * Owner-operated, offline-only SI-07 $0 beta integrity gate.
 *
 * Sign:
 *   node script/beta_release_manifest.cjs sign --version 1.0.0-beta.1
 *     --commit <full SHA> --assets-dir /owned/release-staging
 *     --private-key /private/off-repo/ed25519.pem --out /owned/release-staging/beta-manifest.json
 *
 * Verify:
 *   node script/beta_release_manifest.cjs verify --manifest /download/beta-manifest.json
 *     --assets-dir /download --trusted-public-key /trusted/from-independent-channel.pem
 *     --commit <full reviewed SHA> [--current-version 1.0.0-beta.1]
 *
 * The trusted key MUST come from an independent verified owner channel; a key
 * bundled beside its own manifest is not a trust anchor. Never run sign in CI.
 */
const fs = require("node:fs");
const path = require("node:path");
const {
  signBetaManifest, verifyBetaManifest,
} = require("../betaReleaseManifest.cjs");

function options(args) {
  const out = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!/^--[a-z-]+$/.test(key || "") || !value || value.startsWith("--")) {
      throw new Error("Invalid beta release flag syntax.");
    }
    const label = key.slice(2);
    if (Object.prototype.hasOwnProperty.call(out, label)) throw new Error("Duplicate flag: " + label);
    out[label] = value;
  }
  return out;
}

async function main(argv) {
  const [operation, ...args] = argv;
  if (operation !== "sign" && operation !== "verify") {
    throw new Error("Expected sign or verify. Signing is owner-only, offline, with an off-repo Ed25519 private key.");
  }
  const flags = options(args);
  const accepted = operation === "sign"
    ? ["version", "commit", "assets-dir", "private-key", "out"]
    : ["manifest", "assets-dir", "trusted-public-key", "commit", "current-version"];
  if (Object.keys(flags).some(key => !accepted.includes(key))) throw new Error("Unsupported release manifest flag.");
  const required = operation === "sign"
    ? ["version", "commit", "assets-dir", "private-key", "out"]
    : ["manifest", "assets-dir", "trusted-public-key", "commit"];
  if (required.some(key => !flags[key])) throw new Error("Missing mandatory release manifest input.");
  if (operation === "sign") {
    const keyPath = path.resolve(flags["private-key"]);
    if (fs.lstatSync(keyPath).isSymbolicLink()) throw new Error("Private signing key must not be a symlink.");
    const keyFile = fs.realpathSync(keyPath);
    const repoRoot = fs.realpathSync(path.resolve(__dirname, "..", ".."));
    const relativeKey = path.relative(repoRoot, keyFile);
    const repositoryIdentity = fs.statSync(repoRoot, { bigint: true });
    let insideRepository = false;
    for (let ancestor = path.dirname(keyFile); ; ) {
      const identity = fs.statSync(ancestor, { bigint: true });
      if (identity.ino !== 0n && identity.ino === repositoryIdentity.ino && identity.dev === repositoryIdentity.dev) {
        insideRepository = true;
        break;
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
    if (insideRepository || relativeKey === "" || (!path.isAbsolute(relativeKey) && relativeKey !== ".." && !relativeKey.startsWith(".." + path.sep))) {
      throw new Error("Private signing key MUST be stored outside the public repository.");
    }
    const output = path.resolve(flags.out);
    if (output === keyFile) throw new Error("Manifest must not overwrite signing material.");
    if (fs.existsSync(output)) throw new Error("Refusing to overwrite an existing signed release manifest.");
    const result = await signBetaManifest({
      version: flags.version,
      commit: flags.commit,
      assetDir: flags["assets-dir"],
      privateKeyPem: fs.readFileSync(keyFile, "utf8"),
    });
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    process.stdout.write("Signed local beta release manifest: " + path.basename(output) + "\n");
    process.stdout.write("Key fingerprint: " + result.signature.publicKeyFingerprint + "\n");
    process.stdout.write("No OS code signing, notarization, distribution or installation occurred.\n");
    return;
  }
  const result = await verifyBetaManifest({
    manifest: JSON.parse(fs.readFileSync(flags.manifest, "utf8")),
    assetDir: flags["assets-dir"],
    trustedPublicKeyPem: fs.readFileSync(flags["trusted-public-key"], "utf8"),
    expectedCommit: flags.commit,
    currentVersion: flags["current-version"] || null,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
if (require.main === module) {
  main(process.argv.slice(2)).catch(() => {
    // Do not log arbitrary OS error strings: file paths can carry credentials.
    console.error("Beta release manifest verification/signing refused. Review inputs and asset integrity.");
    process.exitCode = 1;
  });
}
module.exports = { options, main };
