import assert from "node:assert/strict";
import test from "node:test";
import { strictSandboxInventoryFingerprint } from "./strict-sandbox-inventory";

const PROFILE_KEYS = [
  "LIOS_EXECUTION_ISOLATION",
  "LIOS_EXECUTION_SANDBOX_ENGINE",
  "LIOS_EXECUTION_SANDBOX_TARGET",
  "LIOS_EXECUTION_SANDBOX_IMAGE",
  "LIOS_EXECUTION_SANDBOX_USER",
  "LIOS_EXECUTION_SANDBOX_SHELL",
  "LIOS_EXECUTION_SANDBOX_BASE64",
  "LIOS_EXECUTION_SANDBOX_TAR",
  "LIOS_EXECUTION_SANDBOX_PYTHON",
  "LIOS_EXECUTION_SANDBOX_NODE",
  "LIOS_EXECUTION_SANDBOX_XLSX",
  "LIOS_EXECUTION_SANDBOX_MAX_MEMORY_BYTES",
  "LIOS_EXECUTION_SANDBOX_MAX_PROCESSES",
  "LIOS_EXECUTION_SANDBOX_WORKSPACE_BYTES",
] as const;

test("Doctor's cached Python inventory invalidates on every strict backend input", () => {
  const baseline: NodeJS.ProcessEnv = {
    LIOS_EXECUTION_ISOLATION: "strict",
    LIOS_EXECUTION_SANDBOX_ENGINE: "docker",
    LIOS_EXECUTION_SANDBOX_TARGET: "unix:///var/run/docker.sock",
    LIOS_EXECUTION_SANDBOX_IMAGE: "sha256:" + "a".repeat(64),
  };
  const original = strictSandboxInventoryFingerprint(baseline);
  for (const key of PROFILE_KEYS) {
    const changed = { ...baseline, [key]: "CHANGED_FOR_TEST" };
    assert.notEqual(strictSandboxInventoryFingerprint(changed), original, `cache stayed valid after ${key} changed`);
  }
});

test("Python inventory cache key is stable for unrelated runtime and user secrets", () => {
  const input: NodeJS.ProcessEnv = { LIOS_EXECUTION_ISOLATION: "strict", LIOS_EXECUTION_SANDBOX_PYTHON: "/opt/venv/bin/python" };
  assert.equal(strictSandboxInventoryFingerprint(input), strictSandboxInventoryFingerprint({ ...input, API_KEY: "do-not-leak", PATH: "/usr/bin" }));
  assert.notEqual(strictSandboxInventoryFingerprint({ ...input, LIOS_EXECUTION_SANDBOX_PYTHON: "" }), strictSandboxInventoryFingerprint(input));
  assert.equal(strictSandboxInventoryFingerprint(input), strictSandboxInventoryFingerprint({ ...input }));
});
