import assert from "node:assert/strict";
import test from "node:test";
import { createContainerExecutionBackend } from "./container";
import type { ExecutionBackendRequest } from "./types";

const IMAGE = "ghcr.io/example/lios-sandbox@sha256:" + "a".repeat(64);
const TOTAL_MEMORY_LIMIT = 128 * 1024 * 1024;

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
      maxMemoryBytes: TOTAL_MEMORY_LIMIT,
      maxProcesses: 8,
    },
  };
}

test("Podman keeps total memory plus swap within the admitted LiOS memory ceiling", async () => {
  const backend = createContainerExecutionBackend({
    engine: "podman",
    engineTarget: "unix:///run/user/1000/podman/podman.sock",
    image: IMAGE,
    user: "10001:10001",
    maxMemoryBytes: 512 * 1024 * 1024,
    maxProcesses: 64,
  });

  const plan = await backend.prepare(request());
  const memory = plan.spawn.argv.find((value) => value.startsWith("--memory="));
  const total = plan.spawn.argv.find((value) => value.startsWith("--memory-swap="));

  assert.equal(total, `--memory-swap=${TOTAL_MEMORY_LIMIT}b`);
  assert.ok(memory, "Podman plan must retain a resident-memory ceiling");
  const residentBytes = Number(memory!.slice("--memory=".length, -1));
  assert.ok(residentBytes > 0);
  assert.ok(residentBytes < TOTAL_MEMORY_LIMIT, "Podman requires memory-swap total to exceed memory");
  assert.ok(TOTAL_MEMORY_LIMIT - residentBytes <= 4096, "only one page is reserved for swap");
});

test("Podman refuses a total memory ceiling too small to preserve memory-swap ordering", async () => {
  const backend = createContainerExecutionBackend({
    engine: "podman",
    engineTarget: "unix:///run/user/1000/podman/podman.sock",
    image: IMAGE,
    user: "10001:10001",
    maxMemoryBytes: 4096,
    maxProcesses: 64,
  });

  await assert.rejects(
    () => backend.prepare({
      ...request(),
      resources: {
        ...request().resources,
        maxMemoryBytes: 4096,
      },
    }),
    /resource-limit-invalid/,
  );
});
