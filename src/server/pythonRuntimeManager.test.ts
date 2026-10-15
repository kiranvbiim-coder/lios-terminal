import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  installManagedRuntime,
  ManagedRuntimeVerificationError,
  StrictProvisioningAuthorityError,
  managedRuntimePythonPath,
  readManagedRuntimeState,
  rollbackManagedRuntime,
  type StrictProvisioningAuthority,
} from "./pythonRuntimeManager";
import { MANAGED_RUNTIME_MANIFEST } from "./runtimeManifest";

test("managed runtime state fails closed when no installation exists", () => {
  const previous = process.env.LIMURIA_DATA_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-runtime-test-"));
  process.env.LIMURIA_DATA_DIR = directory;
  try {
    assert.equal(readManagedRuntimeState(), null);
    assert.equal(managedRuntimePythonPath(), null);
  } finally {
    if (previous === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("strict managed runtime provisioning fails closed before mutation without an authority", async () => {
  const previous = process.env.LIMURIA_DATA_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-runtime-strict-missing-authority-"));
  process.env.LIMURIA_DATA_DIR = directory;
  try {
    await assert.rejects(
      installManagedRuntime(["core"], [], { isolationMode: "strict" }),
      (error: unknown) => error instanceof StrictProvisioningAuthorityError
        && error.code === "strict_provisioning_authority_missing",
    );
    assert.equal(fs.existsSync(path.join(directory, "python-runtimes")), false);
    assert.equal(readManagedRuntimeState(), null);
  } finally {
    if (previous === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("strict managed runtime provisioning delegates the staging mutation to the governed authority", async (t) => {
  if (!MANAGED_RUNTIME_MANIFEST.supportedPlatforms.includes(`${process.platform}-${process.arch}`)) {
    t.skip("The managed runtime does not support this test host.");
    return;
  }
  const previous = process.env.LIMURIA_DATA_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-runtime-strict-authority-"));
  process.env.LIMURIA_DATA_DIR = directory;
  const calls: string[] = [];
  const authority: StrictProvisioningAuthority = {
    async provisionManagedRuntime(request) {
      calls.push(request.runtimePath);
      assert.ok(request.runtimePath.startsWith(path.join(directory, "python-runtimes", "install-")));
      assert.deepEqual(request.selectedPackIds, ["core"]);
      assert.ok(request.packageSpecs.length > 0);
      assert.equal(request.hashVerified, false);

      const python = process.platform === "win32"
        ? path.join(request.runtimePath, "Scripts", "python.exe")
        : path.join(request.runtimePath, "bin", "python3");
      fs.mkdirSync(path.dirname(python), { recursive: true });
      fs.writeFileSync(python, "governed-runtime");

      const core = MANAGED_RUNTIME_MANIFEST.packs.find((pack) => pack.id === "core");
      assert.ok(core);
      const installedPackages = Object.fromEntries(core.packages.map((pkg) => [pkg.name, pkg.version]));
      return {
        packageOutput: "provisioned by strict authority",
        installedPackages,
      };
    },
  };

  try {
    const result = await installManagedRuntime(["core"], [], {
      isolationMode: "strict",
      strictProvisioningAuthority: authority,
    });
    assert.equal(calls.length, 1);
    assert.equal(result.state.packageOutput, "provisioned by strict authority");
    assert.equal(result.state.runtimePath, path.join(directory, "python-runtimes", "current"));
    assert.ok(managedRuntimePythonPath());
  } finally {
    if (previous === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("release-qualified install refuses absent platform wheel hashes before staging", async (t) => {
  if (!MANAGED_RUNTIME_MANIFEST.supportedPlatforms.includes(`${process.platform}-${process.arch}`)) {
    t.skip("The managed runtime does not support this test host.");
    return;
  }
  const previous = process.env.LIMURIA_DATA_DIR;
  const previousResources = process.env.ELECTRON_RESOURCES_PATH;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-runtime-release-locks-"));
  process.env.LIMURIA_DATA_DIR = directory;
  process.env.ELECTRON_RESOURCES_PATH = directory;
  try {
    await assert.rejects(
      installManagedRuntime(["core"], [], { requireVerified: true }),
      (error: unknown) => error instanceof ManagedRuntimeVerificationError
        && error.code === "unverified_release_hashes",
    );
    assert.equal(readManagedRuntimeState(), null);
    assert.equal(fs.existsSync(path.join(directory, "python-runtimes")), false);
  } finally {
    if (previous === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = previous;
    if (previousResources === undefined) delete process.env.ELECTRON_RESOURCES_PATH;
    else process.env.ELECTRON_RESOURCES_PATH = previousResources;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("managed runtime rollback restores the previous runtime pack-selection metadata", async () => {
  const previous = process.env.LIMURIA_DATA_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-runtime-rollback-test-"));
  process.env.LIMURIA_DATA_DIR = directory;
  const root = path.join(directory, "python-runtimes");
  const current = path.join(root, "current");
  const rollback = path.join(root, "rollback-123456");
  fs.mkdirSync(current, { recursive: true });
  fs.mkdirSync(rollback, { recursive: true });
  fs.writeFileSync(path.join(current, "current-marker.txt"), "current");
  fs.writeFileSync(path.join(rollback, "previous-marker.txt"), "previous");

  const currentState = {
    manifestVersion: "1.0.0",
    installedAt: "2026-09-23T00:00:00.000Z",
    runtimePath: current,
    rollbackPath: rollback,
    selectedPackIds: ["core", "ml"],
    selectedReleasePackIds: ["core", "quant"],
    packageOutput: "",
    installedSpecs: ["scikit-learn==1.9.0"],
    hashVerified: false,
    verificationWarnings: [],
  };
  const previousState = {
    manifestVersion: "1.0.0",
    installedAt: "2026-09-22T00:00:00.000Z",
    runtimePath: rollback,
    rollbackPath: null,
    selectedPackIds: ["core", "research-sec"],
    selectedReleasePackIds: ["core", "research"],
    packageOutput: "",
    installedSpecs: ["edgartools==5.51.0"],
    hashVerified: true,
    verificationWarnings: [],
  };
  fs.writeFileSync(path.join(root, "managed-state.json"), JSON.stringify(currentState, null, 2));
  fs.writeFileSync(path.join(rollback, ".lios-runtime-state.json"), JSON.stringify(previousState, null, 2));

  try {
    const result = await rollbackManagedRuntime();
    assert.deepEqual(result.state.selectedReleasePackIds, ["core", "research"]);
    assert.deepEqual(result.state.selectedPackIds, ["core", "research-sec"]);
    assert.equal(result.state.hashVerified, true);
    assert.equal(fs.readFileSync(path.join(current, "previous-marker.txt"), "utf8"), "previous");
    assert.ok(result.state.rollbackPath);
    assert.equal(fs.readFileSync(path.join(result.state.rollbackPath!, "current-marker.txt"), "utf8"), "current");
    assert.deepEqual(readManagedRuntimeState()?.selectedReleasePackIds, ["core", "research"]);
  } finally {
    if (previous === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SI-07.10 corrupted rollback metadata cannot move directories outside the managed runtime root", async () => {
  const previousRoot = process.env.LIMURIA_DATA_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-rollback-outside-"));
  process.env.LIMURIA_DATA_DIR = directory;
  const root = path.join(directory, "python-runtimes");
  const current = path.join(root, "current");
  const outside = path.join(directory, "unrelated-private-data");
  fs.mkdirSync(current, { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(current, "keep.txt"), "current");
  fs.writeFileSync(path.join(outside, "keep.txt"), "private");
  const saved = {
    manifestVersion: MANAGED_RUNTIME_MANIFEST.manifestVersion,
    installedAt: "2026-10-15T00:00:00.000Z",
    runtimePath: current,
    rollbackPath: outside,
    selectedPackIds: ["core"],
    selectedReleasePackIds: [],
    packageOutput: "",
    installedSpecs: [],
    hashVerified: false,
    verificationWarnings: [],
  };
  fs.writeFileSync(path.join(root, "managed-state.json"), JSON.stringify(saved));
  try {
    await assert.rejects(rollbackManagedRuntime(), /No safe managed runtime rollback/);
    assert.equal(fs.readFileSync(path.join(outside, "keep.txt"), "utf8"), "private");
    assert.equal(fs.readFileSync(path.join(current, "keep.txt"), "utf8"), "current");
    assert.equal(fs.existsSync(path.join(root, ".lios-runtime-state.json")), false);
  } finally {
    if (previousRoot === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = previousRoot;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SI-07.10 rollback refuses a numeric-named symlink to an external directory", async (t) => {
  const previousRoot = process.env.LIMURIA_DATA_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-rollback-symlink-"));
  process.env.LIMURIA_DATA_DIR = directory;
  const root = path.join(directory, "python-runtimes");
  const current = path.join(root, "current");
  const outside = path.join(directory, "other-data");
  const link = path.join(root, "rollback-654321");
  fs.mkdirSync(current, { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(current, "keep.txt"), "current");
  fs.writeFileSync(path.join(outside, "keep.txt"), "outside");
  try {
    try {
      fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      t.skip("Host cannot create directory symlinks: " + (error instanceof Error ? error.message : String(error)));
      return;
    }
    const state = {
      manifestVersion: MANAGED_RUNTIME_MANIFEST.manifestVersion,
      installedAt: "2026-10-15T00:00:00.000Z",
      runtimePath: current,
      rollbackPath: link,
      selectedPackIds: ["core"],
      selectedReleasePackIds: [],
      packageOutput: "",
      installedSpecs: [],
      hashVerified: false,
      verificationWarnings: [],
    };
    fs.writeFileSync(path.join(root, "managed-state.json"), JSON.stringify(state));
    await assert.rejects(rollbackManagedRuntime(), /No safe managed runtime rollback/);
    assert.equal(fs.readFileSync(path.join(outside, "keep.txt"), "utf8"), "outside");
    assert.equal(fs.readFileSync(path.join(current, "keep.txt"), "utf8"), "current");
  } finally {
    if (previousRoot === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = previousRoot;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SI-07.10 successful governed install never deletes an outside path named by previous rollback metadata", async (t) => {
  if (!MANAGED_RUNTIME_MANIFEST.supportedPlatforms.includes(`${process.platform}-${process.arch}`)) {
    t.skip("Managed runtime unsupported on this test host");
    return;
  }
  const previousRoot = process.env.LIMURIA_DATA_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-rollback-cleanup-"));
  process.env.LIMURIA_DATA_DIR = directory;
  const root = path.join(directory, "python-runtimes");
  const current = path.join(root, "current");
  const outside = path.join(directory, "valuable-user-folder");
  fs.mkdirSync(current, { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "keep.txt"), "safe");
  const saved = {
    manifestVersion: MANAGED_RUNTIME_MANIFEST.manifestVersion,
    installedAt: "2026-10-15T00:00:00.000Z",
    runtimePath: current,
    rollbackPath: outside,
    selectedPackIds: ["core"],
    selectedReleasePackIds: [],
    packageOutput: "",
    installedSpecs: [],
    hashVerified: false,
    verificationWarnings: [],
  };
  fs.writeFileSync(path.join(root, "managed-state.json"), JSON.stringify(saved));
  const authority: StrictProvisioningAuthority = {
    async provisionManagedRuntime(request) {
      fs.mkdirSync(request.runtimePath, { recursive: true });
      const core = MANAGED_RUNTIME_MANIFEST.packs.find((pack) => pack.id === "core");
      assert.ok(core);
      return {
        packageOutput: "mock governed staging",
        installedPackages: Object.fromEntries(core.packages.map((pkg) => [pkg.name, pkg.version])),
      };
    },
  };
  try {
    const result = await installManagedRuntime(["core"], [], {
      isolationMode: "strict", strictProvisioningAuthority: authority,
    });
    assert.equal(result.state.selectedPackIds.includes("core"), true);
    assert.equal(fs.readFileSync(path.join(outside, "keep.txt"), "utf8"), "safe");
    assert.ok(fs.existsSync(current));
  } finally {
    if (previousRoot === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = previousRoot;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SI-07.10 failed rollback activation restores current and preserves prior rollback for retry", async (t) => {
  const previousRoot = process.env.LIMURIA_DATA_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-rollback-atomic-rename-"));
  process.env.LIMURIA_DATA_DIR = directory;
  const root = path.join(directory, "python-runtimes");
  const current = path.join(root, "current");
  const previous = path.join(root, "rollback-10101");
  fs.mkdirSync(current, { recursive: true });
  fs.mkdirSync(previous);
  fs.writeFileSync(path.join(current, "current.txt"), "still-current");
  fs.writeFileSync(path.join(previous, "previous.txt"), "still-previous");
  const state = {
    manifestVersion: MANAGED_RUNTIME_MANIFEST.manifestVersion,
    installedAt: "2026-10-15T00:00:00.000Z",
    runtimePath: current,
    rollbackPath: previous,
    selectedPackIds: ["core"],
    selectedReleasePackIds: ["quant"],
    packageOutput: "",
    installedSpecs: [],
    hashVerified: true,
    verificationWarnings: [],
  };
  const saved = JSON.stringify(state);
  fs.writeFileSync(path.join(root, "managed-state.json"), saved);
  const originalRename = fs.renameSync.bind(fs);
  try {
    const simulated = t.mock.method(fs, "renameSync", (from: fs.PathLike, to: fs.PathLike) => {
      if (String(from) === previous && String(to) === current) {
        throw new Error("simulated second rename failure");
      }
      return originalRename(from, to);
    });
    await assert.rejects(rollbackManagedRuntime(), /simulated second rename failure/);
    simulated.mock.restore();
    assert.equal(fs.readFileSync(path.join(current, "current.txt"), "utf8"), "still-current");
    assert.equal(fs.readFileSync(path.join(previous, "previous.txt"), "utf8"), "still-previous");
    assert.equal(fs.readFileSync(path.join(root, "managed-state.json"), "utf8"), saved);
    assert.deepEqual(fs.readdirSync(root).sort(), ["current", "managed-state.json", "rollback-10101"]);
    // This remains an actionable rollback after the temporary failure.
    const retried = await rollbackManagedRuntime();
    assert.equal(retried.state.selectedReleasePackIds.length, 0);
    assert.equal(fs.readFileSync(path.join(current, "previous.txt"), "utf8"), "still-previous");
    assert.match(path.basename(retried.state.rollbackPath!), /^rollback-\d+$/);
  } finally {
    if (previousRoot === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = previousRoot;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SI-07.10 failed post-activation state persistence restores both runtimes and state", async (t) => {
  const previousRoot = process.env.LIMURIA_DATA_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-rollback-state-write-"));
  process.env.LIMURIA_DATA_DIR = directory;
  const root = path.join(directory, "python-runtimes");
  const current = path.join(root, "current");
  const previous = path.join(root, "rollback-20202");
  const stateFile = path.join(root, "managed-state.json");
  fs.mkdirSync(current, { recursive: true });
  fs.mkdirSync(previous);
  fs.writeFileSync(path.join(current, "current.txt"), "current");
  fs.writeFileSync(path.join(previous, "previous.txt"), "previous");
  const state = {
    manifestVersion: MANAGED_RUNTIME_MANIFEST.manifestVersion,
    installedAt: "2026-10-15T00:00:00.000Z",
    runtimePath: current,
    rollbackPath: previous,
    selectedPackIds: ["core"],
    selectedReleasePackIds: [],
    packageOutput: "",
    installedSpecs: [],
    hashVerified: false,
    verificationWarnings: [],
  };
  const saved = JSON.stringify(state);
  fs.writeFileSync(stateFile, saved);
  const originalWrite = fs.writeFileSync.bind(fs);
  let injected = false;
  try {
    const simulated = t.mock.method(fs, "writeFileSync", (...args: Parameters<typeof fs.writeFileSync>) => {
      if (!injected && String(args[0]) === stateFile) {
        injected = true;
        throw new Error("simulated metadata write failure");
      }
      return originalWrite(...args);
    });
    await assert.rejects(rollbackManagedRuntime(), /simulated metadata write failure/);
    simulated.mock.restore();
    assert.equal(injected, true);
    assert.equal(fs.readFileSync(path.join(current, "current.txt"), "utf8"), "current");
    assert.equal(fs.readFileSync(path.join(previous, "previous.txt"), "utf8"), "previous");
    assert.equal(fs.readFileSync(stateFile, "utf8"), saved);
    assert.deepEqual(fs.readdirSync(root).sort(), ["current", "managed-state.json", "rollback-20202"]);
  } finally {
    if (previousRoot === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = previousRoot;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SI-07.10 rollback rejects a symlinked runtime state snapshot before moving directories", async (t) => {
  const previousRoot = process.env.LIMURIA_DATA_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-rollback-snapshot-link-"));
  process.env.LIMURIA_DATA_DIR = directory;
  const root = path.join(directory, "python-runtimes");
  const current = path.join(root, "current");
  const previous = path.join(root, "rollback-30303");
  const outside = path.join(directory, "outside.json");
  fs.mkdirSync(current, { recursive: true });
  fs.mkdirSync(previous);
  fs.writeFileSync(outside, "private");
  fs.writeFileSync(path.join(current, "current.txt"), "current");
  try {
    try {
      fs.symlinkSync(outside, path.join(current, ".lios-runtime-state.json"), "file");
    } catch (error) {
      t.skip("Host cannot create symlinks: " + (error instanceof Error ? error.message : String(error)));
      return;
    }
    const state = {
      manifestVersion: MANAGED_RUNTIME_MANIFEST.manifestVersion,
      installedAt: "2026-10-15T00:00:00.000Z",
      runtimePath: current,
      rollbackPath: previous,
      selectedPackIds: ["core"],
      selectedReleasePackIds: [],
      packageOutput: "",
      installedSpecs: [],
      hashVerified: true,
      verificationWarnings: [],
    };
    fs.writeFileSync(path.join(root, "managed-state.json"), JSON.stringify(state));
    await assert.rejects(rollbackManagedRuntime(), /snapshot path is unsafe/);
    assert.equal(fs.readFileSync(outside, "utf8"), "private");
    assert.equal(fs.readFileSync(path.join(current, "current.txt"), "utf8"), "current");
    assert.ok(fs.existsSync(previous));
  } finally {
    if (previousRoot === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = previousRoot;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
