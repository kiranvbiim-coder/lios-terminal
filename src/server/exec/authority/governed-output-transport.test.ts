import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setImmediate as nextTurn, setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import {
  createExecutionPolicySnapshot,
  ExecutionAuthorizationLease,
} from "../execution-authorization";
import { runPreparedSpawn } from "../run-command";
import { createStubChildAdapter, createStubSupervisor } from "../supervisor.test-support";
import type {
  ExecutionBackend,
  ExecutionBackendLifecycle,
  ExecutionBackendRequest,
} from "../backends/types";
import {
  executePreparedGovernedCommand,
  GovernedCommandAdmissionError,
  prepareAnalyzedGovernedCommand,
} from "./governed-command";

const policyRevision = crypto.createHash("sha256").update("governed-output-policy").digest("hex");
const returnedBytes = Buffer.from("ok");
const returnedFile = Object.freeze({
  path: "result.txt",
  size: returnedBytes.length,
  sha256: crypto.createHash("sha256").update(returnedBytes).digest("hex"),
  data: returnedBytes,
});

function request(cwd: string): ExecutionBackendRequest {
  return {
    argv: [process.execPath, "-e", "process.stdout.write('work')"],
    cwd,
    isolation: { filesystem: "host", network: "inherit", processes: "host" },
    resources: { maxWallTimeMs: 5_000, maxCapturedOutputChars: 8_192 },
  };
}

function authorization(prepared: { approvalDigest: string; operation: { digest: string } }) {
  const now = Date.now();
  return {
    approvedOperationDigest: prepared.operation.digest,
    approvedDigest: prepared.approvalDigest,
    lease: new ExecutionAuthorizationLease(createExecutionPolicySnapshot({
      permissionClass: "user_confirm",
      policyRevision,
      issuedAtMs: now - 1_000,
      expiresAtMs: now + 60_000,
    })),
    currentPolicy: () => ({ permissionClass: "user_confirm" as const, policyRevision }),
  };
}

function privateTransportBackend(input: {
  mismatchRawCallback?: boolean;
  acceptExit?: ExecutionBackendLifecycle["acceptExit"];
} = {}): ExecutionBackend {
  return {
    id: "test.private-output",
    capabilities: {
      filesystem: ["host"],
      network: ["inherit"],
      processes: ["host"],
      resourceControls: ["wall-time", "captured-output"],
    },
    async prepare(source) {
      const stdoutRaw = (_chunk: Buffer) => undefined;
      const stderrRaw = (_chunk: Buffer) => undefined;
      const lifecycle: ExecutionBackendLifecycle = {
        onCancel() {},
        onStdoutRaw: stdoutRaw,
        onStderrRaw: stderrRaw,
        acceptExit: input.acceptExit ?? ((exit) => ({ ...exit, stdout: "sanitized", stderr: "" })),
        async finalize() {
          return { workspaceOutputs: [returnedFile] };
        },
      };
      return {
        backendId: "test.private-output",
        spawn: {
          mode: "child" as const,
          argv: [...source.argv],
          cwd: source.cwd,
          timeoutMs: source.resources.maxWallTimeMs,
          maxCapturedOutputChars: source.resources.maxCapturedOutputChars,
          captureOutput: false,
          onStdoutRaw: input.mismatchRawCallback ? (_chunk: Buffer) => undefined : stdoutRaw,
          onStderrRaw: stderrRaw,
          scopeKey: source.scopeKey,
          onCancel: lifecycle.onCancel,
        },
        signal: source.signal,
        lifecycle,
        facts: {
          isolation: { ...source.isolation },
          resources: { ...source.resources },
          runtimeGenerationId: "lios-exec-test-private-output-00000001",
        },
      };
    },
  };
}

async function waitForAdapter(createAdapter: ReturnType<typeof createStubSupervisor>["createAdapter"], ready: Promise<void>, execution: Promise<unknown>): Promise<void> {
  await Promise.race([ready, execution.then(() => { throw new Error("Execution finished before native adapter construction"); })]);
  await nextTurn();
  assert.equal(createAdapter.mock.calls.length, 1, "expected one native adapter");
}

