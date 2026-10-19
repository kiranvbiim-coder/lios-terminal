import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setImmediate as nextTurn, setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import {
  createExecutionPolicySnapshot,
  ExecutionAuthorizationInvalidError,
  ExecutionAuthorizationLease,
} from "../execution-authorization";
import { ExecutionOperationMismatchError } from "../operation-identity";
import { localExecutionBackend } from "../backends/local";
import { withConversationExecutionScope } from "../execution-scope";
import type {
  ExecutionBackend,
  ExecutionBackendLaunchPlan,
  ExecutionBackendRequest,
} from "../backends/types";
import { createStubChildAdapter, createStubSupervisor } from "../supervisor.test-support";
import {
  executePreparedGovernedCommand,
  GovernedCommandAdmissionError,
  GovernedCommandAnalysisError,
  prepareAnalyzedGovernedCommand,
  prepareInternalExecIntent,
} from "./governed-command";

const revision = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

function authorization(prepared: { approvalDigest: string; operation: { digest: string } }, source?: AbortSignal) {
  const now = Date.now();
  const policyRevision = revision("policy-v1");
  const lease = new ExecutionAuthorizationLease(
    createExecutionPolicySnapshot({
      permissionClass: "user_confirm",
      policyRevision,
      issuedAtMs: now - 1_000,
      expiresAtMs: now + 60_000,
    }),
    source ? [source] : [],
  );
  return {
    approvedOperationDigest: prepared.operation.digest,
    approvedDigest: prepared.approvalDigest,
    lease,
    currentPolicy: () => ({ permissionClass: "user_confirm" as const, policyRevision }),
  };
}

function request(
  argv: string[],
  cwd: string,
  overrides: Partial<ExecutionBackendRequest> = {},
): ExecutionBackendRequest {
  return {
    argv,
    cwd,
    isolation: { filesystem: "host", network: "inherit", processes: "host" },
    resources: { maxWallTimeMs: 5_000, maxCapturedOutputChars: 8_192 },
    ...overrides,
  };
}

function passthroughBackend(
  mutate?: (plan: ExecutionBackendLaunchPlan, source: ExecutionBackendRequest) => void,
): { backend: ExecutionBackend; calls: { count: number } } {
  const calls = { count: 0 };
  const backend: ExecutionBackend = {
    id: "test.execution.backend",
    capabilities: {
      filesystem: ["host"],
      network: ["inherit"],
      processes: ["host"],
      resourceControls: ["wall-time", "captured-output"],
    },
    async prepare(source) {
      calls.count += 1;
      const plan: ExecutionBackendLaunchPlan = {
        backendId: "test.execution.backend",
        spawn: {
          mode: "child",
          argv: [...source.argv],
          cwd: source.cwd,
          env: source.env ? { ...source.env } : undefined,
          envProfile: source.envProfile,
          timeoutMs: source.resources.maxWallTimeMs,
          maxCapturedOutputChars: source.resources.maxCapturedOutputChars,
          captureOutput: true,
          input: source.input,
          scopeKey: source.scopeKey,
        },
        signal: source.signal,
        facts: {
          isolation: { ...source.isolation },
          resources: { ...source.resources },
        },
      };
      mutate?.(plan, source);
      return plan;
    },
  };
  return { backend, calls };
}

async function waitForAdapter(createAdapter: ReturnType<typeof createStubSupervisor>["createAdapter"], ready: Promise<void>, execution: Promise<unknown>): Promise<void> {
  await Promise.race([ready, execution.then(() => { throw new Error("Execution finished before native adapter construction"); })]);
  await nextTurn();
  assert.equal(createAdapter.mock.calls.length, 1, "expected exactly one native adapter construction");
}

test("opaque privileged commands fail before backend admission or native construction", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-opaque-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const { backend, calls } = passthroughBackend();

  await assert.rejects(
    () => prepareAnalyzedGovernedCommand({
      backend,
      request: request(["curl", "https://example.invalid"], cwd),
    }),
    (error: unknown) => {
      assert.ok(error instanceof GovernedCommandAnalysisError);
      assert.equal(error.reason, "unclassified-command-operands");
      return true;
    },
  );
  assert.equal(calls.count, 0);
});

