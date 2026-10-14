import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pythonRuntimeEnvOverlay } from "./env";
import { CommandExecutionError, describeCommandOperation, runCommand } from "./run-command";
import { ExecutionOperationMismatchError } from "./operation-identity";
import { ExecutionAuthorizationInvalidError } from "./execution-authorization";
import { createProcessSupervisor } from "./supervisor";

const node = (script: string) => [process.execPath, "-e", script];

test("one-shot command drains both output streams before returning", { timeout: 10_000 }, async () => {
  const result = await runCommand({
    argv: node("process.stdout.write(JSON.stringify({value:42})); process.stderr.write('diagnostic');"),
    timeoutMs: 5_000,
  });
  assert.deepEqual(JSON.parse(result.stdout), { value: 42 });
  assert.equal(result.stderr, "diagnostic");
});

test("a nonzero command result retains typed failure diagnostics, not success-shaped partial output", { timeout: 10_000 }, async () => {
  await assert.rejects(runCommand({
    argv: node("process.stdout.write('partial'); process.stderr.write('bad input'); process.exitCode=7;"),
    timeoutMs: 5_000,
  }), (error: unknown) => {
    assert.ok(error instanceof CommandExecutionError);
    assert.equal(error.result.exitCode, 7);
    assert.equal(error.result.stderr, "bad input");
    assert.equal(error.result.stdout, "partial");
    return true;
  });
});

test("capture overflow is rejected rather than returning truncated JSON", { timeout: 10_000 }, async () => {
  await assert.rejects(runCommand({
    argv: node("process.stdout.write(JSON.stringify({data:'x'.repeat(8192)}));"),
    timeoutMs: 5_000,
    maxOutputChars: 256,
  }), (error: unknown) => {
    assert.ok(error instanceof CommandExecutionError);
    assert.equal(error.result.stdoutTruncated, true);
    assert.ok(error.result.stdout.length <= 256);
    return true;
  });
});

test("an already-aborted request cannot admit a command or expose its reason", async () => {
  const sentinel = "PRIVATE_RUN_COMMAND_ABORT_SENTINEL";
  await assert.rejects(runCommand({
    argv: ["missing-executable"],
    timeoutMs: 5_000,
    signal: AbortSignal.abort(new Error(sentinel)),
  }), (error: unknown) => {
    assert.ok(error instanceof ExecutionAuthorizationInvalidError);
    assert.equal(error.reason, "cancelled");
    assert.equal(String(error).includes(sentinel), false);
    return true;
  });
});

test("rejects NODE_OPTIONS before child launch and never echoes its value", { timeout: 10_000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-exec-env-policy-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const marker = path.join(directory, "preload-ran");
  const preload = path.join(directory, "preload.cjs");
  fs.writeFileSync(preload, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "loaded")`);
  const injectedValue = `--require=${preload}`;
  await assert.rejects(runCommand({
    argv: node("process.stdout.write('launched')"),
    timeoutMs: 5_000,
    env: { NODE_OPTIONS: injectedValue },
  }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Unsafe child environment override: NODE_OPTIONS/);
    assert.ok(!error.message.includes(injectedValue));
    return true;
  });
  assert.equal(fs.existsSync(marker), false);
});

test("an approval-bound command runs only while its exact operation identity still matches", { timeout: 10_000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-exec-operation-binding-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const supervisor = createProcessSupervisor();
  t.after(() => supervisor.shutdown());
  const marker = path.join(directory, "launched");
  const argv = node(`require("node:fs").writeFileSync(${JSON.stringify(marker)}, "yes")`);
  const approved = await describeCommandOperation({
    argv,
    cwd: directory,
    env: { LIOS_OPERATION_TEST: "one" },
  });
  await runCommand({
    argv,
    cwd: directory,
    env: { LIOS_OPERATION_TEST: "one" },
    timeoutMs: 5_000,
    expectedOperationDigest: approved.digest,
  }, supervisor);
  assert.equal(fs.readFileSync(marker, "utf8"), "yes");
});

test("operation drift is rejected before child launch", { timeout: 10_000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-exec-operation-drift-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const marker = path.join(directory, "must-not-run");
  const argv = node(`require("node:fs").writeFileSync(${JSON.stringify(marker)}, "bad")`);
  const approved = await describeCommandOperation({
    argv,
    cwd: directory,
    env: { LIOS_OPERATION_TEST: "approved" },
  });
  await assert.rejects(runCommand({
    argv,
    cwd: directory,
    env: { LIOS_OPERATION_TEST: "changed" },
    timeoutMs: 5_000,
    expectedOperationDigest: approved.digest,
  }), ExecutionOperationMismatchError);
  assert.equal(fs.existsSync(marker), false);
});

test("fixed stdin drift is rejected before child launch", { timeout: 10_000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-exec-operation-stdin-drift-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const marker = path.join(directory, "must-not-run");
  const argv = node(`require("node:fs").writeFileSync(${JSON.stringify(marker)}, require("node:fs").readFileSync(0, "utf8"))`);
  const approved = await describeCommandOperation({ argv, cwd: directory, input: "approved" });
  await assert.rejects(runCommand({
    argv,
    cwd: directory,
    input: "changed",
    timeoutMs: 5_000,
    expectedOperationDigest: approved.digest,
  }), ExecutionOperationMismatchError);
  assert.equal(fs.existsSync(marker), false);
});

test("analyzed script drift is rejected before child launch", { timeout: 10_000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-exec-operation-file-drift-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const script = path.join(directory, "job.cjs");
  const marker = path.join(directory, "must-not-run");
  fs.writeFileSync(script, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "v1")`);
  const argv = [process.execPath, script];
  const approved = await describeCommandOperation({ argv, cwd: directory, operationFilePaths: [script] });
  fs.writeFileSync(script, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "v2")`);
  await assert.rejects(runCommand({
    argv,
    cwd: directory,
    operationFilePaths: [script],
    timeoutMs: 5_000,
    expectedOperationDigest: approved.digest,
  }), ExecutionOperationMismatchError);
  assert.equal(fs.existsSync(marker), false);
});

test("python-runtime profile preserves only its fixed environment keys", { timeout: 10_000 }, async () => {
  const result = await runCommand({
    argv: node("process.stdout.write(JSON.stringify({pythonPath:process.env.PYTHONPATH ?? null,nodeOptions:process.env.NODE_OPTIONS ?? null,other:process.env.OTHER ?? null}))"),
    timeoutMs: 5_000,
    env: pythonRuntimeEnvOverlay(
      { PYTHONPATH: "/runtime/python" },
      { PYTHONPATH: "/source/python", NODE_OPTIONS: "--require=/untrusted", OTHER: "private" },
    ),
    envProfile: "python-runtime",
  });
  assert.deepEqual(JSON.parse(result.stdout), {
    pythonPath: "/runtime/python",
    nodeOptions: null,
    other: null,
  });
});
