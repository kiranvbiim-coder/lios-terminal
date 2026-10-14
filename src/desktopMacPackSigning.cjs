const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function resolveMacPackAppPath({ rootDir, arch, productName }) {
  const outputDirectory = arch === "arm64" ? "mac-arm64" : "mac";
  return path.join(rootDir, "dist-app", outputDirectory, `${productName}.app`);
}

/**
 * An ad-hoc signature's default designated requirement pins this build's code hash, so macOS treats
 * every rebuild as a different app and asks for Keychain access again (Electron safeStorage), which
 * blocks startup until the user answers. Local ad-hoc packs therefore re-sign the main bundle with a
 * fixed requirement on the bundle identifier, so an update installed in place keeps the Keychain
 * trust the user already granted. Signed and notarized releases use a Team ID requirement instead.
 */
const DEFAULT_BUNDLE_IDENTIFIER = "com.limuria.terminal";

function signAdHocMacPack({ appPath, platform = process.platform, existsSync = fs.existsSync, run = spawnSync, bundleIdentifier = DEFAULT_BUNDLE_IDENTIFIER } = {}) {
  if (platform !== "darwin") return { ok: true, skipped: true };
  if (!appPath || !existsSync(appPath)) return { ok: false, reason: "missing_bundle" };

  const sign = run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath], { stdio: "inherit" });
  if (sign.error || sign.status !== 0) return { ok: false, reason: "sign_failed" };

  const stableRequirement = run(
    "/usr/bin/codesign",
    ["--force", "--sign", "-", "--timestamp=none", `-r=designated => identifier "${bundleIdentifier}"`, appPath],
    { stdio: "inherit" },
  );
  if (stableRequirement.error || stableRequirement.status !== 0) return { ok: false, reason: "requirement_failed" };

  const verify = run("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  if (verify.error || verify.status !== 0) return { ok: false, reason: "verify_failed" };
  return { ok: true, skipped: false };
}

module.exports = { resolveMacPackAppPath, signAdHocMacPack };
