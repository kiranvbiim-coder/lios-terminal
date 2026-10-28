const { spawnSync } = require("node:child_process");
const { requireCleanBetaSourceCommit } = require("./clean_beta_source.cjs");
const path = require("node:path");
const { resolveMacPackAppPath, signAdHocMacPack } = require("../desktopMacPackSigning.cjs");
const { verifyPackagedSandboxRelease } = require("../desktopSandboxImage.cjs");

const mode = process.argv[2];
if (!["pack", "mac", "win", "beta-mac", "beta-win"].includes(mode)) {
  console.error("Usage: node script/desktop_build.cjs <pack|mac|win|beta-mac|beta-win>");
  process.exit(2);
}
const beta = mode === "beta-mac" || mode === "beta-win";
const betaDirectoryOnly = beta && process.argv.includes("--dir");
const targetMac = mode === "mac" || mode === "beta-mac";
const targetWin = mode === "win" || mode === "beta-win";
if (beta && (targetMac ? process.platform !== "darwin" || process.arch !== "arm64" : process.platform !== "win32" || process.arch !== "x64")) {
  console.error("Beta sidecars and packages must be built on the target OS/architecture (macOS ARM64 or Windows x64).");
  process.exit(1);
}
const betaVersion = process.env.LIOS_BETA_VERSION;
// A beta must correspond to one exact, reviewed clean tracked source tree.
// Package metadata carries this immutable commit to the installed self-test.
let betaSourceCommit = null;
if (beta) {
  try {
    betaSourceCommit = requireCleanBetaSourceCommit(path.join(__dirname, ".."));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
if (beta && !/^\d+\.\d+\.\d+-beta\.[1-9]\d*$/.test(betaVersion || "")) {
  console.error("Set LIOS_BETA_VERSION to an explicit version such as 1.0.0-beta.1.");
  process.exit(1);
}

function normalizeHttpsUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return null;
    return parsed.toString().endsWith("/") ? parsed.toString() : parsed.toString() + "/";
  } catch {
    return null;
  }
}

const env = { ...process.env };
const configuredUpdateUrl = normalizeHttpsUrl(env.LIOS_UPDATE_URL);

if (mode === "pack" || beta) {
  // Local unsigned iteration still needs a syntactically valid publish URL so
  // electron-builder can generate its metadata. .invalid is reserved by
  // RFC 2606 and can never become a real network destination.
  env.LIOS_UPDATE_URL = configuredUpdateUrl || "https://updates.invalid/lios/";
  if (beta) {
    env.LIOS_UPDATE_URL = "https://updates.invalid/lios/";
    env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  }
} else {
  if (!configuredUpdateUrl || new URL(configuredUpdateUrl).hostname.endsWith(".invalid")) {
    console.error("A real HTTPS LIOS_UPDATE_URL is required for signed desktop distribution builds.");
    process.exit(1);
  }
  env.LIOS_UPDATE_URL = configuredUpdateUrl;
}

if (mode !== "pack") {
  const expectedSidecar = path.join(
    __dirname,
    "..",
    "python-sidecar-dist",
    "lios-python-sidecar",
    targetWin ? "lios-python-sidecar.exe" : "lios-python-sidecar",
  );
  if (!require("node:fs").existsSync(expectedSidecar)) {
    console.error(`Self-contained Python sidecar is required before distribution packaging: ${expectedSidecar}`);
    console.error("Run npm run python:sidecar:build on the target platform first.");
    process.exit(1);
  }
}

const sandboxTarget = targetWin
  ? { platform: "win32", arch: "x64" }
  : targetMac
    ? { platform: "darwin", arch: process.arch }
    : { platform: process.platform, arch: process.arch };
try {
  verifyPackagedSandboxRelease(path.join(__dirname, ".."), sandboxTarget);
} catch (error) {
  console.error(`Desktop sandbox image release is missing, invalid, or not qualified for ${sandboxTarget.platform}/${sandboxTarget.arch}: ${error.message}`);
  process.exit(1);
}

// Never package an absent/stale dist tree from a previous source revision.
// The same build owner produces the renderer, Home server and restore worker.
const sourceBuild = spawnSync(process.execPath, ["--import", "tsx", "script/build.ts"], {
  cwd: path.join(__dirname, ".."),
  env,
  stdio: "inherit",
});
if (sourceBuild.error) {
  console.error(sourceBuild.error.message);
  process.exit(1);
}
if (sourceBuild.status !== 0) process.exit(sourceBuild.status ?? 1);

const executable = path.join(
  __dirname,
  "..",
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-builder.cmd" : "electron-builder",
);

const args = ["build"];
if (mode === "pack") args.push("-c.extraMetadata.liosReleaseChannel=development");
if (beta) {
  args.push("--publish", "never", "-c.forceCodeSigning=false", "-c.extraMetadata.liosReleaseChannel=beta",
    `-c.extraMetadata.version=${betaVersion}`, `-c.extraMetadata.liosBuildCommit=${betaSourceCommit}`, "-c.artifactName=LiOS-${version}-${os}-${arch}-beta.${ext}");
  if (targetMac) args.push("--mac", ...(betaDirectoryOnly ? ["dir"] : ["dmg", "zip"]), "--arm64", "-c.mac.identity=-", "-c.mac.notarize=false",
    "-c.mac.entitlements=build-resources/entitlements.beta.mac.plist",
    "-c.mac.entitlementsInherit=build-resources/entitlements.beta.mac.plist",
    "-c.mac.sign=script/signBetaMac.cjs");
  else args.push("--win", ...(betaDirectoryOnly ? ["dir"] : ["nsis"]), "--x64", "-c.win.signAndEditExecutable=false", "-c.nsis.perMachine=false", "-c.nsis.oneClick=true");
}
if (mode === "pack") {
  args.push("--dir");
  if (process.platform === "darwin") {
    args.push("-c.mac.identity=null", "-c.mac.hardenedRuntime=false", "-c.mac.notarize=false");
  }
}
if (mode === "mac") args.push("--mac", "-c.forceCodeSigning=true", "-c.mac.notarize=true");
if (mode === "win") args.push("--win", "-c.forceCodeSigning=true");

const result = spawnSync(executable, args, {
  cwd: path.join(__dirname, ".."),
  env,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

if (mode === "pack" && process.platform === "darwin") {
  const appPath = resolveMacPackAppPath({
    rootDir: path.join(__dirname, ".."),
    arch: process.arch,
    productName: require("../package.json").build.productName,
  });
  const signature = signAdHocMacPack({ appPath });
  if (!signature.ok) {
    console.error(`Local macOS package signing or verification failed (${signature.reason}): ${appPath}`);
    process.exit(1);
  }
}

process.exit(0);