test("GM-11 admits lifecycle-bound private output transport and returns only sanitized output", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-private-output-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const prepared = await prepareAnalyzedGovernedCommand({
    backend: privateTransportBackend(),
    request: request(cwd),
  });
  const launch = prepared.launchSnapshot();
  assert.equal(launch.captureOutput, false);
  assert.equal(typeof launch.onStdoutRaw, "function");
  assert.equal(typeof prepared.lifecycle()?.acceptExit, "function");

  const adapter = createStubChildAdapter({ autoExtinction: false });
  const { supervisor, createAdapter, adapterCreated } = createStubSupervisor([adapter]);
  t.after(async () => supervisor.shutdown());
  const execution = executePreparedGovernedCommand(prepared, authorization(prepared), supervisor);
  await waitForAdapter(createAdapter, adapterCreated, execution);
  adapter.emitStdoutRaw(Buffer.from("private-frame-must-not-return"));
  adapter.settle(0);
  adapter.settleExtinction();
  const result = await execution;
  assert.equal(result.stdout, "sanitized");
  assert.equal(result.stdout.includes("private-frame-must-not-return"), false);
  assert.equal(result.backendFinalization?.workspaceOutputs?.[0]?.path, "result.txt");
  assert.equal(result.backendFinalization?.workspaceOutputs?.[0]?.data.toString("utf8"), "ok");
});

test("GM-11 rejects raw output callbacks that are not bound to the backend lifecycle", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-private-output-unbound-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  await assert.rejects(
    () => prepareAnalyzedGovernedCommand({
      backend: privateTransportBackend({ mismatchRawCallback: true }),
      request: request(cwd),
    }),
    (error: unknown) => {
      assert.ok(error instanceof GovernedCommandAdmissionError);
      assert.equal(error.reason, "backend-control-field-unsupported");
      return true;
    },
  );
});

test("canonical GM-10 join accepts private output only after native extinction and before finalization", async (t) => {
  const events: string[] = [];
  let raw = "";
  const stdoutRaw = (chunk: Buffer) => { raw += chunk.toString("utf8"); };
  const lifecycle: ExecutionBackendLifecycle = {
    onCancel() {},
    onStdoutRaw: stdoutRaw,
    onStderrRaw: (_chunk: Buffer) => undefined,
    acceptExit(exit) {
      events.push("accept");
      return { ...exit, stdout: "clean", stderr: "" };
    },
    async finalize() {
      events.push("finalize");
      return { workspaceOutputs: [returnedFile] };
    },
  };
  const adapter = createStubChildAdapter({ autoExtinction: false });
  const { supervisor, createAdapter, adapterCreated } = createStubSupervisor([adapter]);
  t.after(async () => supervisor.shutdown());
  const execution = runPreparedSpawn({
    mode: "child",
    argv: [process.execPath, "-e", ""],
    timeoutMs: 5_000,
    maxCapturedOutputChars: 8_192,
    captureOutput: false,
    onStdoutRaw: stdoutRaw,
    onStderrRaw: lifecycle.onStderrRaw,
    onCancel: lifecycle.onCancel,
  }, undefined, supervisor, { lifecycle });
  await waitForAdapter(createAdapter, adapterCreated, execution);
  adapter.emitStdoutRaw(Buffer.from("private-frame"));
  adapter.settle(0);
  await delay(10);
  assert.deepEqual(events, [], "private transport cannot be accepted before native extinction");
  adapter.settleExtinction();
  const result = await execution;
  assert.equal(raw, "private-frame");
  assert.deepEqual(events, ["accept", "finalize"]);
  assert.equal(result.stdout, "clean");
  assert.equal(result.backendFinalization?.workspaceOutputs?.[0]?.data.toString("utf8"), "ok");
});

test("private output acceptance failure still finalizes the backend before surfacing the error", async (t) => {
  const events: string[] = [];
  const lifecycle: ExecutionBackendLifecycle = {
    onCancel() {},
    onStdoutRaw: (_chunk: Buffer) => undefined,
    onStderrRaw: (_chunk: Buffer) => undefined,
    acceptExit() {
      events.push("accept");
      throw new Error("private transport invalid");
    },
    async finalize() {
      events.push("finalize");
      return {};
    },
  };
  const adapter = createStubChildAdapter({ autoExtinction: false });
  const { supervisor, createAdapter, adapterCreated } = createStubSupervisor([adapter]);
  t.after(async () => supervisor.shutdown());
  const execution = runPreparedSpawn({
    mode: "child",
    argv: [process.execPath, "-e", ""],
    timeoutMs: 5_000,
    maxCapturedOutputChars: 8_192,
    captureOutput: false,
    onStdoutRaw: lifecycle.onStdoutRaw,
    onStderrRaw: lifecycle.onStderrRaw,
    onCancel: lifecycle.onCancel,
  }, undefined, supervisor, { lifecycle });
  await waitForAdapter(createAdapter, adapterCreated, execution);
  adapter.settle(0);
  adapter.settleExtinction();
  await assert.rejects(execution, /private transport invalid/);
  assert.deepEqual(events, ["accept", "finalize"]);
});
