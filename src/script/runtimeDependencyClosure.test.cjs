const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { selectRuntimeClosure, copyRuntimeClosure, closureEvidence } = require("./runtimeDependencyClosure.cjs");

function fixture(t, extraPackages = {}, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-runtime-closure-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifest = { dependencies: { runtime: "1.0.0" }, devDependencies: { tsx: "4.0.0", builder: "8.0.0" }, ...overrides };
  const packages = {
    "": manifest,
    "node_modules/runtime": { version: "1.0.0" },
    "node_modules/tsx": { version: "4.0.0", dev: true },
    "node_modules/builder": { version: "8.0.0", dev: true },
    ...extraPackages,
  };
  fs.mkdirSync(path.join(root, "node_modules"));
  for (const [location, entry] of Object.entries(packages)) {
    if (!location) continue;
    const directory = path.join(root, location);
    fs.mkdirSync(directory, { recursive: true });
    const name = entry.name || location.slice(location.lastIndexOf("node_modules/") + 13);
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, version: entry.version, license: "MIT", main: "index.cjs" }));
    fs.writeFileSync(path.join(directory, "index.cjs"), `module.exports = ${JSON.stringify(`${name}@${entry.version}`)};`);
  }
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
  const saveLock = () => fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages }));
  saveLock();
  return { root, manifest, packages, saveLock, select: (target = {}) => selectRuntimeClosure({ projectDir: root, platform: "darwin", arch: "arm64", ...target }) };
}

