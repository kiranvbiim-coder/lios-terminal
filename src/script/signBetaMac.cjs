const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { signAdHocMacPack } = require("../desktopMacPackSigning.cjs");

function isMachO(filename, size) {
  if (size < 8 || path.extname(filename) === ".class") return false;
  const header = Buffer.allocUnsafe(8);
  const fd = fs.openSync(filename, "r");
  try { fs.readSync(fd, header, 0, 8, 0); } finally { fs.closeSync(fd); }
  const magic = header.toString("hex", 0, 4);
  if (["feedface", "feedfacf", "cefaedfe", "cffaedfe"].includes(magic)) return true;
  const count = ["cafebabe", "cafebabf"].includes(magic) ? header.readUInt32BE(4)
    : ["bebafeca", "bfbafeca"].includes(magic) ? header.readUInt32LE(4) : 0;
  return count > 0 && count <= 32;
}

function *resourceCode(directory, excludedRoot) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (filename === excludedRoot || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) yield *resourceCode(filename, excludedRoot);
    else if (entry.isFile() && isMachO(filename, fs.statSync(filename).size)) yield filename;
  }
}

function codesign(args) {
  const result = spawnSync("/usr/bin/codesign", args, { encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Beta native signing failed: ${result.error?.message || result.stderr || result.status}`);
}

/** Supported beta-only custom signer. Bound file inspection and native signing serially. */
module.exports = async options => {
  if (process.platform !== "darwin" || options.platform !== "darwin" || options.identity !== "-") {
    throw new Error("The beta signer only accepts an explicit macOS ad-hoc identity.");
  }
  const appPath = options.app;
  const entitlementsFile = path.join(__dirname, "..", "build-resources", "entitlements.beta.mac.plist");
  const resources = path.join(appPath, "Contents", "Resources");
  // The canonical runtime manifest pins these exact bytes; preserve the existing exclusion.
  const excluded = path.join(resources, "native-runtime-dist");
  for (const filename of resourceCode(resources, excluded)) {
    codesign(["--force", "--sign", "-", "--timestamp=none", "--options", "runtime", "--entitlements", entitlementsFile, filename]);
  }
  const result = signAdHocMacPack({ appPath, entitlementsFile, hardenedRuntime: true });
  if (!result.ok) throw new Error(`Beta ad-hoc signature verification failed: ${result.reason}`);
  // Deep bundle verification does not cover executable Resources; check those explicitly.
  for (const filename of resourceCode(resources, excluded)) codesign(["--verify", "--strict", filename]);
};
