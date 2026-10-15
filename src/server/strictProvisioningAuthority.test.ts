import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {
  createStrictProvisioningAuthority,
  StrictProvisioningAuthorityError,
  type StrictProvisioningCommandRunner,
} from "./strictProvisioningAuthority";

test("SI-07 strict provisioning authority rejects staging outside the managed runtime root before execution", async () => {
  const calls: unknown[] = [];
  const run: StrictProvisioningCommandRunner = async (input) => {
    calls.push(input);
    return { stdout: "", stderr: "", wallDurationMs: 1 };
  };
  const root = path.join(os.tmpdir(), "lios-runtime-root");
  const authority = createStrictProvisioningAuthority({ run, pythonExecutable: "python3", platform: "linux" });

  await assert.rejects(
    authority.provision({
      runtimeRoot: root,
      stagingPath: path.join(os.tmpdir(), "install-escape"),
      specs: ["numpy==2.3.3"],
      lockFiles: [],
      requireHashes: false,
    }),
    (error: unknown) => error instanceof StrictProvisioningAuthorityError && error.code === "staging_path_outside_runtime_root",
  );
  assert.deepEqual(calls, []);
});

test("SI-07 strict provisioning authority rejects non-LiOS staging names before execution", async () => {
  const calls: unknown[] = [];
  const run: StrictProvisioningCommandRunner = async (input) => {
    calls.push(input);
    return { stdout: "", stderr: "", wallDurationMs: 1 };
  };
  const root = path.join(os.tmpdir(), "lios-runtime-root");
  const authority = createStrictProvisioningAuthority({ run, pythonExecutable: "python3", platform: "linux" });

  await assert.rejects(
    authority.provision({
      runtimeRoot: root,
      stagingPath: path.join(root, "current"),
      specs: ["numpy==2.3.3"],
      lockFiles: [],
      requireHashes: false,
    }),
    (error: unknown) => error instanceof StrictProvisioningAuthorityError && error.code === "invalid_staging_path",
  );
  assert.deepEqual(calls, []);
});

test("SI-07 strict provisioning authority exposes only the fixed venv, install and package-audit command sequence", async () => {
  const calls: Array<{ argv: string[]; cwd?: string; envProfile?: string }> = [];
  const run: StrictProvisioningCommandRunner = async (input) => {
    calls.push({ argv: [...input.argv], cwd: input.cwd, envProfile: input.envProfile });
    if (input.argv.includes("list")) {
      return {
        stdout: JSON.stringify([{ name: "numpy", version: "2.3.3" }]),
        stderr: "",
        wallDurationMs: 1,
      };
    }
    return { stdout: input.argv.includes("install") ? "installed" : "", stderr: "", wallDurationMs: 1 };
  };
  const root = path.join(os.tmpdir(), "lios-runtime-root");
  const stagingPath = path.join(root, "install-123-456");
  const authority = createStrictProvisioningAuthority({ run, pythonExecutable: "/usr/bin/python3", platform: "linux" });

  const result = await authority.provision({
    runtimeRoot: root,
    stagingPath,
    specs: ["numpy==2.3.3"],
    lockFiles: [],
    requireHashes: false,
  });

  const pip = path.join(stagingPath, "bin", "pip");
  assert.deepEqual(calls.map((call) => call.argv), [
    ["/usr/bin/python3", "-m", "venv", stagingPath],
    [pip, "install", "--disable-pip-version-check", "numpy==2.3.3"],
    [pip, "list", "--format=json", "--disable-pip-version-check"],
  ]);
  assert.equal(calls[1]?.cwd, stagingPath);
  assert.ok(calls.every((call) => call.envProfile === "python-runtime"));
  assert.equal(result.packageOutput, "installed");
  assert.deepEqual(result.installedPackages, { numpy: "2.3.3" });
});
