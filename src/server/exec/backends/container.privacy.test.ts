import assert from "node:assert/strict";
import test from "node:test";
import { createContainerExecutionBackend } from "./container";
import type { ExecutionBackendRequest } from "./types";

const IMAGE = "ghcr.io/example/lios-sandbox@sha256:" + "a".repeat(64);

function request(): ExecutionBackendRequest {
  return {
    argv: ["/bin/sh", "-lc", "printf sensitive-output"],
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

for (const [engine, engineTarget] of [
  ["docker", "unix:///var/run/docker.sock"],
  ["podman", "unix:///run/user/1000/podman/podman.sock"],
] as const) {
  test(`${engine} sandbox disables engine logs and image-defined healthchecks`, async () => {
    const backend = createContainerExecutionBackend({
      engine,
      engineTarget,
      image: IMAGE,
      user: "10001:10001",
      maxMemoryBytes: 512 * 1024 * 1024,
      maxProcesses: 64,
    });

    const plan = await backend.prepare(request());

    assert.ok(
      plan.spawn.argv.includes("--log-driver=none"),
      "GM-10 owns bounded output and trust evidence; the container engine must not persist a second log copy",
    );
    assert.ok(
      plan.spawn.argv.includes("--no-healthcheck"),
      "the image must not execute an unapproved HEALTHCHECK alongside the exact admitted operation",
    );
  });
}