test("a backend cannot weaken admitted resource facts or launch bounds", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-backend-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const { backend } = passthroughBackend((plan) => {
    plan.spawn.timeoutMs = 6_000;
  });

  await assert.rejects(
    () => prepareAnalyzedGovernedCommand({
      backend,
      request: request([process.execPath, "-e", "process.stdout.write('ok')"], cwd),
    }),
    (error: unknown) => {
      assert.ok(error instanceof GovernedCommandAdmissionError);
      assert.equal(error.reason, "wall-time-weakened");
      return true;
    },
  );
});

test("a backend that reports its closed-stdin default is admitted for a request that never opted into stdin", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-stdin-default-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const { backend } = passthroughBackend((plan) => {
    plan.spawn.stdinMode = "pipe-closed";
  });

  const prepared = await prepareAnalyzedGovernedCommand({
    backend,
    request: request([process.execPath, "-e", "process.stdout.write('ok')"], cwd),
  });
  assert.equal(prepared.spawnSnapshot.stdinMode, "pipe-closed");
});

test("a backend still cannot open stdin that the request did not ask for", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-stdin-open-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const { backend } = passthroughBackend((plan) => {
    plan.spawn.stdinMode = "pipe-open";
  });

  await assert.rejects(
    () => prepareAnalyzedGovernedCommand({
      backend,
      request: request([process.execPath, "-e", "process.stdout.write('ok')"], cwd),
    }),
    (error: unknown) => {
      assert.ok(error instanceof GovernedCommandAdmissionError);
      assert.equal(error.reason, "backend-control-field-unsupported");
      return true;
    },
  );
});

test("backend hard resource ceilings may tighten but never relax the requested bounds", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-hard-cap-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const argv = [process.execPath, "-e", "process.stdout.write('ok')"];
  const { backend } = passthroughBackend((plan) => {
    plan.facts.resources.maxMemoryBytes = 128;
    plan.facts.resources.maxProcesses = 8;
  });
  const prepared = await prepareAnalyzedGovernedCommand({
    backend,
    request: request(argv, cwd, {
      resources: { maxWallTimeMs: 5_000, maxCapturedOutputChars: 8_192, maxMemoryBytes: 256 },
    }),
  });
  assert.equal(prepared.facts.resources.maxMemoryBytes, 128);
  assert.equal(prepared.facts.resources.maxProcesses, 8);

  const { backend: weakened } = passthroughBackend((plan) => {
    plan.facts.resources.maxMemoryBytes = 512;
  });
  await assert.rejects(
    () => prepareAnalyzedGovernedCommand({
      backend: weakened,
      request: request(argv, cwd, {
        resources: { maxWallTimeMs: 5_000, maxCapturedOutputChars: 8_192, maxMemoryBytes: 256 },
      }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof GovernedCommandAdmissionError);
      assert.equal(error.reason, "resource-facts-mismatch");
      return true;
    },
  );
});

test("backend cannot introduce a new cancellation source absent from the request", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-signal-injection-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const { backend } = passthroughBackend((plan) => {
    plan.signal = new AbortController().signal;
  });
  await assert.rejects(
    () => prepareAnalyzedGovernedCommand({
      backend,
      request: request([process.execPath, "-e", "process.stdout.write('no')"], cwd),
    }),
    (error: unknown) => {
      assert.ok(error instanceof GovernedCommandAdmissionError);
      assert.equal(error.reason, "authorization-signal-dropped");
      return true;
    },
  );
});

