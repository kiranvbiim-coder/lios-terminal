import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installManagedRuntime, ManagedRuntimeVerificationError, managedRuntimePythonPath, readManagedRuntimeState, rollbackManagedRuntime } from "./pythonRuntimeManager";
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
  const rollback = path.join(root, "rollback-previous");
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
