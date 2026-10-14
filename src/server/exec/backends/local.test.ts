import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCAL_EXECUTION_BACKEND_ID,
  LOCAL_MAX_CAPTURED_OUTPUT_CHARS,
  LOCAL_MAX_WALL_TIME_MS,
  localExecutionBackend,
} from "./local";
import { ExecutionBackendUnavailableError } from "./types";
import type { ExecutionBackendRequest } from "./types";

function request(overrides: Partial<ExecutionBackendRequest> = {}): ExecutionBackendRequest {
  return {
    argv: [process.execPath, "-e", "process.stdout.write('ok')"],
    isolation: { filesystem: "host", network: "inherit", processes: "host" },
    resources: { maxWallTimeMs: 5_000, maxCapturedOutputChars: 8_192 },
    ...overrides,
  };
}

test("local backend truthfully advertises only controls it enforces", () => {
  assert.equal(localExecutionBackend.id, LOCAL_EXECUTION_BACKEND_ID);
  assert.deepEqual(localExecutionBackend.capabilities.filesystem, ["host"]);
  assert.deepEqual(localExecutionBackend.capabilities.network, ["inherit"]);
  assert.deepEqual(localExecutionBackend.capabilities.processes, ["host"]);
  assert.deepEqual(localExecutionBackend.capabilities.resourceControls, ["wall-time", "captured-output"]);
});

test("local backend converts admitted bounds into the existing GM-10 spawn contract", async () => {
  const controller = new AbortController();
  const source = request({
    env: { LIOS_TEST_VALUE: "one" },
    signal: controller.signal,
    envProfile: "default",
    argv0: "approved-node",
    windowsVerbatimArguments: false,
    stdinMode: "pipe-closed",
  });
  const plan = await localExecutionBackend.prepare(source);

  assert.equal(plan.backendId, LOCAL_EXECUTION_BACKEND_ID);
  assert.deepEqual(plan.spawn.argv, source.argv);
  assert.equal(plan.spawn.timeoutMs, 5_000);
  assert.equal(plan.spawn.maxCapturedOutputChars, 8_192);
  assert.equal(plan.spawn.captureOutput, true);
  assert.equal(plan.spawn.envProfile, "default");
  assert.equal(plan.spawn.argv0, "approved-node");
  assert.equal(plan.spawn.windowsVerbatimArguments, false);
  assert.equal(plan.spawn.stdinMode, "pipe-closed");
  assert.equal(plan.signal, controller.signal, "live cancellation authority remains attached to the plan");
  assert.deepEqual(plan.facts.isolation, source.isolation);
  assert.deepEqual(plan.facts.resources, source.resources);

  source.argv[0] = "changed-after-admission";
  source.env!.LIOS_TEST_VALUE = "changed";
  source.resources.maxWallTimeMs = 1;
  assert.equal(plan.spawn.argv[0], process.execPath, "launch plan snapshots argv");
  assert.equal(plan.spawn.env?.LIOS_TEST_VALUE, "one", "launch plan snapshots env");
  assert.equal(plan.facts.resources.maxWallTimeMs, 5_000, "receipt facts snapshot limits");
  controller.abort(new Error("revoked after admission"));
  assert.equal(plan.signal?.aborted, true, "post-admission revocation remains observable");
});

for (const [name, isolation, expected] of [
  [
    "filesystem",
    { filesystem: "workspace-readonly", network: "inherit", processes: "host" },
    "filesystem-isolation-unsupported",
  ],
  [
    "sandbox filesystem",
    { filesystem: "sandbox", network: "inherit", processes: "host" },
    "filesystem-isolation-unsupported",
  ],
  [
    "network",
    { filesystem: "host", network: "deny", processes: "host" },
    "network-isolation-unsupported",
  ],
  [
    "process",
    { filesystem: "host", network: "inherit", processes: "deny-child-process" },
    "process-isolation-unsupported",
  ],
  [
    "sandbox process",
    { filesystem: "host", network: "inherit", processes: "sandbox" },
    "process-isolation-unsupported",
  ],
] as const) {
  test(`local backend rejects required ${name} isolation instead of pretending to sandbox`, async () => {
    await assert.rejects(
      () => localExecutionBackend.prepare(request({ isolation })),
      (error: unknown) => {
        assert.ok(error instanceof ExecutionBackendUnavailableError);
        assert.equal(error.reason, expected);
        return true;
      },
    );
  });
}

test("local backend rejects CPU/RAM/storage/process-count controls it cannot prove", async () => {
  for (const resources of [
    { maxWallTimeMs: 5_000, maxCapturedOutputChars: 8_192, maxCpuTimeMs: 2_000 },
    { maxWallTimeMs: 5_000, maxCapturedOutputChars: 8_192, maxMemoryBytes: 64 * 1024 * 1024 },
    { maxWallTimeMs: 5_000, maxCapturedOutputChars: 8_192, maxStorageBytes: 1024 * 1024 },
    { maxWallTimeMs: 5_000, maxCapturedOutputChars: 8_192, maxProcesses: 1 },
  ]) {
    await assert.rejects(
      () => localExecutionBackend.prepare(request({ resources })),
      (error: unknown) => {
        assert.ok(error instanceof ExecutionBackendUnavailableError);
        assert.equal(error.reason, "resource-control-unsupported");
        return true;
      },
    );
  }
});

test("local backend validates bounded wall time and retained output", async () => {
  for (const resources of [
    { maxWallTimeMs: 0, maxCapturedOutputChars: 8_192 },
    { maxWallTimeMs: LOCAL_MAX_WALL_TIME_MS + 1, maxCapturedOutputChars: 8_192 },
    { maxWallTimeMs: 5_000, maxCapturedOutputChars: 255 },
    { maxWallTimeMs: 5_000, maxCapturedOutputChars: LOCAL_MAX_CAPTURED_OUTPUT_CHARS + 1 },
  ]) {
    await assert.rejects(
      () => localExecutionBackend.prepare(request({ resources })),
      (error: unknown) => {
        assert.ok(error instanceof ExecutionBackendUnavailableError);
        assert.equal(error.reason, "resource-limit-invalid");
        return true;
      },
    );
  }
});

test("malformed argv is rejected before backend admission", async () => {
  await assert.rejects(
    () => localExecutionBackend.prepare(request({ argv: ["node\0evil"] })),
    (error: unknown) => {
      assert.ok(error instanceof ExecutionBackendUnavailableError);
      assert.equal(error.reason, "request-invalid");
      return true;
    },
  );
});

test("already-cancelled authority fails closed without leaking the abort reason", async () => {
  const secret = "sentinel-private-abort-context";
  await assert.rejects(
    () => localExecutionBackend.prepare(request({ signal: AbortSignal.abort(new Error(secret)) })),
    (error: unknown) => {
      assert.ok(error instanceof ExecutionBackendUnavailableError);
      assert.equal(error.reason, "authorization-cancelled");
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});
