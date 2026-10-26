const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { resolveMacPackAppPath, signAdHocMacPack } = require("./desktopMacPackSigning.cjs");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

test("macOS local pack resolves the target architecture and product bundle", () => {
  // resolveMacPackAppPath uses path.join, so the expected values are built the same way (backslashes on Windows).
  assert.equal(resolveMacPackAppPath({ rootDir: "/lios", arch: "arm64", productName: "LiOS" }), path.join("/lios", "dist-app", "mac-arm64", "LiOS.app"));
  assert.equal(resolveMacPackAppPath({ rootDir: "/lios", arch: "x64", productName: "LiOS" }), path.join("/lios", "dist-app", "mac", "LiOS.app"));
});


test("ad-hoc packs pin the designated requirement to the bundle identifier so rebuilds keep Keychain trust", () => {
  const calls = [];
  signAdHocMacPack({ appPath: "/lios/LiOS.app", platform: "darwin", existsSync: () => true, bundleIdentifier: "com.example.app", run: (...args) => { calls.push(args[1]); return { status: 0 }; } });
  const requirementArg = calls[1].find((arg) => arg.startsWith("-r="));
  assert.equal(requirementArg, '-r=designated => identifier "com.example.app"');
  // The requirement must never pin a code hash, or every rebuild would look like a different app.
  assert.doesNotMatch(requirementArg, /cdhash/i);
});

test("local ad-hoc signing is skipped off macOS", () => {
  let calls = 0;
  assert.deepEqual(signAdHocMacPack({ appPath: "/lios/LiOS.app", platform: "win32", run: () => { calls += 1; } }), { ok: true, skipped: true });
  assert.equal(calls, 0);
});

test("macOS pack fails closed for missing bundles or signing and verification failures", () => {
  assert.deepEqual(signAdHocMacPack({ appPath: "/missing/LiOS.app", platform: "darwin", existsSync: () => false, run: () => ({ status: 0 }) }), { ok: false, reason: "missing_bundle" });
  assert.deepEqual(signAdHocMacPack({ appPath: "/lios/LiOS.app", platform: "darwin", existsSync: () => true, run: () => ({ status: 1 }) }), { ok: false, reason: "sign_failed" });
  let calls = 0;
  assert.deepEqual(signAdHocMacPack({ appPath: "/lios/LiOS.app", platform: "darwin", existsSync: () => true, run: () => ({ status: ++calls === 1 ? 0 : 1 }) }), { ok: false, reason: "requirement_failed" });
  calls = 0;
  assert.deepEqual(signAdHocMacPack({ appPath: "/lios/LiOS.app", platform: "darwin", existsSync: () => true, run: () => ({ status: ++calls <= 2 ? 0 : 1 }) }), { ok: false, reason: "verify_failed" });
});

test("real ad-hoc resign preserves runtime flag and existing entitlements", { skip: process.platform !== "darwin" }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-signing-metadata-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appPath = path.join(root, "Metadata.app");
  const contents = path.join(appPath, "Contents");
  fs.mkdirSync(path.join(contents, "MacOS"), { recursive: true });
  fs.copyFileSync("/bin/echo", path.join(contents, "MacOS", "Metadata"));
  fs.writeFileSync(path.join(contents, "Info.plist"), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.example.metadata</string><key>CFBundleExecutable</key><string>Metadata</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>');
  const entitlements = path.join(root, "entitlements.plist");
  fs.writeFileSync(entitlements, '<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>');
  const signed = spawnSync("/usr/bin/codesign", ["--force", "--sign", "-", "--options", "runtime", "--entitlements", entitlements, appPath], { encoding: "utf8" });
  assert.equal(signed.status, 0, signed.stderr);
  assert.equal(signAdHocMacPack({ appPath, bundleIdentifier: "com.example.metadata" }).ok, true);
  const metadata = spawnSync("/usr/bin/codesign", ["-d", "--verbose=4", "--entitlements", ":-", appPath], { encoding: "utf8" });
  assert.equal(metadata.status, 0, metadata.stderr);
  assert.match(metadata.stderr, /flags=.*runtime/);
  assert.match(metadata.stdout, /com.apple.security.cs.allow-jit/);
});
