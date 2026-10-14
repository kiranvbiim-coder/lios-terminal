import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { callPythonService, stopPythonService, PythonServiceDataError } from "./pythonService";

test("Python request deadline and cancellation cover streamed result and error bodies", { timeout: 10_000 }, async (t) => {
  const keys = ["PYTHON_REMOTE_SERVICE_URL", "PYTHON_REMOTE_SERVICE_TOKEN", "LIOS_EXECUTION_ISOLATION"] as const;
  const saved = keys.map(key => [key, process.env[key]] as const);
  let headersArrived: (() => void) | undefined;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    if (String(args[0]).endsWith("/cancel")) {
      const decode = response.json.bind(response);
      response.json = () => { headersArrived?.(); return decode(); };
    }
    return response;
  };
  const server = http.createServer((req, res) => {
    const route = req.url?.replace(/^\/+/, "/");
    if (route === "/health") { res.end("ok"); return; }
    if (req.headers.authorization !== "Bearer deadline-test") { res.writeHead(401).end(); return; }
    if (route === "/complete") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"mean":2}'); return;
    }
    if (route === "/invalid") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end('{"detail":"Singular matrix"}'); return;
    }
    res.writeHead(route === "/stall-error" ? 400 : 200, { "content-type": "application/json" });
    res.write('{"unfinished":');
    // The connection deliberately never completes: only client abort should release it.
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  process.env.PYTHON_REMOTE_SERVICE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.PYTHON_REMOTE_SERVICE_TOKEN = "deadline-test";
  process.env.LIOS_EXECUTION_ISOLATION = "legacy-host";
  stopPythonService();
  t.after(async () => {
    stopPythonService();
    globalThis.fetch = nativeFetch;
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  // These integration probes exercise the native fetch body abort against a real
  // socket; fake clocks cannot drive Undici's network cancellation lifecycle.
  await t.test("stalled successful JSON is stopped by the computation deadline", async () => {
    await assert.rejects(callPythonService("/stall", {}, { timeoutMs: 100 }), { name: "TimeoutError" });
  });
  await t.test("stalled 4xx body cannot outlive the computation deadline", async () => {
    await assert.rejects(callPythonService("/stall-error", {}, { timeoutMs: 100 }), { name: "TimeoutError" });
  });
  await t.test("owner cancellation after headers aborts decoding without leaking its reason", async () => {
    const controller = new AbortController();
    const arrived = new Promise<void>(resolve => { headersArrived = resolve; });
    const result = callPythonService("/cancel", {}, { signal: controller.signal, timeoutMs: 2_000 });
    await arrived;
    controller.abort("PRIVATE_ABORT_SENTINEL");
    await assert.rejects(result, error => error instanceof Error && error.name === "AbortError"
      && !error.message.includes("PRIVATE_ABORT_SENTINEL"));
    headersArrived = undefined;
  });
  await t.test("complete result and model input rejection retain their semantics", async () => {
    assert.deepEqual(await callPythonService("/complete", {}, { timeoutMs: 500 }), { mean: 2 });
    await assert.rejects(callPythonService("/invalid", {}, { timeoutMs: 500 }), error =>
      error instanceof PythonServiceDataError && error.detail === "Singular matrix");
  });
});
