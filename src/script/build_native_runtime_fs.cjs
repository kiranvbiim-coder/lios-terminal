const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

/** Build only our fixed N-API source on its native target; never reuse a cached binary. */
function buildNativeRuntimeFs({ projectDir = path.resolve(__dirname, ".."), arch = process.arch, electronVersion } = {}) {
  if (process.platform !== "win32" || process.arch !== "x64" || arch !== "x64") {
    throw new Error("Windows runtime custody must be built on native Windows x64.");
  }
  if (electronVersion !== undefined && !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(electronVersion)) {
    throw new Error("A concrete Electron version is required for Windows runtime custody.");
  }
  const directory = path.join(projectDir, "native-runtime-fs");
  const args = [require.resolve("node-gyp/bin/node-gyp.js"), "rebuild", "--directory", directory, "--arch=x64"];
  if (electronVersion) args.push(`--target=${electronVersion}`, "--dist-url=https://electronjs.org/headers");
  // Include cold header download and MSVC startup; this is a build budget, not an execution grant.
  const result = spawnSync(process.execPath, args, { cwd: projectDir, stdio: "inherit", timeout: 240_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Windows runtime custody build failed (${result.status ?? result.signal}).`);
  const addon = path.join(directory, "build", "Release", "lios_native_runtime_fs.node");
  const stat = fs.lstatSync(addon);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) {
    throw new Error("Windows runtime custody build did not produce a regular native addon.");
  }
  return addon;
}

module.exports = { buildNativeRuntimeFs };
if (require.main === module) {
  try { console.log(buildNativeRuntimeFs()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
