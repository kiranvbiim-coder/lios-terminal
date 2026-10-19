import test, { describe, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createNativeRuntimeBundleAuthority, resolvePackagedNativeRuntimeBundleAuthority } from "./nativeRuntimeBundle";
import { installManagedRuntime, packSpec, readManagedRuntimeState, type StrictProvisioningRequest } from "./pythonRuntimeManager";
import { MANAGED_RUNTIME_MANIFEST } from "./runtimeManifest";

const sha256 = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
const inventory = {
  fastapi: "0.141.1", starlette: "1.6.0", uvicorn: "0.34.0", numpy: "2.3.4",
  pandas: "2.3.3", scipy: "1.14.1", statsmodels: "0.14.4", "python-dateutil": "2.9.0.post0",
};

function fixture(t: TestContext) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "lios-native-bundle-"));
  const root = fs.realpathSync(temporary);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const resources = path.join(root, "resources");
  const bundleRoot = path.join(resources, "native-runtime-dist");
  const runtimeRoot = path.join(root, "home", "python-runtimes");
  fs.mkdirSync(path.join(bundleRoot, "runtime", "bin"), { recursive: true });
  fs.mkdirSync(path.join(bundleRoot, "runtime", "lib"));
  fs.mkdirSync(path.join(bundleRoot, "locks"));
  const python = "#!/bin/sh\nexit 99\n";
  const library = "pinned-native-library-fixture";
  fs.writeFileSync(path.join(bundleRoot, "runtime", "bin", "python3"), python, { mode: 0o755 });
  fs.writeFileSync(path.join(bundleRoot, "runtime", "lib", "component.dylib"), library, { mode: 0o644 });
  const lock = "# fixture hash lock; not a real release payload\nfastapi==0.141.1 --hash=sha256:" + "a".repeat(64) + "\n";
  fs.writeFileSync(path.join(bundleRoot, "locks", "core.lock.txt"), lock);
  const manifest = {
    schemaVersion: 1, target: "darwin-arm64", manifestVersion: MANAGED_RUNTIME_MANIFEST.manifestVersion,
    pythonVersion: "3.13.16", minimumSystemVersion: "14.0", packIds: ["core"], pythonRelativePath: "bin/python3", installedPackages: { ...inventory },
    locks: [{ packId: "core", sha256: sha256(lock) }],
    files: [
      { path: "bin/python3", size: Buffer.byteLength(python), sha256: sha256(python), executable: true },
      { path: "lib/component.dylib", size: Buffer.byteLength(library), sha256: sha256(library), executable: false },
    ],
    totalBytes: Buffer.byteLength(python) + Buffer.byteLength(library),
    source: { repository: "https://github.com/astral-sh/python-build-standalone", commit: "b".repeat(40), archiveSha256: "c".repeat(64) },
  };
  let manifestSha256 = "";
  function pin() {
    const bytes = JSON.stringify(manifest);
    manifestSha256 = sha256(bytes);
    fs.writeFileSync(path.join(bundleRoot, "manifest.json"), bytes);
    fs.writeFileSync(path.join(bundleRoot, "release.json"), JSON.stringify({ schemaVersion: 1, manifestSha256 }));
    return manifestSha256;
  }
  pin();
  function authority(overrides: Partial<Parameters<typeof createNativeRuntimeBundleAuthority>[0]> = {}) {
    return createNativeRuntimeBundleAuthority({ runtimeRoot, bundleRoot, manifestSha256, platform: "darwin", arch: "arm64", ...overrides });
  }
  function request(overrides: Partial<StrictProvisioningRequest> = {}): StrictProvisioningRequest {
    const core = MANAGED_RUNTIME_MANIFEST.packs.find((pack) => pack.id === "core")!;
    return {
      runtimePath: path.join(runtimeRoot, "install-123-456"), selectedPackIds: ["core"],
      packageSpecs: core.packages.map(packSpec).filter((spec): spec is string => spec !== null),
      lockFiles: [path.join(bundleRoot, "locks", "core.lock.txt")], hashVerified: true, requireVerified: true,
      ...overrides,
    };
  }
  return { root, resources, bundleRoot, runtimeRoot, python, library, lock, manifest, pin, authority, request };
}

