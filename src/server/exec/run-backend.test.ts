import assert from "node:assert/strict";
import test from "node:test";
import { createProcessSupervisor } from "./index";
import { runExecutionBackendRequest } from "./run-backend";
import type {
  ExecutionBackend,
  ExecutionBackendRequest,
} from "./backends/types";

function request(signal?: AbortSignal): ExecutionBackendRequest {
  return {
    argv: [process.execPath, "-e", "process.stdout.write('ok')"],
    isolation: { filesystem: "host", network: "inherit", processes: "host" },
    resources: { maxWallTimeMs: 5_000, maxCapturedOutputChars: 8_192 },
    signal,
  };
}

function backend(events: string[] = []): ExecutionBackend {
  return {
    id: "test.backend",
    capabilities: {
      filesystem: ["host"],
      network: ["inherit"],
      processes: ["host"],
      resourceControls: ["wall-time", "captured-output"],
    },
    async prepare(input) {
      events.push("prepare");
      return {
        backendId: "test.backend",
        spawn: {
          mode: "child",
          argv: [...input.argv],
          scopeKey: input.scopeKey,
          timeoutMs: input.resources.maxWallTimeMs,
          maxCapturedOutputChars: input.resources.maxCapturedOutputChars,
          captureOutput: true,
        },
        lifecycle: {
          onCancel() {
            events.push("cancel");
          },
          async finalize() {
            events.push("finalize");
            return {};
          },
        },
        facts: {
          isolation: { ...input.isolation },
          resources: { ...input.resources },
        },
      };
    },
  };
}

test("one-shot backend runner executes then finalizes after native extinction", { timeout: 10_000 }, async () => {
  const events: string[] = [];
  const supervisor = createProcessSupervisor();
  try {
    const result = await runExecutionBackendRequest(backend(events), request(), supervisor);
    assert.equal(result.exit.reason, "exit");
    assert.equal(result.exit.exitCode, 0);
    assert.equal(result.exit.stdout, "ok");
    assert.deepEqual(events, ["prepare", "finalize"]);
  } finally {
    await supervisor.shutdown();
  }
});

test("AbortSignal cancels a running backend request and still finalizes", { timeout: 10_000 }, async () => {
  const events: string[] = [];
  const supervisor = createProcessSupervisor();
  const controller = new AbortController();
  const slow: ExecutionBackend = {
    ...backend(events),
    async prepare(input) {
      const plan = await backend(events).prepare(input);
      return {
        ...plan,
        spawn: {
          ...plan.spawn,
          argv: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
          onCancel(reason) {
            events.push("cancel:" + reason);
            plan.lifecycle?.onCancel(reason);
          },
        },
      };
    },
  };
  try {
    const running = runExecutionBackendRequest(slow, request(controller.signal), supervisor);
    setTimeout(() => controller.abort(new Error("stop")), 50).unref?.();
    const result = await running;
    assert.equal(result.exit.reason, "manual-cancel");
    assert.ok(events.includes("cancel:manual-cancel"));
    assert.ok(events.includes("finalize"));
  } finally {
    await supervisor.shutdown();
  }
});

test("caller-provided shared scope is refused", async () => {
  const supervisor = createProcessSupervisor();
  try {
    await assert.rejects(
      () => runExecutionBackendRequest(
        backend(),
        { ...request(), scopeKey: "project:shared" },
        supervisor,
      ),
      /owns its cleanup scope/,
    );
  } finally {
    await supervisor.shutdown();
  }
});

test("spawn construction failure releases the private scope then finalizes", async () => {
  const events: string[] = [];
  const supervisor = createProcessSupervisor();
  const invalid: ExecutionBackend = {
    ...backend(events),
    async prepare(input) {
      const plan = await backend(events).prepare(input);
      return { ...plan, spawn: { ...plan.spawn, argv: [] } };
    },
  };
  try {
    await assert.rejects(
      () => runExecutionBackendRequest(invalid, request(), supervisor),
      /spawn argv cannot be empty/,
    );
    assert.deepEqual(events, ["prepare", "finalize"]);
  } finally {
    await supervisor.shutdown();
  }
});

test("backend finalization is skipped when native extinction cannot be proven", async () => {
  const events: string[] = [];
  const extinctionFailure = new Error("native extinction unknown");
  const scopeFailure = new Error("scope extinction unknown");
  const supervisor = {
    acquireScopeCleanup() {
      return async () => {
        events.push("scope-close");
        throw scopeFailure;
      };
    },
    async spawn() {
      return {
        activity: Object.freeze({ resultSettled: true, lastOutputAtMs: Date.now() }),
        runId: "test-run",
        startedAtMs: Date.now(),
        wait: async () => ({
          reason: "exit" as const,
          exitCode: 0,
          exitSignal: null,
          durationMs: 1,
          stdout: "",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
          timedOut: false,
          noOutputTimedOut: false,
        }),
        waitForExtinction: async () => {
          events.push("extinction");
          throw extinctionFailure;
        },
        cancel() {},
      };
    },
    cancel() {},
    cancelScope() {},
    async shutdown() {},
  };

  const guarded: ExecutionBackend = {
    ...backend(events),
    async prepare(input) {
      const plan = await backend(events).prepare(input);
      return {
        ...plan,
        lifecycle: {
          onCancel() {},
          async finalize() {
            events.push("finalize");
            return {};
          },
        },
      };
    },
  };

  await assert.rejects(
    () => runExecutionBackendRequest(guarded, request(), supervisor),
    AggregateError,
  );
  assert.equal(events.includes("finalize"), false);
  assert.ok(events.includes("extinction"));
  assert.ok(events.includes("scope-close"));
});

test("backend finalization failure is surfaced after process completion", async () => {
  const supervisor = createProcessSupervisor();
  const failing: ExecutionBackend = {
    ...backend(),
    async prepare(input) {
      const plan = await backend().prepare(input);
      return {
        ...plan,
        lifecycle: {
          onCancel() {},
          async finalize() {
            throw new Error("finalization failed");
          },
        },
      };
    },
  };
  try {
    await assert.rejects(
      () => runExecutionBackendRequest(failing, request(), supervisor),
      /finalization failed/,
    );
  } finally {
    await supervisor.shutdown().catch(() => undefined);
  }
});
