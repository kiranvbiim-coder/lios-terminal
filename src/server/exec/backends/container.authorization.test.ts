import assert from "node:assert/strict";
import test from "node:test";
import { createContainerExecutionBackend } from "./container";
import { ExecutionBackendUnavailableError } from "./types";
import type { ExecutionBackendRequest } from "./types";

const IMAGE = "ghcr.io/example/lios-sandbox@sha256:" + "a".repeat(64);

function backend() {
  return createContainerExecutionBackend({
    engine: "docker",
    engineTarget: "unix:///var/run/docker.sock",
    image: IMAGE,
    user: "10001:10001",
    maxMemoryBytes: 512 * 1024 * 1024,
    maxProcesses: 64,
  });
}

function request(signal?: AbortSignal): ExecutionBackendRequest {
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
    signal,
  };
}

test("prepared container sandbox retains the live authorization signal", async () => {
  const controller = new AbortController();
  const plan = await backend().prepare(request(controller.signal));

  assert.equal(plan.signal, controller.signal);
  controller.abort(new Error("revoked after admission"));
  assert.equal(plan.signal?.aborted, true);
});

test("pre-cancelled container sandbox fails with a secret-safe typed error", async () => {
  const sentinel = "PRIVATE_CONTAINER_ABORT_SENTINEL_2f4c";

  await assert.rejects(
    () => backend().prepare(request(AbortSignal.abort(new Error(sentinel)))),
    (error: unknown) => {
      assert.ok(error instanceof ExecutionBackendUnavailableError);
      assert.equal(error.reason, "authorization-cancelled");
      assert.equal(error.message.includes(sentinel), false);
      return true;
    },
  );
});
