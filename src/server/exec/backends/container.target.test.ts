import assert from "node:assert/strict";
import test from "node:test";
import { createContainerExecutionBackend } from "./container";
import type { ExecutionBackendRequest } from "./types";

const IMAGE = "ghcr.io/example/lios-sandbox@sha256:" + "a".repeat(64);

function request(): ExecutionBackendRequest {
  return {
    argv: ["/bin/sh", "-lc", "printf ok"],
    isolation: {
      filesystem: "sandbox",
      network: "deny",
      processes: "sandbox",
    },
    resources: {
      maxWallTimeMs: 5_000,
      maxCapturedOutputChars: 8_192,
    },
  };
}

function config(engine: "docker" | "podman", engineTarget: string) {
  return {
    engine,
    engineTarget,
    image: IMAGE,
    user: "10001:10001",
    maxMemoryBytes: 512 * 1024 * 1024,
    maxProcesses: 64,
  } as const;
}

test("Docker launch pins the configured local Unix engine target before run", async () => {
  const backend = createContainerExecutionBackend(
    config("docker", "unix:///var/run/docker.sock"),
  );

  const plan = await backend.prepare(request());
  assert.deepEqual(plan.spawn.argv.slice(0, 3), [
    "docker",
    "--host=unix:///var/run/docker.sock",
    "run",
  ]);
});

test("Docker launch supports the explicit local Windows named pipe without inheriting a context", async () => {
  const backend = createContainerExecutionBackend(
    config("docker", "npipe:////./pipe/docker_engine"),
  );

  const plan = await backend.prepare(request());
  assert.deepEqual(plan.spawn.argv.slice(0, 3), [
    "docker",
    "--host=npipe:////./pipe/docker_engine",
    "run",
  ]);
});

test("Podman launch pins the configured local engine target before run", async () => {
  const backend = createContainerExecutionBackend(
    config("podman", "unix:///run/user/1000/podman/podman.sock"),
  );

  const plan = await backend.prepare(request());
  assert.deepEqual(plan.spawn.argv.slice(0, 3), [
    "podman",
    "--url=unix:///run/user/1000/podman/podman.sock",
    "run",
  ]);
});

test("remote or ambiguous engine targets are rejected instead of inheriting CLI context", () => {
  for (const engineTarget of [
    "tcp://127.0.0.1:2375",
    "ssh://user@127.0.0.1:2222/run/podman/podman.sock",
    "unix://remote/run/docker.sock",
    "unix:relative.sock",
    "unix:///",
    "npipe:////remote/pipe/docker_engine",
    "npipe:////./pipe/../escape",
  ]) {
    assert.throws(
      () => createContainerExecutionBackend(config("docker", engineTarget)),
      /explicit local unix:\/\/ socket or Windows npipe:\/\/ endpoint/,
    );
  }
});
