import assert from "node:assert/strict";
import test from "node:test";
import {
  CommunityPythonRuntimeUnavailableError,
  COMMUNITY_PYTHON_PACK_ID,
  communityPythonRuntimeStatus,
  resolveCommunityPythonExecutable,
} from "./communityPythonRuntime";
import type { ManagedRuntimeState } from "./pythonRuntimeManager";

function state(overrides: Partial<ManagedRuntimeState> = {}): ManagedRuntimeState {
  return {
    manifestVersion: "1.1.0",
    installedAt: "2026-09-27T00:00:00.000Z",
    runtimePath: "/Users/test/.limuria-terminal/python-runtimes/current",
    rollbackPath: null,
    selectedPackIds: ["core", COMMUNITY_PYTHON_PACK_ID],
    selectedReleasePackIds: [],
    packageOutput: "",
    installedSpecs: ["yfinance==1.5.1"],
    hashVerified: false,
    verificationWarnings: [],
    ...overrides,
  };
}

const packagedRetailEnv = {
  LIOS_SOFTWARE_PROFILE: "retail",
  ELECTRON_RESOURCES_PATH: "/Applications/LiOS.app/Contents/Resources",
  PYTHON_EXECUTABLE: "/ambient/should-never-run/python3",
} satisfies NodeJS.ProcessEnv;

test("packaged retail community helpers use the selected managed runtime only", () => {
  const managed = "/Users/test/.limuria-terminal/python-runtimes/current/bin/python3";
  const resolved = resolveCommunityPythonExecutable({
    env: packagedRetailEnv,
    platform: "darwin",
    state: state(),
    existsSync: (candidate) => candidate === managed,
  });
  assert.deepEqual(resolved, {
    executable: managed,
    authority: "managed_runtime",
    packId: "community-yahoo",
  });
});

test("managed Windows runtime uses Scripts/python.exe and never the ambient interpreter", () => {
  const runtimePath = "C:\\LiOS Home\\python-runtimes\\current";
  const executable = "C:\\LiOS Home\\python-runtimes\\current\\Scripts\\python.exe";
  const resolved = resolveCommunityPythonExecutable({
    env: packagedRetailEnv,
    platform: "win32",
    state: state({ runtimePath }),
    existsSync: (candidate) => candidate === executable,
  });
  assert.equal(resolved.executable, executable);
  assert.equal(resolved.authority, "managed_runtime");
});

test("packaged retail fails closed when community-yahoo is unselected", () => {
  assert.throws(
    () => resolveCommunityPythonExecutable({
      env: packagedRetailEnv,
      platform: "darwin",
      state: state({ selectedPackIds: ["core"] }),
      existsSync: () => true,
    }),
    CommunityPythonRuntimeUnavailableError,
  );
});

test("packaged retail fails closed when selected managed runtime executable is missing", () => {
  assert.throws(
    () => resolveCommunityPythonExecutable({
      env: packagedRetailEnv,
      platform: "darwin",
      state: state(),
      existsSync: () => false,
    }),
    /selected but its managed Python runtime is unavailable/,
  );
  const status = communityPythonRuntimeStatus({
    env: packagedRetailEnv,
    platform: "darwin",
    state: state(),
    existsSync: () => false,
  });
  assert.equal(status.available, false);
  assert.equal(status.authority, "unavailable");
  assert.match(status.detail, /Repair or reinstall/);
});

test("development and hosted contexts preserve explicit Python configuration", () => {
  const resolved = resolveCommunityPythonExecutable({
    env: { PYTHON_EXECUTABLE: "/opt/lios-dev/python3" },
    platform: "darwin",
    state: null,
    existsSync: () => false,
  });
  assert.equal(resolved.executable, "/opt/lios-dev/python3");
  assert.equal(resolved.authority, "configured_dev");
});

test("development may retain ambient discovery without weakening packaged retail", () => {
  const resolved = resolveCommunityPythonExecutable({
    env: {},
    platform: "darwin",
    state: null,
    existsSync: (candidate) => candidate === "/opt/homebrew/bin/python3",
  });
  assert.equal(resolved.executable, "/opt/homebrew/bin/python3");
  assert.equal(resolved.authority, "ambient_dev");

  const fallback = resolveCommunityPythonExecutable({
    env: {},
    platform: "linux",
    state: null,
    existsSync: () => false,
  });
  assert.equal(fallback.executable, "python3");
  assert.equal(fallback.authority, "ambient_dev");
});
