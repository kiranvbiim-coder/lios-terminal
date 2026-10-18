import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { callIsolatedPythonService, IsolatedPythonInputError } from "./isolatedPythonService";
import type { ExecutionBackendRequest } from "./exec/backends/types";
import type { ExecutionBackendRunResult, ExecutionBackendRunner } from "./exec/run-backend";

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-python-transport-test-"));
  const serviceDir = path.join(root, "service");
  fs.mkdirSync(serviceDir);
  fs.writeFileSync(path.join(serviceDir, "engine_worker.py"), "# trusted worker\n");
  fs.writeFileSync(path.join(serviceDir, "advanced_valuation.py"), "# trusted engine\n");
  fs.writeFileSync(path.join(serviceDir, "test_private.py"), "# not admitted\n");
  fs.writeFileSync(path.join(serviceDir, "conftest.py"), "# not admitted\n");
  fs.writeFileSync(path.join(serviceDir, "private.json"), "not admitted");
  fs.mkdirSync(path.join(serviceDir, "__pycache__"));
  const values = {
    LIOS_EXECUTION_ISOLATION: "legacy-host", // Explicit isolated calls still require the strict profile.
    LIOS_EXECUTION_SANDBOX_ENGINE: "docker",
    LIOS_EXECUTION_SANDBOX_TARGET: "unix:///var/run/docker.sock",
    LIOS_EXECUTION_SANDBOX_IMAGE: "sha256:" + "a".repeat(64),
    LIOS_EXECUTION_SANDBOX_PYTHON: "/opt/venv/bin/python",
    LIOS_EXECUTION_SANDBOX_USER: "10001:10001",
    LIOS_EXECUTION_SANDBOX_MAX_MEMORY_BYTES: String(2 * 1024 * 1024 * 1024),
    LIOS_EXECUTION_SANDBOX_MAX_PROCESSES: "128",
    LIOS_EXECUTION_SANDBOX_WORKSPACE_BYTES: String(128 * 1024 * 1024),
    LIOS_EXECUTION_SANDBOX_SHELL: "/bin/sh",
    LIOS_EXECUTION_SANDBOX_BASE64: "/usr/bin/base64",
    LIOS_EXECUTION_SANDBOX_TAR: "/bin/tar",
    LIOS_EXECUTION_SANDBOX_NODE: "/usr/bin/node",
    LIOS_EXECUTION_SANDBOX_XLSX: "/opt/lios/node_modules/xlsx",
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, serviceDir };
}

function result(request: ExecutionBackendRequest, payload: unknown): ExecutionBackendRunResult {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
  return {
    backendId: "lios.execution.docker",
    facts: { isolation: request.isolation, resources: request.resources },
    exit: {
      reason: "exit", exitCode: 0, exitSignal: null, durationMs: 1,
      stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false,
      timedOut: false, noOutputTimedOut: false,
    },
    finalization: {
      workspaceOutputs: [{ path: "result.json", size: data.length,
        sha256: crypto.createHash("sha256").update(data).digest("hex"), data }],
    },
  };
}

const ROUTE = "/advanced/valuation/reverse-dcf";