describe("native runtime copy authority", { skip: !fs.constants.O_NOFOLLOW ? "No no-follow filesystem support on this host." : false }, () => {

test("native authority copies exact pinned bytes and executable modes without executing Python", async (t) => {
  const f = fixture(t);
  const authority = f.authority();
  const request = f.request({ packageSpecs: [...f.request().packageSpecs].reverse() });
  const result = await authority.provisionManagedRuntime(request);
  assert.deepEqual(result.installedPackages, inventory);
  assert.match(result.packageOutput, /not runtime execution proof/);
  assert.equal(fs.readFileSync(path.join(request.runtimePath, "bin", "python3"), "utf8"), f.python);
  assert.equal(fs.readFileSync(path.join(request.runtimePath, "lib", "component.dylib"), "utf8"), f.library);
  assert.equal(fs.statSync(path.join(request.runtimePath, "bin", "python3")).mode & 0o777, 0o755);
  assert.equal(fs.statSync(path.join(request.runtimePath, "lib", "component.dylib")).mode & 0o777, 0o644);
  assert.equal(fs.existsSync(path.join(f.runtimeRoot, "current")), false);
  result.installedPackages.fastapi = "0.0.0";
  const second = await authority.provisionManagedRuntime(f.request({ runtimePath: path.join(f.runtimeRoot, "install-123-457") }));
  assert.equal(second.installedPackages.fastapi, inventory.fastapi);
});

test("native authority copies multi-chunk payloads with bounded reads", async (t) => {
  const f = fixture(t);
  const content = Buffer.alloc(192 * 1024 + 7, 0x5a);
  fs.writeFileSync(path.join(f.bundleRoot, "runtime", "lib", "component.dylib"), content);
  f.manifest.files[1].size = content.length;
  f.manifest.files[1].sha256 = sha256(content);
  f.manifest.totalBytes = f.manifest.files.reduce((total, file) => total + file.size, 0);
  f.pin();
  const read = fs.readSync;
  let maximum = 0;
  const reads = t.mock.method(fs, "readSync", (fd: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
    maximum = Math.max(maximum, length);
    assert.ok(length <= 64 * 1024);
    return read(fd, buffer, offset, length, position);
  });
  await f.authority().provisionManagedRuntime(f.request());
  assert.equal(maximum, 64 * 1024);
  reads.mock.restore();
  assert.deepEqual(fs.readFileSync(path.join(f.request().runtimePath, "lib", "component.dylib")), content);
});

test("native bundle refuses Darwin kernels older than the selected wheels' macOS 14 floor", (t) => {
  if (process.platform !== "darwin") {
    t.skip("The OS floor is checked against actual Darwin hosts, not simulated platform options.");
    return;
  }
  const f = fixture(t);
  t.mock.method(os, "release", () => "22.6.0");
  assert.throws(() => f.authority(), /requires macOS 14/);
});

test("native bundle rejects unpinned metadata, tampered payload bytes and executable drift", (t) => {
  const f = fixture(t);
  assert.throws(() => f.authority({ manifestSha256: "x".repeat(64) }), /trusted manifest pin/);
  assert.throws(() => f.authority({ manifestSha256: "0".repeat(64) }), /trusted pin/);
  const manifestPath = path.join(f.bundleRoot, "manifest.json");
  fs.appendFileSync(manifestPath, " ");
  assert.throws(() => f.authority(), /manifest digest mismatch/);
  f.pin();
  const libraryPath = path.join(f.bundleRoot, "runtime", "lib", "component.dylib");
  fs.writeFileSync(libraryPath, "x".repeat(Buffer.byteLength(f.library)));
  assert.throws(() => f.authority(), /payload digest mismatch/);
  fs.writeFileSync(libraryPath, f.library);
  fs.chmodSync(libraryPath, 0o755);
  assert.throws(() => f.authority(), /executable mode changed/);
});

test("native bundle requires exact target, Python, manifest revision and core-only packs", (t) => {
  const f = fixture(t);
  assert.throws(() => f.authority({ platform: "linux" }), /incompatible target/);
  assert.throws(() => f.authority({ arch: "x64" }), /incompatible target/);
  for (const update of [
    { target: "linux-x64" }, { pythonVersion: "3.13.15" }, { manifestVersion: "0.0.0" },
    { minimumSystemVersion: "13.0" }, { minimumSystemVersion: "15.0" },
    { packIds: [] }, { packIds: ["core", "ml"] }, { packIds: ["core", "core"] }, { pythonRelativePath: "lib/python3" },
  ]) {
    const previous = { ...f.manifest };
    Object.assign(f.manifest, update);
    f.pin();
    assert.throws(() => f.authority(), /Native runtime bundle refused/);
    Object.assign(f.manifest, previous);
  }
});

test("native bundle audits missing, exact, range and ambiguous installed package versions", (t) => {
  const f = fixture(t);
  for (const installedPackages of [
    { ...inventory, fastapi: "0.1.0" }, { ...inventory, numpy: "3.0.0" }, { ...inventory, pandas: "3.0.0" },
    { ...inventory, pandas: "2.3.0rc1" }, { ...inventory, fastapi: "" }, { ...inventory, FastAPI: inventory.fastapi },
    Object.fromEntries(Object.entries(inventory).filter(([name]) => name !== "scipy")),
  ]) {
    Object.assign(f.manifest, { installedPackages });
    f.pin();
    assert.throws(() => f.authority(), /inventory|package version/);
  }
});

test("native bundle rejects unsafe, duplicate, aliased and file-directory conflicting payload paths", (t) => {
  const f = fixture(t);
  const original = f.manifest.files.map((file) => ({ ...file }));
  for (const filename of ["../escape", "/absolute", "lib\\escape", "lib//empty", "lib/./dot", "", "lib/trailing.", "lib/drive:C"]) {
    f.manifest.files[1].path = filename;
    f.pin();
    assert.throws(() => f.authority(), /payload path/);
  }
  for (const files of [
    [original[0], original[0]],
    [original[0], { ...original[0], path: "BIN/PYTHON3" }],
    [original[0], { ...original[1], path: "BIN/component.dylib" }],
    [original[0], { ...original[1], path: "bin" }],
    [{ ...original[1], path: "bin" }, original[0]],
  ]) {
    f.manifest.files = files;
    f.pin();
    assert.throws(() => f.authority(), /duplicate|conflicting|aliased|directory/);
  }
});

test("native bundle rejects unlisted files and directories at payload and metadata levels", (t) => {
  const f = fixture(t);
  for (const filename of ["unlisted.txt", "runtime/extra.txt", "locks/other.lock.txt", "runtime/lib/extra.txt"]) {
    const fullPath = path.join(f.bundleRoot, filename);
    fs.writeFileSync(fullPath, "extra");
    assert.throws(() => f.authority(), /unlisted/);
    fs.unlinkSync(fullPath);
  }
  fs.mkdirSync(path.join(f.bundleRoot, "runtime", "empty-extra"));
  assert.throws(() => f.authority(), /unlisted/);
});

test("native bundle bounds metadata, file count, per-file sizes and total payload sizes", (t) => {
  const f = fixture(t);
  const originalFiles = f.manifest.files;
  for (const size of [-1, 0.5, 512 * 1024 * 1024 + 1, Number.MAX_SAFE_INTEGER + 1]) {
    f.manifest.files = [originalFiles[0], { ...originalFiles[1], size }];
    f.pin();
    assert.throws(() => f.authority(), /file metadata/);
  }
  f.manifest.files = Array.from({ length: 100_001 }, (_, index) => ({ ...originalFiles[0], path: `file-${index}` }));
  f.pin();
  assert.throws(() => f.authority(), /oversized|inventory size/);
  f.manifest.files = Array.from({ length: 5 }, (_, index) => ({ ...originalFiles[0], path: `file-${index}`, size: 512 * 1024 * 1024 }));
  f.pin();
  assert.throws(() => f.authority(), /total size limit/);
  f.manifest.files = originalFiles;
  f.manifest.totalBytes += 1;
  f.pin();
  assert.throws(() => f.authority(), /total size/);
  fs.truncateSync(path.join(f.bundleRoot, "manifest.json"), 8 * 1024 * 1024 + 1);
  assert.throws(() => f.authority(), /oversized/);
});

test("native authority rejects mismatched verification flags, requirements, packs and lock bytes before staging", async (t) => {
  const f = fixture(t);
  const authority = f.authority();
  const otherLock = path.join(f.root, "other.lock.txt");
  fs.writeFileSync(otherLock, "different lock");
  for (const update of [
    { hashVerified: false }, { requireVerified: false }, { selectedPackIds: [] },
    { selectedPackIds: ["core", "ml"] }, { selectedPackIds: ["core", "core"] },
    { packageSpecs: [] }, { packageSpecs: [...f.request().packageSpecs, "untrusted==1"] },
    { packageSpecs: f.request().packageSpecs.map(() => "fastapi==0.141.1") },
    { lockFiles: [] }, { lockFiles: [otherLock] }, { lockFiles: [...f.request().lockFiles, ...f.request().lockFiles] },
  ]) {
    await assert.rejects(authority.provisionManagedRuntime(f.request(update)), /Native runtime bundle refused/);
    assert.equal(fs.existsSync(f.runtimeRoot), false);
  }
  fs.appendFileSync(path.join(f.bundleRoot, "locks", "core.lock.txt"), "tampered");
  await assert.rejects(authority.provisionManagedRuntime(f.request()), /release lock digest mismatch/);
});

test("native authority permits an identical safe lock copy but refuses symlinked locks", async (t) => {
  const f = fixture(t);
  const authority = f.authority();
  const lockCopy = path.join(f.root, "copy.lock.txt");
  fs.writeFileSync(lockCopy, f.lock);
  await authority.provisionManagedRuntime(f.request({ lockFiles: [lockCopy] }));
  fs.unlinkSync(lockCopy);
  fs.symlinkSync(path.join(f.bundleRoot, "locks", "core.lock.txt"), lockCopy);
  await assert.rejects(authority.provisionManagedRuntime(f.request({ lockFiles: [lockCopy], runtimePath: path.join(f.runtimeRoot, "install-123-457") })), /unsafe/);
});

test("native authority accepts only absent generated direct staging children and preserves collisions", async (t) => {
  const f = fixture(t);
  const authority = f.authority();
  for (const runtimePath of [
    f.runtimeRoot, path.join(f.root, "install-123-456"), path.join(f.runtimeRoot, "current"),
    path.join(f.runtimeRoot, "rollback-123"), path.join(f.runtimeRoot, "nested", "install-123-456"),
    `${f.runtimeRoot}/nested/../install-123-456`,
  ]) {
    await assert.rejects(authority.provisionManagedRuntime(f.request({ runtimePath })), /staging child|canonical absolute/);
  }
  fs.mkdirSync(f.request().runtimePath, { recursive: true });
  const sentinel = path.join(f.request().runtimePath, "keep.txt");
  fs.writeFileSync(sentinel, "existing occupant");
  await assert.rejects(authority.provisionManagedRuntime(f.request()), /already occupied/);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "existing occupant");
});

test("native authority rejects source file, source ancestor and runtime ancestor symlinks", async (t) => {
  const f = fixture(t);
  const source = path.join(f.bundleRoot, "runtime", "lib", "component.dylib");
  const outside = path.join(f.root, "outside-library");
  fs.writeFileSync(outside, f.library);
  fs.unlinkSync(source);
  fs.symlinkSync(outside, source);
  assert.throws(() => f.authority(), /symlink/);
  fs.unlinkSync(source);
  fs.writeFileSync(source, f.library, { mode: 0o644 });
  const bundleAlias = path.join(f.root, "bundle-alias");
  fs.symlinkSync(f.bundleRoot, bundleAlias, "dir");
  assert.throws(() => f.authority({ bundleRoot: bundleAlias }), /unsafe directory ancestor/);
  const outsideRoot = path.join(f.root, "outside-home");
  fs.mkdirSync(outsideRoot);
  fs.symlinkSync(outsideRoot, path.dirname(f.runtimeRoot), "dir");
  assert.throws(() => f.authority(), /unsafe directory ancestor/);
  fs.unlinkSync(path.dirname(f.runtimeRoot));
  const authority = f.authority();
  fs.symlinkSync(outsideRoot, path.dirname(f.runtimeRoot), "dir");
  await assert.rejects(authority.provisionManagedRuntime(f.request()), /unsafe directory ancestor/);
  assert.deepEqual(fs.readdirSync(outsideRoot), []);
});

test("native authority rejects a staging symlink without removing its outside target", async (t) => {
  const f = fixture(t);
  const authority = f.authority();
  fs.mkdirSync(f.runtimeRoot, { recursive: true });
  const outside = path.join(f.root, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "keep.txt"), "keep");
  fs.symlinkSync(outside, f.request().runtimePath, "dir");
  await assert.rejects(authority.provisionManagedRuntime(f.request()), /already occupied/);
  assert.equal(fs.readFileSync(path.join(outside, "keep.txt"), "utf8"), "keep");
  assert.equal(fs.lstatSync(f.request().runtimePath).isSymbolicLink(), true);
});

