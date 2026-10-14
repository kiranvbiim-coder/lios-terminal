import assert from "node:assert/strict";
import test from "node:test";
import { createProcessSupervisor } from "./index";
import { runExecutionBackendRequest } from "./run-backend";
import { ExecutionBackendUnavailableError } from "./backends/types";
import type { ExecutionBackend, ExecutionBackendRequest } from "./backends/types";

function request(signal?: AbortSignal): ExecutionBackendRequest {
  return {
    argv: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
    isolation: { filesystem: "host", network: "inherit", processes: "host" },
    resources: { maxWallTimeMs: 2_000, maxCapturedOutputChars: 8_192 },
    signal,
  };
}

function backend(planSignal?: AbortSignal): ExecutionBackend {
  return {
    id: "test.authorization-backend",
    capabilities: {
      filesystem: ["host"],
      network: ["inherit"],
      processes: ["host"],
      resourceControls: ["wall-time", "captured-output"],
    },
    async prepare(input) {
      return {
        backendId: "test.authorization-backend",
        spawn: {
          mode: "child",
          argv: [...input.argv],
          scopeKey: input.scopeKey,
          timeoutMs: input.resources.maxWallTimeMs,
          maxCapturedOutputChars: input.resources.maxCapturedOutputChars,
          captureOutput: true,
        },
        signal: planSignal,
        facts: {
          isolation: { ...input.isolation },
          resources: { ...input.resources },
        },
      };
    },
  };
}

test("pre-cancelled request fails with a secret-safe typed authorization error", async () => {
  const sentinel = "PRIVATE_RUNNER_ABORT_SENTINEL_245";
  const supervisor = createProcessSupervisor();
  try {
    await assert.rejects(
      () => runExecutionBackendRequest(
        backend(),
        request(AbortSignal.abort(new Error(sentinel))),
        supervisor,
      ),
      (error: unknown) => {
        assert.ok(error instanceof ExecutionBackendUnavailableError);
        assert.equal(error.reason, "authorization-cancelled");
        assert.equal(error.message.includes(sentinel), false);
        return true;
      },
    );
  } finally {
    await supervisor.shutdown().catch(() => undefined);
  }
});

test("backend-plan authorization signal remains live through execution", { timeout: 10_000 }, async () => {
  const controller = new AbortController();
  const supervisor = createProcessSupervisor();
  try {
    const running = runExecutionBackendRequest(backend(controller.signal), request(), supervisor);
    setTimeout(() => controller.abort(new Error("policy revoked after admission")), 50).unref?.();
    const result = await running;
    assert.equal(result.exit.reason, "manual-cancel");
  } finally {
    await supervisor.shutdown().catch(() => undefined);
  }
});

test("backend-plan signal already cancelled after prepare fails before spawn without leaking reason", async () => {
  const sentinel = "PRIVATE_PLAN_ABORT_SENTINEL_245";
  const supervisor = createProcessSupervisor();
  try {
    await assert.rejects(
      () => runExecutionBackendRequest(
        backend(AbortSignal.abort(new Error(sentinel))),
        request(),
        supervisor,
      ),
      (error: unknown) => {
        assert.ok(error instanceof ExecutionBackendUnavailableError);
        assert.equal(error.reason, "authorization-cancelled");
        assert.equal(error.message.includes(sentinel), false);
        return true;
      },
    );
  } finally {
    await supervisor.shutdown().catch(() => undefined);
  }
});