test("analyzed file drift is rejected before native construction", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-file-drift-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const script = path.join(cwd, "job.cjs");
  fs.writeFileSync(script, "process.stdout.write('v1');\n");

  const prepared = await prepareAnalyzedGovernedCommand({
    backend: localExecutionBackend,
    request: request([process.execPath, script], cwd),
  });
  assert.equal(prepared.operation.files.length, 1);
  fs.writeFileSync(script, "process.stdout.write('v2');\n");

  const adapter = createStubChildAdapter();
  const { supervisor, createAdapter } = createStubSupervisor([adapter]);
  t.after(async () => supervisor.shutdown());

  await assert.rejects(
    () => executePreparedGovernedCommand(prepared, authorization(prepared), supervisor),
    ExecutionOperationMismatchError,
  );
  assert.equal(createAdapter.mock.calls.length, 0);
});

test("a valid policy lease cannot authorize a different prepared admission digest", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-approval-digest-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const first = await prepareAnalyzedGovernedCommand({
    backend: localExecutionBackend,
    request: request([process.execPath, "-e", "process.stdout.write('one')"], cwd),
  });
  const second = await prepareAnalyzedGovernedCommand({
    backend: localExecutionBackend,
    request: request([process.execPath, "-e", "process.stdout.write('two')"], cwd),
  });
  assert.notEqual(first.approvalDigest, second.approvalDigest);

  const adapter = createStubChildAdapter();
  const { supervisor, createAdapter } = createStubSupervisor([adapter]);
  t.after(async () => supervisor.shutdown());
  const auth = authorization(first);

  await assert.rejects(
    () => executePreparedGovernedCommand(second, {
      ...auth,
      approvedOperationDigest: first.operation.digest,
      approvedDigest: first.approvalDigest,
    }, supervisor),
    (error: unknown) => {
      assert.ok(error instanceof GovernedCommandAdmissionError);
      assert.equal(error.reason, "approval-digest-mismatch");
      return true;
    },
  );
  assert.equal(createAdapter.mock.calls.length, 0);
});

test("a different independently approved operation digest cannot launch the prepared command", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-operation-approval-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const commandA = await prepareAnalyzedGovernedCommand({
    backend: localExecutionBackend,
    request: request([process.execPath, "-e", "process.stdout.write('A')"], cwd),
  });
  const commandB = await prepareAnalyzedGovernedCommand({
    backend: localExecutionBackend,
    request: request([process.execPath, "-e", "process.stdout.write('B')"], cwd),
  });
  assert.notEqual(commandA.operation.digest, commandB.operation.digest);
  const { supervisor, createAdapter } = createStubSupervisor([createStubChildAdapter()]);
  t.after(async () => supervisor.shutdown());

  await assert.rejects(
    () => executePreparedGovernedCommand(commandA, {
      ...authorization(commandA),
      approvedOperationDigest: commandB.operation.digest,
    }, supervisor),
    (error: unknown) => {
      assert.ok(error instanceof GovernedCommandAdmissionError);
      assert.equal(error.reason, "approval-digest-mismatch");
      return true;
    },
  );
  assert.equal(createAdapter.mock.calls.length, 0);
});

test("pre-prepare cancellation never exposes a private abort reason or calls the backend", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-pre-abort-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const sentinel = "PRIVATE_PREPARE_ABORT_SENTINEL";
  const { backend, calls } = passthroughBackend();
  await assert.rejects(
    () => prepareAnalyzedGovernedCommand({
      backend,
      request: request([process.execPath, "-e", "process.stdout.write('no')"], cwd, {
        signal: AbortSignal.abort(new Error(sentinel)),
      }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof ExecutionAuthorizationInvalidError);
      assert.equal(error.reason, "cancelled");
      assert.equal(String(error).includes(sentinel), false);
      return true;
    },
  );
  assert.equal(calls.count, 0);
});