test("native authority refuses a destination ancestor replaced by a symlink during copy", async (t) => {
  const f = fixture(t);
  const authority = f.authority();
  const outside = path.join(f.root, "outside-destination");
  fs.mkdirSync(outside);
  const staging = f.request().runtimePath;
  const open = fs.openSync;
  const source = path.join(f.bundleRoot, "runtime", "bin", "python3");
  let replaced = false;
  t.mock.method(fs, "openSync", (filename: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
    if (!replaced && filename === source) {
      replaced = true;
      fs.symlinkSync(outside, path.join(staging, "bin"), "dir");
    }
    return open(filename, flags, mode);
  });
  await assert.rejects(authority.provisionManagedRuntime(f.request()), /unsafe directory ancestor/);
  assert.equal(replaced, true);
  assert.equal(fs.existsSync(staging), false);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("native authority rechecks source identity between lstat and no-follow open and cleans owned staging", async (t) => {
  const f = fixture(t);
  const authority = f.authority();
  const source = path.join(f.bundleRoot, "runtime", "bin", "python3");
  const open = fs.openSync;
  let replaced = false;
  t.mock.method(fs, "openSync", (filename: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
    if (!replaced && filename === source) {
      replaced = true;
      fs.renameSync(source, `${source}.original`);
      fs.writeFileSync(source, f.python, { mode: 0o755 });
    }
    return open(filename, flags, mode);
  });
  await assert.rejects(authority.provisionManagedRuntime(f.request()), /source file identity changed/);
  assert.equal(replaced, true);
  assert.equal(fs.existsSync(f.request().runtimePath), false);
});

test("native authority cleans partial staging after late payload tamper while preserving current and rollback", async (t) => {
  const f = fixture(t);
  const authority = f.authority();
  for (const directory of ["current", "rollback-123"]) {
    fs.mkdirSync(path.join(f.runtimeRoot, directory), { recursive: true });
    fs.writeFileSync(path.join(f.runtimeRoot, directory, "keep.txt"), directory);
  }
  fs.writeFileSync(path.join(f.bundleRoot, "runtime", "lib", "component.dylib"), "x".repeat(Buffer.byteLength(f.library)));
  await assert.rejects(authority.provisionManagedRuntime(f.request()), /payload digest mismatch/);
  assert.equal(fs.existsSync(f.request().runtimePath), false);
  for (const directory of ["current", "rollback-123"]) {
    assert.equal(fs.readFileSync(path.join(f.runtimeRoot, directory, "keep.txt"), "utf8"), directory);
  }
});

test("native authority cleans its staging after a filesystem write failure", async (t) => {
  const f = fixture(t);
  const authority = f.authority();
  const failure = new Error("injected write failure");
  t.mock.method(fs, "writeSync", () => { throw failure; });
  await assert.rejects(authority.provisionManagedRuntime(f.request()), (error: unknown) => error === failure);
  assert.equal(fs.existsSync(f.request().runtimePath), false);
});

test("native authority rejects source and destination overlap", (t) => {
  const f = fixture(t);
  for (const runtimeRoot of [f.bundleRoot, path.dirname(f.bundleRoot), path.join(f.bundleRoot, "managed")]) {
    assert.throws(() => f.authority({ runtimeRoot }), /overlap/);
  }
});

test("packaged resolver returns null only for an absent bundle and fails closed on present invalid descriptors", (t) => {
  const f = fixture(t);
  const absent = path.join(f.root, "empty-resources");
  fs.mkdirSync(absent);
  assert.equal(resolvePackagedNativeRuntimeBundleAuthority(absent, f.runtimeRoot), null);
  const release = path.join(f.bundleRoot, "release.json");
  for (const bytes of ["not json", "{}", JSON.stringify({ schemaVersion: 2, manifestSha256: "a".repeat(64) }), JSON.stringify({ schemaVersion: 1, manifestSha256: "bad" })]) {
    fs.writeFileSync(release, bytes);
    assert.throws(() => resolvePackagedNativeRuntimeBundleAuthority(f.resources, f.runtimeRoot), /Native runtime bundle refused/);
  }
  fs.unlinkSync(release);
  assert.throws(() => resolvePackagedNativeRuntimeBundleAuthority(f.resources, f.runtimeRoot));
  f.pin();
  fs.unlinkSync(release);
  const outsideDescriptor = path.join(f.root, "outside-release.json");
  fs.writeFileSync(outsideDescriptor, JSON.stringify({ schemaVersion: 1, manifestSha256: f.pin() }));
  fs.unlinkSync(release);
  fs.symlinkSync(outsideDescriptor, release);
  assert.throws(() => resolvePackagedNativeRuntimeBundleAuthority(f.resources, f.runtimeRoot), /unsafe/);
});

test("packaged native bundle activates through the existing manager and retains prior current as rollback", async (t) => {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    t.skip("Actual manager host selection for this bundle is darwin-arm64 only; portable authority fixtures cover refusal/copy.");
    return;
  }
  const f = fixture(t);
  const beforeData = process.env.LIMURIA_DATA_DIR;
  const beforeResources = process.env.ELECTRON_RESOURCES_PATH;
  process.env.LIMURIA_DATA_DIR = path.dirname(f.runtimeRoot);
  process.env.ELECTRON_RESOURCES_PATH = f.resources;
  t.after(() => {
    if (beforeData === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = beforeData;
    if (beforeResources === undefined) delete process.env.ELECTRON_RESOURCES_PATH;
    else process.env.ELECTRON_RESOURCES_PATH = beforeResources;
  });
  fs.mkdirSync(path.join(f.runtimeRoot, "current"), { recursive: true });
  fs.writeFileSync(path.join(f.runtimeRoot, "current", "prior.txt"), "prior runtime");
  const authority = resolvePackagedNativeRuntimeBundleAuthority(f.resources, f.runtimeRoot);
  assert.ok(authority);
  const result = await installManagedRuntime(["core"], [], {
    isolationMode: "strict", requireVerified: true, strictProvisioningAuthority: authority,
  });
  assert.equal(result.state.hashVerified, true);
  assert.equal(result.state.runtimePath, path.join(f.runtimeRoot, "current"));
  assert.ok(result.state.rollbackPath);
  assert.equal(fs.readFileSync(path.join(result.state.rollbackPath, "prior.txt"), "utf8"), "prior runtime");
  assert.equal(fs.readFileSync(path.join(result.state.runtimePath, "bin", "python3"), "utf8"), f.python);
  assert.equal(readManagedRuntimeState()?.runtimePath, result.state.runtimePath);
  const activatedState = fs.readFileSync(path.join(f.runtimeRoot, "managed-state.json"), "utf8");
  fs.writeFileSync(path.join(f.bundleRoot, "runtime", "lib", "component.dylib"), "x".repeat(Buffer.byteLength(f.library)));
  await assert.rejects(installManagedRuntime(["core"], [], {
    isolationMode: "strict", requireVerified: true, strictProvisioningAuthority: authority,
  }), /payload digest mismatch/);
  assert.equal(fs.readFileSync(path.join(f.runtimeRoot, "managed-state.json"), "utf8"), activatedState);
  assert.equal(fs.readFileSync(path.join(result.state.runtimePath, "bin", "python3"), "utf8"), f.python);
  assert.equal(fs.readFileSync(path.join(result.state.rollbackPath, "prior.txt"), "utf8"), "prior runtime");
});

});