test("closure preserves scoped/hoisted/nested placements, peers, cycles and dev operator dependencies", (t) => {
  const f = fixture(t, {
    "node_modules/runtime": { version: "1.0.0", dependencies: { "@scope/child": "2", shared: "1" }, peerDependencies: { peer: "1" } },
    "node_modules/@scope/child": { version: "2.0.0", dependencies: { shared: "2", runtime: "1" } },
    "node_modules/@scope/child/node_modules/shared": { version: "2.0.0" },
    "node_modules/shared": { version: "1.0.0" },
    "node_modules/peer": { version: "1.0.0", dev: true },
    "node_modules/tsx": { version: "4.0.0", dev: true, dependencies: { esbuild: "~0.27.0" } },
    "node_modules/tsx/node_modules/esbuild": { version: "0.28.2", dev: true },
    "node_modules/runtime/node_modules/unrelated": { version: "9.0.0", dev: true },
  });
  const closure = f.select();
  const paths = closure.packages.map((entry) => entry.path);
  for (const retained of ["node_modules/shared", "node_modules/@scope/child/node_modules/shared", "node_modules/peer", "node_modules/tsx/node_modules/esbuild"]) assert.ok(paths.includes(retained));
  assert.ok(!paths.includes("node_modules/builder"));
  const runtime = path.join(f.root, "node_modules/runtime");
  fs.mkdirSync(path.join(runtime, "tests/node_modules/unrelated"), { recursive: true });
  fs.writeFileSync(path.join(runtime, "tests/node_modules/unrelated/package.json"), JSON.stringify({ name: "unrelated", version: "99.0.0" }));
  fs.mkdirSync(path.join(runtime, "licenses/vendor/node_modules"), { recursive: true });
  fs.writeFileSync(path.join(runtime, "licenses/vendor/node_modules/README.md"), "Exact complete legal-directory bytes.");
  const destination = path.join(f.root, "staging");
  copyRuntimeClosure(closure, destination);
  assert.equal(require(path.join(destination, "node_modules/runtime/index.cjs")), "runtime@1.0.0");
  const nested = require.resolve("shared", { paths: [path.join(destination, "node_modules/@scope/child")] });
  assert.equal(fs.realpathSync.native(nested), fs.realpathSync.native(path.join(destination, "node_modules/@scope/child/node_modules/shared/index.cjs")));
  assert.equal(require(nested), "shared@2.0.0");
  assert.equal(require(require.resolve("shared", { paths: [path.join(destination, "node_modules/runtime")] })), "shared@1.0.0");
  assert.equal(fs.existsSync(path.join(destination, "node_modules/runtime/node_modules/unrelated")), false);
  assert.equal(fs.existsSync(path.join(destination, "node_modules/builder")), false);
  assert.equal(fs.existsSync(path.join(destination, "node_modules/runtime/tests/node_modules")), false);
  assert.equal(fs.readFileSync(path.join(destination, "node_modules/runtime/licenses/vendor/node_modules/README.md"), "utf8"),
    "Exact complete legal-directory bytes.");
  const evidence = closureEvidence(closure, 2);
  assert.equal(evidence.selectedPaths.length, 2);
  assert.match(evidence.selectionSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(closureEvidence(f.select(), 2), evidence);
});

test("npm aliases retain real package identity", (t) => {
  const f = fixture(t, {
    "node_modules/runtime": { version: "1.0.0", dependencies: { alias: "npm:real-package@^2.0.0" } },
    "node_modules/alias": { name: "real-package", version: "2.4.0" },
  });
  assert.equal(f.select().packages.find((entry) => entry.path === "node_modules/alias").name, "real-package");
});

test("installed target-compatible optionals are selected and omissions are explicit", (t) => {
  const f = fixture(t, {
    "node_modules/runtime": { version: "1.0.0", optionalDependencies: { absent: "1", missing: "1", mac: "1", intel: "1", linux: "1", glibc: "1" }, peerDependencies: { optionalPeer: "1" }, peerDependenciesMeta: { optionalPeer: { optional: true } } },
    "node_modules/missing": { version: "1.0.0" },
    "node_modules/mac": { version: "1.0.0", os: ["darwin"], cpu: ["arm64"] },
    "node_modules/intel": { version: "1.0.0", cpu: ["x64"] },
    "node_modules/linux": { version: "1.0.0", os: ["linux"] },
    "node_modules/glibc": { version: "1.0.0", os: ["linux"], libc: ["glibc"] },
  }, { optionalDependencies: { mac: "1" } });
  fs.rmSync(path.join(f.root, "node_modules/missing"), { recursive: true });
  const closure = f.select();
  assert.ok(closure.packages.some((entry) => entry.path === "node_modules/mac"));
  assert.ok(closure.roots.some((entry) => entry.name === "mac" && entry.reason === "optionalDependency"));
  for (const [name, reason] of [["missing", "not-installed"], ["absent", "not-locked"], ["intel", "incompatible-target"], ["optionalPeer", "not-locked"]]) assert.ok(closure.omittedOptionals.some((entry) => entry.name === name && entry.reason === reason));
  assert.ok(f.select({ platform: "linux", libc: "musl" }).omittedOptionals.some((entry) => entry.name === "glibc" && entry.reason === "incompatible-target"));
  assert.ok(f.select({ platform: "linux", libc: "glibc" }).packages.some((entry) => entry.path === "node_modules/glibc"));
});

test("missing required lock, installed and peer edges fail closed", async (t) => {
  for (const [label, entry, pattern] of [
    ["lock", { dependencies: { missing: "1" } }, /Missing required locked edge/],
    ["peer", { peerDependencies: { missing: "1" } }, /Missing required locked edge/],
    ["target", { os: ["win32"] }, /incompatible with target/],
  ]) await t.test(label, (t) => {
    const f = fixture(t, { "node_modules/runtime": { version: "1.0.0", ...entry } });
    assert.throws(() => f.select(), pattern);
  });
  const f = fixture(t);
  fs.rmSync(path.join(f.root, "node_modules/runtime"), { recursive: true });
  assert.throws(() => f.select(), /Missing required installed edge/);
});

test("version/identity drift, stale roots and lock links fail closed", async (t) => {
  for (const [label, mutate, pattern] of [
    ["version", (f) => fs.writeFileSync(path.join(f.root, "node_modules/runtime/package.json"), JSON.stringify({ name: "runtime", version: "99.0.0" })), /identity\/version drift/],
    ["identity", (f) => fs.writeFileSync(path.join(f.root, "node_modules/runtime/package.json"), JSON.stringify({ name: "imposter", version: "1.0.0" })), /identity\/version drift/],
    ["root", (f) => fs.writeFileSync(path.join(f.root, "package.json"), JSON.stringify({ ...f.manifest, dependencies: {} })), /Manifest\/lock dependencies drift/],
    ["link", (f) => { f.packages["node_modules/runtime"].link = true; f.saveLock(); }, /Unsupported linked/],
    ["v1", (f) => fs.writeFileSync(path.join(f.root, "package-lock.json"), JSON.stringify({ lockfileVersion: 1 })), /package-lock v2\/v3/],
  ]) await t.test(label, (t) => {
    const f = fixture(t);
    mutate(f);
    assert.throws(() => f.select(), pattern);
  });
});

test("v2 locks and symlinked source module roots retain executable payloads without .bin", (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, "package-lock.json"), JSON.stringify({ lockfileVersion: 2, packages: f.packages }));
  const installed = path.join(f.root, "installed");
  fs.renameSync(path.join(f.root, "node_modules"), installed);
  fs.symlinkSync(installed, path.join(f.root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  fs.writeFileSync(path.join(installed, "runtime/spawn-helper"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.mkdirSync(path.join(installed, ".bin"));
  fs.writeFileSync(path.join(installed, ".bin/unrelated"), "must not ship");
  const destination = path.join(f.root, "staging");
  copyRuntimeClosure(f.select(), destination);
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(destination, "node_modules/runtime/spawn-helper")).mode & 0o111, 0o111);
  assert.equal(fs.existsSync(path.join(destination, "node_modules/.bin")), false);
});

test("package links, escaping payload links and cyclic payload links are refused", async (t) => {
  for (const kind of ["package", "escape", "cycle"]) await t.test(kind, (t) => {
    const f = fixture(t);
    const runtime = path.join(f.root, "node_modules/runtime");
    const directoryLink = process.platform === "win32" ? "junction" : "dir";
    if (kind === "package") {
      fs.renameSync(runtime, path.join(f.root, "linked-runtime"));
      fs.symlinkSync(path.join(f.root, "linked-runtime"), runtime, directoryLink);
    } else if (kind === "escape") {
      const privateDirectory = path.join(f.root, "private");
      fs.mkdirSync(privateDirectory);
      fs.writeFileSync(path.join(privateDirectory, "private.txt"), "must never ship");
      fs.symlinkSync(privateDirectory, path.join(runtime, "LICENSE"), directoryLink);
    } else fs.symlinkSync(runtime, path.join(runtime, "cycle"), directoryLink);
    assert.throws(() => copyRuntimeClosure(f.select(), path.join(f.root, "staging")), /Unsupported linked package path|Escaping package symlink|Cyclic package symlink/);
  });
});

test("internal payload symlinks preserve their bytes and legal copy mutations are refused", (t) => {
  const f = fixture(t);
  const runtime = path.join(f.root, "node_modules/runtime");
  fs.writeFileSync(path.join(runtime, "LICENSE"), "exact license bytes");
  const assets = path.join(runtime, "assets");
  fs.mkdirSync(assets);
  fs.writeFileSync(path.join(assets, "index.cjs"), "module.exports = 'linked payload';");
  fs.symlinkSync(assets, path.join(runtime, "linked-assets"), process.platform === "win32" ? "junction" : "dir");
  const destination = path.join(f.root, "staging");
  const legal = copyRuntimeClosure(f.select(), destination);
  assert.equal(fs.readFileSync(path.join(destination, "node_modules/runtime/linked-assets/index.cjs"), "utf8"),
    fs.readFileSync(path.join(assets, "index.cjs"), "utf8"));
  assert.ok(legal.some((entry) => entry.path === "node_modules/runtime/LICENSE"));
  const copyFileSync = fs.copyFileSync.bind(fs);
  t.mock.method(fs, "copyFileSync", (source, target, mode) => {
    copyFileSync(source, target, mode);
    if (path.basename(source) === "LICENSE") fs.writeFileSync(target, "mutated grant");
  });
  assert.throws(() => copyRuntimeClosure(f.select(), path.join(f.root, "mutated")), /Copied dependency legal bytes changed/);
});