test("policy drift between initial admission and final native fence creates no process", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-policy-drift-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const prepared = await prepareAnalyzedGovernedCommand({
    backend: localExecutionBackend,
    request: request([process.execPath, "-e", "process.stdout.write('ok')"], cwd),
  });

  const approvedRevision = revision("policy-v1");
  const changedRevision = revision("policy-v2");
  const now = Date.now();
  const lease = new ExecutionAuthorizationLease(createExecutionPolicySnapshot({
    permissionClass: "user_confirm",
    policyRevision: approvedRevision,
    issuedAtMs: now - 1_000,
    expiresAtMs: now + 60_000,
  }));
  let checks = 0;
  const adapter = createStubChildAdapter();
  const { supervisor, createAdapter } = createStubSupervisor([adapter]);
  t.after(async () => supervisor.shutdown());

  await assert.rejects(
    () => executePreparedGovernedCommand(prepared, {
      approvedOperationDigest: prepared.operation.digest,
      approvedDigest: prepared.approvalDigest,
      lease,
      currentPolicy: () => ({
        permissionClass: "user_confirm",
        policyRevision: checks++ === 0 ? approvedRevision : changedRevision,
      }),
    }, supervisor),
    (error: unknown) => {
      assert.ok(error instanceof ExecutionAuthorizationInvalidError);
      assert.equal(error.reason, "policy-changed");
      return true;
    },
  );
  assert.equal(checks, 2, "policy is checked before admission and again at the native construction fence");
  assert.equal(createAdapter.mock.calls.length, 0);
});

test("cancelled authorization creates no native process", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-cancel-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const source = new AbortController();
  const prepared = await prepareAnalyzedGovernedCommand({
    backend: localExecutionBackend,
    request: request([process.execPath, "-e", "process.stdout.write('ok')"], cwd, { signal: source.signal }),
  });
  source.abort(new Error("private cancellation reason"));

  const adapter = createStubChildAdapter();
  const { supervisor, createAdapter } = createStubSupervisor([adapter]);
  t.after(async () => supervisor.shutdown());

  await assert.rejects(
    () => executePreparedGovernedCommand(prepared, authorization(prepared, source.signal), supervisor),
    (error: unknown) => {
      assert.ok(error instanceof ExecutionAuthorizationInvalidError);
      assert.equal(error.reason, "cancelled");
      assert.equal(error.message.includes("private cancellation reason"), false);
      return true;
    },
  );
  assert.equal(createAdapter.mock.calls.length, 0);
});

test("run cancellation revokes a lease that was issued without any source signal", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-lease-revoke-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const run = new AbortController();
  const prepared = await prepareAnalyzedGovernedCommand({
    backend: localExecutionBackend,
    request: request([process.execPath, "-e", "process.stdout.write('ok')"], cwd, { signal: run.signal }),
  });
  const approved = authorization(prepared);
  assert.equal(approved.lease.active, true);
  run.abort(new Error("run cancelled"));

  const adapter = createStubChildAdapter();
  const { supervisor, createAdapter } = createStubSupervisor([adapter]);
  t.after(async () => supervisor.shutdown());

  await assert.rejects(
    () => executePreparedGovernedCommand(prepared, approved, supervisor),
    (error: unknown) => error instanceof ExecutionAuthorizationInvalidError && error.reason === "cancelled",
  );
  assert.equal(approved.lease.reason, "cancelled", "the approval is revoked by the cancellation, not merely closed afterwards");
  assert.equal(createAdapter.mock.calls.length, 0);
});

test("a private abort just before runner admission is sanitized and never constructs an adapter", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-runner-abort-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const controller = new AbortController();
  const prepared = await prepareAnalyzedGovernedCommand({
    backend: localExecutionBackend,
    request: request([process.execPath, "-e", "process.stdout.write('no')"], cwd, { signal: controller.signal }),
  });
  const { supervisor, createAdapter } = createStubSupervisor([createStubChildAdapter()]);
  t.after(async () => supervisor.shutdown());
  const sentinel = "PRIVATE_RUNNER_ABORT_SENTINEL";
  const auth = authorization(prepared);
  await assert.rejects(
    () => executePreparedGovernedCommand(prepared, {
      ...auth,
      currentPolicy: () => {
        controller.abort(new Error(sentinel));
        return auth.currentPolicy();
      },
    }, supervisor),
    (error: unknown) => {
      assert.ok(error instanceof ExecutionAuthorizationInvalidError);
      assert.equal(error.reason, "cancelled");
      assert.equal(String(error).includes(sentinel), false);
      return true;
    },
  );
  assert.equal(createAdapter.mock.calls.length, 0);
});