test("strict numerical transport snapshots only direct approved sources and uses canonical isolation", async (t) => {
  const f = fixture(t);
  const controller = new AbortController();
  let stagingRoot = "";
  const runner: ExecutionBackendRunner = async (backend, request) => {
    assert.equal(backend.id, "lios.execution.docker");
    stagingRoot = request.workspaceTransfer!.root;
    assert.deepEqual(request.argv, ["/opt/venv/bin/python", "/workspace/engine_worker.py",
      "/workspace/request.json", "/workspace/result.json"]);
    assert.equal(request.argv.join(" ").includes(f.root), false);
    assert.equal(request.env, undefined);
    assert.equal(request.input, undefined);
    assert.equal(request.cwd, undefined);
    assert.equal(request.signal, controller.signal);
    assert.deepEqual(request.isolation, { filesystem: "sandbox", network: "deny", processes: "sandbox" });
    assert.deepEqual(request.resources, { maxWallTimeMs: 7_321, maxCapturedOutputChars: 4_096,
      maxMemoryBytes: 1024 * 1024 * 1024, maxProcesses: 32 });
    assert.deepEqual(request.workspaceTransfer!.inputs, ["advanced_valuation.py", "engine_worker.py", "request.json"]);
    assert.deepEqual(request.workspaceTransfer!.outputs, ["result.json"]);
    assert.equal(request.workspaceTransfer!.mode, "write-return");
    assert.deepEqual(fs.readdirSync(stagingRoot).sort(), request.workspaceTransfer!.inputs);
    assert.equal(fs.readFileSync(path.join(stagingRoot, "advanced_valuation.py"), "utf8"), "# trusted engine\n");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(stagingRoot, "request.json"), "utf8")),
      { route: ROUTE, body: { targetPrice: 10 } });
    return result(request, { ok: true, result: { impliedGrowth: 0, error: 0 } });
  };
  assert.deepEqual(await callIsolatedPythonService(ROUTE, { targetPrice: 10 },
    { serviceDir: f.serviceDir, signal: controller.signal, timeoutMs: 7_321, runner }),
  { impliedGrowth: 0, error: 0 });
  assert.equal(fs.existsSync(stagingRoot), false);
});

test("input/domain and unavailable errors stay distinct, bounded, and clean up", async (t) => {
  const f = fixture(t);
  for (const kind of ["input", "unavailable"] as const) {
    let stagingRoot = "";
    await assert.rejects(callIsolatedPythonService(ROUTE, {}, { serviceDir: f.serviceDir,
      runner: async (_backend, request) => {
        stagingRoot = request.workspaceTransfer!.root;
        return result(request, { ok: false, error: { kind, message: "x".repeat(9_000) } });
      } }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error instanceof IsolatedPythonInputError, kind === "input");
      assert.ok(error.message.length <= 4_100);
      assert.ok(error.message.endsWith("x".repeat(4_000)));
      return true;
    });
    assert.equal(fs.existsSync(stagingRoot), false);
  }
});

test("unsafe, non-finite, malformed and ambiguous worker protocols are rejected", async (t) => {
  const f = fixture(t);
  const payloads = [
    Buffer.from("not-json"), Buffer.from([0xff]), Buffer.from('{"ok":true,"result":1e999}'),
    null, [], { ok: true }, { ok: "true", result: 10 },
    { ok: true, result: 10, error: "extra" },
    { ok: false, error: { kind: "execution", message: "bad" } },
    { ok: false, error: { kind: "input", message: "" } },
    { ok: false, error: { kind: "input", message: "bad", input: "private" } },
  ];
  for (const payload of payloads) {
    let stagingRoot = "";
    await assert.rejects(callIsolatedPythonService(ROUTE, {}, { serviceDir: f.serviceDir,
      runner: async (_backend, request) => {
        stagingRoot = request.workspaceTransfer!.root;
        return result(request, payload);
      } }), /malformed JSON|invalid result protocol/);
    assert.equal(fs.existsSync(stagingRoot), false);
  }
});

test("missing, extra, oversized and inconsistent result files fail closed", async (t) => {
  const f = fixture(t);
  for (const variant of ["missing", "extra", "path", "empty", "size", "oversized"] as const) {
    let stagingRoot = "";
    await assert.rejects(callIsolatedPythonService(ROUTE, {}, { serviceDir: f.serviceDir,
      runner: async (_backend, request) => {
        stagingRoot = request.workspaceTransfer!.root;
        const response = result(request, { ok: true, result: 10 });
        const file = response.finalization.workspaceOutputs![0]!;
        if (variant === "missing") response.finalization = {};
        if (variant === "extra") response.finalization.workspaceOutputs!.push({ ...file });
        if (variant === "path") file.path = "elsewhere.json";
        if (variant === "empty") { file.data = Buffer.alloc(0); file.size = 0; }
        if (variant === "size") file.size += 1;
        if (variant === "oversized") { file.data = Buffer.alloc(8 * 1024 * 1024 + 1); file.size = file.data.length; }
        return response;
      } }), /declared result file|inconsistent, or oversized/);
    assert.equal(fs.existsSync(stagingRoot), false);
  }
});

