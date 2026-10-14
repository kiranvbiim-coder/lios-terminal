const assert = require("node:assert/strict");
const test = require("node:test");
const { resolveMacPackAppPath, signAdHocMacPack } = require("./desktopMacPackSigning.cjs");

test("macOS local pack resolves the target architecture and product bundle", () => {
  assert.equal(resolveMacPackAppPath({ rootDir: "/lios", arch: "arm64", productName: "LiOS" }), "/lios/dist-app/mac-arm64/LiOS.app");
  assert.equal(resolveMacPackAppPath({ rootDir: "/lios", arch: "x64", productName: "LiOS" }), "/lios/dist-app/mac/LiOS.app");
});

test("macOS local pack ad-hoc signs and verifies the final bundle", () => {
  const calls = [];
  const result = signAdHocMacPack({
    appPath: "/lios/dist-app/mac-arm64/LiOS.app",
    platform: "darwin",
    existsSync: () => true,
    run: (...args) => {
      calls.push(args);
      return { status: 0, error: null };
    },
  });

  assert.deepEqual(result, { ok: true, skipped: false });
  assert.deepEqual(calls.map(([binary, args]) => [binary, args]), [
    ["/usr/bin/codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", "/lios/dist-app/mac-arm64/LiOS.app"]],
    ["/usr/bin/codesign", ["--force", "--sign", "-", "--timestamp=none", '-r=designated => identifier "com.limuria.terminal"', "/lios/dist-app/mac-arm64/LiOS.app"]],
    ["/usr/bin/codesign", ["--verify", "--deep", "--strict", "/lios/dist-app/mac-arm64/LiOS.app"]],
  ]);
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