test("backend lifecycle is retained through native extinction and finalization before success", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-lifecycle-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const events: string[] = [];
  let finish!: () => void;
  let started!: () => void;
  const finalizationStarted = new Promise<void>((resolve) => { started = resolve; });
  const finalization = new Promise<void>((resolve) => { finish = resolve; });
  let retainedPlan: ExecutionBackendLaunchPlan | undefined;
  const { backend } = passthroughBackend((plan) => {
    retainedPlan = plan;
    plan.facts.runtimeGenerationId = "lios-exec-test-generation-00000001";
    plan.lifecycle = {
      onCancel() { events.push("cancel"); },
      async finalize() {
        events.push("finalize");
        started();
        await finalization;
      },
    };
    plan.spawn.onCancel = plan.lifecycle.onCancel;
  });
  const prepared = await prepareAnalyzedGovernedCommand({
    backend,
    request: request([process.execPath, "-e", "process.stdout.write('ok')"], cwd),
  });
  const savedPlan = retainedPlan as ExecutionBackendLaunchPlan | undefined;
  assert.ok(savedPlan);
  savedPlan.facts.runtimeGenerationId = "lios-exec-mutated-generation-00000002";
  savedPlan.lifecycle!.finalize = async () => { throw new Error("mutated backend finalization"); };
  assert.equal(prepared.facts.runtimeGenerationId, "lios-exec-test-generation-00000001");
  assert.equal(Object.isFrozen(prepared.facts), true);
  const adapter = createStubChildAdapter({ autoExtinction: false });
  const { supervisor, createAdapter, adapterCreated } = createStubSupervisor([adapter]);
  t.after(async () => supervisor.shutdown());
  let returned = false;
  const execution = executePreparedGovernedCommand(prepared, authorization(prepared), supervisor)
    .then((result) => { returned = true; return result; });
  await waitForAdapter(createAdapter, adapterCreated, execution);
  adapter.emitStdout("ok");
  adapter.settle(0);
  await delay(10);
  assert.deepEqual(events, [], "backend finalization cannot precede native extinction");
  assert.equal(returned, false);
  adapter.settleExtinction();
  await finalizationStarted;
  assert.deepEqual(events, ["finalize"]);
  assert.equal(returned, false, "completion waits for backend extinction proof");
  finish();
  assert.equal((await execution).stdout, "ok");
  assert.equal(returned, true);
});

test("cancel invokes backend hook before native termination and finalization failure fails closed", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-lifecycle-cancel-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const controller = new AbortController();
  const events: string[] = [];
  const { backend } = passthroughBackend((plan) => {
    plan.lifecycle = {
      onCancel() { events.push("backend-cancel"); },
      async finalize() {
        events.push("backend-finalize");
        throw new Error("backend extinction unproven");
      },
    };
    plan.spawn.onCancel = plan.lifecycle.onCancel;
  });
  const prepared = await prepareAnalyzedGovernedCommand({
    backend,
    request: request([process.execPath, "-e", "process.stdout.write('no')"], cwd, { signal: controller.signal }),
  });
  const adapter = createStubChildAdapter({
    onKill: () => {
      events.push("native-kill");
      adapter.settle(null, "SIGTERM");
    },
  });
  const { supervisor, createAdapter, adapterCreated } = createStubSupervisor([adapter]);
  t.after(async () => supervisor.shutdown());
  const execution = executePreparedGovernedCommand(prepared, authorization(prepared), supervisor);
  await waitForAdapter(createAdapter, adapterCreated, execution);
  controller.abort(new Error("private backend cancel"));
  await assert.rejects(execution, /backend extinction unproven/);
  assert.deepEqual(events, ["backend-cancel", "native-kill", "backend-finalize"]);
});