test("private backend errors, diagnostics and caller cancellation reasons never escape", async (t) => {
  const f = fixture(t);
  for (const variant of ["throw", "exit", "timeout"] as const) {
    let stagingRoot = "";
    await assert.rejects(callIsolatedPythonService(ROUTE, { secret: "private-body" }, { serviceDir: f.serviceDir,
      runner: async (_backend, request) => {
        stagingRoot = request.workspaceTransfer!.root;
        if (variant === "throw") throw new Error("private-body private-host");
        const response = result(request, { ok: true, result: 10 });
        response.exit.exitCode = 1;
        response.exit.stderr = "private-body private-host";
        response.exit.stdout = "private-body";
        if (variant === "timeout") { response.exit.reason = "overall-timeout"; response.exit.timedOut = true; }
        return response;
      } }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes("private-"), false);
      if (variant === "timeout") {
        assert.ok(error instanceof DOMException);
        assert.equal(error.name, "TimeoutError");
        assert.match(error.message, /execution deadline/);
      }
      return true;
    });
    assert.equal(fs.existsSync(stagingRoot), false);
  }
  const controller = new AbortController();
  controller.abort(new Error("private-body"));
  let launched = false;
  await assert.rejects(callIsolatedPythonService(ROUTE, {}, { serviceDir: f.serviceDir,
    signal: controller.signal, runner: async () => { launched = true; throw new Error(); } }),
  { name: "AbortError", message: "Isolated Python request cancelled." });
  assert.equal(launched, false);
});

test("either authoritative deadline fact produces TimeoutError without returning a result", async (t) => {
  const f = fixture(t);
  for (const variant of ["reason", "flag"] as const) {
    let stagingRoot = "";
    await assert.rejects(callIsolatedPythonService(ROUTE, { secret: "private-body" }, {
      serviceDir: f.serviceDir,
      runner: async (_backend, request) => {
        stagingRoot = request.workspaceTransfer!.root;
        const response = result(request, { ok: true, result: "must-not-return" });
        response.exit.stderr = "private-body private-engine";
        if (variant === "reason") response.exit.reason = "overall-timeout";
        else response.exit.timedOut = true;
        return response;
      },
    }), (error: unknown) => {
      assert.ok(error instanceof DOMException);
      assert.equal(error.name, "TimeoutError");
      assert.equal(error.message, "Isolated Python worker exceeded its execution deadline.");
      return true;
    });
    assert.equal(fs.existsSync(stagingRoot), false);
  }
});

test("cancellation waits for the runner extinction/finalization join before staging cleanup", async (t) => {
  const f = fixture(t);
  const controller = new AbortController();
  let stagingRoot = "";
  let release!: () => void;
  const extinction = new Promise<void>((resolve) => { release = resolve; });
  let settled = false;
  const running = callIsolatedPythonService(ROUTE, {}, { serviceDir: f.serviceDir, signal: controller.signal,
    runner: async (_backend, request) => {
      stagingRoot = request.workspaceTransfer!.root;
      controller.abort("private-reason");
      await extinction;
      assert.equal(fs.existsSync(stagingRoot), true);
      return result(request, { ok: true, result: 10 });
    } });
  const rejected = assert.rejects(running, { name: "AbortError", message: "Isolated Python request cancelled." })
    .then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(fs.existsSync(stagingRoot), true);
  release();
  await rejected;
  assert.equal(fs.existsSync(stagingRoot), false);
});

