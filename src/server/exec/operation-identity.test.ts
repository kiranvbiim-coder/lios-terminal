import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createProcessSupervisor } from "./supervisor";
import { createStubChildAdapter } from "./supervisor.test-support";
import { describeExecutionOperation, ExecutionOperationMismatchError, assertExecutionOperationBinding } from "./operation-identity";

const node = (script: string) => [process.execPath, "-e", script];

test("operation descriptor binds argv, cwd, effective environment and executable identity without exposing values", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-operation-identity-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const descriptor = await describeExecutionOperation({
    argv: node("process.stdout.write('ok')"),
    cwd,
    env: { LIOS_BINDING_TEST: "private-value" },
  });
  const executableStat = fs.statSync(fs.realpathSync(process.execPath), { bigint: true });
  assert.equal(descriptor.version, 1);
  assert.equal(descriptor.cwd, fs.realpathSync(cwd));
  assert.equal(descriptor.executable.path, fs.realpathSync(process.execPath));
  assert.match(descriptor.executable.sha256, /^[a-f0-9]{64}$/);
  assert.equal(descriptor.executable.mtimeNs, executableStat.mtimeNs.toString());
  assert.equal(descriptor.executable.ctimeNs, executableStat.ctimeNs.toString());
  assert.match(descriptor.environment.sha256, /^[a-f0-9]{64}$/);
  assert.ok(descriptor.environment.keys.includes("LIOS_BINDING_TEST"));
  assert.equal(descriptor.launch.argv0, process.execPath);
  assert.equal(descriptor.launch.stdin.mode, "pipe-closed");
  assert.equal(descriptor.launch.stdin.sha256, null);
  assert.equal(JSON.stringify(descriptor).includes("private-value"), false);
  assert.match(descriptor.digest, /^[a-f0-9]{64}$/);
});

test("operation binding rejects argument, cwd and environment drift", async (t) => {
  const first = fs.mkdtempSync(path.join(os.tmpdir(), "lios-operation-first-"));
  const second = fs.mkdtempSync(path.join(os.tmpdir(), "lios-operation-second-"));
  t.after(() => {
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  });
  const approved = await describeExecutionOperation({
    argv: node("process.stdout.write('one')"),
    cwd: first,
    env: { LIOS_BINDING_TEST: "one" },
  });
  await assert.rejects(
    () => assertExecutionOperationBinding({
      argv: node("process.stdout.write('two')"),
      cwd: first,
      env: { LIOS_BINDING_TEST: "one" },
    }, approved.digest),
    ExecutionOperationMismatchError,
  );
  await assert.rejects(
    () => assertExecutionOperationBinding({
      argv: node("process.stdout.write('one')"),
      cwd: second,
      env: { LIOS_BINDING_TEST: "one" },
    }, approved.digest),
    ExecutionOperationMismatchError,
  );
  await assert.rejects(
    () => assertExecutionOperationBinding({
      argv: node("process.stdout.write('one')"),
      cwd: first,
      env: { LIOS_BINDING_TEST: "two" },
    }, approved.digest),
    ExecutionOperationMismatchError,
  );
});


test("operation binding covers fixed stdin and launch semantics without storing stdin content", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-operation-stdin-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const input = "private command input";
  const approved = await describeExecutionOperation({
    argv: node("process.stdin.resume()"),
    cwd,
    input,
    argv0: "approved-node",
    windowsVerbatimArguments: false,
  });
  assert.equal(approved.launch.stdin.mode, "fixed-input");
  assert.equal(approved.launch.stdin.bytes, Buffer.byteLength(input));
  assert.match(approved.launch.stdin.sha256 ?? "", /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(approved).includes(input), false);
  await assert.rejects(
    () => assertExecutionOperationBinding({
      argv: node("process.stdin.resume()"),
      cwd,
      input: "changed input",
      argv0: "approved-node",
      windowsVerbatimArguments: false,
    }, approved.digest),
    ExecutionOperationMismatchError,
  );
  await assert.rejects(
    () => assertExecutionOperationBinding({
      argv: node("process.stdin.resume()"),
      cwd,
      input,
      argv0: "changed-node",
      windowsVerbatimArguments: false,
    }, approved.digest),
    ExecutionOperationMismatchError,
  );
  await assert.rejects(
    () => describeExecutionOperation({ argv: node("process.stdin.resume()"), cwd, stdinMode: "pipe-open" }),
    /cannot use inherited or open stdin/i,
  );
});


test("supervisor launches the exact verified snapshot rather than mutable caller inputs", { skip: process.platform === "win32" }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-operation-spawn-path-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(cwd);
  const cwdLink = path.join(root, "cwd-link");
  fs.symlinkSync(cwd, cwdLink);
  const executableLink = path.join(cwd, "approved-node");
  fs.symlinkSync(process.execPath, executableLink);
  const argv = [executableLink, "-e", "process.stdout.write('ok')"];
  const env = { LIOS_SNAPSHOT_TEST: "approved" };
  const approved = await describeExecutionOperation({ argv, cwd: cwdLink, env });
  const adapter = createStubChildAdapter();
  let seenArgv: string[] | undefined;
  let seenCwd: string | undefined;
  let seenEnv: NodeJS.ProcessEnv | undefined;
  let seenArgv0: string | undefined;
  const supervisor = createProcessSupervisor({
    createAdapter: (params) => {
      seenArgv = params.argv;
      seenCwd = params.cwd;
      seenEnv = params.env;
      seenArgv0 = params.argv0;
      return adapter;
    },
  });
  t.after(async () => { await supervisor.shutdown(); });
  const pending = supervisor.spawn({
    mode: "child",
    argv,
    cwd: cwdLink,
    env,
    expectedOperationDigest: approved.digest,
  });
  argv[1] = "--changed-after-admission";
  env.LIOS_SNAPSHOT_TEST = "changed-after-admission";
  const run = await pending;
  assert.equal(seenArgv?.[0], approved.executable.path);
  assert.equal(seenArgv?.[1], "-e");
  assert.equal(seenCwd, approved.cwd);
  assert.equal(seenEnv?.LIOS_SNAPSHOT_TEST, "approved");
  assert.equal(seenArgv0, executableLink);
  adapter.settle(0);
  assert.equal((await run.wait()).exitCode, 0);
});


test("analyzed mutable file drift invalidates the approved operation", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-operation-file-drift-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const script = path.join(cwd, "job.cjs");
  fs.writeFileSync(script, "module.exports = 1;\n");
  const argv = node("process.stdout.write('ok')");
  const approved = await describeExecutionOperation({ argv, cwd, filePaths: [script] });
  assert.equal(approved.files.length, 1);
  assert.equal(approved.files[0].path, fs.realpathSync(script));
  assert.match(approved.files[0].sha256, /^[a-f0-9]{64}$/);
  fs.writeFileSync(script, "module.exports = 2;\n");
  await assert.rejects(
    () => assertExecutionOperationBinding({ argv, cwd, filePaths: [script] }, approved.digest),
    ExecutionOperationMismatchError,
  );
});