test("backend launch snapshots cannot be mutated after operation approval", { timeout: 15_000 }, async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-backend-snapshot-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  let retainedPlan: ExecutionBackendLaunchPlan | null = null;
  const { backend } = passthroughBackend((plan) => { retainedPlan = plan; });
  const prepared = await prepareAnalyzedGovernedCommand({
    backend,
    request: request([process.execPath, "-e", "process.stdout.write('approved')"], cwd),
  });
  assert.ok(retainedPlan);
  retainedPlan!.spawn.argv[2] = "process.stdout.write('mutated')";

  const adapter = createStubChildAdapter();
  const { supervisor, createAdapter } = createStubSupervisor([adapter]);
  let constructed!: () => void;
  const nativeConstruction = new Promise<void>((resolve) => { constructed = resolve; });
  createAdapter.mock.mockImplementation(() => {
    constructed();
    return adapter;
  });
  t.after(async () => {
    adapter.settle(0);
    await supervisor.shutdown();
  });
  const execution = executePreparedGovernedCommand(prepared, authorization(prepared), supervisor);
  // Admission hashes/revalidates the executable asynchronously; await the actual
  // construction event or surface its rejection, never a polling time allowance.
  await Promise.race([
    nativeConstruction,
    execution.then(() => { throw new Error("Execution completed before native construction."); }),
  ]);
  assert.equal(createAdapter.mock.calls[0]!.arguments[0].argv[2], "process.stdout.write('approved')");
  adapter.emitStdout("approved");
  adapter.settle(0);
  const result = await execution;
  assert.equal(result.stdout, "approved");
});

test("a prepared admission cannot be replayed under a different conversation scope", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-scope-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const firstRequestId = "11111111-1111-4111-8111-111111111111";
  const secondRequestId = "22222222-2222-4222-8222-222222222222";
  const adapter = createStubChildAdapter();
  const { supervisor, createAdapter } = createStubSupervisor([adapter]);
  t.after(async () => supervisor.shutdown());

  await withConversationExecutionScope(firstRequestId, async () => {
    const prepared = await prepareAnalyzedGovernedCommand({
      backend: localExecutionBackend,
      request: request([process.execPath, "-e", "process.stdout.write('ok')"], cwd),
    });
    await withConversationExecutionScope(secondRequestId, async () => {
      await assert.rejects(
        () => executePreparedGovernedCommand(prepared, authorization(prepared), supervisor),
        /Prepared execution scope does not match the active conversation scope/,
      );
    });
  });
  assert.equal(createAdapter.mock.calls.length, 0);
});

test("registered internal ExecIntent feeds exact mutable-file identity without becoming authorization", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-intent-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const script = path.join(cwd, "history.py");
  fs.writeFileSync(script, "print('ok')\n");

  const prepared = await prepareInternalExecIntent({
    backend: localExecutionBackend,
    intent: {
      intentId: "archive.zip.extract.python-stdlib",
      executable: process.execPath,
      archivePath: script,
      destinationPath: cwd,
    },
    cwd,
    isolation: { filesystem: "host", network: "inherit", processes: "host" },
  });
  assert.equal(prepared.facts.intent?.intentId, "archive.zip.extract.python-stdlib");
  assert.equal(prepared.operation.files.length, 1);
  assert.equal(prepared.operation.files[0]!.path, fs.realpathSync.native(script));
});

test("governed happy path reaches exactly one GM-10 native adapter", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-happy-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const prepared = await prepareAnalyzedGovernedCommand({
    backend: localExecutionBackend,
    request: request([process.execPath, "-e", "process.stdout.write('ok')"], cwd),
  });

  const adapter = createStubChildAdapter();
  const { supervisor, createAdapter, adapterCreated } = createStubSupervisor([adapter]);
  t.after(async () => supervisor.shutdown());
  const execution = executePreparedGovernedCommand(prepared, authorization(prepared), supervisor);
  await waitForAdapter(createAdapter, adapterCreated, execution);
  adapter.emitStdout("ok");
  adapter.settle(0);
  const result = await execution;

  assert.equal(result.stdout, "ok");
  assert.equal(createAdapter.mock.calls.length, 1);
});
