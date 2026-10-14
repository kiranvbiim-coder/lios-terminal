import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { nodePermissionExecutionBackend } from "./node-permission";
import { ExecutionBackendUnavailableError } from "./types";
import type { ExecutionBackendRequest } from "./types";

function request(cwd: string, signal?: AbortSignal): ExecutionBackendRequest {
  return {
    argv: [process.execPath, "-e", "0"],
    cwd,
    isolation: {
      filesystem: "none",
      network: "deny",
      processes: "deny-child-process",
    },
    resources: { maxWallTimeMs: 5_000, maxCapturedOutputChars: 8_192 },
    signal,
  };
}

test("prepared node sandbox retains the live authorization signal", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-node-permission-auth-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const controller = new AbortController();

  const plan = await nodePermissionExecutionBackend.prepare(request(cwd, controller.signal));

  assert.equal(plan.signal, controller.signal);
  controller.abort(new Error("revoked after admission"));
  assert.equal(plan.signal?.aborted, true);
});

test("pre-cancelled node sandbox fails with a secret-safe typed error", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-node-permission-auth-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const sentinel = "PRIVATE_ABORT_SENTINEL_9fd7";

  await assert.rejects(
    () => nodePermissionExecutionBackend.prepare(
      request(cwd, AbortSignal.abort(new Error(sentinel))),
    ),
    (error: unknown) => {
      assert.ok(error instanceof ExecutionBackendUnavailableError);
      assert.equal(error.reason, "authorization-cancelled");
      assert.equal(error.message.includes(sentinel), false);
      return true;
    },
  );
});

test("node sandbox refuses workspace-scoped filesystem modes until symlink-safe isolation exists", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-node-permission-auth-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

  for (const filesystem of ["workspace-readonly", "workspace-readwrite"] as const) {
    await assert.rejects(
      () => nodePermissionExecutionBackend.prepare({
        ...request(cwd),
        isolation: {
          filesystem,
          network: "deny",
          processes: "deny-child-process",
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof ExecutionBackendUnavailableError);
        assert.equal(error.reason, "filesystem-isolation-unsupported");
        return true;
      },
    );
  }
});

test("node sandbox preserves safe GM-10 launch semantics in its final spawn plan", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-node-permission-auth-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

  const plan = await nodePermissionExecutionBackend.prepare({
    ...request(cwd),
    env: { LIOS_TEST_FLAG: "safe" },
    envProfile: "default",
    argv0: "lios-node-sandbox",
    windowsVerbatimArguments: false,
    stdinMode: "pipe-open",
    input: "fixed-input",
  });

  assert.deepEqual(plan.spawn.env, { LIOS_TEST_FLAG: "safe" });
  assert.equal(plan.spawn.envProfile, "default");
  assert.equal(plan.spawn.argv0, "lios-node-sandbox");
  assert.equal(plan.spawn.windowsVerbatimArguments, false);
  assert.equal(plan.spawn.stdinMode, "pipe-open");
  assert.equal(plan.spawn.input, "fixed-input");
});

test("node sandbox refuses inherited host stdin", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-node-permission-auth-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

  await assert.rejects(
    () => nodePermissionExecutionBackend.prepare({ ...request(cwd), stdinMode: "inherit" }),
    (error: unknown) => {
      assert.ok(error instanceof ExecutionBackendUnavailableError);
      assert.equal(error.reason, "request-invalid");
      return true;
    },
  );
});

test("node sandbox refuses Windows verbatim argument mode", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-node-permission-auth-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

  await assert.rejects(
    () => nodePermissionExecutionBackend.prepare({
      ...request(cwd),
      windowsVerbatimArguments: true,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ExecutionBackendUnavailableError);
      assert.equal(error.reason, "request-invalid");
      return true;
    },
  );
});

test("node sandbox refuses the Python-only child environment profile", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-node-permission-auth-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

  await assert.rejects(
    () => nodePermissionExecutionBackend.prepare({
      ...request(cwd),
      envProfile: "python-runtime",
      env: { PYTHONPATH: "/private/runtime" },
    }),
    (error: unknown) => {
      assert.ok(error instanceof ExecutionBackendUnavailableError);
      assert.equal(error.reason, "request-invalid");
      return true;
    },
  );
});
