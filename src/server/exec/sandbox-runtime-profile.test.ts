import assert from "node:assert/strict";
import test from "node:test";
import {
  SandboxRuntimeConfigurationError,
  effectiveSandboxIsolationMode,
  resolveSandboxRuntimeProfile,
  sandboxIsolationMode,
} from "./sandbox-runtime-profile";

const IMAGE = "ghcr.io/limuria/lios-sandbox@sha256:" + "a".repeat(64);
const DOCKER_TARGET = "unix:///var/run/docker.sock";
const WINDOWS_DOCKER_TARGET = "npipe:////./pipe/docker_engine";
const PODMAN_TARGET = "unix:///run/user/1000/podman/podman.sock";

test("sandbox runtime defaults to explicit legacy-host compatibility", () => {
  assert.equal(sandboxIsolationMode({}), "legacy-host");
  const profile = resolveSandboxRuntimeProfile({});
  assert.equal(profile.mode, "legacy-host");
  assert.equal(profile.backend, null);
  assert.equal(profile.image, null);
  assert.equal(profile.engineTarget, null);
});

test("global strict mode cannot be downgraded by a legacy-host caller hint", () => {
  const strictEnv = { LIOS_EXECUTION_ISOLATION: "strict" };
  assert.equal(effectiveSandboxIsolationMode(undefined, strictEnv), "strict");
  assert.equal(effectiveSandboxIsolationMode("legacy-host", strictEnv), "strict");
  assert.equal(effectiveSandboxIsolationMode("strict", {}), "strict");
  assert.equal(effectiveSandboxIsolationMode(undefined, {}), "legacy-host");
});

test("strict sandbox profile requires engine, explicit local target and immutable image", () => {
  assert.throws(
    () => resolveSandboxRuntimeProfile({ LIOS_EXECUTION_ISOLATION: "strict" }),
    SandboxRuntimeConfigurationError,
  );
  assert.throws(
    () => resolveSandboxRuntimeProfile({
      LIOS_EXECUTION_ISOLATION: "strict",
      LIOS_EXECUTION_SANDBOX_ENGINE: "docker",
      LIOS_EXECUTION_SANDBOX_IMAGE: IMAGE,
    }),
    /SANDBOX_TARGET/,
  );
  assert.throws(
    () => resolveSandboxRuntimeProfile({
      LIOS_EXECUTION_ISOLATION: "strict",
      LIOS_EXECUTION_SANDBOX_ENGINE: "docker",
      LIOS_EXECUTION_SANDBOX_TARGET: DOCKER_TARGET,
      LIOS_EXECUTION_SANDBOX_IMAGE: "ubuntu:latest",
    }),
    /immutable sha256 digest/,
  );
  assert.throws(
    () => resolveSandboxRuntimeProfile({
      LIOS_EXECUTION_ISOLATION: "strict",
      LIOS_EXECUTION_SANDBOX_ENGINE: "docker",
      LIOS_EXECUTION_SANDBOX_TARGET: "tcp://127.0.0.1:2375",
      LIOS_EXECUTION_SANDBOX_IMAGE: IMAGE,
    }),
    /explicit local unix:\/\/ socket or Windows npipe:\/\/ endpoint/,
  );
});

test("strict profile rejects engine/socket mismatch before any numerical worker can launch", () => {
  for (const [engine, target, explanation] of [
    ["docker", PODMAN_TARGET, /Podman socket must be paired/],
    ["podman", WINDOWS_DOCKER_TARGET, /Podman execution cannot use a Windows Docker named-pipe/],
  ] as const) {
    assert.throws(() => resolveSandboxRuntimeProfile({
      LIOS_EXECUTION_ISOLATION: "strict",
      LIOS_EXECUTION_SANDBOX_ENGINE: engine,
      LIOS_EXECUTION_SANDBOX_TARGET: target,
      LIOS_EXECUTION_SANDBOX_IMAGE: IMAGE,
    }), (error: unknown) =>
      error instanceof SandboxRuntimeConfigurationError &&
      explanation.test(error.message));
  }
});

test("strict profile accepts the explicit local Windows Docker named pipe", () => {
  const profile = resolveSandboxRuntimeProfile({
    LIOS_EXECUTION_ISOLATION: "strict",
    LIOS_EXECUTION_SANDBOX_ENGINE: "docker",
    LIOS_EXECUTION_SANDBOX_TARGET: WINDOWS_DOCKER_TARGET,
    LIOS_EXECUTION_SANDBOX_IMAGE: IMAGE,
  });
  assert.equal(profile.mode, "strict");
  assert.equal(profile.engine, "docker");
  assert.equal(profile.engineTarget, WINDOWS_DOCKER_TARGET);
  assert.equal(profile.backend?.id, "lios.execution.docker");
});

test("strict profile builds the canonical container backend and pinned in-image tools", () => {
  const profile = resolveSandboxRuntimeProfile({
    LIOS_EXECUTION_ISOLATION: "strict",
    LIOS_EXECUTION_SANDBOX_ENGINE: "podman",
    LIOS_EXECUTION_SANDBOX_TARGET: PODMAN_TARGET,
    LIOS_EXECUTION_SANDBOX_IMAGE: IMAGE,
    LIOS_EXECUTION_SANDBOX_USER: "10001:10001",
    LIOS_EXECUTION_SANDBOX_PYTHON: "/opt/lios/python",
    LIOS_EXECUTION_SANDBOX_NODE: "/opt/lios/node",
    LIOS_EXECUTION_SANDBOX_XLSX: "/opt/lios/xlsx",
  });
  assert.equal(profile.mode, "strict");
  assert.equal(profile.engine, "podman");
  assert.equal(profile.engineTarget, PODMAN_TARGET);
  assert.equal(profile.image, IMAGE);
  assert.equal(profile.backend?.id, "lios.execution.podman");
  assert.equal(profile.tools.python, "/opt/lios/python");
  assert.equal(profile.tools.node, "/opt/lios/node");
  assert.equal(profile.tools.xlsxModule, "/opt/lios/xlsx");
});

test("strict profile rejects malformed mode, tool paths and resource ceilings", () => {
  assert.throws(
    () => sandboxIsolationMode({ LIOS_EXECUTION_ISOLATION: "sometimes" }),
    /legacy-host or strict/,
  );
  assert.throws(
    () => resolveSandboxRuntimeProfile({
      LIOS_EXECUTION_ISOLATION: "strict",
      LIOS_EXECUTION_SANDBOX_ENGINE: "docker",
      LIOS_EXECUTION_SANDBOX_TARGET: DOCKER_TARGET,
      LIOS_EXECUTION_SANDBOX_IMAGE: IMAGE,
      LIOS_EXECUTION_SANDBOX_PYTHON: "python3",
    }),
    /absolute NUL-free/,
  );
  assert.throws(
    () => resolveSandboxRuntimeProfile({
      LIOS_EXECUTION_ISOLATION: "strict",
      LIOS_EXECUTION_SANDBOX_ENGINE: "docker",
      LIOS_EXECUTION_SANDBOX_TARGET: DOCKER_TARGET,
      LIOS_EXECUTION_SANDBOX_IMAGE: IMAGE,
      LIOS_EXECUTION_SANDBOX_MAX_PROCESSES: "0",
    }),
    /positive integer/,
  );
});