test("input and timeout bounds are enforced before backend admission without private echoes", async (t) => {
  const f = fixture(t);
  let launches = 0;
  const runner: ExecutionBackendRunner = async () => { launches += 1; throw new Error(); };
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  for (const body of [NaN, Infinity, { value: -Infinity }, undefined, BigInt(1), circular,
    { private: "x".repeat(8 * 1024 * 1024) }, { toJSON() { throw new Error("private-body"); } }]) {
    await assert.rejects(callIsolatedPythonService(ROUTE, body, { serviceDir: f.serviceDir, runner }),
      (error: unknown) => error instanceof IsolatedPythonInputError && !error.message.includes("private-body"));
  }
  for (const timeoutMs of [0, -1, 0.5, NaN, Infinity, 300_001]) {
    await assert.rejects(callIsolatedPythonService(ROUTE, {}, { serviceDir: f.serviceDir, timeoutMs, runner }),
      IsolatedPythonInputError);
  }
  await assert.rejects(callIsolatedPythonService("../../private", {}, { serviceDir: f.serviceDir, runner }),
    IsolatedPythonInputError);
  assert.equal(launches, 0);
});

test("unsafe, absent and over-budget source snapshots never reach the backend and leave no staging files", async (t) => {
  const f = fixture(t);
  const staging = t.mock.method(fs, "mkdtempSync");
  let launches = 0;
  const runner: ExecutionBackendRunner = async () => { launches += 1; throw new Error(); };
  const options = { serviceDir: f.serviceDir, runner };
  fs.unlinkSync(path.join(f.serviceDir, "engine_worker.py"));
  await assert.rejects(callIsolatedPythonService(ROUTE, {}, options), /trusted regular Python sources/);
  fs.symlinkSync("advanced_valuation.py", path.join(f.serviceDir, "engine_worker.py"));
  await assert.rejects(callIsolatedPythonService(ROUTE, {}, options), /trusted regular Python sources/);
  fs.unlinkSync(path.join(f.serviceDir, "engine_worker.py"));
  fs.mkdirSync(path.join(f.serviceDir, "engine_worker.py"));
  await assert.rejects(callIsolatedPythonService(ROUTE, {}, options), /trusted regular Python sources/);
  fs.rmdirSync(path.join(f.serviceDir, "engine_worker.py"));
  fs.writeFileSync(path.join(f.serviceDir, "engine_worker.py"), "# trusted\n");
  fs.truncateSync(path.join(f.serviceDir, "engine_worker.py"), 4 * 1024 * 1024 + 1);
  await assert.rejects(callIsolatedPythonService(ROUTE, {}, options), /trusted regular Python sources/);
  fs.truncateSync(path.join(f.serviceDir, "engine_worker.py"), 4 * 1024 * 1024);
  for (let index = 0; index < 4; index += 1) {
    const filename = path.join(f.serviceDir, `source_${index}.py`);
    fs.writeFileSync(filename, "");
    fs.truncateSync(filename, 4 * 1024 * 1024);
  }
  await assert.rejects(callIsolatedPythonService(ROUTE, {}, options), /trusted regular Python sources/);
  fs.truncateSync(path.join(f.serviceDir, "engine_worker.py"), 0);
  for (let index = 0; index < 64; index += 1) {
    fs.writeFileSync(path.join(f.serviceDir, `source_${index}.py`), "");
  }
  await assert.rejects(callIsolatedPythonService(ROUTE, {}, options), /trusted regular Python sources/);
  assert.equal(launches, 0);
  assert.ok(staging.mock.calls.length >= 6);
  for (const call of staging.mock.calls) assert.equal(fs.existsSync(call.result), false);
});

test("missing strict runtime configuration is explicit and cannot fall back", async (t) => {
  const f = fixture(t);
  delete process.env.LIOS_EXECUTION_SANDBOX_IMAGE;
  let launched = false;
  await assert.rejects(callIsolatedPythonService(ROUTE, {}, { serviceDir: f.serviceDir,
    runner: async () => { launched = true; throw new Error(); } }), /immutable sha256 digest/);
  assert.equal(launched, false);
});
