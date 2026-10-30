import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { build } from "esbuild";

test("packaged CommonJS Windows custody reaches the native loader instead of failing on ESM metadata", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-windows-custody-cjs-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outfile = path.join(root, "custody.cjs");
  await build({ entryPoints: [path.resolve("server/nativeRuntimeWindowsFs.ts")], bundle: true,
    platform: "node", format: "cjs", outfile, logLevel: "silent" });
  const resources = path.join(root, "resources");
  const addon = path.join(resources, "native-runtime-fs", "lios_native_runtime_fs.node");
  fs.mkdirSync(path.dirname(addon), { recursive: true });
  fs.writeFileSync(addon, "Deliberately invalid native fixture; no executable code.");
  const result = spawnSync(process.execPath, ["-e", `
    Object.defineProperty(process, "platform", { value: "win32" });
    Object.defineProperty(process, "arch", { value: "x64" });
    process.env.ELECTRON_RESOURCES_PATH = ${JSON.stringify(resources)};
    try { require(${JSON.stringify(outfile)}).windowsRuntimeFs(); process.exitCode = 2; }
    catch (error) { process.stdout.write(JSON.stringify({ code: error.code ?? null })); }
  `], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).code, "ERR_DLOPEN_FAILED",
    "the app-owned file must reach Node's real native-module loader; this does not qualify a Windows binary on another host");
});

test("native Windows custody enforces private ACLs, no-follow identity and pinned-directory lifetime", {
  skip: process.platform !== "win32" || process.arch !== "x64" ? "requires actual Windows x64" : false,
  timeout: 290_000,
}, () => {
  const result = spawnSync(process.execPath, [path.resolve("script/verify_windows_runtime_fs.cjs")], {
    encoding: "utf8", timeout: 280_000,
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
});
